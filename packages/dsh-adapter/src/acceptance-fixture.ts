import { createServer, type ServerResponse } from 'node:http';
import { once } from 'node:events';

export const FIXTURE_TEXT = 'LAM DSH adapter fixture response';
export const writeCommand = (path: string) => `Set-Content -LiteralPath '${path.replaceAll("'", "''")}' -Value 'fixture' -Encoding ascii`;
type Body = { model?: string; tools?: { name?: string; function?: { name?: string } }[]; messages?: { role?: string; content?: unknown }[] };
export function permissionResult(value: { control: boolean; rejectedOnce: boolean; sandboxDenied: boolean; markerExists: boolean }) {
  return value.control && value.rejectedOnce && value.sandboxDenied && !value.markerExists;
}

/** Bounded local Messages SSE contract, derived from Windows R3/R4. Never proxies a request. */
export async function startAcceptanceFixture(marker: string) {
  let mode: 'text' | 'hold' | 'permission' = 'text', stage = 0, calls = 0, held = 0, rejected = 0;
  let sandboxDenied = false, pwsh = false;
  const holding = new Set<ServerResponse>();
  const server = createServer((request, response) => {
    void (async () => {
      if (request.method !== 'POST' || request.url !== '/v1/messages' || calls >= 64) { rejected++; response.writeHead(404).end(); return; }
      let bytes = 0; const parts: Buffer[] = [];
      for await (const part of request) {
        bytes += part.length;
        if (bytes > 1024 * 1024) { rejected++; response.writeHead(413).end(); request.resume(); return; }
        parts.push(part);
      }
      let body: Body;
      try { body = JSON.parse(Buffer.concat(parts).toString('utf8')) as Body; if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(); }
      catch { rejected++; response.writeHead(400).end(); return; }
      calls++;
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const event = (type: string, data: Record<string, unknown>) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      event('message_start', { message: { id: `msg_lam_${calls}`, type: 'message', role: 'assistant', model: typeof body.model === 'string' ? body.model : 'deepseek-v4-flash', content: [],
        stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } } });
      if (mode === 'hold') {
        event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
        held++; holding.add(response); response.once('close', () => holding.delete(response)); return;
      }
      if (mode === 'permission' && stage < 2) {
        const tool = body.tools?.find(t => t.name === 'pwsh' || t.function?.name === 'pwsh');
        const denied = body.messages?.some(m => m.role === 'user' && Array.isArray(m.content) &&
          m.content.some((c: unknown) => c && typeof c === 'object' && (c as { type?: string }).type === 'tool_result' && JSON.stringify(c).includes('sandbox: file access denied')));
        sandboxDenied ||= Boolean(denied); pwsh ||= Boolean(tool);
        if (tool && (stage === 0 || denied)) {
          const args = { command: writeCommand(marker), description: 'Deny this fixture-owned marker write',
            ...(stage === 1 ? { sandbox_permissions: 'workspace-write', justification: 'Observe native reject_once, never grant it' } : {}) };
          stage++;
          event('content_block_start', { index: 0, content_block: { type: 'tool_use', id: `toolu_lam_${stage}`, name: 'pwsh', input: {} } });
          event('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(args) } });
          event('content_block_stop', { index: 0 });
          event('message_delta', { delta: { stop_reason: 'tool_use' }, usage: { input_tokens: 1, output_tokens: 1 } });
          event('message_stop', {}); response.end(); return;
        }
      }
      event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
      event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: FIXTURE_TEXT } });
      event('content_block_stop', { index: 0 });
      event('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 1, output_tokens: 1 } });
      event('message_stop', {}); response.end();
    })().catch(() => { rejected++; response.destroy(); });
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Fixture bind failed');
  return {
    baseUrl: `http://127.0.0.1:${address.port}/`,
    setMode(value: typeof mode) { if (holding.size) throw new Error('Previous held response still active'); mode = value; stage = 0; sandboxDenied = false; pwsh = false; },
    snapshot: () => ({ calls, held, rejected, sandboxDenied, pwsh, permissionStages: stage, holding: holding.size }),
    async waitHeld(previous: number, signal: AbortSignal) {
      while (held <= previous) { signal.throwIfAborted(); await new Promise(r => setTimeout(r, 50)); }
    },
    async drainHeld(signal: AbortSignal) {
      while (holding.size) { signal.throwIfAborted(); await new Promise(r => setTimeout(r, 50)); }
    },
    async close() { for (const response of holding) response.destroy(); server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); },
    get listening() { return server.listening; },
  };
}
