import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { access, copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { rpcProcess } from './rpc-probe.mjs';
import { redactProbeText, startupLogSummary } from './probe-diagnostics.mjs';

const entry = process.env.LAM_ZCODE_ENTRY ?? '/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs';
const root = await mkdtemp(join(tmpdir(), 'lam-zcode-fixture-'));
const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('ZCODE_')));
const env = { ...inherited, HOME: root, ...(process.platform === 'win32' ? { USERPROFILE: root, APPDATA: join(root, 'appdata'), LOCALAPPDATA: join(root, 'localappdata') } : {}), XDG_CONFIG_HOME: root, XDG_DATA_HOME: root, ZCODE_DATA_BASE_DIR: root, ZCODE_STORAGE_DIR: join(root, 'storage'), ZCODE_SESSION_DB_PATH: join(root, 'sessions.sqlite'), ZCODE_LOG_DIR: join(root, 'logs') };
const report = { harness: 'zcode', platform: process.platform, inference: 'localhost deterministic fixture; no external model', externalModelRequests: 0, fixtureRequests: 0, results: {} };
report.startup = { storageStates: [], preferenceRequests: [], preferenceReplies: 0 };
let rpc; let mode = 'text'; let permissionIssued = false;
const observed = []; const listeners = new Set();
function observe(message) { observed.push(message); for (const listener of listeners) listener(message); }
function waitFor(predicate) {
  const previous = observed.find(predicate); if (previous) return Promise.resolve(previous);
  return new Promise((resolve, reject) => {
    const listener = message => { if (predicate(message)) { clearTimeout(timer); listeners.delete(listener); resolve(message); } };
    const timer = setTimeout(() => { listeners.delete(listener); reject(new Error('Native event timed out')); }, 15000);
    listeners.add(listener);
  });
}
const fixture = createServer(async (request, response) => {
  if (request.method !== 'POST' || !request.url?.endsWith('/chat/completions')) { response.writeHead(404).end(); return; }
  let raw = ''; for await (const chunk of request) raw += chunk;
  let body; try { body = JSON.parse(raw); } catch { response.writeHead(400).end(); return; }
  report.fixtureRequests++;
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const delta = (value, finish = null) => response.write(`data: ${JSON.stringify({ id: 'chatcmpl-lam-fixture', object: 'chat.completion.chunk', created: 0, model: 'lam-fixture', choices: [{ index: 0, delta: value, finish_reason: finish }] })}\n\n`);
  delta({ role: 'assistant' });
  if (mode === 'hold') { observe({ method: 'fixture/holdStarted' }); return; }
  if (mode === 'permission' && !permissionIssued) {
    const tool = body.tools?.find(tool => /^(bash|shell)$/i.test(tool.function?.name ?? ''));
    if (tool) {
      permissionIssued = true;
      const command = process.platform === 'win32' ? 'echo fixture > denied-marker' : `printf fixture > '${join(root, 'denied-marker')}'`;
      const args = { command, description: 'Exercise temporary permission denial fixture' };
      delta({ tool_calls: [{ index: 0, id: 'call_lam_permission', type: 'function', function: { name: tool.function.name, arguments: JSON.stringify(args) } }] });
      delta({}, 'tool_calls'); response.end('data: [DONE]\n\n'); return;
    }
    report.results.permissionSetup = { status: 'unknown', reason: 'No compatible shell tool advertised', advertisedTools: body.tools?.map(tool => tool.function?.name).filter(Boolean) };
  }
  delta({ content: 'LAM ZCode fixture response' }); delta({}, 'stop'); response.end('data: [DONE]\n\n');
});
await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
try {
  report.version = execFileSync(process.execPath, [entry, '--version'], { encoding: 'utf8', env, cwd: root, timeout: 15000 }).trim();
  await copyFile(process.env.LAM_ZCODE_BUILTIN_CONFIG ?? resolve(dirname(entry), '../config/provider/zcode-builtin.json'), join(root, 'builtin.json'));
  env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE = join(root, 'builtin.json'); env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE = join(root, 'personal.json');
  const selection = { providerId: 'lam-fixture', modelId: 'lam-fixture', options: { reasoningLevel: 'disabled' } };
  await writeFile(env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE, JSON.stringify({ schemaVersion: 1, config: {
    providerConfigRules: { providerRules: [{ providerId: 'lam-fixture', providerName: 'LAM Local Fixture', config: {
      group: 'standard-personal', access: { type: 'api-key', apiKey: 'lam-local-fixture-not-a-real-key' },
      api: { type: 'openai-chat-completions', baseUrl: `http://127.0.0.1:${fixture.address().port}/v1` }, personalModelIds: ['lam-fixture'],
    } }] }, modelConfigRules: { providerModelRules: [], manualProviderModelRules: [] }, defaultModelSelection: selection,
  } }), { mode: 0o600 });
  await mkdir(join(root, '.zcode', 'cli'), { recursive: true });
  await writeFile(join(root, '.zcode', 'cli', 'config.json'), JSON.stringify({ features: { mcp: false, subagent: false, memory: false, skill: false }, plugins: { enabled: false }, hooks: { enabled: false } }));
  const connect = () => {
    const connection = rpcProcess(process.execPath, [entry, 'app-server', '--cwd', root], env, root, { jsonrpc: false, captureDiagnostics: true, onMessage: message => {
      observe(message);
      if (message.method === 'startup/storageState') report.startup.storageStates.push({ phase: message.params?.phase, elapsedMs: message.params?.elapsedMs, errorCode: message.params?.errorCode });
      if (message.method === 'interaction/requestPermission' && 'id' in message) {
        connection.reply(message.id, { decision: 'deny', reason: 'LAM fixture rejects this temporary operation.' });
        report.results.permissions = { status: 'verified', nativeRequestMethod: message.method, decision: 'deny' };
      }
      if (message.method === 'session/requestRuntimePreferences' && 'id' in message) {
        report.startup.preferenceRequests.push({ scope: message.params?.scope, idType: typeof message.id });
        connection.reply(message.id, { nativeSearchEnhancementsEnabled: false, toolSearchMode: 'off', subagentRuntimeConfigEnabled: false, memoryEnabled: false, askUserQuestionAutoResolutionEnabled: false, modelContextBudgetStrategy: 'preflight-v1' });
        report.startup.preferenceReplies++;
      }
    } });
    return connection;
  };
  rpc = connect();
  report.stage = 'runtimeCapabilities';
  await rpc.call('runtime/capabilities', {});
  report.results.runtimeCapabilities = { status: 'verified' };
  const sessionId = `sess_${randomUUID()}`;
  const workspace = { workspacePath: root, workspaceKey: root };
  report.stage = 'create';
  const createStarted = Date.now();
  try {
    await rpc.call('session/create', { sessionId, workspace, model: selection, persistence: 'immediate', mode: 'plan', titleGenerationEnabled: false, mcpServers: [] }, { timeoutMs: 60000 });
  } finally { report.startup.createElapsedMs = Date.now() - createStarted; }
  report.results.create = { status: 'verified' };
  await rpc.call('session/subscribe', { sessionId, deliveryKind: 'desktop-continuous' });
  const inputId = randomUUID();
  report.stage = 'send';
  const accepted = await rpc.call('session/send', { sessionId, inputId, modelSelection: selection, content: 'Return a fixture greeting.' });
  const completed = await waitFor(message => message.method === 'session/event' && ['turn.completed', 'turn.failed'].includes(message.params?.type) && message.params.payload?.inputId === inputId);
  report.results.send = { status: accepted.accepted && completed.params.payload.resultType === 'success' ? 'verified' : 'unknown', eventType: completed.params.type, resultType: completed.params.payload.resultType };
  if (completed.params.type === 'turn.failed') { report.results.send.error = completed.params.payload.error?.message; throw new Error('Native fixture turn failed'); }
  const text = observed.filter(message => message.method === 'session/event' && message.params?.type === 'model.streaming' && message.params.payload.kind === 'text_delta').map(message => message.params.payload.delta).join('');
  report.results.stream = { status: text === 'LAM ZCode fixture response' ? 'verified' : 'unknown', matchingFixtureText: text === 'LAM ZCode fixture response', textDeltaCount: observed.filter(message => message.method === 'session/event' && message.params?.type === 'model.streaming' && message.params.payload.kind === 'text_delta').length };
  await rpc.call('session/close', { sessionId }); await rpc.close(); rpc = connect();
  report.stage = 'resume';
  const resumed = await rpc.call('session/resume', { sessionId, workspace });
  const retainsFixtureText = JSON.stringify(resumed.messages).includes('LAM ZCode fixture response');
  report.results.resume = { status: retainsFixtureText ? 'verified' : 'unknown', afterProcessRestart: true, retainsFixtureText, messageCount: resumed.messages.length };
  await rpc.call('session/subscribe', { sessionId, deliveryKind: 'desktop-continuous' });
  mode = 'hold'; const cancelInputId = randomUUID();
  report.stage = 'cancel';
  await rpc.call('session/send', { sessionId, inputId: cancelInputId, modelSelection: selection, content: 'Wait for cancellation fixture.' });
  await waitFor(message => message.method === 'fixture/holdStarted');
  await rpc.call('session/stop', { sessionId });
  const stopped = await waitFor(message => message.method === 'session/event' && ['turn.completed', 'turn.failed'].includes(message.params?.type) && message.params.payload?.inputId === cancelInputId);
  report.results.cancel = { status: stopped.params.payload.resultType === 'cancelled' ? 'verified' : 'unknown', eventType: stopped.params.type, resultType: stopped.params.payload.resultType, inFlightFixtureRequest: true };
  mode = 'permission';
  report.stage = 'permissions';
  await rpc.call('session/setMode', { sessionId, mode: 'build' });
  const permissionInputId = randomUUID();
  await rpc.call('session/send', { sessionId, inputId: permissionInputId, modelSelection: selection, content: 'Exercise the denied fixture operation.' });
  const permissionDone = await waitFor(message => message.method === 'session/event' && ['turn.completed', 'turn.failed'].includes(message.params?.type) && message.params.payload?.inputId === permissionInputId);
  report.results.permissionTurn = { eventType: permissionDone.params.type, resultType: permissionDone.params.payload.resultType };
  try { await access(join(root, 'denied-marker')); report.results.deniedOperation = { status: report.results.permissions?.status === 'verified' ? 'failed' : 'unknown', markerCreated: true }; }
  catch { report.results.deniedOperation = { status: report.results.permissions?.status === 'verified' ? 'verified' : 'unknown', markerCreated: false }; }
  await rpc.call('session/close', { sessionId });
  report.results.permissions ??= { status: 'unknown', reason: 'Native approval was not reached' };
  report.results.attachExistingGui = { status: 'unknown', reason: 'Only this probe-owned App Server session was controlled' };
  report.stage = 'complete';
} catch (e) {
  report.error = redactProbeText(e.message, root);
  report.observedMethods = [...new Set(observed.map(message => message.method).filter(Boolean))];
  report.observedEventTypes = [...new Set(observed.filter(message => message.method === 'session/event').map(message => message.params?.type))];
  process.exitCode = 1;
} finally {
  await rpc?.close();
  report.diagnostics = rpc ? JSON.parse(redactProbeText(JSON.stringify(rpc.diagnostics()), root)) : undefined;
  report.startup.logs = await startupLogSummary(join(root, 'logs'), root).catch(() => []);
  fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve));
  await rm(root, { recursive: true, force: true });
}
console.log(JSON.stringify(report, null, 2));
