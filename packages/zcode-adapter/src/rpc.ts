import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { MeshError } from '@lam/adapter-sdk';

type Message = { id?: number | string; method?: string; params?: unknown; result?: unknown; error?: unknown };
/** The fixed runtime-preferences reply that keeps the harness headless and non-interactive. */
export const RuntimePreferencesReply = {
  nativeSearchEnhancementsEnabled: false,
  toolSearchMode: 'off',
  subagentRuntimeConfigEnabled: false,
  memoryEnabled: false,
  askUserQuestionAutoResolutionEnabled: false,
  modelContextBudgetStrategy: 'preflight-v1',
} as const;

/**
 * A single owned stdio process speaking the installed CLI's strict NDJSON envelopes
 * (id/method/params, no JSON-RPC version field). A timeout poisons the connection:
 * mutations are never replayed.
 */
export class ZcodeRpc {
  readonly child: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private buffer = '';
  private terminal = false;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private readonly exited: Promise<void>;
  constructor(command: string, args: string[], env: NodeJS.ProcessEnv, cwd: string,
    private readonly onMessage: (message: Message) => void,
    private readonly onLost: () => void,
    private readonly timeoutMs = 15000) {
    this.child = spawn(command, args, { cwd, env, stdio: 'pipe', windowsHide: true, detached: process.platform === 'darwin' });
    this.exited = new Promise(resolve => {
      this.child.once('error', () => { this.fail(); resolve(); });
      this.child.once('close', () => { this.fail(); resolve(); });
    });
    this.child.stdin.on('error', () => this.fail());
    this.child.stderr.resume(); // Native diagnostics may contain credentials or workspace paths.
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => {
      if (this.terminal) return;
      this.buffer += chunk;
      if (Buffer.byteLength(this.buffer) > 1024 * 1024) { this.fail(); return; }
      while (this.buffer.includes('\n')) {
        const end = this.buffer.indexOf('\n'), line = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + 1);
        try {
          const value: unknown = JSON.parse(line);
          if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
          const message = value as Message;
          if (message.method) this.onMessage(message);
          else if (typeof message.id === 'number') {
            const entry = this.pending.get(message.id);
            if (!entry) continue;
            clearTimeout(entry.timer); this.pending.delete(message.id);
            if (message.error) entry.reject(new MeshError('internal', 'Native request rejected'));
            else entry.resolve(message.result);
          } else throw new Error();
        } catch { this.fail(); return; }
      }
    });
  }
  private fail() {
    if (this.terminal) return;
    this.terminal = true;
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new MeshError('internal', 'Native connection lost; outcome unknown'));
    }
    this.pending.clear();
    if (process.platform === 'darwin' && this.child.pid) {
      try { process.kill(-this.child.pid, 'SIGKILL'); } catch { /* The owned process group may already be gone. */ }
    } else this.child.kill('SIGKILL');
    this.onLost();
  }
  private write(message: Message) {
    if (this.terminal) throw new MeshError('internal', 'Native connection unavailable');
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }
  call(method: string, params: unknown): Promise<unknown> {
    if (this.terminal) return Promise.reject(new MeshError('internal', 'Native connection unavailable'));
    if (this.pending.size >= 64) return Promise.reject(new MeshError('busy', 'Native request capacity reached'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(), this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.write({ id, method, params }); } catch { this.fail(); }
    });
  }
  notify(method: string, params: unknown = {}) { this.write({ method, params }); }
  /** Server-to-client requests: runtime preferences get the headless reply, permissions are
   *  always denied, anything else is refused without leaking native error bodies. */
  deny(id: number | string, method: string) {
    if (method === 'session/requestRuntimePreferences') this.write({ id, result: RuntimePreferencesReply });
    else if (method === 'interaction/requestPermission') this.write({ id, result: { decision: 'deny', reason: 'lan-agent-mesh adapter denies native permission requests' } });
    else this.write({ id, error: { code: -32601, message: 'Client request unsupported' } });
  }
  reply(id: number | string, result: unknown) { this.write({ id, result }); }
  async close() {
    if (!this.terminal) {
      this.child.stdin.end();
      const timer = setTimeout(() => this.fail(), 2000);
      await this.exited; clearTimeout(timer);
    } else await this.exited;
  }
}
