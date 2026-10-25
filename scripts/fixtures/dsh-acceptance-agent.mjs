// Synthetic peer for the acceptance runner only. Simulates sandbox/permission behavior; executes NO tool commands.
import { createInterface } from 'node:readline';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { TextDecoder } from 'node:util';
import { URL } from 'node:url';
const state = join(process.cwd(), 'synthetic-sessions.json');
const sessions = existsSync(state) ? JSON.parse(readFileSync(state, 'utf8')) : [];
const active = new Map(), permissions = new Map();
let nextPermission = 0;
const send = value => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n');
const reply = (id, result) => send({ id, result });
const update = (sessionId, text) => send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } } });

async function prompt(message, controller) {
  const messages = [{ role: 'user', content: [{ type: 'text', text: message.params.prompt[0].text }] }];
  try {
    for (let turn = 0; turn < 4; turn++) {
      const response = await globalThis.fetch(new URL('v1/messages', process.env.DEEPSEEK_BASE_URL), { method: 'POST', signal: controller.signal,
        body: JSON.stringify({ model: 'lam-synthetic', stream: true, messages, tools: [{ name: 'pwsh' }] }) });
      if (!response.ok || !response.body) throw new Error();
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let buffer = '', ended = false, toolId, args = '';
      for (;;) {
        const part = await reader.read(); if (part.done) break;
        buffer += decoder.decode(part.value, { stream: true });
        let end;
        while ((end = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          const data = frame.split('\n').find(line => line.startsWith('data: ')); if (!data) continue;
          const event = JSON.parse(data.slice(6));
          if (event.type === 'message_start' && !event.message?.usage) throw new Error();
          if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') toolId = event.content_block.id;
          if (event.type === 'content_block_delta' && event.delta.type === 'input_json_delta') args += event.delta.partial_json;
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') update(message.params.sessionId, event.delta.text);
          if (event.type === 'message_stop') ended = true;
        }
      }
      if (!ended) throw new Error();
      if (!toolId) { reply(message.id, { stopReason: 'end_turn' }); return; }
      const input = JSON.parse(args);
      let result = 'sandbox: file access denied';
      if (input.sandbox_permissions === 'workspace-write') {
        const id = `permission-${++nextPermission}`;
        const decision = new Promise(resolve => permissions.set(id, resolve));
        send({ id, method: 'session/request_permission', params: { sessionId: message.params.sessionId,
          options: [{ kind: 'allow_once', optionId: 'allow' }, { kind: 'reject_once', optionId: 'reject' }] } });
        const outcome = await decision;
        if (outcome?.outcome?.optionId === 'allow') throw new Error('Synthetic acceptance must never grant');
        result = 'permission denied by synthetic client';
      }
      messages.push({ role: 'assistant', content: [{ type: 'tool_use', id: toolId, name: 'pwsh', input }] });
      messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: toolId, content: result }] });
    }
    throw new Error();
  } catch {
    if (controller.signal.aborted) reply(message.id, { stopReason: 'cancelled' });
    else send({ id: message.id, error: { code: -32000, message: 'Synthetic fixture failure' } });
  } finally { active.delete(message.params.sessionId); }
}
createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line), { id, method, params } = message;
  if (!method) { const resolve = permissions.get(id); permissions.delete(id); resolve?.(message.result); return; }
  if (method === 'initialize') reply(id, { protocolVersion: 1, agentInfo: { name: 'deepseek-harness-acp', version: '0.0.1' } });
  else if (method === 'session/new') { const sessionId = `synthetic-${sessions.length + 1}`; sessions.push(sessionId); writeFileSync(state, JSON.stringify(sessions)); reply(id, { sessionId }); }
  else if (method === 'session/resume') {
    if (!sessions.includes(params.sessionId)) send({ id, error: { code: -32000, message: 'Synthetic session missing' } });
    else reply(id, {});
  } else if (method === 'session/close') reply(id, {});
  else if (method === 'session/prompt') { const controller = new globalThis.AbortController(); active.set(params.sessionId, controller); void prompt(message, controller); }
  else if (method === 'session/cancel') active.get(params.sessionId)?.abort();
});
