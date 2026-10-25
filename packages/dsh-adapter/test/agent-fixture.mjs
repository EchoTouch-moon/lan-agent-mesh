// Synthetic ACP peer only. It never loads a Harness, user configuration or a model.
import { createInterface } from 'node:readline';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
if (process.argv.includes('--version')) { console.log('0.2.1-rc.2'); process.exit(0); }
const mode = process.argv[2] === '--profile' ? 'normal' : process.argv[2] ?? 'normal';
const audit = join(process.cwd(), 'fixture-audit.jsonl');
const state = join(process.cwd(), 'fixture-sessions.json');
const sessions = existsSync(state) ? JSON.parse(readFileSync(state, 'utf8')) : [];
const held = new Map();
let reverse;
const log = value => appendFileSync(audit, JSON.stringify(value) + '\n');
const send = value => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n');
const reply = (id, result) => send({ id, result });
const update = (sessionId, text) => send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } } });
const input = createInterface({ input: process.stdin });
input.on('line', line => {
  const message = JSON.parse(line);
  log(message);
  if (!message.method) {
    const pending = held.get('permission');
    if (pending && message.id === 'permission-1') {
      held.delete('permission'); reply(pending.id, { stopReason: pending.fixtureCancel ? 'cancelled' : 'end_turn' });
    }
    return;
  }
  const { id, method, params } = message;
  if (method === 'initialize') {
    reply(id, { protocolVersion: 1, agentInfo: { name: 'deepseek-harness-acp', version: mode === 'wrong-version' ? '999' : '0.0.1' } });
  } else if (method === 'session/new') {
    const sessionId = `fixture-${sessions.length + 1}`;
    sessions.push(sessionId); writeFileSync(state, JSON.stringify(sessions)); reply(id, { sessionId });
  } else if (method === 'session/resume') {
    if (!sessions.includes(params.sessionId)) send({ id, error: { code: -32000, message: 'SECRET_NATIVE_DIAGNOSTIC missing session' } });
    else { update(params.sessionId, 'history must not become new output'); reply(id, {}); }
  } else if (method === 'session/close') {
    reply(id, {});
  } else if (method === 'session/cancel') {
    const pending = held.get(params.sessionId);
    if (pending) {
      held.delete(params.sessionId);
      if (mode === 'cancel-permission') {
        held.set('permission', { ...pending, fixtureCancel: true });
        send({ id: 'permission-1', method: 'session/request_permission', params: { sessionId: params.sessionId,
          options: [{ kind: 'reject_once', optionId: 'deny' }] } });
      } else { update(params.sessionId, 'cancelled'); reply(pending.id, { stopReason: 'cancelled' }); }
    }
  } else if (method === 'session/prompt') {
    if (params.prompt[0].text === 'incomplete') { reply(id, { stopReason: 'max_tokens' }); return; }
    if (mode === 'duplicate-permission') {
      send({ id: 'dup', method: 'session/request_permission', params: { sessionId: 'unknown', options: [] } });
      send({ id: 'dup', method: 'session/request_permission', params: { sessionId: 'unknown', options: [] } }); return;
    }
    if (mode === 'native-error') { send({ id, error: { code: -32000, message: 'SECRET_NATIVE_DIAGNOSTIC', data: 'secret' } }); return; }
    if (mode === 'exit') { process.stderr.write('SECRET_NATIVE_DIAGNOSTIC'); process.exit(9); }
    if (mode === 'malformed') { process.stdout.write('not-json\n'); return; }
    if (mode === 'oversize') { process.stdout.write('x'.repeat(1024 * 1024 + 1)); return; }
    if (mode === 'invalid-utf8') { process.stdout.write(Buffer.from([0xff, 10])); return; }
    if (mode === 'unknown-response') { reply(100000, {}); return; }
    if (mode === 'conflicting-response') { send({ id, result: {}, error: { code: -32000, message: 'secret' } }); return; }
    if (mode === 'invalid-stop') { reply(id, { stopReason: 'something-else' }); return; }
    if (mode === 'stream-flood') { update(params.sessionId, 'x'.repeat(32769)); return; }
    if (mode === 'tree') {
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      log({ descendant: child.pid });
    }
    const text = params.prompt[0].text;
    if (text === 'hold' || mode === 'tree') { held.set(params.sessionId, message); update(params.sessionId, 'started'); return; }
    if (['permission', 'allow-only', 'wrong-session'].includes(text)) {
      held.set('permission', message);
      send({ id: 'filesystem-1', method: 'fs/write_text_file', params: { path: 'must-not-write', content: 'secret' } });
      send({ id: 'permission-1', method: 'session/request_permission', params: {
        sessionId: text === 'wrong-session' ? 'foreign-session' : params.sessionId,
        options: [{ kind: 'allow_once', optionId: 'allow' }, ...(text === 'allow-only' ? [] : [{ kind: 'reject_once', optionId: 'deny' }])],
      } }); return;
    }
    // Split a multibyte UTF-8 character across OS writes, followed by a terminal reply.
    const frame = Buffer.from(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: {
      sessionId: params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '你好🌙' } },
    } }) + '\n');
    const split = frame.indexOf(Buffer.from('🌙')) + 1;
    process.stdout.write(frame.subarray(0, split));
    setTimeout(() => {
      const terminal = JSON.stringify({ jsonrpc: '2.0', id, result: { stopReason: 'end_turn' } }) + '\n';
      const late = mode === 'late-update' ? JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: {
        sessionId: params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'late output' } },
      } }) + '\n' : '';
      // Same OS write deliberately puts a late notification immediately after the terminal reply.
      process.stdout.write(Buffer.concat([frame.subarray(split), Buffer.from(terminal + late)]));
    }, 10);
  } else if (method === 'echo') {
    if (params.n === 1) reverse = message;
    else { reply(id, params.n); reply(reverse.id, reverse.params.n); }
  } // Other methods intentionally hang for timeout/pending-limit tests.
});
