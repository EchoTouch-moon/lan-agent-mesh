import { execFile } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, realpathSync, unlinkSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { MeshError, type AdapterEvent, type HarnessAdapter, type SendInput } from '@lam/adapter-sdk';
import { IdSchema, WorkspaceAliasSchema, TimestampSchema, SessionSchema, type Session, type Capabilities } from '@lam/domain';
import { privateDirectory, type PrivateLease } from '@lam/private-storage';
import { Store } from '@lam/storage';
import { CodexRpc } from './rpc.js';

export interface CodexOptions {
  nodeId: string;
  /** Absolute, operator-selected executable. No shell or executable discovery. */
  executable: string;
  /** Dedicated adapter-owned directory; an existing nonempty unmarked directory is refused. */
  home: string;
  workspaces: Record<string, string>;
  /** This first slice intentionally enables loopback fixtures only, never production credentials. */
  fixtureBaseUrl: string;
  expectedVersion: 'codex-cli 0.146.0';
}
type Run = { input: SendInput; fingerprint: string; events: AdapterEvent[]; terminal: boolean; turnId?: string };
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

/** Gateway-owned Codex threads. No GUI attach, token import, automatic approval or ambiguous replay. */
export class CodexAdapter implements HarnessAdapter {
  private rpc!: CodexRpc;
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
  private constructor(private readonly options: CodexOptions) {
    this.agentId = id(`${options.nodeId}/codex/default`);
  }
  static async open(options: CodexOptions): Promise<CodexAdapter> {
    // Windows executable shape is still unknown. Do not execute the MSIX candidate by inference.
    if (process.platform !== 'darwin') throw new MeshError('unsupported', 'Codex executable is not verified on this platform');
    const fixture = new URL(options.fixtureBaseUrl);
    if (fixture.protocol !== 'http:' || fixture.hostname !== '127.0.0.1' || fixture.username || fixture.password || fixture.search || fixture.hash || fixture.pathname !== '/v1')
      throw new MeshError('permission_denied', 'Only explicit loopback /v1 fixtures are enabled');
    if (options.expectedVersion !== 'codex-cli 0.146.0' || !isAbsolute(options.executable) || !isAbsolute(options.home))
      throw new MeshError('unsupported', 'Explicit verified Codex executable and home required');
    const workspaces = Object.fromEntries(Object.entries(options.workspaces).map(([alias, path]) => {
      WorkspaceAliasSchema.parse(alias);
      if (!isAbsolute(path) || realpathSync(path) !== resolve(path)) throw new MeshError('permission_denied', 'Workspace must be a canonical local directory');
      return [alias, path];
    }));
    if (!Object.keys(workspaces).length || Object.keys(workspaces).length > 64)
      throw new MeshError('invalid_message', 'Register between one and 64 workspace aliases');
    const adapter = new CodexAdapter({ ...options, home: resolve(options.home), workspaces });
    try { await adapter.start(); return adapter; }
    catch { await adapter.close(); throw new MeshError('internal', 'Codex initialization refused; inspect executable, private home and version'); }
  }
  private env(): NodeJS.ProcessEnv {
    // Never inherit OPENAI_*, CODEX_*, proxy settings, user config roots or credential variables.
    return { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: this.options.home, CODEX_HOME: this.options.home,
      XDG_CONFIG_HOME: join(this.options.home, 'xdg-config'), XDG_DATA_HOME: join(this.options.home, 'xdg-data'),
      TMPDIR: this.options.home, LANG: 'en_US.UTF-8' };
  }
  private async start() {
    const home = this.options.home;
    try { mkdirSync(home, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    await this.openOwnedHome();
  }
  private async openOwnedHome() {
    const home = this.options.home, marker = 'lam-owned.json';
    this.lease = await privateDirectory(home, { files: [marker, 'adapter.lock', 'adapter.sqlite', 'adapter.sqlite-wal', 'adapter.sqlite-shm'] });
    const entries = readdirSync(home);
    const signature = createHash('sha256').update(JSON.stringify([this.options.nodeId, this.options.executable, this.options.workspaces, this.options.expectedVersion])).digest('hex');
    if (!entries.length) writeFileSync(join(home, marker), signature, { mode: 0o600, flag: 'wx' });
    else if (!entries.includes(marker)) throw new Error('Home is not adapter owned');
    else if (readFileSync(join(home, marker), 'utf8') !== signature) throw new Error('Home registration changed');
    const lock = join(home, 'adapter.lock');
    try { writeFileSync(lock, String(process.pid), { mode: 0o600, flag: 'wx' }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const pid = Number(readFileSync(lock, 'utf8'));
      if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('Invalid lock');
      try { process.kill(pid, 0); throw new Error('Home already active'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
      unlinkSync(lock); writeFileSync(lock, String(process.pid), { mode: 0o600, flag: 'wx' });
    }
    this.locked = true;
    this.lease.assertActive();
    const version = await promisify(execFile)(this.options.executable, ['--version'], { cwd: home, env: this.env(), timeout: 5000, maxBuffer: 4096 });
    if (version.stdout.trim() !== this.options.expectedVersion) throw new Error('Unverified version');
    this.store = new Store(join(home, 'adapter.sqlite'));
    for (const session of this.store.list<Session>('sessions')) this.sessions.set(session.id, SessionSchema.parse(session));
    for (const run of this.store.list<Run>('nodes')) {
      this.runs.set(run.input.taskId, run);
      if (!run.terminal) this.emit(run, { type: 'unknown', taskId: run.input.taskId, reason: 'Adapter restarted; never replay an ambiguous turn' });
      if (run.events.at(-1)?.type === 'unknown') this.active.set(run.input.sessionId, run);
    }
    const config = ['model_provider="lam_fixture"', 'model="lam-fixture"',
      'model_providers.lam_fixture.name="LAM Fixture"',
      `model_providers.lam_fixture.base_url=${JSON.stringify(this.options.fixtureBaseUrl)}`,
      'model_providers.lam_fixture.wire_api="responses"', 'model_providers.lam_fixture.requires_openai_auth=false',
      'model_providers.lam_fixture.supports_websockets=false'];
    this.rpc = new CodexRpc(this.options.executable, ['app-server', '--listen', 'stdio://', ...config.flatMap(c => ['-c', c])], this.env(), home,
      message => {
        if (message.id !== undefined && message.method) {
          this.rpc.deny(message.id, message.method);
          if (message.method.endsWith('/requestApproval')) this.denials++;
          return;
        }
        this.notification(message.method ?? '', message.params);
      }, () => this.lost());
    await this.rpc.call('initialize', { clientInfo: { name: 'lan-agent-mesh', title: 'LAN Agent Mesh', version: '0.0.0' }, capabilities: { experimentalApi: false } });
    this.rpc.notify('initialized'); this.online = true;
    this.lease.onLost(() => { this.lost(); void this.close(); });
  }
  private assertOnline() {
    this.lease.assertActive();
    if (!this.online) throw new MeshError('unsupported', 'Codex adapter is offline');
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
    if (!['turn/started', 'turn/completed', 'item/agentMessage/delta', 'item/completed'].includes(method)) return;
    const params = object(value);
    const session = [...this.sessions.values()].find(s => s.nativeSessionId === params.threadId);
    if (!session) return;
    const run = this.active.get(session.id);
    if (!run || run.terminal) return;
    const turn = params.turn ? object(params.turn) : undefined;
    const turnId = turn?.id ?? params.turnId;
    if (typeof turnId !== 'string') throw new Error('Missing native turn identity');
    if (run.turnId && run.turnId !== turnId) return;
    run.turnId = id(turnId);
    if (method === 'item/agentMessage/delta') {
      const text = params.delta;
      if (typeof text !== 'string') throw new Error('Invalid native delta');
      if (run.events.length >= 4090 || run.events.reduce((n, e) => n + (e.type === 'delta' ? e.text.length : 0), 0) + text.length > 32768)
        throw new Error('Native stream capacity exceeded');
      this.emit(run, { type: 'delta', taskId: run.input.taskId, text });
    } else if (method === 'turn/completed') {
      if (turn?.status === 'completed') this.emit(run, { type: 'completed', taskId: run.input.taskId, text: run.events.flatMap(e => e.type === 'delta' ? [e.text] : []).join('') });
      else if (turn?.status === 'interrupted') this.emit(run, { type: 'cancelled', taskId: run.input.taskId });
      else if (turn?.status === 'failed') this.emit(run, { type: 'failed', taskId: run.input.taskId, code: 'internal' });
      else throw new Error('Unknown native terminal status');
    }
  }
  async probe() { return { available: this.online, kind: 'codex' as const, version: this.options.expectedVersion, capabilities: { ...capabilities } }; }
  async discover() {
    this.assertOnline();
    return [{ id: this.agentId, nodeId: this.options.nodeId, harnessId: `${this.options.nodeId}/codex`,
      name: 'Codex (isolated fixture)', workspaceAliases: Object.keys(this.options.workspaces), capabilities: { ...capabilities } }];
  }
  async spawn(input: { agentId: string; workspaceAlias: string }) {
    this.assertOnline();
    const cwd = this.options.workspaces[input.workspaceAlias];
    if (input.agentId !== this.agentId || !Object.hasOwn(this.options.workspaces, input.workspaceAlias) || !cwd)
      throw new MeshError('permission_denied', 'Agent or workspace not registered');
    if (this.sessions.size + this.locks.size >= 100) throw new MeshError('busy', 'Session capacity reached');
    const reservation = randomUUID(); this.locks.add(reservation);
    try {
      const result = object(await this.rpc.call('thread/start', { cwd, approvalPolicy: 'untrusted', sandbox: 'read-only', persistExtendedHistory: false }));
      const session = SessionSchema.parse({ id: randomUUID(), nativeSessionId: id(object(result.thread).id), nodeId: this.options.nodeId,
        agentId: this.agentId, workspaceAlias: input.workspaceAlias, state: 'idle', createdAt: new Date().toISOString() });
      this.sessions.set(session.id, session); this.store.put('sessions', session.id, session); return structuredClone(session);
    } finally { this.locks.delete(reservation); }
  }
  async resume(sessionId: string) {
    this.assertOnline(); const session = this.session(sessionId);
    if (this.active.has(sessionId) || this.locks.has(sessionId)) throw new MeshError('busy', 'Session has active or ambiguous work');
    this.locks.add(sessionId);
    try {
      const result = object(await this.rpc.call('thread/resume', { threadId: session.nativeSessionId, cwd: this.options.workspaces[session.workspaceAlias], approvalPolicy: 'untrusted', sandbox: 'read-only' }));
      if (object(result.thread).id !== session.nativeSessionId) { this.lost(); void this.rpc.close(); throw new MeshError('conflict', 'Native session identity changed'); }
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
    const run: Run = { input: { ...input }, fingerprint, events: [], terminal: false };
    this.runs.set(input.taskId, run); this.active.set(session.id, run); session.state = 'running';
    this.store.put('nodes', input.taskId, run); this.store.put('sessions', session.id, session);
    // Reserve before any RPC. Lost ACKs, timeouts and process death become durable UNKNOWN.
    const timer = setTimeout(() => { if (!run.terminal) { this.lost(); void this.rpc.close(); } }, remaining);
    this.timers.set(input.taskId, timer);
    void this.rpc.call('turn/start', { threadId: session.nativeSessionId, input: [{ type: 'text', text: input.text }] })
      .then(result => { const turnId = id(object(object(result).turn).id); if (run.turnId && run.turnId !== turnId) throw new Error(); run.turnId = turnId; })
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
    // turn/started may arrive before the start ACK. Wait boundedly for identity, never guess a turn ID.
    if (!run.turnId) { this.lost(); await this.rpc.close(); return; }
    await this.rpc.call('turn/interrupt', { threadId: this.session(run.input.sessionId).nativeSessionId, turnId: run.turnId });
  }
  async answerPermission(): Promise<void> { throw new MeshError('unsupported', 'Native approvals are always denied; human bridge not implemented'); }
  get deniedNativeRequests() { return this.denials; }
  close(): Promise<void> {
    return this.closing ??= (async () => {
      this.lost();
      try { await this.rpc?.close(); this.store?.close(); }
      finally { if (this.locked) { unlinkSync(join(this.options.home, 'adapter.lock')); this.locked = false; } await this.lease?.close(); }
    })();
  }
}
