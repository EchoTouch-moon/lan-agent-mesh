import { createServer } from 'node:http';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { rpcProcess } from './rpc-probe.mjs';

// Runs the installed harness against deterministic localhost responses; no real model.
const root = await mkdtemp(join(tmpdir(), 'lam-codex-fixture-'));
const command = process.env.LAM_CODEX_BIN ?? 'codex';
const report = { harness: 'codex', platform: process.platform, inference: 'localhost deterministic fixture; no external model', externalModelRequests: 0, fixtureRequests: 0, results: {} };
let mode = 'text'; let rpc; let fixtureCalls = 0; let approvalIssued = false;
const messages = []; const listeners = new Set();
function observe(message) { messages.push(message); for (const listener of listeners) listener(message); }
function waitFor(predicate) {
  const previous = messages.find(predicate); if (previous) return Promise.resolve(previous);
  return new Promise((resolve, reject) => {
    const listener = message => { if (predicate(message)) { clearTimeout(timer); listeners.delete(listener); resolve(message); } };
    const timer = setTimeout(() => { listeners.delete(listener); reject(new Error('Native event timed out')); }, 15000);
    listeners.add(listener);
  });
}
const fixture = createServer(async (request, response) => {
  if (request.method !== 'POST' || !request.url?.endsWith('/responses')) { response.writeHead(404).end(); return; }
  let raw = ''; for await (const chunk of request) raw += chunk;
  let body; try { body = JSON.parse(raw); } catch { response.writeHead(400).end(); return; }
  fixtureCalls++; report.fixtureRequests = fixtureCalls;
  const responseId = `resp_lam_${fixtureCalls}`;
  const event = (type, value) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`);
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  event('response.created', { response: { id: responseId, object: 'response', status: 'in_progress', output: [] } });
  if (mode === 'hold') { observe({ method: 'fixture/holdStarted' }); return; } // turn/interrupt must terminate this in-flight turn.
  if (mode === 'permission' && !approvalIssued) {
    const tool = body.tools?.find(tool => ['exec_command', 'shell_command', 'shell'].includes(tool.name));
    if (!tool) { report.results.permissions = { status: 'unknown', reason: 'No compatible shell tool advertised', advertisedTools: body.tools?.map(tool => tool.name).filter(Boolean) }; }
    else {
      approvalIssued = true;
      const cmd = `printf fixture > '${join(root, 'denied-marker')}'`;
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
try {
  report.version = execFileSync(command, ['--version'], { encoding: 'utf8' }).trim();
  const config = [
    'model_provider="lam_fixture"', 'model="lam-fixture"',
    'model_providers.lam_fixture.name="LAM Local Fixture"',
    `model_providers.lam_fixture.base_url="http://127.0.0.1:${fixture.address().port}/v1"`,
    'model_providers.lam_fixture.wire_api="responses"',
    'model_providers.lam_fixture.requires_openai_auth=false',
    'model_providers.lam_fixture.supports_websockets=false',
  ];
  const args = ['app-server', '--listen', 'stdio://', ...config.flatMap(value => ['-c', value])];
  const connect = async () => {
    const connection = rpcProcess(command, args, { ...process.env, CODEX_HOME: root }, root, { onMessage: message => {
    observe(message);
    if (message.method?.endsWith('/requestApproval') && 'id' in message) {
      report.results.permissions = { status: 'verified', nativeRequestMethod: message.method, decision: 'decline' };
      connection.reply(message.id, { decision: 'decline' });
    }
  } });
    await connection.call('initialize', { clientInfo: { name: 'lam-local-fixture', version: '0.0.0' }, capabilities: { experimentalApi: false } });
    connection.notify('initialized');
    return connection;
  };
  rpc = await connect();
  const created = await rpc.call('thread/start', { cwd: root, approvalPolicy: 'untrusted', sandbox: 'read-only', persistExtendedHistory: false });
  const threadId = created.thread.id;
  const turn = await rpc.call('turn/start', { threadId, input: [{ type: 'text', text: 'Return a fixture greeting.' }] });
  const completed = await waitFor(m => m.method === 'turn/completed' && m.params?.turn?.id === turn.turn.id);
  report.results.send = { status: completed.params.turn.status === 'completed' ? 'verified' : 'unknown', turnStatus: completed.params.turn.status, error: completed.params.turn.error };
  if (completed.params.turn.status !== 'completed') throw new Error('Fixture turn did not complete');
  report.results.stream = { status: messages.some(m => m.method === 'item/agentMessage/delta' && m.params?.delta === 'LAM fixture response') ? 'verified' : 'unknown' };
  await rpc.close();
  rpc = await connect();
  const resumed = await rpc.call('thread/resume', { threadId });
  report.results.resume = { status: 'verified', sameThreadId: resumed.thread.id === threadId, retainedTurns: resumed.thread.turns.length, afterProcessRestart: true };
  mode = 'hold';
  const interrupted = await rpc.call('turn/start', { threadId, input: [{ type: 'text', text: 'Wait for cancellation fixture.' }] });
  await waitFor(m => m.method === 'fixture/holdStarted');
  await rpc.call('turn/interrupt', { threadId, turnId: interrupted.turn.id });
  const cancelled = await waitFor(m => m.method === 'turn/completed' && m.params?.turn?.id === interrupted.turn.id);
  report.results.cancel = { status: cancelled.params.turn.status === 'interrupted' ? 'verified' : 'unknown', turnStatus: cancelled.params.turn.status, inFlightFixtureRequest: true };
  mode = 'permission';
  const permissionTurn = await rpc.call('turn/start', { threadId, input: [{ type: 'text', text: 'Exercise the denied fixture operation.' }] });
  const permissionDone = await waitFor(m => m.method === 'turn/completed' && m.params?.turn?.id === permissionTurn.turn.id);
  report.results.permissionTurn = { turnStatus: permissionDone.params.turn.status };
  try { await access(join(root, 'denied-marker')); report.results.deniedOperation = { status: 'failed', markerCreated: true }; }
  catch { report.results.deniedOperation = { status: 'verified', markerCreated: false }; }
  report.results.attachExistingGui = { status: 'unknown', reason: 'Only this probe-owned thread was controlled' };
} catch (e) {
  report.error = e.message.replaceAll(root, '<temporary-home>');
  report.observedMethods = [...new Set(messages.map(m => m.method).filter(Boolean))];
  report.nativeErrors = messages.filter(m => m.method === 'error').map(m => m.params?.error?.message ?? m.params?.message).filter(Boolean).map(s => s.replaceAll(root, '<temporary-home>'));
  process.exitCode = 1;
} finally {
  await rpc?.close(); fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve));
  await rm(root, { recursive: true, force: true });
}
console.log(JSON.stringify(report, null, 2));
