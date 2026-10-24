import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { lstatSync, mkdirSync, readdirSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PRIVATE_STORAGE_ERROR =
  'Private storage verification failed; choose an exclusive local directory. Existing ACLs were not changed.';
const REASONS = new Set(['verification_failed', 'unsafe_object', 'acl_unavailable', 'unsafe_owner_or_dacl', 'unsupported_ace', 'unsafe_allow_ace', 'cannot_lock_object', 'directory_create_failed', 'unsupported_path', 'invalid_file_name', 'helper_timeout', 'helper_unavailable']);
export class PrivateStorageError extends Error {
  constructor(readonly reason: string) { super(PRIVATE_STORAGE_ERROR); }
}
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
  const windowsRoot = Object.entries(process.env).find(([key]) => key.toLowerCase() === 'systemroot')?.[1];
  if (!windowsRoot || !/^[a-z]:\\/i.test(windowsRoot)) throw new PrivateStorageError('helper_unavailable');
  const child = spawn(resolve(windowsRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
    fileURLToPath(new URL('../src/windows-acl.ps1', import.meta.url)),
  ], { windowsHide: true, stdio: 'pipe', env: { ...process.env, PSModulePath: resolve(windowsRoot, 'System32/WindowsPowerShell/v1.0/Modules') } });
  let active = false, closing = false, reason = 'verification_failed';
  const lost = new Set<() => void>();
  child.stderr.resume(); // Never forward diagnostics (which may contain private paths).
  const done = waitForExit(child);
  try {
    await new Promise<void>((accept, reject) => {
      let buffer = '', phase = 'spawn', sent = false;
      const timeout = setTimeout(() => { reason = `helper_timeout_${phase}`; reject(new PrivateStorageError(reason)); }, 20000);
      const fail = () => { clearTimeout(timeout); reject(new Error(PRIVATE_STORAGE_ERROR)); };
      child.once('error', () => { reason = 'helper_unavailable'; fail(); });
      child.once('exit', fail);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        buffer += chunk;
        if (buffer.length > 1024) return fail();
        while (buffer.includes('\n')) {
          const end = buffer.indexOf('\n'), line = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          try {
            const result = JSON.parse(line);
            if (result.version !== 1) return fail();
            if (['compile', 'request', 'check'].includes(result.phase)) {
              phase = result.phase;
              if (phase === 'request' && !sent) {
                sent = true;
                child.stdin.write(JSON.stringify({ directory: path, create: options.create ?? false, files: options.files ?? [] }) + '\n');
              }
              continue;
            }
            clearTimeout(timeout);
            if (result.private !== true || !sent) {
              if (REASONS.has(result.reason)) reason = result.reason;
              return fail();
            }
            active = true;
            accept();
          } catch { return fail(); }
        }
      });
      child.stdin.on('error', () => { });
    });
  } catch {
    child.stdin.destroy(); child.kill(); await done;
    throw new PrivateStorageError(reason);
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
  return privateDirectory(dirname(full), { files: [basename(full)] });
}
