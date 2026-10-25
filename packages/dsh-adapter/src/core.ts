import { createHash, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync, unlinkSync, realpathSync, lstatSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { MeshError, type HarnessAdapter, type AdapterEvent, type SendInput, type SpawnInput } from '@lam/adapter-sdk';
import { IdSchema, WorkspaceAliasSchema, TimestampSchema, SessionSchema, type Capabilities, type Session } from '@lam/domain';
import { privateDirectory, type PrivateLease } from '@lam/private-storage';
import { Store, fingerprint, type StoredTask, type TaskStatus } from '@lam/storage';
import type { LossReason } from './rpc.js';

// Internal injection seam for synthetic tests, not an exported production launcher.
export interface DshDriver {
  createSession(cwd: string): Promise<string>;
  resumeSession(id: string, cwd: string): Promise<void>;
  prompt(id: string, text: string, timeoutMs?: number): Promise<string>;
  cancel(id: string): void;
  close(): Promise<void>;
  readonly deniedNativeRequests: number;
  readonly rejectedOnceRequests?: number;
}
export type DriverFactory = (context: {
  nativeHome: string; onText: (id: string, text: string) => void; onLost: (reason: LossReason) => void;
}) => Promise<DshDriver>;
export interface CoreOptions { nodeId: string; home: string; workspaces: Record<string, string>; registration: string }
const capabilities: Capabilities = {
  discover: 'supported', spawn: 'supported', resume: 'supported', send: 'supported', watch: 'supported', cancel: 'supported',
  answerPermission: 'unsupported', attachExistingGui: 'unsupported',
};
const Input = z.object({ sessionId: IdSchema, taskId: IdSchema, idempotencyKey: IdSchema,
  text: z.string().min(1).refine(text => Buffer.byteLength(text) <= 32768), deadline: TimestampSchema }).strict();
const Event = z.discriminatedUnion('type', [
  z.object({ type: z.literal('delta'), taskId: IdSchema, text: z.string() }).strict(),
  z.object({ type: z.literal('completed'), taskId: IdSchema, text: z.string() }).strict(),
  z.object({ type: z.literal('failed'), taskId: IdSchema, code: z.string().min(1).max(128) }).strict(),
  z.object({ type: z.literal('cancelled'), taskId: IdSchema }).strict(),
  z.object({ type: z.literal('unknown'), taskId: IdSchema, reason: z.string().max(256) }).strict(),
]);
const terminals: Partial<Record<TaskStatus, string>> = { COMPLETED: 'completed', FAILED: 'failed', CANCELLED: 'cancelled', UNKNOWN: 'unknown' };
type Run = { task: StoredTask; events: AdapterEvent[]; terminal: boolean; started: boolean; cancelRequested: boolean; listeners: Set<() => void> };
const fail = (code: 'invalid_message' | 'permission_denied' | 'internal' | 'conflict' | 'busy' | 'not_found' | 'unsupported' | 'deadline_exceeded', message: string): never => { throw new MeshError(code, message); };

/** Durable SDK semantics shared by native and synthetic drivers. Only native.ts is exported as a launcher. */
export class DshAdapterCore implements HarnessAdapter {
  private store: Store | undefined;
  private driver: DshDriver | undefined;
  private readonly leases: PrivateLease[] = [];
  private readonly sessions = new Map<string, Session>();
  private readonly runs = new Map<string, Run>();
  private readonly keys = new Map<string, Run>();
  private readonly active = new Map<string, Run>();
  private readonly loaded = new Set<string>();
  private readonly reservations = new Set<string>();
  private readonly operations = new Set<Promise<unknown>>();
  private online = false;
  private closing: Promise<void> | undefined;
  private lostReason: LossReason | undefined;
  private healthy = true;
  private uncertainCreation = false;
  private readonly lockNonce = randomUUID();
  private locked = false;
  readonly agentId: string;
  private constructor(private readonly options: CoreOptions) { this.agentId = IdSchema.parse(`${options.nodeId}/dsh/default`); }
  static async open(options: CoreOptions, factory: DriverFactory): Promise<DshAdapterCore> {
    try {
      IdSchema.parse(options.nodeId);
      if (!isAbsolute(options.home) || !options.registration || options.registration.length > 4096) fail('invalid_message', 'Explicit adapter home and registration required');
      const workspaces = Object.fromEntries(Object.entries(options.workspaces).sort(([a], [b]) => a.localeCompare(b)).map(([alias, path]) => {
        WorkspaceAliasSchema.parse(alias);
        if (!isAbsolute(path) || realpathSync(path) !== resolve(path) || !lstatSync(path).isDirectory()) fail('permission_denied', 'Workspace must be a canonical directory');
        const overlap = (a: string, b: string) => { const r = relative(a, b); return r === '' || (r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r)); };
        if (overlap(path, resolve(options.home)) || overlap(resolve(options.home), path)) fail('permission_denied', 'Workspace and adapter state must not overlap');
        return [alias, path];
      }));
      if (!Object.keys(workspaces).length || Object.keys(workspaces).length > 64) fail('invalid_message', 'Register one to 64 workspace aliases');
      const core = new DshAdapterCore({ ...options, home: resolve(options.home), workspaces });
      try { await core.start(factory); return core; }
      catch { await core.close(); return fail('internal', 'DSH initialization refused'); }
    } catch (error) {
      if (error instanceof MeshError) throw error;
      return fail('internal', 'DSH initialization refused');
    }
  }
  private async start(factory: DriverFactory) {
    const home = this.options.home;
    this.leases.push(await privateDirectory(home, { create: true,
      files: ['lam-owned.json', 'adapter.lock', 'adapter.sqlite', 'adapter.sqlite-wal', 'adapter.sqlite-shm', 'adapter.sqlite-journal'] }));
    if (realpathSync(home) !== home) fail('permission_denied', 'Canonical adapter home required');
    const entries = readdirSync(home);
    const signature = createHash('sha256').update(JSON.stringify([this.options.nodeId, home, this.options.registration, this.options.workspaces])).digest('hex');
    if (entries.length === 0) writeFileSync(join(home, 'lam-owned.json'), signature, { mode: 0o600, flag: 'wx' });
    else if (!entries.includes('lam-owned.json') || lstatSync(join(home, 'lam-owned.json')).size !== 64 || readFileSync(join(home, 'lam-owned.json'), 'utf8') !== signature)
      fail('permission_denied', 'Adapter home registration mismatch');
    const allowed = new Set(['lam-owned.json', 'adapter.lock', 'adapter.sqlite', 'adapter.sqlite-wal', 'adapter.sqlite-shm', 'adapter.sqlite-journal', 'native']);
    if (entries.some(name => !allowed.has(name))) fail('permission_denied', 'Unrecognized adapter state');
    try { writeFileSync(join(home, 'adapter.lock'), this.lockNonce, { flag: 'wx', mode: 0o600 }); this.locked = true; }
    catch { fail('busy', 'Adapter home is active or needs explicit crash cleanup'); }
    // Do not infer native process death from a stale parent PID or remove its lock automatically.
    const nativeHome = join(home, 'native');
    this.leases.push(await privateDirectory(nativeHome, { create: true }));
    try { this.store = new Store(join(home, 'adapter.sqlite')); this.restore(); }
    catch { this.healthy = false; throw new Error('Invalid durable state'); }
    for (const lease of this.leases) lease.onLost(() => { this.healthy = false; this.lost('process'); void this.close().catch(() => {}); });
    try { this.driver = await factory({ nativeHome, onText: (id, text) => this.text(id, text), onLost: reason => this.lost(reason) }); }
    catch { this.lost('process'); throw new Error('Native initialization cleanup requires inspection'); }
    if (this.lostReason !== undefined) throw new Error('Native process lost during initialization');
    this.online = true;
  }
  private restore() {
    for (const value of this.store!.list<Session>('sessions')) {
      const s = SessionSchema.parse(value);
      if (s.nodeId !== this.options.nodeId || s.agentId !== this.agentId || !['idle', 'running'].includes(s.state) || !Object.hasOwn(this.options.workspaces, s.workspaceAlias) ||
        [...this.sessions.values()].some(previous => previous.nativeSessionId === s.nativeSessionId) || this.sessions.size >= 100) throw new Error();
      this.sessions.set(s.id, s);
    }
    const rows = this.store!.query('SELECT id FROM tasks');
    if (rows.length > 1000) throw new Error();
    // Validate before recovery, so malformed persisted input cannot be silently rewritten into acceptance.
    for (const row of rows) this.validate(this.store!.task(String(row.id))!);
    this.store!.recover();
    for (const row of rows) {
      const task = this.store!.task(String(row.id))!, events = this.validate(task);
      const run: Run = { task, events, terminal: Boolean(terminals[task.state]), started: false, cancelRequested: false, listeners: new Set() };
      this.runs.set(task.id, run); this.keys.set(task.key, run);
      if (task.state === 'UNKNOWN') {
        const sid = (task.input as SendInput).sessionId;
        if (this.active.has(sid)) throw new Error();
        this.active.set(sid, run);
      }
    }
    for (const s of this.sessions.values()) { s.state = this.active.has(s.id) ? 'running' : 'idle'; this.store!.put('sessions', s.id, s); }
  }
  private validate(task: StoredTask): AdapterEvent[] {
    const input = Input.parse(task.input), events = task.events.map(e => Event.parse(e));
    if (task.peer !== this.options.nodeId || task.id !== input.taskId || task.key !== input.idempotencyKey || task.fingerprint !== fingerprint(input) ||
      !this.sessions.has(input.sessionId) || events.length > 4092 || events.some((e, i) => e.taskId !== task.id || (e.type !== 'delta' && i !== events.length - 1)) ||
      events.filter(e => e.type === 'delta').reduce((n, e) => n + Buffer.byteLength(e.text), 0) > 32768) throw new Error();
    const terminal = terminals[task.state];
    if (terminal ? events.at(-1)?.type !== terminal : !['QUEUED', 'RUNNING', 'WAITING_INPUT'].includes(task.state) || events.some(e => e.type !== 'delta')) throw new Error();
    const last = events.at(-1);
    if (last?.type === 'completed' && last.text !== events.flatMap(e => e.type === 'delta' ? [e.text] : []).join('')) throw new Error();
    return events;
  }
  private assertOnline() {
    if (!this.online || this.closing || !this.healthy) fail('unsupported', 'DSH adapter is offline');
    for (const lease of this.leases) lease.assertActive();
  }
  private session(id: string) { return this.sessions.get(id) ?? fail('not_found', 'Session not found'); }
  private workspace(alias: string) {
    const cwd = Object.hasOwn(this.options.workspaces, alias) ? this.options.workspaces[alias] : undefined;
    if (!cwd || realpathSync(cwd) !== cwd || !lstatSync(cwd).isDirectory()) return fail('permission_denied', 'Workspace registration changed');
    return cwd;
  }
  private emit(run: Run, event: AdapterEvent) {
    if (run.terminal) return;
    const state: TaskStatus = event.type === 'delta' ? 'RUNNING' : event.type === 'completed' ? 'COMPLETED' : event.type === 'cancelled' ? 'CANCELLED' : event.type === 'failed' ? 'FAILED' : 'UNKNOWN';
    try {
      this.store!.event(run.task.id, state, event);
      run.events.push(event); run.task.state = state;
      if (event.type !== 'delta') {
        run.terminal = true;
        const sid = (run.task.input as SendInput).sessionId, session = this.session(sid);
        if (event.type !== 'unknown') this.active.delete(sid);
        session.state = event.type === 'unknown' ? 'running' : 'idle'; this.store!.put('sessions', sid, session);
      }
    } catch { this.abandon(); throw new MeshError('internal', 'DSH durable state unavailable'); }
    finally { for (const wake of run.listeners) wake(); }
  }
  private text(nativeId: string, text: string) {
    const session = [...this.sessions.values()].find(s => s.nativeSessionId === nativeId), run = session && this.active.get(session.id);
    if (!run || run.terminal) return;
    if (run.events.length >= 4090 || Buffer.byteLength(text) + run.events.reduce((n, e) => n + (e.type === 'delta' ? Buffer.byteLength(e.text) : 0), 0) > 32768)
      throw new Error('Stream event capacity reached');
    this.emit(run, { type: 'delta', taskId: run.task.id, text });
  }
  private lost(reason: LossReason) {
    this.online = false;
    if (reason === 'process' || this.lostReason === undefined) this.lostReason = reason;
    for (const run of this.active.values()) if (!run.terminal) this.emit(run, { type: 'unknown', taskId: run.task.id, reason: 'Native outcome uncertain; never replay' });
  }
  private abandon() {
    this.healthy = false; this.online = false;
    for (const run of this.active.values()) if (!run.terminal) {
      // Volatile UNKNOWN only: never claim a disk write succeeded. Retain the ownership lock.
      run.events.push({ type: 'unknown', taskId: run.task.id, reason: 'Durability unavailable; operator recovery required' });
      run.terminal = true; run.task.state = 'UNKNOWN'; for (const wake of run.listeners) wake();
    }
    void this.driver?.close().catch(() => {});
  }
  private track<T>(operation: Promise<T>): Promise<T> {
    this.operations.add(operation);
    void operation.finally(() => this.operations.delete(operation)).catch(() => {});
    return operation;
  }
  async probe() { return { kind: 'dsh' as const, version: 'dsh-desktop/0.2.1-rc.2-fixture', available: this.online && !this.closing && this.healthy, capabilities: { ...capabilities } }; }
  async discover() {
    this.assertOnline();
    return [{ id: this.agentId, nodeId: this.options.nodeId, harnessId: `${this.options.nodeId}/dsh`, name: 'Gateway-owned DSH fixture', workspaceAliases: Object.keys(this.options.workspaces), capabilities: { ...capabilities } }];
  }
  async spawn(input: SpawnInput): Promise<Session> {
    this.assertOnline();
    if (input.agentId !== this.agentId) return fail('not_found', 'Agent not found');
    const cwd = this.workspace(WorkspaceAliasSchema.parse(input.workspaceAlias));
    if (this.sessions.size + this.reservations.size >= 100) return fail('busy', 'Session capacity reached');
    const reservation = randomUUID(); this.reservations.add(reservation);
    return this.track((async () => {
      try {
        const nativeSessionId = IdSchema.parse(await this.driver!.createSession(cwd));
        if ([...this.sessions.values()].some(s => s.nativeSessionId === nativeSessionId)) throw new Error();
        const session = SessionSchema.parse({ id: randomUUID(), nativeSessionId, nodeId: this.options.nodeId, agentId: this.agentId,
          workspaceAlias: input.workspaceAlias, state: 'idle', createdAt: new Date().toISOString() });
        this.store!.put('sessions', session.id, session); this.sessions.set(session.id, session); this.loaded.add(session.id);
        return structuredClone(session);
      } catch { this.uncertainCreation = true; this.lost('protocol'); void this.driver?.close().catch(() => {}); return fail('internal', 'Native session creation uncertain; operator cleanup required'); }
      finally { this.reservations.delete(reservation); }
    })());
  }
  async resume(sessionId: string): Promise<Session> {
    this.assertOnline(); const session = this.session(sessionId);
    if (this.active.has(sessionId) || this.reservations.has(sessionId)) return fail('busy', 'Session has active or ambiguous work');
    const cwd = this.workspace(session.workspaceAlias); this.reservations.add(sessionId);
    return this.track((async () => {
      try { await this.driver!.resumeSession(session.nativeSessionId, cwd); this.loaded.add(sessionId); return structuredClone(session); }
      catch { this.lost('protocol'); void this.driver?.close().catch(() => {}); return fail('internal', 'Native resume uncertain'); }
      finally { this.reservations.delete(sessionId); }
    })());
  }
  async send(value: SendInput) {
    const parsed = Input.safeParse(value);
    if (!parsed.success) return fail('invalid_message', 'Invalid DSH task input');
    const input = parsed.data, previous = this.keys.get(input.idempotencyKey);
    if (previous && previous.task.fingerprint !== fingerprint(input)) return fail('conflict', 'Idempotency input changed');
    const remaining = Date.parse(input.deadline) - Date.now();
    if (remaining <= 0 || remaining > 2 ** 31 - 1) return fail('deadline_exceeded', 'Invalid task deadline');
    if (previous) return { taskId: previous.task.id };
    if (this.runs.has(input.taskId)) return fail('conflict', 'Task ID reused');
    this.assertOnline(); const session = this.session(input.sessionId); this.workspace(session.workspaceAlias);
    if (this.active.has(session.id) || this.reservations.has(session.id)) return fail('busy', 'Session has active or ambiguous work');
    if (!this.loaded.has(session.id)) return fail('conflict', 'Explicitly resume the native session before sending new work');
    let task: StoredTask;
    try { task = this.store!.acceptTask(input.taskId, this.options.nodeId, input.idempotencyKey, input).task; }
    catch (error) { if (error instanceof MeshError) throw error; this.abandon(); return fail('internal', 'DSH durable state unavailable'); }
    const run: Run = { task, events: [], terminal: false, started: false, cancelRequested: false, listeners: new Set() };
    this.runs.set(task.id, run); this.keys.set(task.key, run); this.active.set(session.id, run); session.state = 'running';
    try { this.store!.put('sessions', session.id, session); }
    catch { this.abandon(); return fail('internal', 'DSH durable state unavailable'); }
    void this.track(Promise.resolve().then(async () => {
      if (run.terminal) return;
      try {
        const left = Date.parse(input.deadline) - Date.now();
        if (left <= 0) { this.emit(run, { type: 'failed', taskId: task.id, code: 'deadline_exceeded' }); return; }
        const prompt = this.driver!.prompt(session.nativeSessionId, input.text, left);
        void prompt.catch(() => {});
        run.started = true; if (run.cancelRequested) this.driver!.cancel(session.nativeSessionId);
        const reason = await prompt;
        this.emit(run, reason === 'end_turn' ? { type: 'completed', taskId: task.id, text: run.events.flatMap(e => e.type === 'delta' ? [e.text] : []).join('') }
          : reason === 'cancelled' ? { type: 'cancelled', taskId: task.id } : { type: 'failed', taskId: task.id, code: 'incomplete_native_turn' });
      } catch { this.lost('protocol'); void this.driver?.close().catch(() => {}); }
    })).catch(() => {});
    return { taskId: task.id };
  }
  async *watch(taskId: string, signal?: AbortSignal): AsyncIterable<AdapterEvent> {
    const run = this.runs.get(taskId) ?? fail('not_found', 'Task not found');
    let index = 0;
    while (!signal?.aborted) {
      while (index < run.events.length) yield structuredClone(run.events[index++]!);
      if (run.terminal) return;
      await new Promise<void>(resolve => {
        const wake = () => { run.listeners.delete(wake); signal?.removeEventListener('abort', wake); resolve(); };
        run.listeners.add(wake); signal?.addEventListener('abort', wake, { once: true }); if (signal?.aborted) wake();
      });
    }
  }
  async cancel(taskId: string) {
    const run = this.runs.get(taskId) ?? fail('not_found', 'Task not found');
    if (run.terminal) return;
    this.assertOnline(); run.cancelRequested = true;
    if (run.started) this.driver!.cancel(this.session((run.task.input as SendInput).sessionId).nativeSessionId);
  }
  async answerPermission(): Promise<void> { return fail('unsupported', 'Native permissions are always denied; human bridge not implemented'); }
  get deniedNativeRequests() { return this.driver?.deniedNativeRequests ?? 0; }
  get rejectedOnceRequests() { return this.driver?.rejectedOnceRequests ?? 0; }
  close(): Promise<void> {
    return this.closing ??= (async () => {
      this.online = false;
      let cleaned = true;
      try { this.lost('closed'); } catch { this.healthy = false; }
      try { await this.driver?.close(); } catch { cleaned = false; }
      await Promise.allSettled([...this.operations]);
      try { this.store?.close(); } catch { this.healthy = false; }
      // Keep ownership if cleanup, durable state, creation, or unexpected process death is uncertain.
      const leases = await Promise.allSettled(this.leases.map(lease => lease.close()));
      const release = cleaned && this.healthy && !this.uncertainCreation && this.lostReason !== 'process' && leases.every(l => l.status === 'fulfilled');
      if (release && this.locked) {
        try { if (lstatSync(join(this.options.home, 'adapter.lock')).size !== this.lockNonce.length || readFileSync(join(this.options.home, 'adapter.lock'), 'utf8') !== this.lockNonce) throw new Error(); unlinkSync(join(this.options.home, 'adapter.lock')); this.locked = false; }
        catch { cleaned = false; }
      }
      if (!release || !cleaned) fail('internal', 'DSH cleanup uncertain; retain home and inspect ownership manually');
    })();
  }
}
