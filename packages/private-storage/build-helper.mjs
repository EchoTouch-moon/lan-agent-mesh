import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { URL, fileURLToPath } from 'node:url';
if (process.platform === 'win32') {
  const root = Object.entries(process.env).find(([key]) => key.toLowerCase() === 'systemroot')?.[1];
  if (!root || !/^[a-z]:\\/i.test(root)) throw new Error('Windows system runtime unavailable');
  execFileSync(resolve(root, 'System32/WindowsPowerShell/v1.0/powershell.exe'), [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
    fileURLToPath(new URL('./build-helper.ps1', import.meta.url)),
  ], { stdio: 'pipe', windowsHide: true, timeout: 60000, env: { ...process.env, PSModulePath: resolve(root, 'System32/WindowsPowerShell/v1.0/Modules') } });
}
