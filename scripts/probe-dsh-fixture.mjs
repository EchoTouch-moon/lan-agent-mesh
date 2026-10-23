import { createServer } from 'node:http';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { rpcProcess } from './rpc-probe.mjs';

const root = await mkdtemp(join(tmpdir(), 'lam-dsh-fixture-'));
const command = process.env.LAM_DSH_BIN ?? 'dsh';
const report = { harness: 'dsh', platform: process.platform, inference: 'localhost deterministic fixture; no external model', externalModelRequests: 0, fixtureRequests: 0, results: {} };
let mode = 'text'; let rpc; let notifyHeld; let permissionStage = 0;
const notifications = [];
const fixture = createServer(async (request, response) => {
  if (request.method !== 'POST' || !request.url?.endsWith('/chat/completions')) { response.writeHead(404).end(); return; }
  let raw = ''; for await (const chunk of request) raw += chunk;
  let body; try { body = JSON.parse(raw); } catch { response.writeHead(400).end(); return; }
  report.fixtureRequests++;
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const delta = (value, finish = null) => response.write(`data: ${JSON.stringify({ id: 'chatcmpl-lam-fixture', object: 'chat.completion.chunk', created: 0, model: 'deepseek-v4-flash', choices: [{ index: 0, delta: value, finish_reason: finish }] })}\n\n`);
  delta({ role: 'assistant' });
  if (mode === 'hold') { notifyHeld?.(); return; }
  if (mode === 'permission' && permissionStage < 2) {
    const tool = body.tools?.find(tool => tool.function?.name === 'bash');
    const priorDenial = body.messages?.some(message => message.role === 'tool' && JSON.stringify(message.content).includes('sandbox: file access denied'));
    if (tool && (permissionStage === 0 || priorDenial)) {
      const args = { command: `printf fixture > '${join(root, 'denied-marker')}'`, description: 'Exercise temporary permission denial fixture', ...(permissionStage === 1 ? { sandbox_permissions: 'workspace-write', justification: 'Verify that the native ACP client can reject this temporary fixture operation.' } : {}) };
      permissionStage++;
      delta({ tool_calls: [{ index: 0, id: `call_lam_${permissionStage}`, type: 'function', function: { name: 'bash', arguments: JSON.stringify(args) } }] });
      delta({}, 'tool_calls'); response.end('data: [DONE]\n\n'); return;
    }
    report.results.permissionSetup = { bashAdvertised: Boolean(tool), initialSandboxDenialObserved: Boolean(priorDenial) };
  }
  delta({ content: 'LAM DSH fixture response' }); delta({}, 'stop'); response.end('data: [DONE]\n\n');
});
await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
try {
  report.version = execFileSync(command, ['--version'], { encoding: 'utf8' }).trim();
  const env = { ...process.env, DSH_HOME: root, DEEPSEEK_API_KEY: 'lam-local-fixture-not-a-real-key', DEEPSEEK_BASE_URL: `http://127.0.0.1:${fixture.address().port}`, DSH_PERMISSION_MODE: 'read-only' };
  const connect = async () => {
    const connection = rpcProcess(command, ['--profile', 'acp'], env, root, { onMessage: message => {
      if (message.method) notifications.push(message);
      if (message.method === 'session/request_permission' && 'id' in message) {
        const reject = message.params.options.find(option => option.kind === 'reject_once') ?? message.params.options.find(option => option.kind === 'reject_always');
        connection.reply(message.id, { outcome: reject ? { outcome: 'selected', optionId: reject.optionId } : { outcome: 'cancelled' } });
        report.results.permissions = { status: 'verified', nativeRequestMethod: message.method, decision: reject?.kind ?? 'cancelled' };
      }
    } });
    await connection.call('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'lam-local-fixture', version: '0.0.0' } });
    return connection;
  };
  rpc = await connect();
  const created = await rpc.call('session/new', { cwd: root, mcpServers: [] });
  const sessionId = created.sessionId;
  const prompt = await rpc.call('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'Return a fixture greeting.' }] });
  report.results.send = { status: prompt.stopReason === 'end_turn' ? 'verified' : 'unknown', stopReason: prompt.stopReason };
  const updates = notifications.filter(message => message.method === 'session/update');
  const text = updates.filter(message => message.params?.update?.sessionUpdate === 'agent_message_chunk').map(message => message.params.update.content?.text ?? '').join('');
  report.results.stream = { status: text === 'LAM DSH fixture response' ? 'verified' : 'unknown', matchingFixtureText: text === 'LAM DSH fixture response', observedUpdateTypes: [...new Set(updates.map(message => message.params?.update?.sessionUpdate))] };
  await rpc.call('session/close', { sessionId });
  await rpc.close(); rpc = await connect();
  await rpc.call('session/resume', { sessionId, cwd: root, mcpServers: [] });
  report.results.resume = { status: 'verified', acceptedOriginalSessionIdAfterProcessRestart: true };
  mode = 'hold';
  let holdTimer;
  const held = new Promise((resolve, reject) => { notifyHeld = resolve; holdTimer = setTimeout(() => reject(new Error('Fixture request not started')), 10000); });
  held.catch(() => {});
  const pendingPrompt = rpc.call('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'Wait for cancellation fixture.' }] });
  pendingPrompt.catch(() => {});
  try { await held; } finally { clearTimeout(holdTimer); }
  rpc.notify('session/cancel', { sessionId });
  const cancelled = await pendingPrompt;
  report.results.cancel = { status: cancelled.stopReason === 'cancelled' ? 'verified' : 'unknown', stopReason: cancelled.stopReason, inFlightFixtureRequest: true };
  mode = 'permission';
  const permissionDone = await rpc.call('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'Exercise the denied fixture operation.' }] });
  report.results.permissionTurn = { stopReason: permissionDone.stopReason };
  try { await access(join(root, 'denied-marker')); report.results.deniedOperation = { status: 'failed', markerCreated: true }; }
  catch { report.results.deniedOperation = { status: 'verified', markerCreated: false }; }
  await rpc.call('session/close', { sessionId });
  report.results.permissions ??= { status: 'unknown', reason: 'Native approval was not reached; see permissionSetup' };
  report.results.attachExistingGui = { status: 'unknown', reason: 'Only this probe-owned ACP session was controlled' };
} catch (e) {
  report.error = e.message.replaceAll(root, '<temporary-home>');
  report.observedMethods = [...new Set(notifications.map(message => message.method))]; process.exitCode = 1;
} finally {
  await rpc?.close(); fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve));
  await rm(root, { recursive: true, force: true });
}
console.log(JSON.stringify(report, null, 2));
