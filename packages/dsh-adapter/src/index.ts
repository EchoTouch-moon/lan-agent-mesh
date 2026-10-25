import { isAbsolute } from 'node:path';
import { AcpError, AcpRpc, object, type AcpProcessOptions, type NativeObject, type LossReason } from './rpc.js';
export { AcpError, type AcpProcessOptions, type LossReason } from './rpc.js';

export interface DshAcpOptions extends AcpProcessOptions {
  onText: (sessionId: string, text: string) => void;
  onLost: (reason: LossReason) => void;
}
const stopReasons = new Set(['end_turn', 'cancelled', 'max_tokens', 'max_turn_requests', 'refusal']);
function sessionId(value: unknown): string {
  if (typeof value !== 'string' || !value.length || value.length > 256 || [...value].some(char => char.charCodeAt(0) < 32)) throw new AcpError('protocol', true);
  return value;
}

/** DSH desktop's observed ACP v1 dialect, not a HarnessAdapter yet. No GUI, filesystem or terminal client methods. */
export class DshAcpClient {
  private rpc!: AcpRpc;
  private online = false;
  private readonly sessions = new Set<string>();
  private readonly busy = new Set<string>();
  private readonly prompting = new Map<string, { bytes: number; chunks: number }>();
  private readonly cancelling = new Set<string>();
  private creating = 0;
  private denied = 0;
  private readonly requestIds = new Set<string>();
  private constructor(private readonly options: DshAcpOptions) {}
  static async open(options: DshAcpOptions): Promise<DshAcpClient> {
    const client = new DshAcpClient(options);
    client.rpc = new AcpRpc(options, message => client.message(message), reason => {
      client.online = false; options.onLost(reason);
    });
    try {
      const result = object(await client.rpc.call('initialize', {
        protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'lan-agent-mesh', version: '0.0.0' },
      }));
      const info = object(result.agentInfo);
      if (result.protocolVersion !== 1 || info.name !== 'deepseek-harness-acp' || info.version !== '0.0.1') throw new AcpError('protocol', true);
      client.rpc.notify('initialized'); client.online = true; return client;
    } catch (error) { await client.close(); throw error; }
  }
  private message(message: NativeObject) {
    if ('id' in message) {
      const id = message.id as string | number, key = `${typeof id}:${id}`;
      if (this.requestIds.has(key) || this.requestIds.size >= 4096) throw new AcpError('protocol', true);
      this.requestIds.add(key);
      if (message.method !== 'session/request_permission') { this.rpc.reject(id); return; }
      const params = object(message.params);
      const options = params.options;
      if (!Array.isArray(options) || options.length > 64) throw new AcpError('protocol', true);
      // Only a known in-flight session may select a rejection option. Unknown context is cancelled.
      const reject = typeof params.sessionId === 'string' && this.prompting.has(params.sessionId) && !this.cancelling.has(params.sessionId) && this.online ? options.find(value => {
        const option = object(value);
        return option.kind === 'reject_once' && typeof option.optionId === 'string' && option.optionId.length > 0 && option.optionId.length <= 256;
      }) : undefined;
      this.rpc.reply(id, { outcome: reject ? { outcome: 'selected', optionId: object(reject).optionId } : { outcome: 'cancelled' } });
      this.denied++;
      return;
    }
    if (message.method !== 'session/update') return;
    const params = object(message.params), id = sessionId(params.sessionId), update = object(params.update);
    // Resume may replay history; it must not be mistaken for a new task's output.
    const output = this.prompting.get(id);
    if (!output || !this.sessions.has(id) || update.sessionUpdate !== 'agent_message_chunk') return;
    const content = object(update.content);
    if (content.type !== 'text' || typeof content.text !== 'string') throw new AcpError('protocol', true);
    output.bytes += Buffer.byteLength(content.text); output.chunks++;
    if (output.bytes > 32768 || output.chunks > 4096) throw new AcpError('protocol', true);
    this.options.onText(id, content.text);
  }
  private check() { if (!this.online) throw new AcpError('closed', true); }
  private reserve(id: string) {
    this.check();
    try { sessionId(id); } catch { throw new AcpError('invalid_input'); }
    if (this.busy.has(id)) throw new AcpError('busy');
    this.busy.add(id);
  }
  private cwd(path: string) { if (!isAbsolute(path)) throw new AcpError('invalid_input'); }
  async createSession(cwd: string): Promise<string> {
    this.check(); this.cwd(cwd);
    if (this.sessions.size + this.creating >= 100) throw new AcpError('busy');
    this.creating++;
    try {
      const id = sessionId(object(await this.rpc.call('session/new', { cwd, mcpServers: [] })).sessionId);
      if (this.sessions.has(id) || this.busy.has(id)) throw new AcpError('protocol', true);
      this.sessions.add(id); return id;
    } catch (error) { this.rpc.abort(); throw error; }
    finally { this.creating--; }
  }
  /** DSH extension verified by R3; do not claim ACP loadSession support or fall back to it. */
  async resumeSession(id: string, cwd: string): Promise<void> {
    this.cwd(cwd);
    if (!this.sessions.has(id) && this.sessions.size + this.creating >= 100) throw new AcpError('busy');
    this.reserve(id); this.creating++;
    try {
      const result = object(await this.rpc.call('session/resume', { sessionId: id, cwd, mcpServers: [] }));
      if (result.sessionId !== undefined && result.sessionId !== id) throw new AcpError('protocol', true);
      this.sessions.add(id);
    } catch (error) { this.rpc.abort(); throw error; }
    finally { this.creating--; this.busy.delete(id); }
  }
  async prompt(id: string, text: string, timeoutMs?: number): Promise<string> {
    if (!this.sessions.has(id) || typeof text !== 'string' || !text.length || Buffer.byteLength(text) > 32768) throw new AcpError('invalid_input');
    if (timeoutMs !== undefined && (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2 ** 31 - 1)) throw new AcpError('invalid_input');
    this.reserve(id);
    this.prompting.set(id, { bytes: 0, chunks: 0 });
    try {
      const result = object(await this.rpc.call('session/prompt', { sessionId: id, prompt: [{ type: 'text', text }] }, timeoutMs,
        () => { this.prompting.delete(id); }));
      if (typeof result.stopReason !== 'string' || !stopReasons.has(result.stopReason)) throw new AcpError('protocol', true);
      return result.stopReason;
    } catch (error) { this.rpc.abort(); throw error; }
    finally { this.busy.delete(id); this.prompting.delete(id); this.cancelling.delete(id); }
  }
  cancel(id: string): void {
    this.check();
    if (!this.sessions.has(id) || !this.busy.has(id)) throw new AcpError('invalid_input');
    if (!this.prompting.has(id)) throw new AcpError('busy');
    if (this.cancelling.has(id)) return;
    this.cancelling.add(id);
    // Notification only. Completion remains the original prompt RPC's stopReason.
    this.rpc.notify('session/cancel', { sessionId: id });
  }
  async closeSession(id: string): Promise<void> {
    if (!this.sessions.has(id)) throw new AcpError('invalid_input');
    this.reserve(id);
    try { object(await this.rpc.call('session/close', { sessionId: id })); this.sessions.delete(id); }
    catch (error) { this.rpc.abort(); throw error; }
    finally { this.busy.delete(id); }
  }
  get deniedNativeRequests() { return this.denied; }
  close(): Promise<void> { this.online = false; return this.rpc.close(); }
}
