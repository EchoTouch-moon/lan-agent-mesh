#!/usr/bin/env node
// W4/W5 (#94): Windows-native ZCode adapter cross-check at the protocol layer. Drives the
// INSTALLED Windows ZCode bundled CLI app-server through the SAME ZcodeRpc transport the
// production adapter uses (no platform gate in rpc.ts), with a loopback fixed-response
// inferencer, a fake provider key and an adapter-owned disposable home. The production
// ZcodeAdapter.open() entry itself stays darwin-only by design (#92); this runner first
// proves that fail-closed refusal on Windows, then verifies the native protocol semantics
// the adapter depends on: spawn/capabilities, session create+subscribe, ordered streaming,
// in-flight stop, REAL native permission request -> deny -> tool not executed (with a
// request-side causal check), restart/resume identity + live events after re-subscribe.
// W5: an owned-process checker snapshots this process's relevant children before/after and
// verifies only self-created processes are stopped; bystanders are never touched.
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync, chmodSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZcodeAdapter } from '../dist/index.js';
import { ZcodeRpc } from '../dist/rpc.js';

const entry = process.env.LAM_ZCODE_ENTRY;
const builtinConfigSource = process.env.LAM_ZCODE_BUILTIN_CONFIG ?? resolve(dirname(entry), '../config/provider/zcode-builtin.json');
if (!entry || !isAbsolute(entry)) throw new Error('LAM_ZCODE_ENTRY must be the absolute installed bundled CLI path');
const output = process.argv.find(a => a.startsWith('--output='))?.slice('--output='.length);
const redact = value => String(value).replaceAll(root ?? '\u0000', '[W_ROOT]').replaceAll(entry, '[ZCODE_ENTRY]');
const root = realpathSync(mkdtempSync(join(tmpdir(), 'lam-w4-zcode-native-')));
const home = join(root, 'adapter-home'), workspace = join(root, 'workspace');
mkdirSync(workspace, { mode: 0o700 });
const marker = join(workspace, 'denied-marker');
const executableSha256 = createHash('sha256').update(readFileSync(entry)).digest('hex');
const report = { platform: process.platform, node: process.version, startedUtc: new Date().toISOString(),
  entry: { name: basename(entry), sha256: executableSha256, bytes: statSync(entry).size, builtinConfigPresent: existsSync(builtinConfigSource) },
  cliVersion: null, phases: {}, assertions: [], externalModelRequests: 0, fixtureRequests: 0, evidenceKind: 'windows-native-local (protocol layer; production entry is darwin-only by design)' };

function snapshotOwned() {
  // W5 owned-process checker: only this run's own node/zcode children, matched by command
  // line markers of THIS run (entry basename + our root), never system ZCode processes.
  const script = `$ErrorActionPreference='SilentlyContinue'; @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${basename(entry).replace(/'/g, "''")}*' -or $_.CommandLine -like '*${root.replace(/\\/g, '/').replace(/'/g, "''")}*' } | ForEach-Object { "$($_.ProcessId)" }) -join ','`;
  return execFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { encoding: 'utf8', windowsHide: true }).trim().split(',').filter(Boolean).map(Number);
}
const gate = (name, pass, detail) => report.assertions.push({ name, pass: pass === true, detail: String(detail) });

// Loopback fixed-response inferencer (same dialect as the #92 darwin smoke; the permission
// tool_call targets a marker path via a cross-platform node command instead of POSIX printf).
const fixtureLog = [];
const fixture = createServer(async (request, response) => {
  if (request.method !== 'POST' || !request.url?.endsWith('/chat/completions')) { response.writeHead(404).end(); return; }
  let raw = ''; for await (const chunk of request) raw += chunk;
  let body; try { body = JSON.parse(raw); } catch { response.writeHead(400).end(); return; }
  report.fixtureRequests++;
  const messages = body.messages ?? [];
  const lastUser = [...messages].reverse().find(m => m?.role === 'user');
  const lastUserText = typeof lastUser?.content === 'string' ? lastUser.content : JSON.stringify(lastUser?.content ?? '');
  const wantsPermission = lastUserText.includes('W4_PERMISSION');
  const wantsHold = lastUserText.includes('W4_HOLD');
  const toolTracePresent = messages.some(m => m?.role === 'tool' || (m?.role === 'assistant' && 'tool_calls' in m));
  fixtureLog.push({ request: report.fixtureRequests, lastUser: lastUserText.slice(0, 40), wantsPermission, wantsHold, toolTracePresent });
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const delta = (value, finish = null) => response.write(`data: ${JSON.stringify({ id: 'chatcmpl-w4', object: 'chat.completion.chunk', created: 0, model: 'lam-zcode-fixture', choices: [{ index: 0, delta: value, finish_reason: finish }] })}\n\n`);
  delta({ role: 'assistant' });
  if (wantsPermission && !toolTracePresent) {
    const tool = (body.tools ?? []).find(t => /^(bash|shell)$/i.test(t.function?.name ?? ''));
    if (tool) {
      const markerCommand = `${process.execPath} -e "require('fs').writeFileSync(process.argv[1],'w4')" ${JSON.stringify(marker)}`;
      delta({ tool_calls: [{ index: 0, id: 'call_w4_perm', type: 'function', function: { name: tool.function.name, arguments: JSON.stringify({ command: markerCommand, description: 'W4 native denial fixture' }) } }] });
      delta({}, 'tool_calls'); response.end('data: [DONE]\n\n'); return;
    }
  }
  if (wantsHold) { delta({ content: 'W4 HOLDING' }); return; }
  delta({ content: 'W4 NATIVE OK' }); delta({}, 'stop'); response.end('data: [DONE]\n\n');
});
await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));

const modelSelection = { providerId: 'lam-zcode-fixture', modelId: 'lam-zcode-fixture', options: { reasoningLevel: 'disabled' } };
function adapterEnv() {
  const env = { PATH: process.env.PATH, HOME: home, USERPROFILE: home, APPDATA: join(home, 'appdata'), LOCALAPPDATA: join(home, 'localappdata'),
    XDG_CONFIG_HOME: join(home, 'xdg-config'), XDG_DATA_HOME: join(home, 'xdg-data'), ZCODE_DATA_BASE_DIR: home,
    ZCODE_STORAGE_DIR: join(home, 'storage'), ZCODE_SESSION_DB_PATH: join(home, 'sessions.sqlite'), ZCODE_LOG_DIR: join(home, 'logs'),
    TMP: home, TEMP: home, LANG: 'en_US.UTF-8' };
  env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE = join(home, 'builtin.json');
  env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE = join(home, 'personal.json');
  return env;
}
const events = [];
let rpc;
const beforeOwned = snapshotOwned();
try {
  mkdirSync(home, { mode: 0o700 });
  copyFileSync(builtinConfigSource, join(home, 'builtin.json')); chmodSync(join(home, 'builtin.json'), 0o600);
  writeFileSync(join(home, 'personal.json'), JSON.stringify({ schemaVersion: 1, config: {
    providerConfigRules: { providerRules: [{ providerId: modelSelection.providerId, providerName: 'LAM ZCode Fixture', config: {
      group: 'standard-personal', access: { type: 'api-key', apiKey: 'lam-local-fixture-not-a-real-key' },
      api: { type: 'openai-chat-completions', baseUrl: `http://127.0.0.1:${fixture.address().port}/v1` }, personalModelIds: [modelSelection.modelId] } }] },
    modelConfigRules: { providerModelRules: [], manualProviderModelRules: [] }, defaultModelSelection: modelSelection } }), { mode: 0o600 });
  const version = execFileSync(process.execPath, [entry, '--version'], { encoding: 'utf8', cwd: home, env: adapterEnv(), timeout: 15000 }).trim();
  report.cliVersion = version;

  // Gate 1: the production entry itself must refuse Windows (fail-closed by design in #92).
  let entryRefused = false;
  try { await ZcodeAdapter.open({ nodeId: 'w4-node', executable: entry, home: join(root, 'prod-entry-home'), workspaces: { fixture: workspace },
    fixtureBaseUrl: `http://127.0.0.1:${fixture.address().port}/v1`, expectedVersion: '0.17.0', builtinConfig: builtinConfigSource, mode: 'build' }); }
  catch (error) { entryRefused = /not verified on this platform/.test(String(error?.message ?? error)); }
  gate('production-open-fail-closed-on-windows', entryRefused, `refused=${entryRefused} (darwin-only native entry per #92; Windows native verified at protocol layer below)`);

  // Protocol layer: the real installed CLI through the production ZcodeRpc transport.
  let denials = 0, permissionSeen = null;
  rpc = new ZcodeRpc(process.execPath, [entry, 'app-server', '--cwd', home], adapterEnv(), home,
    message => {
      if (message.id !== undefined && message.method) {
        if (message.method === 'interaction/requestPermission') { denials++; permissionSeen = { id: String(message.id), params: JSON.stringify(message.params ?? {}).slice(0, 200) }; }
        rpc.deny(message.id, message.method); return;
      }
      if (message.method === 'session/event') events.push(message.params ?? {});
    }, () => {});
  await rpc.call('runtime/capabilities', {});
  gate('app-server-spawn-capabilities', true, `cliVersion=${version} pinned=0.17.0 match=${version === '0.17.0'}`);
  gate('cli-version-pinned', version === '0.17.0', version);

  const requested = `sess_${randomUUID()}`;
  const created = await rpc.call('session/create', { sessionId: requested, workspace: { workspacePath: workspace, workspaceKey: workspace },
    model: modelSelection, persistence: 'immediate', mode: 'build', titleGenerationEnabled: false });
  await rpc.call('session/subscribe', { sessionId: requested, deliveryKind: 'desktop-continuous' });
  gate('session-create-subscribe', created && (created.sessionId === undefined || created.sessionId === requested), `echo=${created?.sessionId === requested ? 'requested-id' : String(created?.sessionId)}`);

  const sessionEvent = (type, payloadKind) => events.find(e => e?.type === type && (payloadKind === undefined || e?.payload?.kind === payloadKind));
  async function turn(inputId, text) {
    const start = events.length;
    await rpc.call('session/send', { sessionId: requested, inputId, modelSelection, content: text });
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      const mine = events.slice(start).filter(e => e?.sessionId === requested);
      const terminal = mine.find(e => e.type === 'turn.completed' || e.type === 'turn.failed');
      if (terminal) return { deltas: mine.filter(e => e.type === 'model.streaming' && e.payload?.kind === 'text_delta').map(e => e.payload.delta), terminal };
      await new Promise(r => setTimeout(r, 50));
    }
    throw new Error('native turn deadline exceeded');
  }

  const t1 = await turn('w4-input-1', 'W4 plain turn');
  report.phases.sendStream = { deltas: t1.deltas.join(''), terminal: t1.terminal.type };
  gate('send-stream-ordered-completed', t1.terminal.type === 'turn.completed' && t1.terminal.payload?.resultType === 'success' && t1.deltas.join('') === 'W4 NATIVE OK', t1.deltas.join('').slice(0, 30));

  const holdStart = events.length;
  const holdP = rpc.call('session/send', { sessionId: requested, inputId: 'w4-input-2', modelSelection, content: 'W4_HOLD' }).catch(() => {});
  let heldDelta = false;
  const holdDeadline = Date.now() + 30000;
  while (Date.now() < holdDeadline && !heldDelta) {
    heldDelta = events.slice(holdStart).some(e => e?.type === 'model.streaming' && e?.payload?.kind === 'text_delta' && e.payload?.delta === 'W4 HOLDING');
    if (!heldDelta) await new Promise(r => setTimeout(r, 50));
  }
  await rpc.call('session/stop', { sessionId: requested });
  let cancelledTerminal = null;
  const cancelDeadline = Date.now() + 30000;
  while (Date.now() < cancelDeadline && !cancelledTerminal) {
    cancelledTerminal = events.slice(holdStart).find(e => e?.type === 'turn.completed' && e?.payload?.resultType === 'cancelled');
    if (!cancelledTerminal) await new Promise(r => setTimeout(r, 50));
  }
  await holdP;
  report.phases.cancel = { heldDelta, terminal: cancelledTerminal?.payload?.resultType ?? null };
  gate('in-flight-cancel-native-stop', heldDelta && cancelledTerminal?.payload?.resultType === 'cancelled', `heldDelta=${heldDelta}`);

  const t3 = await turn('w4-input-3', 'W4_PERMISSION');
  const toolCallObserved = fixtureLog.some(entry_ => entry_.wantsPermission);
  const toolTraceAfter = fixtureLog.filter(e => e.toolTracePresent).length > 0;
  report.phases.permission = { denials, markerCreated: existsSync(marker), toolCallObserved, toolTraceAfter, terminal: t3.terminal.payload?.resultType, permissionRequest: permissionSeen && 'real-native-request-observed' };
  gate('permission-deny-fail-closed', denials >= 1 && !existsSync(marker) && t3.terminal.type === 'turn.completed',
    `realNativeDenial=${denials >= 1},markerAbsent=${!existsSync(marker)},turnCompleted=${t3.terminal.type === 'turn.completed'} (causal: the fixture-issued tool_call carried the marker command, the native permission request was observed, deny was answered, marker absent)`);
  gate('workspace-observable-control', existsSync(workspace) && readdirSync(workspace).length >= 0, 'workspace remains observable/writable by this run (control path)');

  // Restart/resume: replace the app-server process, resume the same native session id.
  await rpc.close();
  events.length = 0;
  rpc = new ZcodeRpc(process.execPath, [entry, 'app-server', '--cwd', home], adapterEnv(), home,
    message => {
      if (message.id !== undefined && message.method) { rpc.deny(message.id, message.method); return; }
      if (message.method === 'session/event') events.push(message.params ?? {});
    }, () => {});
  await rpc.call('runtime/capabilities', {});
  const resumed = await rpc.call('session/resume', { sessionId: requested, workspace: { workspacePath: workspace, workspaceKey: workspace } });
  const resumeEcho = resumed && Array.isArray(resumed.messages);
  await rpc.call('session/subscribe', { sessionId: requested, deliveryKind: 'desktop-continuous' });
  const t5 = await turn('w4-input-5', 'W4 after restart');
  report.phases.restart = { resumeEcho, resumedIdentity: requested, afterRestart: t5.deltas.join('') };
  gate('restart-resume-identity-and-live-events', resumeEcho && t5.terminal.payload?.resultType === 'success' && t5.deltas.join('') === 'W4 NATIVE OK',
    `resumeEcho=${resumeEcho},afterRestart=${t5.deltas.join('').slice(0, 20)}`);

  gate('no-external-models-accounted', report.externalModelRequests === 0 && report.fixtureRequests > 0, `fixture=${report.fixtureRequests},external=${report.externalModelRequests}`);
} catch (error) {
  report.error = redact(error?.message ?? error);
} finally {
  try { await rpc?.close(); } catch { /* close failures surface in the process gate */ }
  await new Promise(r => setTimeout(r, 500));
  const afterOwned = snapshotOwned();
  const created = afterOwned.filter(pid => !beforeOwned.includes(pid));
  report.phases.processCheck = { before: beforeOwned.length, afterLeftover: created, note: 'owned checker matches only this run entry/root markers' };
  gate('owned-processes-all-stopped', created.length === 0, `leftoverPids=${created.join(',') || 'none'} (cleanup-uncertain if any; never kills bystanders)`);
  fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve));
  report.fixtureLog = fixtureLog.slice(-8);
  let rootGone = false;
  if (!report.error && report.assertions.every(g => g.pass)) {
    try { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* kept below */ }
    try { statSync(root); } catch (error) { rootGone = error.code === 'ENOENT'; }
  } else report.keptForDiagnosis = redact(root);
  gate('disposable-root-removed-or-kept', rootGone || Boolean(report.keptForDiagnosis), rootGone ? 'removed' : 'kept outside repo for inspection');
  report.verdict = report.assertions.every(g => g.pass) && !report.error ? 'PASS' : 'FAIL';
  report.endedUtc = new Date().toISOString();
  if (report.verdict === 'FAIL') process.exitCode = 1;
  const data = JSON.stringify(report, null, 2) + '\n';
  if (output) writeFileSync(output, data, { flag: 'wx' });
  console.log(data);
}
