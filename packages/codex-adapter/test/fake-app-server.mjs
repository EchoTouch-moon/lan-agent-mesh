#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
if (process.argv.includes('--version')) { console.log('codex-cli 0.146.0'); process.exit(0); }
if (process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY || process.env.HOME !== process.env.CODEX_HOME) process.exit(2);
const file = join(process.env.CODEX_HOME, 'fake-history.json');
let threads; try { threads = JSON.parse(readFileSync(file, 'utf8')); } catch { threads = []; }
let nextTurn = 1, active, permission;
const send = value => console.log(JSON.stringify(value));
const complete = (status = 'completed') => {
  send({ method: 'turn/completed', params: { threadId: active.threadId, turn: { id: active.id, status } } }); active = undefined;
};
createInterface({ input: process.stdin }).on('line', line => {
  const m = JSON.parse(line);
  if (!m.method) { if (permission && m.id === 'approval') { permission = false; send({ method: 'item/agentMessage/delta', params: { threadId: active.threadId, turnId: active.id, delta: m.result?.decision === 'decline' ? 'denied' : 'UNSAFE' } }); complete(); } return; }
  if (m.method === 'initialized') return;
  if (m.method === 'initialize') return send({ id: m.id, result: {} });
  if (m.method === 'thread/start') {
    const thread = { id: `thread-${threads.length}` }; threads.push(thread);
    writeFileSync(file, JSON.stringify(threads), { mode: 0o600 });
    return send({ id: m.id, result: { thread } });
  }
  if (m.method === 'thread/resume') return send({ id: m.id, result: { thread: threads.find(t => t.id === m.params.threadId) } });
  if (m.method === 'turn/interrupt') { send({ id: m.id, result: {} }); return complete('interrupted'); }
  if (m.method === 'turn/start') {
    active = { id: `turn-${nextTurn++}`, threadId: m.params.threadId };
    send({ method: 'turn/started', params: { threadId: active.threadId, turn: { id: active.id } } });
    send({ id: m.id, result: { turn: { id: active.id } } });
    const text = m.params.input[0].text;
    if (text === 'crash') return process.exit(3);
    if (text === 'permission') { permission = true; return send({ id: 'approval', method: 'item/commandExecution/requestApproval', params: { threadId: active.threadId, turnId: active.id } }); }
    send({ method: 'item/agentMessage/delta', params: { threadId: active.threadId, turnId: active.id, delta: text } });
    if (text !== 'hold') complete(text === 'fail' ? 'failed' : 'completed');
  }
});
