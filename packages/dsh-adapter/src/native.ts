import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { MeshError } from '@lam/adapter-sdk';
import { DshAdapterCore } from './core.js';
import { DshAcpClient } from './client.js';
import { windowsCmdLauncher } from './windows-command.mjs';
import { terminateOwnedChild } from './process-tree.js';

export interface FixturePowerShell { executable: string; sha256: string }
export function verifyFixturePowerShell(shell: FixturePowerShell): void {
  try {
    if (!isAbsolute(shell.executable) || shell.executable.includes(';') || basename(shell.executable).toLowerCase() !== 'pwsh.exe' ||
        realpathSync(shell.executable) !== resolve(shell.executable) || !/^[a-f0-9]{64}$/.test(shell.sha256)) throw new Error();
    const stat = lstatSync(shell.executable);
    if (!stat.isFile() || stat.size === 0 || stat.size > 32 * 1024 * 1024 ||
        createHash('sha256').update(readFileSync(shell.executable)).digest('hex') !== shell.sha256) throw new Error();
  } catch { throw new MeshError('unsupported', 'Explicit canonical PowerShell executable and matching SHA-256 required'); }
}
export interface DshAdapterOptions {
  nodeId: string; home: string; workspaces: Record<string, string>;
  /** Explicit desktop's resources/runtime/cli/bin/dsh.cmd; never discover or import user settings. */
  launcher: string;
  launcherSha256: string;
  expectedVersion: '0.2.1-rc.2';
  /** Operator-selected existing PowerShell 7; never inherit the user's full PATH. */
  powerShell: FixturePowerShell;
  /** Only fixed-response loopback fixtures are enabled in this implementation. */
  fixtureBaseUrl: string;
}
export function fixtureEnvironment(home: string, baseUrl: string, powerShell?: FixturePowerShell): NodeJS.ProcessEnv {
  const windowsRoot = process.env.SystemRoot;
  return { SystemRoot: windowsRoot, WINDIR: windowsRoot, ComSpec: windowsRoot && join(windowsRoot, 'System32', 'cmd.exe'),
    PATH: windowsRoot && [join(windowsRoot, 'System32'), join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0'),
      ...(powerShell ? [dirname(powerShell.executable)] : [])].join(';'),
    HOME: home, USERPROFILE: home, APPDATA: join(home, 'appdata'), LOCALAPPDATA: join(home, 'localappdata'),
    XDG_CONFIG_HOME: join(home, 'xdg-config'), XDG_DATA_HOME: join(home, 'xdg-data'), DSH_HOME: home,
    TEMP: home, TMP: home, DEEPSEEK_BASE_URL: baseUrl, DEEPSEEK_API_KEY: 'lam-local-fixture-not-a-real-key', DSH_PERMISSION_MODE: 'read-only' };
}
async function version(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<string> {
  const child = spawn(command, args, { cwd, env, windowsHide: true, windowsVerbatimArguments: true, stdio: 'pipe' });
  let observed = false, output = '', invalid = false;
  const exited = new Promise<void>(resolve => child.once('close', () => { observed = true; resolve(); }));
  child.stderr.resume(); child.stdin.on('error', () => {});
  let termination: Promise<void> | undefined;
  const terminate = () => termination ??= terminateOwnedChild(child, exited, () => observed, true);
  try {
    await new Promise<void>((accept, reject) => {
      const timeout = setTimeout(() => { void terminate().catch(() => {}); reject(new Error()); }, 60000);
      child.once('error', () => { clearTimeout(timeout); reject(new Error()); });
      child.stdout.on('data', (chunk: Buffer) => {
        if (invalid) return;
        if (Buffer.byteLength(output) + chunk.length > 4096) { invalid = true; void terminate().catch(() => {}); clearTimeout(timeout); reject(new Error()); }
        else output += chunk.toString('utf8');
      });
      child.once('close', code => { clearTimeout(timeout); if (code === 0 && !invalid) accept(); else reject(new Error()); });
    });
    return output.trim();
  } finally { await terminate(); }
}

/** Windows desktop + private fixture only. Not a production model or GUI attachment entry point. */
export async function openDshAdapter(options: DshAdapterOptions): Promise<DshAdapterCore> {
  if (process.platform !== 'win32') throw new MeshError('unsupported', 'Native DSH desktop adapter is Windows-only');
  let base: URL;
  try { base = new URL(options.fixtureBaseUrl); } catch { throw new MeshError('permission_denied', 'Explicit loopback fixture required'); }
  if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || !base.port || base.pathname !== '/' || base.username || base.password || base.search || base.hash)
    throw new MeshError('permission_denied', 'Only explicit HTTP loopback fixture roots are enabled');
  if (options.expectedVersion !== '0.2.1-rc.2' || !/^[a-f0-9]{64}$/.test(options.launcherSha256)) throw new MeshError('unsupported', 'Pinned DSH desktop version and launcher hash required');
  const root = process.env.SystemRoot;
  if (!root || !isAbsolute(root)) throw new MeshError('unsupported', 'Windows system launcher unavailable');
  verifyFixturePowerShell(options.powerShell);
  let phase = 'launcher-file';
  try {
    if (!isAbsolute(options.launcher) || realpathSync(options.launcher) !== resolve(options.launcher) || !lstatSync(options.launcher).isFile() || lstatSync(options.launcher).size > 65536)
      throw new Error();
    const hash = () => createHash('sha256').update(readFileSync(options.launcher)).digest('hex');
    if (hash() !== options.launcherSha256) throw new Error();
    const acp = windowsCmdLauncher(options.launcher, ['--profile', 'acp']);
    const check = windowsCmdLauncher(options.launcher, ['--version']);
    const command = join(root, 'System32', 'cmd.exe');
    return await DshAdapterCore.open({ nodeId: options.nodeId, home: options.home, workspaces: options.workspaces,
      registration: JSON.stringify(['dsh-desktop', options.expectedVersion, options.launcher, options.launcherSha256, base.href,
        options.powerShell.executable, options.powerShell.sha256]) }, async context => {
      const env = fixtureEnvironment(context.nativeHome, base.href, options.powerShell);
      try {
        phase = 'powershell-file';
        verifyFixturePowerShell(options.powerShell);
        phase = 'powershell-version-process';
        const shellVersion = await version(options.powerShell.executable,
          ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()'], context.nativeHome, env);
        phase = 'powershell-version-format';
        if (!/^7\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(shellVersion)) throw new Error();
        verifyFixturePowerShell(options.powerShell);
        phase = 'launcher-version';
        if (await version(command, check.args, context.nativeHome, env) !== options.expectedVersion || hash() !== options.launcherSha256) throw new Error();
      } catch { context.onLost('process'); throw new Error('Version check refused'); }
      phase = 'acp-startup';
      return DshAcpClient.open({ command, args: acp.args, cwd: context.nativeHome, env, windowsVerbatimArguments: true,
        timeoutMs: 60000, onText: context.onText, onLost: context.onLost });
    });
  } catch { throw new MeshError('internal', `Native DSH initialization refused at ${phase}; inspect pinned programs, versions and private home`); }
}
