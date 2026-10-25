import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { isAbsolute, join } from 'node:path';
import { TextDecoder } from 'node:util';

export type NativeObject = Record<string, unknown>;
type RpcId = string | number;
export type LossReason = 'closed' | 'timeout' | 'protocol' | 'process';
export class AcpError extends Error {
  constructor(readonly code: LossReason | 'native_error' | 'busy' | 'invalid_input', readonly ambiguous = false) {
    // Never expose native errors, stderr, paths, input text or credentials.
    super(`ACP ${code}`); this.name = 'AcpError';
  }
}
export function object(value: unknown): NativeObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AcpError('protocol', true);
  return value as NativeObject;
}
function rpcId(value: unknown): value is RpcId {
  return (typeof value === 'string' && value.length > 0 && value.length <= 256) ||
    (typeof value === 'number' && Number.isSafeInteger(value));
}
export interface AcpProcessOptions {
  /** Low-level transport: caller supplies an owned process and an isolated env/home. No shell lookup. */
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  windowsVerbatimArguments?: boolean;
  timeoutMs?: number;
}
type Pending = { resolve: (value: unknown) => void; reject: (error: AcpError) => void; timer: ReturnType<typeof setTimeout>; onReply: (() => void) | undefined };
const MAX_FRAME = 1024 * 1024;
const MAX_QUEUED = 256 * 1024;

/** One owned ACP JSON-RPC 2.0 stream. A timeout poisons it; uncertain calls are never resent. */
export class AcpRpc {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, Pending>();
  private buffer = Buffer.alloc(0);
  private nextId = 0;
  private loss: LossReason | undefined;
  private termination: Promise<void> | undefined;
  private readonly exited: Promise<void>;
  private exitObserved = false;
  readonly timeoutMs: number;
  constructor(options: AcpProcessOptions, private readonly receive: (message: NativeObject) => void,
    private readonly onLost: (reason: LossReason) => void) {
    this.timeoutMs = options.timeoutMs ?? 15000;
    if (!isAbsolute(options.command) || !isAbsolute(options.cwd) || !Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 120000)
      throw new AcpError('invalid_input');
    this.child = spawn(options.command, options.args, {
      cwd: options.cwd, env: { ...options.env }, shell: false, windowsHide: true,
      windowsVerbatimArguments: options.windowsVerbatimArguments ?? false,
      detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.exited = new Promise(resolve => this.child.once('close', () => { this.exitObserved = true; resolve(); }));
    this.child.on('error', () => this.fail('process'));
    this.child.on('close', () => this.fail('process'));
    this.child.stdin.on('error', () => this.fail('process'));
    this.child.stdout.on('error', () => this.fail('process'));
    // Drain diagnostics without retaining or forwarding them.
    this.child.stderr.on('data', () => {});
    this.child.stderr.on('error', () => this.fail('process'));
    this.child.stdout.on('data', (chunk: Buffer) => {
      if (this.loss) return;
      try {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        let end: number;
        while ((end = this.buffer.indexOf(10)) !== -1) {
          if (end > MAX_FRAME) throw new AcpError('protocol', true);
          const line = this.buffer.subarray(0, end); this.buffer = this.buffer.subarray(end + 1);
          const decoded = new TextDecoder('utf-8', { fatal: true }).decode(line);
          this.message(object(JSON.parse(decoded)));
          if (this.loss) return;
        }
        if (this.buffer.length > MAX_FRAME) throw new AcpError('protocol', true);
      } catch { this.fail('protocol'); }
    });
  }
  private message(message: NativeObject) {
    if (message.jsonrpc !== '2.0') throw new AcpError('protocol', true);
    if ('method' in message) {
      if (typeof message.method !== 'string' || !message.method.length || message.method.length > 256 || 'result' in message || 'error' in message ||
        ('id' in message && !rpcId(message.id))) throw new AcpError('protocol', true);
      this.receive(message); return;
    }
    if (!rpcId(message.id) || ('result' in message) === ('error' in message)) throw new AcpError('protocol', true);
    if (typeof message.id !== 'number' || !this.pending.has(message.id)) throw new AcpError('protocol', true);
    const call = this.pending.get(message.id)!;
    if ('error' in message) {
      const error = object(message.error);
      if (!Number.isSafeInteger(error.code) || typeof error.message !== 'string') throw new AcpError('protocol', true);
    }
    // End stream attribution synchronously, before parsing any following frame in this OS read.
    call.onReply?.();
    this.pending.delete(message.id); clearTimeout(call.timer);
    if ('error' in message) call.reject(new AcpError('native_error', true));
    else call.resolve(message.result);
  }
  private write(message: NativeObject) {
    if (this.loss) throw new AcpError(this.loss, true);
    const data = JSON.stringify(message) + '\n';
    if (Buffer.byteLength(data) > MAX_FRAME) throw new AcpError('invalid_input');
    if (this.child.stdin.writableLength + Buffer.byteLength(data) > MAX_QUEUED) {
      this.fail('protocol'); throw new AcpError('protocol', true);
    }
    this.child.stdin.write(data, error => { if (error) this.fail('process'); });
  }
  call(method: string, params: NativeObject, timeoutMs = this.timeoutMs, onReply?: () => void): Promise<unknown> {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2 ** 31 - 1) return Promise.reject(new AcpError('invalid_input'));
    if (this.loss) return Promise.reject(new AcpError(this.loss, true));
    if (this.pending.size >= 32) return Promise.reject(new AcpError('busy'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail('timeout'), timeoutMs);
      this.pending.set(id, { resolve, reject, timer, onReply });
      try { this.write({ jsonrpc: '2.0', id, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  notify(method: string, params: NativeObject = {}) { this.write({ jsonrpc: '2.0', method, params }); }
  reply(id: RpcId, result: NativeObject) { this.write({ jsonrpc: '2.0', id, result }); }
  reject(id: RpcId) { this.write({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Client method not supported' } }); }
  abort(reason: LossReason = 'protocol') { this.fail(reason); }
  private fail(reason: LossReason) {
    if (this.loss) return;
    this.loss = reason; this.buffer = Buffer.alloc(0);
    for (const call of this.pending.values()) { clearTimeout(call.timer); call.reject(new AcpError(reason, true)); }
    this.pending.clear();
    try { this.onLost(reason); } catch { /* Consumer failure cannot leave the owned process running. */ }
    void this.terminate().catch(() => {});
  }
  private terminate(): Promise<void> {
    return this.termination ??= (async () => {
      // Kill the owned tree while its parent still exists. Ending stdin first can orphan tools on Windows.
      if (this.child.pid) {
        if (process.platform === 'win32' && !this.exitObserved) {
          const killer = spawn(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'),
            ['/pid', String(this.child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => { killer.kill(); reject(new AcpError('process', true)); }, 5000);
            killer.once('error', () => { clearTimeout(timer); reject(new AcpError('process', true)); });
            killer.once('close', code => { clearTimeout(timer); if (code === 0 || this.exitObserved) resolve(); else reject(new AcpError('process', true)); });
          });
        } else if (process.platform !== 'win32') {
          try { process.kill(-this.child.pid, 'SIGKILL'); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw new AcpError('process', true); }
        }
      }
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new AcpError('process', true)), 5000);
        void this.exited.then(() => { clearTimeout(timer); resolve(); });
      });
    })();
  }
  close(): Promise<void> { this.fail('closed'); return this.terminate(); }
}
