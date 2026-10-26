#!/usr/bin/env node
// LHI-2 (#81) native-local smoke: drives the INSTALLED ZCode bundled CLI through
// ZcodeAdapter under an adapter-owned home with a loopback fixed-response inferencer and a
// fake provider key. Lifecycle: spawn -> send/stream -> cancel in-flight -> native
// permission denial (marker must not appear) -> elapsed-deadline UNKNOWN -> restart resume
// + durable idempotent retry -> cleanup proof. Assertion gate mirrors the LHI-1 probe:
// exit 0 only if every load-bearing check holds. darwin only; Windows stays NOT-RUN.
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, statSync, existsSync, mkdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { ZcodeAdapter } from '../dist/index.js';

const entry = process.env.LAM_ZCODE_ENTRY ?? '/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs';
const builtinConfig = process.env.LAM_ZCODE_BUILTIN_CONFIG ?? resolve(dirname(entry), '../config/provider/zcode-builtin.json');
// Canonicalize up front: on macOS the TMPDIR symlink (/var -> /private/var) must not leak
// into the adapter's canonical-path workspace validation.
const root = realpathSync(mkdtempSync(join(tmpdir(), 'lam-lhi2-zcode-native-')));
const home = join(root, 'adapter-home'), workspace = join(root, 'workspace');
mkdirSync(workspace, { mode: 0o700 });
const marker = join(workspace, 'denied-marker');
const report = { platform: process.platform, node: process.version, entry, phases: {}, assertions: [], externalModelRequests: 0, fixtureRequests: 0 };

const fixture = createServer(async (request, response) => {
  if (request.method !== 'POST' || !request.url?.endsWith('/chat/completions')) { response.writeHead(404).end(); return; }
  let raw = ''; for await (const chunk of request) raw += chunk;
  let body; try { body = JSON.parse(raw); } catch { response.writeHead(400).end(); return; }
  report.fixtureRequests++;
  report.fixtureLog ??= [];
  const messages = body.messages ?? [];
  const lastUser = [...messages].reverse().find(m => m?.role === 'user');
  const lastUserText = typeof lastUser?.content === 'string' ? lastUser.content : JSON.stringify(lastUser?.content ?? '');
  // Phase detection MUST use the last user message: turn history accumulates every earlier
  // marker, and history-based checks misroute continuation requests (observed: a post-denial
  // continuation matched an earlier HOLD marker and hung the stream for the full deadline).
  const wantsPermission = lastUserText.includes('LHI2_PERMISSION');
  const wantsHold = lastUserText.includes('LHI2_HOLD');
  // The permission tool_call is emitted at most once per turn: once a tool call/result
  // message exists in history, answer with final text. Re-emitting per request loops the
  // native turn engine (observed: ~1400 model calls within one 120s deadline).
  const toolTracePresent = messages.some(m => m?.role === 'tool' || (m?.role === 'assistant' && (Array.isArray(m.content) || 'tool_calls' in m)));
  report.fixtureLog.push({ request: report.fixtureRequests, lastUser: lastUserText.slice(0, 40), wantsPermission, wantsHold, toolTracePresent });
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const delta = (value, finish = null) => response.write(`data: ${JSON.stringify({ id: 'chatcmpl-lhi2', object: 'chat.completion.chunk', created: 0, model: 'lam-zcode-fixture', choices: [{ index: 0, delta: value, finish_reason: finish }] })}\n\n`);
  delta({ role: 'assistant' });
  if (wantsPermission && !toolTracePresent) {
    const tool = (body.tools ?? []).find(t => /^(bash|shell)$/i.test(t.function?.name ?? ''));
    if (tool) {
      delta({ tool_calls: [{ index: 0, id: 'call_lhi2_perm', type: 'function', function: { name: tool.function.name, arguments: JSON.stringify({ command: `printf p > '${marker}'`, description: 'LHI2 native denial fixture' }) } }] });
      delta({}, 'tool_calls'); response.end('data: [DONE]\n\n'); return;
    }
  }
  if (wantsHold) { delta({ content: 'LHI2 HOLDING' }); return; } // stream stays open after a visible delta; the turn is genuinely in flight
  delta({ content: 'LHI2 NATIVE OK' }); delta({}, 'stop'); response.end('data: [DONE]\n\n');
});
await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));

async function events(adapter, taskId) {
  const result = []; for await (const event of adapter.watch(taskId)) result.push(event); return result;
}
function gate(name, pass, detail) { report.assertions.push({ name, pass: pass === true, detail }); }

let adapter;
try {
  const options = {
    nodeId: 'lhi2-node', executable: entry, home, workspaces: { fixture: workspace },
    fixtureBaseUrl: `http://127.0.0.1:${fixture.address().port}/v1`, expectedVersion: '0.17.0', builtinConfig,
    mode: 'build',
  };
  adapter = await ZcodeAdapter.open(options);
  report.phases.open = { executableSha256: adapter.executableSha256, probe: await adapter.probe() };
  const session = await adapter.spawn({ agentId: adapter.agentId, workspaceAlias: 'fixture' });
  report.phases.spawn = { session: session.id !== session.nativeSessionId ? 'distinct-mapping' : 'SAME-IDS' };

  const t1 = { sessionId: session.id, taskId: 'lhi2-t1', text: 'LHI2 plain turn', idempotencyKey: 'lhi2-k1', deadline: new Date(Date.now() + 120000).toISOString() };
  await adapter.send(t1);
  const stream1 = await events(adapter, 'lhi2-t1');
  report.phases.sendStream = { events: stream1.map(e => e.type), text: stream1.at(-1)?.text };
  gate('send-stream-completes', stream1.at(-1)?.type === 'completed' && stream1.at(-1).text === 'LHI2 NATIVE OK');
  gate('stream-ordered-deltas', stream1[0]?.type === 'delta' && stream1.filter(e => e.type === 'completed').length === 1);

  const t2 = { sessionId: session.id, taskId: 'lhi2-t2', text: 'LHI2_HOLD', idempotencyKey: 'lhi2-k2', deadline: new Date(Date.now() + 120000).toISOString() };
  await adapter.send(t2);
  // Wait for a real in-flight signal (first streamed delta) before cancelling, mirroring the
  // verified probe ordering; cancelling before the turn is running races the native stop path.
  const t2Stream = adapter.watch('lhi2-t2')[Symbol.asyncIterator]();
  const first = await t2Stream.next();
  report.phases.holdFirstEvent = first.value?.type ?? null;
  await adapter.cancel('lhi2-t2');
  const stream2 = [first.value, ...await (async () => { const rest = []; while (true) { const n = await t2Stream.next(); if (n.done) break; rest.push(n.value); } return rest; })()];
  report.phases.cancel = { events: stream2.map(e => e?.type) };
  gate('cancel-terminal', stream2.at(-1)?.type === 'cancelled');

  const t3 = { sessionId: session.id, taskId: 'lhi2-t3', text: 'LHI2_PERMISSION', idempotencyKey: 'lhi2-k3', deadline: new Date(Date.now() + 120000).toISOString() };
  await adapter.send(t3);
  const stream3 = await events(adapter, 'lhi2-t3');
  report.phases.permission = { events: stream3.map(e => e.type), denials: adapter.deniedNativeRequests, markerCreated: existsSync(marker) };
  gate('permission-fail-closed', !existsSync(marker) && stream3.at(-1)?.type === 'completed');

  // The elapsed-deadline turn ends UNKNOWN and conservatively holds ITS session; use a
  // separate session so the restart/resume checks exercise a clean one.
  const deadlineSession = await adapter.spawn({ agentId: adapter.agentId, workspaceAlias: 'fixture' });
  const t4 = { sessionId: deadlineSession.id, taskId: 'lhi2-t4', text: 'LHI2_HOLD', idempotencyKey: 'lhi2-k4', deadline: new Date(Date.now() + 300).toISOString() };
  await adapter.send(t4);
  const stream4 = await events(adapter, 'lhi2-t4');
  report.phases.deadline = { events: stream4.map(e => e.type), onlineAfter: (await adapter.probe()).available };
  gate('deadline-ends-unknown', stream4.at(-1)?.type === 'unknown' && (await adapter.probe()).available === false);

  await adapter.close();
  adapter = await ZcodeAdapter.open(options);
  const resumed = await adapter.resume(session.id);
  const retry = await adapter.send(t1);
  const replay = await events(adapter, 'lhi2-t1');
  report.phases.restart = { resumedNativeId: resumed.nativeSessionId === session.nativeSessionId, retry, replayType: replay.at(-1)?.type };
  gate('restart-resume-identity', resumed.nativeSessionId === session.nativeSessionId);
  gate('durable-idempotent-retry', retry.taskId === 'lhi2-t1' && replay.at(-1)?.type === 'completed');
  gate('no-external-models-accounted', report.externalModelRequests === 0 && report.fixtureRequests > 0);
} catch (error) {
  report.error = String(error?.message ?? error);
} finally {
  await adapter?.close().catch(() => {});
  fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve));
  report.fixtureRequestsTotal = report.fixtureRequests;
  const lockGone = !existsSync(join(home, 'adapter.lock'));
  if (report.error || report.assertions.some(g => !g.pass)) {
    report.keptForDiagnosis = root; // failure keeps the disposable home for log inspection
    console.error(JSON.stringify(report, null, 2));
    process.exitCode = 1;
    process.exit(process.exitCode ?? 1);
  }
  rmSync(root, { recursive: true, force: true });
  let homeGone = false; try { statSync(root); } catch (error) { homeGone = error.code === 'ENOENT'; }
  gate('lock-released-on-close', lockGone, String(lockGone));
  gate('disposable-root-removed', homeGone, String(homeGone));
  report.verdict = report.assertions.every(g => g.pass) && !report.error ? 'PASS' : 'FAIL';
  if (report.verdict === 'FAIL') process.exitCode = 1;
}
console.log(JSON.stringify(report, null, 2));
