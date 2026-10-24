import { mkdirSync, mkdtempSync, writeFileSync, rmSync, symlinkSync, linkSync, existsSync, chmodSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { privateDirectory, privateFile, PRIVATE_STORAGE_ERROR, type PrivateLease } from '../src/index.js';
import { Gateway } from '@lam/runtime';
const roots: string[] = [], leases: PrivateLease[] = [];
afterEach(async () => {
  for (const l of leases.splice(0)) await l.close();
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});
async function root() {
  const path = join(tmpdir(), `LAM ACL & 中文 ${randomUUID()}`);
  roots.push(path);
  const lease = await privateDirectory(path, { create: true });
  leases.push(lease);
  return path;
}
function widen(path: string, extra = {}) {
  execFileSync(resolve(process.env.SystemRoot!, 'System32/WindowsPowerShell/v1.0/powershell.exe'), [
    '-NoProfile', '-NonInteractive', '-File', fileURLToPath(new URL('./windows-fixture.ps1', import.meta.url)),
  ], { input: JSON.stringify({ path, ...extra }) + '\n', encoding: 'utf8', windowsHide: true });
}
it('creates exclusive directories, accepts a private file, rejects symlinks and hard links', async () => {
  const path = await root();
  const secret = join(path, 'secret.json');
  writeFileSync(secret, 'public-fixture-only', { mode: 0o600 });
  const lease = await privateFile(secret); lease.assertActive(); await lease.close();
  const hard = join(path, 'hard.json'); linkSync(secret, hard);
  await expect(privateFile(secret)).rejects.toThrow(PRIVATE_STORAGE_ERROR);
  rmSync(hard);
  const linked = join(path, 'linked');
  symlinkSync(path, linked, process.platform === 'win32' ? 'junction' : 'dir');
  await expect(privateDirectory(linked)).rejects.toThrow();
  // No inspection ever reads or emits the fixed fixture contents.
}, 60000);
it.skipIf(process.platform === 'win32')('denies POSIX broad permissions before creating identity, control or SQLite files', async () => {
  const path = mkdtempSync(join(tmpdir(), 'LAM insecure ')); roots.push(path);
  chmodSync(path, 0o755);
  await expect(new Gateway({ directory: path }).start()).rejects.toThrow(PRIVATE_STORAGE_ERROR);
  for (const f of ['identity.key', 'control.json', 'mesh.sqlite', 'gateway.lock']) expect(existsSync(join(path, f))).toBe(false);
});
it.skipIf(process.platform !== 'win32')('Windows: denies readable and inherit-only ACLs, unsafe ancestors, and exposed existing keys', async () => {
  const path = await root();
  for (const [name, extra] of [['readable', {}], ['inherit-only', { inheritOnly: true }], ['writable', { write: true }], ['no-inheritance', { noInheritance: true }]] as const) {
    const target = join(path, name); mkdirSync(target); widen(target, extra);
    await expect(new Gateway({ directory: target }).start()).rejects.toThrow(PRIVATE_STORAGE_ERROR);
    for (const f of ['identity.key', 'control.json', 'mesh.sqlite', 'gateway.lock']) expect(existsSync(join(target, f))).toBe(false);
  }
  const ancestor = join(path, 'ancestor'); mkdirSync(ancestor); widen(ancestor, { write: true });
  await expect(privateDirectory(join(ancestor, 'child'), { create: true })).rejects.toThrow(PRIVATE_STORAGE_ERROR);
  expect(existsSync(join(ancestor, 'child'))).toBe(false);
  const key = join(path, 'identity.key'); writeFileSync(key, 'public-fixture-only'); widen(key);
  await expect(privateDirectory(path, { files: ['identity.key'] })).rejects.toThrow(PRIVATE_STORAGE_ERROR);
}, 60000);
it.skipIf(process.platform !== 'win32')('Windows: directory lease prevents rename until released and has no unsafe fallback', async () => {
  const path = await root();
  expect(() => renameSync(path, path + '-moved')).toThrow();
  for (const l of leases.splice(0)) await l.close();
  renameSync(path, path + '-moved'); renameSync(path + '-moved', path);
  await expect(privateDirectory('\\\\server\\share')).rejects.toThrow(PRIVATE_STORAGE_ERROR);
}, 60000);
it.skipIf(process.platform !== 'win32')('Windows: unexpected ACL helper loss shuts down Gateway and blocks further commands', async () => {
  const path = await root();
  for (const l of leases.splice(0)) await l.close();
  const gateway = await new Gateway({ directory: path }).start();
  try {
    // Inspect/kill only this test process's owned ACL child, never another host process.
    const code = `$children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = ${process.pid}" | Where-Object { $_.CommandLine -like '*windows-acl.ps1*' }); if ($children.Count -ne 1) { throw 'Expected exactly one owned helper' }; Stop-Process -Id $children[0].ProcessId -Force`;
    execFileSync(resolve(process.env.SystemRoot!, 'System32/WindowsPowerShell/v1.0/powershell.exe'), [
      '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(code, 'utf16le').toString('base64'),
    ], { windowsHide: true, env: { ...process.env, PSModulePath: resolve(process.env.SystemRoot!, 'System32/WindowsPowerShell/v1.0/Modules') } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(gateway.command('status', {})).rejects.toThrow(PRIVATE_STORAGE_ERROR);
    await gateway.stop();
    await expect(fetch(gateway.url + '/health')).rejects.toThrow();
    expect(existsSync(join(path, 'gateway.lock'))).toBe(false);
  } finally { await gateway.stop(); }
}, 60000);
