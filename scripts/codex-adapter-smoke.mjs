import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm, realpath, readFile, unlink, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { CodexAdapter } from '../packages/codex-adapter/dist/index.js';
import { Gateway } from '../packages/runtime/dist/index.js';

if (process.platform !== 'darwin') throw new Error('Windows Codex entry is not verified; do not execute MSIX candidates');
const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
if (dirty && !process.argv.includes('--allow-dirty')) throw new Error('Commit source before formal capture');
const command = process.env.LAM_CODEX_BIN;
if (!command || !command.startsWith('/')) throw new Error('Set LAM_CODEX_BIN to the verified absolute CLI path');
const root = await realpath(await mkdtemp(join(tmpdir(), 'LAM codex adapter & ')));
const workspace = join(root, 'workspace'); await mkdir(workspace, { mode: 0o700 });
const report = { testedSourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceClean: !dirty, startedUtc: new Date().toISOString(), platform: process.platform,
  nodeVersion: process.version, codexVersion: execFileSync(command, ['--version'], { encoding: 'utf8' }).trim(),
  executableSha256: createHash('sha256').update(await readFile(command)).digest('hex'),
  externalModelRequests: 0, fixtureRequests: 0, results: {} };
let mode = 'text', fixtureCalls = 0, approvalIssued = false, holdStarted, adapter, a, b, gatewayAdapter;
async function collect(task) {
  const events = []; for await (const e of adapter.watch(task, globalThis.AbortSignal.timeout(20000))) events.push(e); return events;
}
async function send(text) {
  const input = { sessionId: session.id, taskId: randomUUID(), idempotencyKey: randomUUID(), text, deadline: new Date(Date.now() + 25000).toISOString() };
  await adapter.send(input); return input;
}
let session, stage = 'initialize';
function writeCommand(path) { return "printf fixture > '" + path.replaceAll("'", "'\\''") + "'"; }
const fixture = createServer(async (request, response) => {
  if (request.method !== 'POST' || !request.url?.endsWith('/responses')) { response.writeHead(404).end(); return; }
  let raw = ''; for await (const chunk of request) raw += chunk;
  let body; try { body = JSON.parse(raw); } catch { response.writeHead(400).end(); return; }
  fixtureCalls++; report.fixtureRequests = fixtureCalls;
  const responseId = `resp_lam_${fixtureCalls}`;
  const event = (type, value) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`);
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  event('response.created', { response: { id: responseId, object: 'response', status: 'in_progress', output: [] } });
  if (mode === 'hold') { holdStarted?.(); return; } // turn/interrupt must terminate this in-flight turn.
  if (mode === 'permission' && !approvalIssued) {
    const tool = body.tools?.find(tool => ['exec_command', 'shell_command', 'shell'].includes(tool.name));
    if (!tool) { report.results.permissions = { status: 'unknown', reason: 'No compatible shell tool advertised', advertisedTools: body.tools?.map(tool => tool.name).filter(Boolean) }; }
    else {
      approvalIssued = true;
      const cmd = writeCommand(join(root, 'denied-marker'));
      const args = tool.name === 'exec_command' ? { cmd } : tool.name === 'shell_command' ? { command: cmd } : { command: ['sh', '-c', cmd] };
      const item = { id: 'fc_lam', type: 'function_call', call_id: 'call_lam_permission', name: tool.name, arguments: JSON.stringify(args) };
      event('response.output_item.added', { output_index: 0, item });
      event('response.output_item.done', { output_index: 0, item });
      event('response.completed', { response: { id: responseId, status: 'completed', output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } } });
      response.end(); return;
    }
  }
  const item = { id: `msg_lam_${fixtureCalls}`, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'LAM fixture response', annotations: [] }] };
  event('response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress', content: [] } });
  event('response.content_part.added', { item_id: item.id, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
  event('response.output_text.delta', { item_id: item.id, output_index: 0, content_index: 0, delta: 'LAM fixture response' });
  event('response.output_item.done', { output_index: 0, item });
  event('response.completed', { response: { id: responseId, status: 'completed', output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } } });
  response.end();
});
await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
const options = { nodeId: 'fixture-node', executable: resolve(command), home: join(root, 'home'),
  workspaces: { fixture: workspace }, fixtureBaseUrl: `http://127.0.0.1:${fixture.address().port}/v1`, expectedVersion: 'codex-cli 0.146.0' };
try {
  adapter = await CodexAdapter.open(options);
  stage = 'spawn-send-stream';
  session = await adapter.spawn({ agentId: adapter.agentId, workspaceAlias: 'fixture' });
  assert.notEqual(session.id, session.nativeSessionId);
  const input = await send('Return the fixture greeting.');
  const events = await collect(input.taskId);
  assert.deepEqual(events.at(-1), { type: 'completed', taskId: input.taskId, text: 'LAM fixture response' });
  assert.equal(events.filter(e => e.type === 'delta').map(e => e.text).join(''), 'LAM fixture response');
  report.results.sendStream = 'verified';
  stage = 'restart-resume-retry';
  const nativeId = session.nativeSessionId;
  await adapter.close(); adapter = await CodexAdapter.open(options);
  assert.equal((await adapter.resume(session.id)).nativeSessionId, nativeId);
  const calls = fixtureCalls; await adapter.send(input); assert.equal(fixtureCalls, calls);
  assert.deepEqual((await collect(input.taskId)).at(-1), events.at(-1));
  report.results.restartResumeAndExactRetry = 'verified';
  stage = 'in-flight-cancel'; mode = 'hold';
  let held = new Promise(resolve => { holdStarted = resolve; });
  const cancel = await send('Wait for cancellation.'); await held;
  await assert.rejects(adapter.send({ ...cancel, taskId: randomUUID(), idempotencyKey: randomUUID() }), /already active/);
  await adapter.cancel(cancel.taskId);
  assert.equal((await collect(cancel.taskId)).at(-1).type, 'cancelled');
  report.results.inFlightCancelAndSessionMutex = 'verified';
  // Same shell command body for the operator-owned positive control and requested denied write.
  stage = 'native-permission';
  const positive = join(root, 'positive-marker');
  execFileSync('/bin/sh', ['-c', writeCommand(positive)]);
  assert.equal(await readFile(positive, 'utf8'), 'fixture'); await unlink(positive);
  mode = 'permission';
  const denied = await send('Exercise the denied fixture operation.');
  assert.equal((await collect(denied.taskId)).at(-1).type, 'completed');
  assert.ok(adapter.deniedNativeRequests >= 1, 'Native approval callback must be observed');
  await assert.rejects(access(join(root, 'denied-marker')), { code: 'ENOENT' });
  report.results.nativeDeclineWithPositiveControl = 'verified';
  stage = 'unknown-no-replay'; mode = 'hold'; held = new Promise(resolve => { holdStarted = resolve; });
  const uncertain = await send('Hold for owned process shutdown.'); await held;
  await adapter.close(); adapter = await CodexAdapter.open(options);
  const priorCalls = fixtureCalls;
  await adapter.send(uncertain); assert.equal((await collect(uncertain.taskId)).at(-1).type, 'unknown');
  await assert.rejects(adapter.resume(session.id), /ambiguous/); assert.equal(fixtureCalls, priorCalls);
  report.results.unknownNoReplayAfterRestart = 'verified';
  await adapter.close(); adapter = undefined;
  stage = 'gateway-fixture'; mode = 'text';
  a = await new Gateway({ directory: join(root, 'caller'), listen: ['/ip4/127.0.0.1/tcp/0'] }).start();
  b = await new Gateway({ directory: join(root, 'receiver'), listen: ['/ip4/127.0.0.1/tcp/0'],
    exportAgents: nodeId => [`${nodeId}/codex/default`],
    adapterFactories: [async ({ nodeId }) => {
      gatewayAdapter = await CodexAdapter.open({ ...options, nodeId, home: join(root, 'gateway-codex-home') });
      return gatewayAdapter;
    }],
  }).start();
  const p = await a.mesh.beginPairing(b.mesh.addresses[0]); const q = b.mesh.pendingPairings().find(q => q.id === p.id);
  assert.equal(p.code, q.code); await a.mesh.confirmPairing(p.id, p.code); await b.mesh.confirmPairing(q.id, q.code);
  const registry = await a.sync(b.mesh.id); assert.equal(registry.harnesses[0].kind, 'codex');
  assert.equal(registry.harnesses[0].version, 'codex-cli 0.146.0');
  const remote = await a.spawn(b.mesh.id, registry.agents[0].id, 'fixture');
  const taskId = randomUUID(); await a.submit(b.mesh.id, remote, 'Fixture via encrypted Gateway.', randomUUID(), taskId);
  let cursor = 0, terminal, received = [];
  for (let n = 0; n < 400; n++) {
    const batch = await a.events(b.mesh.id, taskId, cursor); cursor = batch.next; received.push(...batch.events);
    if (!['QUEUED', 'RUNNING', 'WAITING_INPUT'].includes(batch.state)) { terminal = batch.state; break; }
    await delay(25);
  }
  assert.equal(terminal, 'COMPLETED'); assert.equal(received.at(-1).text, 'LAM fixture response');
  await b.stop(); assert.equal((await gatewayAdapter.probe()).available, false);
  report.results.sameHostGatewayToCodex = 'verified';
  report.results.physicalW3 = 'pending'; report.results.windowsCodex = 'unknown'; report.results.attachExistingGui = 'unsupported';
  report.status = 'passed';
} catch {
  report.status = 'failed'; report.failureStage = stage; process.exitCode = 1;
} finally {
  await a?.stop(); await b?.stop(); await adapter?.close();
  fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve));
  await rm(root, { recursive: true, force: true }); report.cleanup = 'verified'; report.endedUtc = new Date().toISOString();
}
console.log(JSON.stringify(report, null, 2));
