import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { lstatSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PRIVATE_STORAGE_ERROR =
  'Private storage verification failed; choose an exclusive local directory. Existing ACLs were not changed.';
export interface PrivateLease {
  /** Fails once a Windows namespace lock is lost. Never log paths or credentials. */
  assertActive(): void;
  onLost(callback: () => void): void;
  close(): Promise<void>;
}
export async function privateDirectory(
  directory: string,
  options: { create?: boolean; files?: string[] } = {},
): Promise<PrivateLease> {
  const path = resolve(directory);
  if (process.platform !== 'win32') {
    if (options.create) mkdirSync(path, { recursive: true, mode: 0o700 });
    const check = (target: string, file: boolean) => {
      const st = lstatSync(target);
      if (
        (file ? !st.isFile() || st.nlink !== 1 : !st.isDirectory()) ||
        st.uid !== process.getuid?.() || (st.mode & 0o077) !== 0
      ) throw new Error(PRIVATE_STORAGE_ERROR);
    };
    check(path, false);
    const entries = new Set(readdirSync(path));
    for (const file of options.files ?? []) {
      if (file !== file.split(/[\\/]/).pop() || file === '.' || file === '..')
        throw new Error(PRIVATE_STORAGE_ERROR);
      if (entries.has(file)) check(resolve(path, file), true);
    }
    return { assertActive() { }, onLost() { }, async close() { } };
  }
  // Use the OS Windows PowerShell, never PATH, an interactive profile or shell quoting.
  const windowsRoot = process.env.SystemRoot;
  if (!windowsRoot || !/^[a-z]:\\/i.test(windowsRoot)) throw new Error(PRIVATE_STORAGE_ERROR);
  const child = spawn(resolve(windowsRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
    fileURLToPath(new URL('../src/windows-acl.ps1', import.meta.url)),
  ], { windowsHide: true, stdio: 'pipe' });
  let active = false, closing = false;
  const lost = new Set<() => void>();
  child.stderr.resume(); // Never forward diagnostics (which may contain private paths).
  const done = waitForExit(child);
  try {
    await new Promise<void>((accept, reject) => {
      let buffer = '';
      const timeout = setTimeout(() => reject(new Error(PRIVATE_STORAGE_ERROR)), 20000);
      const fail = () => { clearTimeout(timeout); reject(new Error(PRIVATE_STORAGE_ERROR)); };
      child.once('error', fail);
      child.once('exit', fail);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        buffer += chunk;
        if (buffer.length > 1024) return fail();
        if (!buffer.includes('\n')) return;
        clearTimeout(timeout);
        try {
          const result = JSON.parse(buffer.trim());
          if (result.version !== 1 || result.private !== true) return fail();
          active = true;
          accept();
        } catch { fail(); }
      });
      child.stdin.on('error', () => { });
      child.stdin.write(JSON.stringify({ directory: path, create: options.create ?? false, files: options.files ?? [] }) + '\n');
    });
  } catch {
    child.stdin.destroy(); child.kill(); await done;
    throw new Error(PRIVATE_STORAGE_ERROR);
  }
  child.stdout.removeAllListeners('data');
  child.stdout.resume();
  void done.then(() => {
    active = false;
    if (!closing) for (const callback of lost) callback();
  });
  return {
    assertActive() { if (!active) throw new Error(PRIVATE_STORAGE_ERROR); },
    onLost(callback) { lost.add(callback); if (!active && !closing) callback(); },
    async close() {
      closing = true; active = false; child.stdin.end('\n');
      const timer = setTimeout(() => child.kill(), 2000);
      await done; clearTimeout(timer);
    },
  };
}
function waitForExit(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve) => {
    child.once('exit', () => resolve());
    child.once('error', () => resolve());
  });
}
export async function privateFile(path: string): Promise<PrivateLease> {
  const full = resolve(path);
  return privateDirectory(dirname(full), { files: [full.slice(dirname(full).length + 1)] });
}
