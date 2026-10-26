#!/usr/bin/env node
// Synthetic ZCode app-server peer for adapter unit tests. Speaks the installed CLI's
// strict NDJSON envelopes (id/method/params, no JSON-RPC version field) and implements
// the behaviors the adapter contract depends on: turn lifecycle keyed by inputId,
// runtime-preferences callback, native permission request, cancel, crash, fail, and
// event noise (foreign inputIds / post-terminal duplicates) that must be dropped.
import { createInterface } from 'node:readline';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

if (process.argv.includes('--version')) { console.log('0.17.0'); process.exit(0); }
// The adapter must have isolated the child: owned home and no inherited credentials.
if (process.env.OPENAI_API_KEY || process.env.ZCODE_OPENAI_API_KEY || process.env.HOME !== process.env.ZCODE_DATA_BASE_DIR || !process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE) process.exit(2);

const file = join(process.env.ZCODE_DATA_BASE_DIR, 'fake-sessions.json');
let sessions; try { sessions = JSON.parse(readFileSync(file, 'utf8')); } catch { sessions = []; }
let permission; // { inputId, requestId }
const send = value => console.log(JSON.stringify(value));
// Mirror the native event shape: session-scoped params with sessionId; lifecycle payloads
// carry inputId, model.streaming deltas do NOT (attribution is by session in the adapter).
let activeSessionId;
const event = (type, payload) => send({ method: 'session/event', params: { sessionId: activeSessionId, type, payload } });
const stream = delta => event('model.streaming', { kind: 'text_delta', delta });
const complete = (inputId, resultType = 'success') => event('turn.completed', { inputId, resultType });

createInterface({ input: process.stdin }).on('line', line => {
  const m = JSON.parse(line);
  if (!m.method) {
    // Client reply to a server-initiated request.
    if (permission && m.id === permission.requestId) {
      const denied = m.result?.decision === 'deny';
      const inputId = permission.inputId; permission = undefined;
      if (denied) { stream('denied'); complete(inputId); }
      else { stream('UNSAFE'); complete(inputId); }
    }
    return;
  }
  if (m.method === 'runtime/capabilities') {
    send({ method: 'startup/storageState', params: { phase: 'ready' } });
    send({ id: 'prefs', method: 'session/requestRuntimePreferences', params: { scope: 'session' } });
    return send({ id: m.id, result: { capabilities: {} } });
  }
  if (m.method === 'session/create') {
    const session = { sessionId: m.params.sessionId, workspaceKey: m.params.workspace?.workspaceKey, messages: [] };
    sessions.push(session); writeFileSync(file, JSON.stringify(sessions), { mode: 0o600 });
    return send({ id: m.id, result: { sessionId: session.sessionId } });
  }
  if (m.method === 'session/subscribe') return send({ id: m.id, result: {} });
  if (m.method === 'session/setMode' || m.method === 'session/close') return send({ id: m.id, result: {} });
  if (m.method === 'session/resume') {
    const session = sessions.find(s => s.sessionId === m.params.sessionId);
    if (!session) return send({ id: m.id, error: { code: -32001, message: 'Session not found' } });
    return send({ id: m.id, result: { messages: session.messages } });
  }
  if (m.method === 'session/stop') {
    const session = sessions.find(s => s.sessionId === m.params.sessionId);
    const inputId = session?.activeInputId;
    if (inputId !== undefined) { session.activeInputId = undefined; send({ id: m.id, result: {} }); return complete(inputId, 'cancelled'); }
    return send({ id: m.id, result: {} });
  }
  if (m.method === 'session/send') {
    const session = sessions.find(s => s.sessionId === m.params.sessionId);
    if (!session) return send({ id: m.id, error: { code: -32001, message: 'Session not found' } });
    const inputId = m.params.inputId, text = m.params.content;
    session.activeInputId = inputId; session.messages.push({ inputId, text });
    activeSessionId = session.sessionId;
    writeFileSync(file, JSON.stringify(sessions), { mode: 0o600 });
    event('turn.started', { inputId });
    send({ id: m.id, result: { accepted: true } });
    if (text === 'crash') return process.exit(3);
    if (text === 'permission') { permission = { inputId, requestId: `perm-${inputId}` }; return send({ id: `perm-${inputId}`, method: 'interaction/requestPermission', params: { inputId } }); }
    stream(text);
    if (text === 'hold') return;
    if (text === 'fail') return event('turn.failed', { inputId, error: { message: 'native failure' } });
    complete(inputId);
    if (text === 'dedup') {
      // Noise the adapter must drop: a foreign inputId and post-terminal duplicates.
      const foreignSession = activeSessionId; activeSessionId = 'sess_foreign';
      stream('GHOST');
      activeSessionId = foreignSession;
      stream('LATE');
      complete(inputId, 'cancelled');
    }
  }
});
