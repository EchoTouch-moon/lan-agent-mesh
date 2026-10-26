import { execFile } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { chmodSync, copyFileSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync, unlinkSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { MeshError, type AdapterEvent, type HarnessAdapter, type SendInput } from '@lam/adapter-sdk';
import { IdSchema, WorkspaceAliasSchema, TimestampSchema, SessionSchema, type Session, type Capabilities } from '@lam/domain';
import { privateDirectory, type PrivateLease } from '@lam/private-storage';
import { Store } from '@lam/storage';
import { ZcodeRpc } from './rpc.js';

export interface ZcodeOptions {
  nodeId: string;
  /** Absolute path of the installed bundled CLI entry (a .cjs executed with the current Node). No discovery. */
  executable: string;
  /** Dedicated adapter-owned directory; an existing nonempty unmarked directory is refused. */
  home: string;
  workspaces: Record<string, string>;
  /** This first slice intentionally enables loopback fixtures only, never production credentials. */
  fixtureBaseUrl: string;
  expectedVersion: '0.17.0';
  /** Absolute path of the shipped builtin provider config; required for the native CLI, omitted for synthetic peers. */
  builtinConfig?: string;
  /** Session mode for spawned sessions; 'build' surfaces native permission requests for tool calls, 'plan' (default) does not ask for this CLI generation. */
  mode?: 'plan' | 'build';
  /** Optional pinned sha256 of the executable; when provided, a mismatch refuses to open (fail closed). */
  expectedExecutableSha256?: string;
}
type Run = { input: SendInput; inputId: string; fingerprint: string; events: AdapterEvent[]; terminal: boolean };
type NativeObject = Record<string, unknown>;
function object(v: unknown): NativeObject {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Invalid native object');
  return v as NativeObject;
}
function id(v: unknown): string { return IdSchema.parse(v); }
const capabilities: Capabilities = {
  discover: 'supported', spawn: 'supported', resume: 'supported', send: 'supported', watch: 'supported',
  cancel: 'supported', answerPermission: 'unsupported', attachExistingGui: 'unsupported',
};
const modelSelection = { providerId: 'lam-zcode-fixture', modelId: 'lam-zcode-fixture', options: { reasoningLevel: 'disabled' } } as const;

/** Gateway-owned ZCode sessions. No GUI attach, token import, automatic approval or ambiguous replay. */
export class ZcodeAdapter implements HarnessAdapter {
  private rpc!: ZcodeRpc;
  private store!: Store;
  private lease!: PrivateLease;
  private readonly sessions = new Map<string, Session>();
  private readonly runs = new Map<string, Run>();
  private readonly wake = new Set<() => void>();
  private readonly active = new Map<string, Run>();
  private readonly locks = new Set<string>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private online = false;
  private closing: Promise<void> | undefined;
  private denials = 0;
  private locked = false;
  readonly agentId: string;
  readonly executableSha256: string;
  private constructor(private readonly options: ZcodeOptions) {
    this.agentId = id(`${options.nodeId}/zcode/default`);
    this.executableSha256 = createHash('sha256').update(readFileSync(options.executable)).digest('hex');
  }
  static async open(options: ZcodeOptions): Promise<ZcodeAdapter> {
    // Native entries are verified on darwin only for this slice; other platforms stay unknown, not guessed.
    if (process.platform !== 'darwin') throw new MeshError('unsupported', 'ZCode executable is not verified on this platform');
    const fixture = new URL(options.fixtureBaseUrl);
    if (fixture.protocol !== 'http:' || fixture.hostname !== '127.0.0.1' || fixture.username || fixture.password || fixture.search || fixture.hash || fixture.pathname !== '/v1')
      throw new MeshError('permission_denied', 'Only explicit loopback /v1 fixtures are enabled');
    if (options.expectedVersion !== '0.17.0' || !isAbsolute(options.executable) || !isAbsolute(options.home))
      throw new MeshError('unsupported', 'Explicit verified ZCode executable and home required');
    if (options.builtinConfig !== undefined && !isAbsolute(options.builtinConfig))
      throw new MeshError('unsupported', 'Builtin provider config must be an absolute path');
    if (options.mode !== undefined && !['plan', 'build'].includes(options.mode))
      throw new MeshError('invalid_message', "Mode must be 'plan' or 'build'");
    if (options.expectedExecutableSha256 !== undefined && !/^[0-9a-f]{64}$/.test(options.expectedExecutableSha256))
      throw new MeshError('invalid_message', 'Expected executable sha256 must be 64 lowercase hex characters');
    const workspaces = Object.fromEntries(Object.entries(options.workspaces).map(([alias, path]) => {
      WorkspaceAliasSchema.parse(alias);
      if (!isAbsolute(path) || realpathSync(path) !== resolve(path)) throw new MeshError('permission_denied', 'Workspace must be a canonical local directory');
      return [alias, path];
    }));
    if (!Object.keys(workspaces).length || Object.keys(workspaces).length > 64)
      throw new MeshError('invalid_message', 'Register between one and 64 workspace aliases');
    const adapter = new ZcodeAdapter({ ...options, home: resolve(options.home), workspaces });
    if (options.expectedExecutableSha256 !== undefined && adapter.executableSha256 !== options.expectedExecutableSha256)
      throw new MeshError('unsupported', 'Executable sha256 does not match the pinned value');
    try { await adapter.start(); return adapter; }
    catch (error) {
      if (process.env.LAM_ZCODE_ADAPTER_DEBUG === '1')
        console.error('zcode-adapter open failed:', String((error as Error)?.message ?? error).replaceAll(adapter.options.home, '<home>'));
      await adapter.close(); throw new MeshError('internal', 'ZCode initialization refused; inspect executable, private home and version');
    }
  }
  private env(): NodeJS.ProcessEnv {
    // Never inherit ZCODE_*, provider credentials, proxy settings or user config roots.
    const home = this.options.home;
    return { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home,
      XDG_CONFIG_HOME: join(home, 'xdg-config'), XDG_DATA_HOME: join(home, 'xdg-data'),
      ZCODE_DATA_BASE_DIR: home, ZCODE_STORAGE_DIR: join(home, 'storage'),
      ZCODE_SESSION_DB_PATH: join(home, 'sessions.sqlite'), ZCODE_LOG_DIR: join(home, 'logs'),
      TMPDIR: home, LANG: 'en_US.UTF-8' };
  }
  private async start() {
    const home = this.options.home;
    try { mkdirSync(home, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    await this.openOwnedHome();
  }
  private async openOwnedHome() {
    const home = this.options.home, marker = 'lam-owned.json';
    this.lease = await privateDirectory(home, { files: [marker, 'adapter.lock', 'adapter.sqlite', 'adapter.sqlite-wal', 'adapter.sqlite-shm', 'builtin.json', 'personal.json'] });
    const entries = readdirSync(home);
    const signature = createHash('sha256').update(JSON.stringify([this.options.nodeId, this.options.executable, this.executableSha256, this.options.workspaces, this.options.expectedVersion])).digest('hex');
    if (!entries.length) writeFileSync(join(home, marker), signature, { mode: 0o600, flag: 'wx' });
    else if (!entries.includes(marker)) throw new Error('Home is not adapter owned');
    else if (readFileSync(join(home, marker), 'utf8') !== signature) throw new Error('Home registration changed');
    const lock = join(home, 'adapter.lock');
    try { writeFileSync(lock, String(process.pid), { mode: 0o600, flag: 'wx' }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      // A dead parent PID does not prove its native child or tools have stopped.
      // Refuse stale locks too; never restart a second app-server against uncertain history.
      throw new Error('Home is active or requires operator crash cleanup');
    }
    this.locked = true;
    this.lease.assertActive();
    if (this.options.builtinConfig) {
      copyFileSync(this.options.builtinConfig, join(home, 'builtin.json'));
      // copyFileSync preserves the source mode; the owned home requires 0600 files.
      chmodSync(join(home, 'builtin.json'), 0o600);
    }
    writeFileSync(join(home, 'personal.json'), JSON.stringify({ schemaVersion: 1, config: {
      providerConfigRules: { providerRules: [{ providerId: modelSelection.providerId, providerName: 'LAM ZCode Fixture', config: {
        group: 'standard-personal', access: { type: 'api-key', apiKey: 'lam-local-fixture-not-a-real-key' },
        api: { type: 'openai-chat-completions', baseUrl: this.options.fixtureBaseUrl }, personalModelIds: [modelSelection.modelId],
      } }] }, modelConfigRules: { providerModelRules: [], manualProviderModelRules: [] }, defaultModelSelection: modelSelection,
    } }), { mode: 0o600 });
    const version = await promisify(execFile)(process.execPath, [this.options.executable, '--version'], { cwd: home, env: this.env(), timeout: 15000, maxBuffer: 4096 });
    if (version.stdout.trim() !== this.options.expectedVersion) throw new Error('Unverified version');
    this.store = new Store(join(home, 'adapter.sqlite'));
    for (const session of this.store.list<Session>('sessions')) this.sessions.set(session.id, SessionSchema.parse(session));
    for (const run of this.store.list<Run>('nodes')) {
      this.runs.set(run.input.taskId, run);
      if (!run.terminal) this.emit(run, { type: 'unknown', taskId: run.input.taskId, reason: 'Adapter restarted; never replay an ambiguous turn' });
      if (run.events.at(-1)?.type === 'unknown') this.active.set(run.input.sessionId, run);
    }
    const env = this.env();
    if (this.options.builtinConfig) env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE = join(home, 'builtin.json');
    env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE = join(home, 'personal.json');
    this.rpc = new ZcodeRpc(process.execPath, [this.options.executable, 'app-server', '--cwd', home], env, home,
      message => {
        if (message.id !== undefined && message.method) {
          this.rpc.deny(message.id, message.method);
          if (message.method === 'interaction/requestPermission') this.denials++;
          return;
        }
        this.notification(message.method ?? '', message.params);
      }, () => this.lost());
    await this.rpc.call('runtime/capabilities', {});
    this.online = true;
    this.lease.onLost(() => { this.lost(); void this.close(); });
  }
  private assertOnline() {
    this.lease.assertActive();
    if (!this.online) throw new MeshError('unsupported', 'ZCode adapter is offline');
  }
  private lost() {
    this.online = false;
    for (const run of this.active.values()) if (!run.terminal)
      this.emit(run, { type: 'unknown', taskId: run.input.taskId, reason: 'Native process lost; never auto-replay' });
  }
  private emit(run: Run, event: AdapterEvent) {
    if (run.terminal) return;
    run.events.push(event);
    if (!['delta', 'permission'].includes(event.type)) {
      clearTimeout(this.timers.get(run.input.taskId)); this.timers.delete(run.input.taskId);
      run.terminal = true;
      if (event.type !== 'unknown') this.active.delete(run.input.sessionId);
      const session = this.sessions.get(run.input.sessionId);
      if (session) { session.state = event.type === 'unknown' ? 'running' : 'idle'; this.store.put('sessions', session.id, session); }
    }
    this.store.put('nodes', run.input.taskId, run);
    for (const wake of this.wake) wake();
  }
  private notification(method: string, value: unknown) {
    if (method !== 'session/event') return;
    const params = object(value);
    const payload = object(params.payload);
    if (process.env.LAM_ZCODE_ADAPTER_DEBUG === '1')
      this.debugEvents.push({ type: String(params.type), payloadKeys: Object.keys(payload), inputId: typeof payload.inputId === 'string' ? payload.inputId : null, sessionId: typeof params.sessionId === 'string' ? params.sessionId : null, kind: typeof payload.kind === 'string' ? payload.kind : null });
    const inputId = typeof payload.inputId === 'string' ? payload.inputId : undefined;
    // Lifecycle events carry inputId; model.streaming deltas do NOT (native shape, verified
    // against the installed CLI) — attribute those through the session's serialized active run.
    const nativeSessionId = typeof params.sessionId === 'string' ? params.sessionId : undefined;
    let run: Run | undefined;
    if (inputId !== undefined) {
      run = [...this.runs.values()].find(r => r.inputId === inputId);
      // Cross-check session ownership: an inputId-keyed terminal from a foreign session must
      // never close a run that belongs to another session.
      if (run && nativeSessionId !== undefined) {
        const owner = this.sessions.get(run.input.sessionId);
        if (owner?.nativeSessionId !== nativeSessionId) run = undefined;
      }
    }
    else if (nativeSessionId !== undefined) {
      const session = [...this.sessions.values()].find(s => s.nativeSessionId === nativeSessionId);
      run = session ? this.active.get(session.id) : undefined;
    } else if (this.active.size === 1) run = [...this.active.values()][0]!;
    if (!run || run.terminal) return; // events for unknown or replayed turns are dropped, never guessed
    if (params.type === 'model.streaming' && payload.kind === 'text_delta') {
      const text = payload.delta;
      if (typeof text !== 'string') throw new Error('Invalid native delta');
      if (run.events.length >= 4090 || run.events.reduce((n, e) => n + (e.type === 'delta' ? e.text.length : 0), 0) + text.length > 32768)
        throw new Error('Native stream capacity exceeded');
      this.emit(run, { type: 'delta', taskId: run.input.taskId, text });
    } else if (params.type === 'turn.completed') {
      if (payload.resultType === 'success')
        this.emit(run, { type: 'completed', taskId: run.input.taskId, text: run.events.flatMap(e => e.type === 'delta' ? [e.text] : []).join('') });
      else if (payload.resultType === 'cancelled') this.emit(run, { type: 'cancelled', taskId: run.input.taskId });
      else if (typeof payload.resultType === 'string') this.emit(run, { type: 'failed', taskId: run.input.taskId, code: 'internal' });
      else throw new Error('Unknown native terminal result');
    } else if (params.type === 'turn.failed') {
      this.emit(run, { type: 'failed', taskId: run.input.taskId, code: 'internal' });
    }
  }
  async probe() { return { available: this.online, kind: 'zcode' as const, version: this.options.expectedVersion, capabilities: { ...capabilities } }; }
  async discover() {
    this.assertOnline();
    return [{ id: this.agentId, nodeId: this.options.nodeId, harnessId: `${this.options.nodeId}/zcode`,
      name: 'ZCode (isolated fixture)', workspaceAliases: Object.keys(this.options.workspaces), capabilities: { ...capabilities } }];
  }
  async spawn(input: { agentId: string; workspaceAlias: string }) {
    this.assertOnline();
    const cwd = this.options.workspaces[input.workspaceAlias];
    if (input.agentId !== this.agentId || !Object.hasOwn(this.options.workspaces, input.workspaceAlias) || !cwd)
      throw new MeshError('permission_denied', 'Agent or workspace not registered');
    if (this.sessions.size + this.locks.size >= 100) throw new MeshError('busy', 'Session capacity reached');
    const reservation = randomUUID(); this.locks.add(reservation);
    try {
      // The create reply echoes the native sessionId; subscribe ties event delivery to this connection.
      const requested = `sess_${randomUUID()}`;
      const result = object(await this.rpc.call('session/create', { sessionId: requested, workspace: { workspacePath: cwd, workspaceKey: cwd }, model: modelSelection, persistence: 'immediate', mode: this.options.mode ?? 'plan', titleGenerationEnabled: false }));
      const session = SessionSchema.parse({ id: randomUUID(), nativeSessionId: id(typeof result.sessionId === 'string' ? result.sessionId : requested), nodeId: this.options.nodeId,
        agentId: this.agentId, workspaceAlias: input.workspaceAlias, state: 'idle', createdAt: new Date().toISOString() });
      await this.rpc.call('session/subscribe', { sessionId: session.nativeSessionId, deliveryKind: 'desktop-continuous' });
      this.sessions.set(session.id, session); this.store.put('sessions', session.id, session); return structuredClone(session);
    } finally { this.locks.delete(reservation); }
  }
  async resume(sessionId: string) {
    this.assertOnline(); const session = this.session(sessionId);
    if (this.active.has(sessionId) || this.locks.has(sessionId)) throw new MeshError('busy', 'Session has active or ambiguous work');
    this.locks.add(sessionId);
    try {
      // The native resume reply carries history, not a session identity; identity trust is
      // limited to the id round-trip and is recorded as such in the adapter contract.
      const result = object(await this.rpc.call('session/resume', { sessionId: session.nativeSessionId, workspace: { workspacePath: this.options.workspaces[session.workspaceAlias], workspaceKey: this.options.workspaces[session.workspaceAlias] } }));
      if (!Array.isArray(result.messages)) throw new Error('Invalid native resume reply');
      // A restarted app-server has no subscriptions; event delivery for subsequent turns on
      // this session requires an explicit subscribe after resume.
      await this.rpc.call('session/subscribe', { sessionId: session.nativeSessionId, deliveryKind: 'desktop-continuous' });
      return structuredClone(session);
    } finally { this.locks.delete(sessionId); }
  }
  private session(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new MeshError('not_found', 'Session not found');
    return session;
  }
  async send(input: SendInput) {
    this.assertOnline();
    id(input.taskId); id(input.idempotencyKey); TimestampSchema.parse(input.deadline);
    if (typeof input.text !== 'string' || !input.text || input.text.length > 32768) throw new MeshError('invalid_message', 'Invalid input text');
    const fingerprint = JSON.stringify([input.sessionId, input.taskId, input.text, input.deadline]);
    const previous = [...this.runs.values()].find(r => r.input.idempotencyKey === input.idempotencyKey);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new MeshError('conflict', 'Idempotency input changed');
      return { taskId: previous.input.taskId };
    }
    if (this.runs.has(input.taskId)) throw new MeshError('conflict', 'Task ID reused');
    if (this.runs.size >= 1000) throw new MeshError('busy', 'Task retention capacity reached');
    const session = this.session(input.sessionId), remaining = Date.parse(input.deadline) - Date.now();
    if (remaining <= 0 || remaining > 2 ** 31 - 1) throw new MeshError('deadline_exceeded', 'Invalid or elapsed task deadline');
    if (this.active.has(session.id) || this.locks.has(session.id)) throw new MeshError('busy', 'Session already active or ambiguous');
    const run: Run = { input: { ...input }, inputId: randomUUID(), fingerprint, events: [], terminal: false };
    this.runs.set(input.taskId, run); this.active.set(session.id, run); session.state = 'running';
    this.store.put('nodes', input.taskId, run); this.store.put('sessions', session.id, session);
    // Reserve before any RPC. Lost ACKs, timeouts and process death become durable UNKNOWN.
    const timer = setTimeout(() => { if (!run.terminal) { this.lost(); void this.rpc.close(); } }, remaining);
    this.timers.set(input.taskId, timer);
    void this.rpc.call('session/send', { sessionId: session.nativeSessionId, inputId: run.inputId, modelSelection, content: input.text })
      .catch(() => { if (!run.terminal) this.emit(run, { type: 'unknown', taskId: input.taskId, reason: 'Native acceptance uncertain; never replay' }); })
      .finally(() => { if (run.terminal) clearTimeout(timer); });
    return { taskId: input.taskId };
  }
  async *watch(taskId: string, signal?: AbortSignal): AsyncIterable<AdapterEvent> {
    const run = this.runs.get(taskId);
    if (!run) throw new MeshError('not_found', 'Task not found');
    let index = 0;
    while (!signal?.aborted) {
      while (index < run.events.length) yield structuredClone(run.events[index++]!);
      if (run.terminal) return;
      await new Promise<void>(resolve => {
        const wake = () => { this.wake.delete(wake); signal?.removeEventListener('abort', wake); resolve(); };
        this.wake.add(wake); signal?.addEventListener('abort', wake, { once: true }); if (signal?.aborted) wake();
      });
    }
  }
  async cancel(taskId: string) {
    this.assertOnline(); const run = this.runs.get(taskId);
    if (!run) throw new MeshError('not_found', 'Task not found');
    if (run.terminal) return;
    await this.rpc.call('session/stop', { sessionId: this.session(run.input.sessionId).nativeSessionId });
  }
  async answerPermission(): Promise<void> { throw new MeshError('unsupported', 'Native approvals are always denied; human bridge not implemented'); }
  get deniedNativeRequests() { return this.denials; }
  /** Diagnostics (opt-in via LAM_ZCODE_ADAPTER_DEBUG=1): event types/keys only, never content. */
  get debugEventTrace() { return [...this.debugEvents]; }
  private readonly debugEvents: { type: string; payloadKeys: string[]; inputId: string | null; sessionId: string | null; kind: string | null }[] = [];
  close(): Promise<void> {
    return this.closing ??= (async () => {
      this.lost();
      try { await this.rpc?.close(); this.store?.close(); }
      finally { if (this.locked) { unlinkSync(join(this.options.home, 'adapter.lock')); this.locked = false; } await this.lease?.close(); }
    })();
  }
}
