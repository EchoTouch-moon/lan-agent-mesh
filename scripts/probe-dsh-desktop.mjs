// DSH desktop (Windows) bundled-CLI ACP lifecycle probe.
// Runs the desktop's official headless CLI entry (ELECTRON_RUN_AS_NODE=1, no GUI)
// under a disposable DSH_HOME and exercises the metadata-only ACP lifecycle.
// No prompts, no inference, no profile installs, no PATH/registry changes.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { rpcProcess } from './rpc-probe.mjs';

const execFileAsync = promisify(execFile);

const launcher = process.env.LAM_DSH_DESKTOP_CMD;
if (!launcher) throw new Error('Set LAM_DSH_DESKTOP_CMD to the installed dsh.cmd launcher path.');
const root = await mkdtemp(join(tmpdir(), 'lam-dsh-desktop-'));

const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(DSH_|DEEPSEEK_|ELECTRON_)/i.test(key)));
const env = {
  ...inherited,
  HOME: root,
  ...(process.platform === 'win32' ? { USERPROFILE: root, APPDATA: join(root, 'appdata'), LOCALAPPDATA: join(root, 'localappdata') } : {}),
  XDG_CONFIG_HOME: root, XDG_DATA_HOME: root, DSH_HOME: root,
};

const report = { harness: 'dsh-desktop', platform: process.platform, launcherKind: 'bundled dsh.cmd (ELECTRON_RUN_AS_NODE headless host)', modelRequests: 0, promptsSent: 0, results: {} };

function redact(text) {
  return String(text).replaceAll(root, '<temporary-home>').replaceAll(launcher, '[DSH_DESKTOP_INSTALL_ROOT]\\resources\\runtime\\cli\\bin\\dsh.cmd');
}

let rpc;
try {
  try {
    const { stdout } = await execFileAsync('cmd.exe', ['/c', launcher, '--version'], { encoding: 'utf8', env, cwd: root, timeout: 60000, windowsHide: true });
    report.version = stdout.trim();
  } catch (error) {
    report.version = `unknown (exit ${error.code})`;
  }

  rpc = rpcProcess('cmd.exe', ['/c', launcher, '--profile', 'acp'], env, root, { captureDiagnostics: true });
  const initialized = await rpc.call('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'lam-feasibility-probe', version: '0.0.0' } }, { timeoutMs: 60000 });
  rpc.notify('initialized');
  report.results.initialize = { status: 'verified', agentInfo: { name: initialized?.agentInfo?.name, version: initialized?.agentInfo?.version }, protocolVersion: initialized?.protocolVersion };

  try {
    const created = await rpc.call('session/new', { cwd: root, mcpServers: [] }, { timeoutMs: 60000 });
    report.results.create = { status: 'verified', returnedSessionId: typeof created.sessionId === 'string' };
    await rpc.call('session/close', { sessionId: created.sessionId });
    report.results.close = { status: 'verified' };
    const listed = await rpc.call('session/list', { cwd: root });
    report.results.listInactive = { status: 'verified', listedOriginalSession: listed.sessions.some(session => session.sessionId === created.sessionId) };
    await rpc.call('session/resume', { sessionId: created.sessionId, cwd: root, mcpServers: [] });
    report.results.resume = { status: 'verified', acceptedOriginalSessionId: true };
    await rpc.call('session/close', { sessionId: created.sessionId });
  } catch (e) { report.results.sessionLifecycle = { status: 'unknown', reason: redact(e.message) }; }

  for (const name of ['send', 'stream', 'cancel', 'permissions', 'attachExistingGui']) report.results[name] = { status: 'unknown', reason: 'Not exercised: metadata-only probe (no prompts, no inference)' };
} catch (e) {
  report.error = redact(e.message);
  process.exitCode = 1;
} finally {
  await rpc?.close();
  report.diagnostics = rpc ? JSON.parse(redact(JSON.stringify(rpc.diagnostics()))) : undefined;
  await rm(root, { recursive: true, force: true });
}
console.log(JSON.stringify(report, null, 2));
