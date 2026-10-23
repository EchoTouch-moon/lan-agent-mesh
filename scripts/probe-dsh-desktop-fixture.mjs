// DSH desktop (Windows) bundled-CLI ACP prompt-level probe with a loopback fixture.
// Same isolation and redaction contract as probe-dsh-desktop.mjs; the model endpoint
// is a local deterministic SSE fixture (no external model), following probe-dsh-fixture.mjs.
// No GUI launch, no PATH/registry changes, no profile installs.
import { createServer } from 'node:http';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { rpcProcess } from './rpc-probe.mjs';
import { redactProbeText } from './probe-diagnostics.mjs';
import { windowsCmdLauncher } from './windows-cmd-launcher.mjs';

const execFileAsync = promisify(execFile);

const launcher = process.env.LAM_DSH_DESKTOP_CMD;
if (process.platform !== 'win32') throw new Error('Run this probe on Windows.');
if (!launcher) throw new Error('Set LAM_DSH_DESKTOP_CMD to the installed dsh.cmd launcher path.');
const versionCommand = windowsCmdLauncher(launcher, ['--version']);
const acpCommand = windowsCmdLauncher(launcher, ['--profile', 'acp']);
const root = await mkdtemp(join(tmpdir(), 'lam-dsh-desktop-fx-'));

const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(DSH_|DEEPSEEK_|ELECTRON_)/i.test(key)));
const report = { harness: 'dsh-desktop', platform: process.platform, launcherKind: 'bundled dsh.cmd (ELECTRON_RUN_AS_NODE headless host)', inference: 'localhost deterministic fixture; no external model', externalModelRequests: 0, fixtureRequests: 0, promptsSent: 0, results: {} };
let mode = 'text'; let rpc; let notifyHeld; let permissionStage = 0;
const notifications = [];

const fixture = createServer(async (request, response) => {
  let raw = ''; for await (const chunk of request) raw += chunk;
  let body; try { body = JSON.parse(raw); } catch { body = null; }
  report.requestLog ??= [];
  if (report.requestLog.length < 10) report.requestLog.push({ method: request.method, url: request.url, bodyKeys: body ? Object.keys(body) : null, stream: body?.stream ?? null, model: body?.model ?? null, tools: body?.tools?.map(tool => tool.function?.name ?? tool.name) ?? null });
  const isMessages = request.method === 'POST' && /\/(beta\/)?messages$/.test(request.url ?? '');
  if (!isMessages) { response.writeHead(404).end(); return; }
  report.fixtureRequests++;
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const event = (name, data) => response.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
  const startMessage = { id: 'msg_lam_fixture', type: 'message', role: 'assistant', model: body?.model ?? 'deepseek-v4-flash', content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } };
  event('message_start', { type: 'message_start', message: startMessage });
  if (mode === 'hold') {
    event('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
    notifyHeld?.(); return;
  }
  if (mode === 'permission' && permissionStage < 2) {
    const tool = body.tools?.find(tool => tool.name === 'pwsh' || tool.function?.name === 'pwsh');
    const priorDenial = body.messages?.some(message => message.role === 'user' && JSON.stringify(message.content).includes('sandbox: file access denied'));
    if (tool && (permissionStage === 0 || priorDenial)) {
      const args = { command: `printf fixture > '${join(root, 'denied-marker')}'`, description: 'Exercise temporary permission denial fixture', ...(permissionStage === 1 ? { sandbox_permissions: 'workspace-write', justification: 'Verify that the native ACP client can reject this temporary fixture operation.' } : {}) };
      permissionStage++;
      event('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: `toolu_lam_${permissionStage}`, name: 'pwsh', input: {} } });
      event('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(args) } });
      event('content_block_stop', { type: 'content_block_stop', index: 0 });
      event('message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { input_tokens: 1, output_tokens: 1 } });
      event('message_stop', { type: 'message_stop' }); response.end(); return;
    }
    report.results.permissionSetup = { pwshAdvertised: Boolean(tool), initialSandboxDenialObserved: Boolean(priorDenial) };
  }
  event('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
  event('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'LAM DSH fixture response' } });
  event('content_block_stop', { type: 'content_block_stop', index: 0 });
  event('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 1, output_tokens: 1 } });
  event('message_stop', { type: 'message_stop' }); response.end();
});
await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));

function redact(text) {
  const installRoot = win32.resolve(win32.dirname(launcher), '../../../..');
  let value = String(text);
  const aliases = [pathToFileURL(installRoot).href, 'file:///' + installRoot.replaceAll('\\', '/'), installRoot, installRoot.replaceAll('\\', '/')];
  for (const path of aliases) value = value.replaceAll(JSON.stringify(path).slice(1, -1), '[DSH_DESKTOP_INSTALL_ROOT]').replaceAll(path, '[DSH_DESKTOP_INSTALL_ROOT]');
  return redactProbeText(value, root);
}

const env = {
  ...inherited,
  HOME: root,
  USERPROFILE: root, APPDATA: join(root, 'appdata'), LOCALAPPDATA: join(root, 'localappdata'),
  XDG_CONFIG_HOME: root, XDG_DATA_HOME: root, DSH_HOME: root,
  DEEPSEEK_API_KEY: 'lam-local-fixture-not-a-real-key',
  DEEPSEEK_BASE_URL: `http://127.0.0.1:${fixture.address().port}`,
  DSH_PERMISSION_MODE: 'read-only',
};

try {
  try {
    const { stdout } = await execFileAsync(versionCommand.command, versionCommand.args, { encoding: 'utf8', env, cwd: root, timeout: 60000, windowsHide: true, windowsVerbatimArguments: true });
    report.version = stdout.trim();
  } catch (error) {
    report.version = `unknown (exit ${error.code})`;
  }

  const connect = async () => {
    const connection = rpcProcess(acpCommand.command, acpCommand.args, env, root, { captureDiagnostics: true, windowsVerbatimArguments: true, killTree: true, onMessage: message => {
      if (message.method) notifications.push(message);
      if (message.method === 'session/request_permission' && 'id' in message) {
        const reject = message.params.options.find(option => option.kind === 'reject_once') ?? message.params.options.find(option => option.kind === 'reject_always');
        connection.reply(message.id, { outcome: reject ? { outcome: 'selected', optionId: reject.optionId } : { outcome: 'cancelled' } });
        report.results.permissions = { status: 'verified', nativeRequestMethod: message.method, decision: reject?.kind ?? 'cancelled' };
      }
    } });
    const initialized = await connection.call('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'lam-local-fixture', version: '0.0.0' } }, { timeoutMs: 60000 });
    if (initialized?.protocolVersion !== 1 || typeof initialized?.agentInfo?.name !== 'string') throw new Error('Invalid ACP initialize response');
    connection.notify('initialized');
    return connection;
  };

  rpc = await connect();
  const created = await rpc.call('session/new', { cwd: root, mcpServers: [] }, { timeoutMs: 60000 });
  if (typeof created?.sessionId !== 'string' || !created.sessionId) throw new Error('session/new did not return a usable sessionId');
  report.results.create = { status: 'verified', returnedSessionId: true };
  const sessionId = created.sessionId;

  report.promptsSent++;
  const prompt = await rpc.call('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'Return a fixture greeting.' }] }, { timeoutMs: 120000 });
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
  const held = new Promise((resolve, reject) => { notifyHeld = resolve; holdTimer = setTimeout(() => reject(new Error('Fixture request not started')), 15000); });
  held.catch(() => {});
  report.promptsSent++;
  const pendingPrompt = rpc.call('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'Wait for cancellation fixture.' }] }, { timeoutMs: 120000 });
  pendingPrompt.catch(() => {});
  try { await held; } finally { clearTimeout(holdTimer); }
  rpc.notify('session/cancel', { sessionId });
  const cancelled = await pendingPrompt;
  report.results.cancel = { status: cancelled.stopReason === 'cancelled' ? 'verified' : 'unknown', stopReason: cancelled.stopReason, inFlightFixtureRequest: true };

  mode = 'permission';
  report.promptsSent++;
  const permissionDone = await rpc.call('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'Exercise the denied fixture operation.' }] }, { timeoutMs: 120000 });
  report.results.permissionTurn = { stopReason: permissionDone.stopReason };
  try { await access(join(root, 'denied-marker')); report.results.deniedOperation = { status: 'failed', markerCreated: true }; }
  catch { report.results.deniedOperation = { status: 'verified', markerCreated: false }; }
  await rpc.call('session/close', { sessionId });
  report.results.permissions ??= { status: 'unknown', reason: 'Native approval was not reached; see permissionSetup' };
  report.results.attachExistingGui = { status: 'unknown', reason: 'Only this probe-owned ACP session was controlled' };
} catch (e) {
  report.error = redact(e.message);
  report.observedMethods = [...new Set(notifications.map(message => message.method))]; process.exitCode = 1;
} finally {
  await rpc?.close();
  for (const name of ['create', 'resume', 'send', 'stream', 'cancel', 'permissions', 'attachExistingGui']) report.results[name] ??= { status: 'unknown', reason: 'Not reached by this probe' };
  report.diagnostics = rpc ? JSON.parse(redact(JSON.stringify(rpc.diagnostics()))) : undefined;
  fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve));
  await rm(root, { recursive: true, force: true });
}
console.log(JSON.stringify(report, null, 2));
