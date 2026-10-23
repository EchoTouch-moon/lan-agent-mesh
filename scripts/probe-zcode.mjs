import { randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { rpcProcess } from './rpc-probe.mjs';
const entry = process.env.LAM_ZCODE_ENTRY ?? '/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs';
const root = await mkdtemp(join(tmpdir(), 'lam-zcode-'));
const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('ZCODE_')));
const env = { ...inherited, HOME: root, XDG_CONFIG_HOME: root, XDG_DATA_HOME: root, ZCODE_DATA_BASE_DIR: root, ZCODE_STORAGE_DIR: join(root, 'storage'), ZCODE_SESSION_DB_PATH: join(root, 'sessions.sqlite'), ZCODE_LOG_DIR: join(root, 'logs') };
let rpc;
const report = { harness: 'zcode', platform: process.platform, modelRequests: 0, results: {} };
try {
  report.version = execFileSync(process.execPath, [entry, '--version'], { encoding: 'utf8', env, cwd: root, timeout: 15000 }).trim();
  const help = execFileSync(process.execPath, [entry, '--help'], { encoding: 'utf8', env, cwd: root, timeout: 15000 });
  report.results.help = { status: 'verified', advertisesAppServer: help.includes('app-server'), advertisesResume: help.includes('--resume') };
  const bundledConfig = process.env.LAM_ZCODE_BUILTIN_CONFIG ?? resolve(dirname(entry), '../config/provider/zcode-builtin.json');
  await copyFile(bundledConfig, join(root, 'builtin.json'));
  env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE = join(root, 'builtin.json');
  env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE = join(root, 'personal.json');
  report.results.isolatedProviderPaths = { status: 'configured', reason: 'Bundled CLI default lookup misses the app Resources/config directory; use a disposable copy of the shipped builtin config.' };
  const observedMethods = new Set();
  rpc = rpcProcess(process.execPath, [entry, 'app-server', '--cwd', root], env, root, { jsonrpc: false, onMessage: message => {
    if (message.method) { observedMethods.add(message.method); report.observedServerMethods = [...observedMethods]; }
    if (message.method === 'session/requestRuntimePreferences' && 'id' in message) {
      rpc.reply(message.id, { nativeSearchEnhancementsEnabled: false, toolSearchMode: 'off', memoryEnabled: false, askUserQuestionAutoResolutionEnabled: false, modelContextBudgetStrategy: 'preflight-v1' });
      report.results.runtimePreferences = { status: 'verified', repliedWithOptionalFeaturesDisabled: true };
    }
  } });
  report.results.runtimeCapabilities = { status: 'verified', response: await rpc.call('runtime/capabilities', {}) };
  const sessionId = `sess_${randomUUID()}`;
  try {
    const created = await rpc.call('session/create', {
      sessionId, workspace: { workspacePath: root, workspaceKey: root },
      persistence: 'immediate', mode: 'plan', titleGenerationEnabled: false, mcpServers: [],
    });
    report.results.create = { status: 'verified', responseKeys: Object.keys(created), acceptedRequestedSessionId: true };
    await rpc.call('session/close', { sessionId });
    report.results.close = { status: 'verified' };
    const resumed = await rpc.call('session/resume', { sessionId, workspace: { workspacePath: root, workspaceKey: root } });
    report.results.resume = { status: 'verified', responseKeys: Object.keys(resumed), acceptedOriginalSessionId: true };
    await rpc.call('session/close', { sessionId });
  } catch (e) {
    report.results.sessionLifecycle = { status: 'unknown', reason: e.message.replaceAll(root, '<temporary-home>').replaceAll(sessionId, '<session-id>') };
  }
} catch (e) { report.error = e.message.replaceAll(root, '<temporary-home>'); process.exitCode = 1; }
finally {
  for (const name of ['create', 'resume', 'send', 'stream', 'cancel', 'permissions', 'attachExistingGui']) report.results[name] ??= { status: 'unknown', reason: 'Not exercised by the no-inference probe' };
  await rpc?.close(); await rm(root, { recursive: true, force: true }); }
console.log(JSON.stringify(report, null, 2));
