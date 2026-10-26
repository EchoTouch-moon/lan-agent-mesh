// G-S3 (#76) synthetic fail-closed regression for private storage. Windows-only cases skip
// explicitly on POSIX: a POSIX run never counts as Windows native verification. All fixtures
// live in test-owned temp directories; existing host ACLs are never changed.
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { privateDirectory, privateFile, PrivateStorageError, PRIVATE_STORAGE_ERROR, type PrivateLease } from '../src/index.js';

const roots: string[] = [], leases: PrivateLease[] = [];
afterEach(async () => {
  for (const lease of leases.splice(0)) await lease.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
async function privateRoot(marker = 'GLM53 校验 & 负例') {
  const path = join(tmpdir(), `LAM ${marker} ${randomUUID()}`);
  roots.push(path);
  leases.push(await privateDirectory(path, { create: true }));
  return path;
}
function widen(path: string, extra: Record<string, unknown> = {}) {
  execFileSync(join(process.env.SystemRoot!, 'System32/WindowsPowerShell/v1.0/powershell.exe'), [
    '-NoProfile', '-NonInteractive', '-File', fileURLToPath(new URL('./windows-fixture.ps1', import.meta.url)),
  ], { input: JSON.stringify({ path, ...extra }) + '\n', encoding: 'utf8', windowsHide: true });
}
async function rejectPrivate(promise: Promise<unknown>) {
  const error = await promise.then(() => { throw new Error('Expected a fail-closed rejection'); }, caught => caught as Error);
  expect(error.message).toBe(PRIVATE_STORAGE_ERROR);
  expect(error.message).not.toMatch(/[0-9a-f]{4,}/i); // No fixture paths, UUIDs or ACE details leak.
  expect(!(error instanceof PrivateStorageError) || /^[a-z_]+$/.test(error.reason)).toBe(true);
  return error;
}
async function until(check: () => boolean, ms: number, what: string) {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Fixture ${what} timed out`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
function aclHelperCount() {
  // Count only ACL helpers this test process owns; never inspect or kill other host processes.
  const script = `$children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = ${process.pid}" | Where-Object { $_.CommandLine -like '*windows-acl.ps1*' }); "count=$($children.Count)"; if ($children.Count -eq 1) { Stop-Process -Id $children[0].ProcessId -Force; 'killed' }`;
  return execFileSync(join(process.env.SystemRoot!, 'System32/WindowsPowerShell/v1.0/powershell.exe'), [
    '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64'),
  ], { encoding: 'utf8', windowsHide: true,
    env: { ...process.env, PSModulePath: join(process.env.SystemRoot!, 'System32/WindowsPowerShell/v1.0/Modules') } });
}

it.skipIf(process.platform !== 'win32')('Windows: safe temp directory positive control with spaces and Unicode, lease lifecycle enforced', async () => {
  const path = await privateRoot();
  const lease = await privateDirectory(path);
  lease.assertActive();
  await lease.close();
  expect(() => lease.assertActive()).toThrow(PRIVATE_STORAGE_ERROR);
});

it.skipIf(process.platform !== 'win32')('Windows: unsafe ancestor DACL fails closed with no partial creation and no residual lock handles', async () => {
  const root = await privateRoot();
  for (const lease of leases.splice(0)) await lease.close(); // Widen only unleased test-owned directories.
  const mid = join(root, 'mid');
  leases.push(await privateDirectory(mid, { create: true }));
  widen(root, { write: true }); // An untrusted full-control ancestor two levels above the leaf.
  await rejectPrivate(privateDirectory(join(mid, 'deep'), { create: true }));
  expect(existsSync(join(mid, 'deep'))).toBe(false);
  for (const lease of leases.splice(0)) await lease.close();
  const leaf = join(root, 'leaf'); mkdirSync(leaf); widen(leaf);
  const error = await rejectPrivate(privateDirectory(leaf));
  expect(error).toBeInstanceOf(PrivateStorageError);
  renameSync(leaf, `${leaf}-renamed`); // A failed verification retains no handle that blocks rename.
});

it.skipIf(process.platform !== 'win32')('Windows: junction path components and file links fail closed as unsafe objects', async (context) => {
  const root = await privateRoot();
  const real = join(root, 'real');
  leases.push(await privateDirectory(real, { create: true }));
  const junction = join(root, 'junction');
  symlinkSync(real, junction, 'junction');
  await rejectPrivate(privateDirectory(join(junction, 'child'), { create: true }));
  expect(existsSync(join(real, 'child'))).toBe(false); // No creation through the rejected link chain.
  const secret = join(root, 'secret.json');
  writeFileSync(secret, 'glm53-fixture-only', { mode: 0o600 });
  try { symlinkSync(secret, join(root, 'alias.json'), 'file'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') return context.skip(); // Symlink privilege unavailable.
    throw error;
  }
  await rejectPrivate(privateFile(join(root, 'alias.json'))); // A link is never accepted as a private file.
  symlinkSync(join(root, 'missing-target'), join(root, 'dangling.json'), 'file');
  await rejectPrivate(privateFile(join(root, 'dangling.json'))); // Dangling links must not pass as absent.
  const hard = join(root, 'hard.json'); linkSync(secret, hard);
  await rejectPrivate(privateFile(hard)); // Extra names for the same file object are rejected.
});

it.skipIf(process.platform !== 'win32')('Windows: unsupported namespaces, stream names and oversized file lists fail closed before any effect', async () => {
  const root = await privateRoot();
  // Trailing-dot/space components are normalized away by the .NET Framework path stack before
  // the helper's own checks run; the resulting object is a plain private directory with no
  // alias, so no fail-closed bypass exists. That normalization is recorded in the review doc.
  await rejectPrivate(privateDirectory(join(root, 'a:b')));
  expect(existsSync(join(root, 'a:b'))).toBe(false);
  await rejectPrivate(privateDirectory(join(root, 'x'.repeat(240)), { create: true }));
  await rejectPrivate(privateDirectory(root, { files: ['name:stream'] }));
  await rejectPrivate(privateDirectory(root, { files: ['sub/name.json'] }));
  await rejectPrivate(privateDirectory(root, { files: Array.from({ length: 65 }, (_, index) => `f${index}`) }));
});

it.skipIf(process.platform !== 'win32')('Windows: missing or non-drive SystemRoot helpers fail closed and recover after restore', async () => {
  const root = await privateRoot();
  try {
    vi.stubEnv('SystemRoot', join(root, 'no-system-root'));
    const missing = await rejectPrivate(privateDirectory(join(root, 'one'), { create: true }));
    expect(missing).toMatchObject({ reason: 'helper_unavailable' });
    vi.stubEnv('SystemRoot', 'relative-root');
    await rejectPrivate(privateDirectory(join(root, 'two'), { create: true }));
    expect(existsSync(join(root, 'one'))).toBe(false);
  } finally { vi.unstubAllEnvs(); }
  leases.push(await privateDirectory(join(root, 'three'), { create: true }));
});

it.skipIf(process.platform !== 'win32')('Windows: unexpected helper exit fails closed, reports loss once, and the directory stays re-verifiable', async () => {
  const path = await privateRoot();
  for (const lease of leases.splice(0)) await lease.close();
  const losses: number[] = [];
  const lease = await privateDirectory(path);
  lease.onLost(() => losses.push(Date.now()));
  let killed = false;
  for (let attempt = 0; attempt < 15 && !killed; attempt++) {
    if (aclHelperCount().includes('killed')) killed = true;
    else await new Promise(resolve => setTimeout(resolve, 300));
  }
  expect(killed).toBe(true); // Honest FAIL if this process does not own exactly one helper.
  await until(() => losses.length > 0, 10000, 'lease loss callback');
  expect(() => lease.assertActive()).toThrow(PRIVATE_STORAGE_ERROR);
  await lease.close();
  expect(losses).toHaveLength(1); // Exactly one loss notification, also across close.
  const again = await privateDirectory(path);
  leases.push(again);
  again.assertActive();
});

it.skipIf(process.platform === 'win32')('POSIX: uid, mode and link negatives on the POSIX branch (not Windows verification)', async () => {
  const base = mkdtempSync(join(tmpdir(), 'lam-glm53-posix-')); roots.push(base);
  const safe = join(base, 'safe');
  const safeLease = await privateDirectory(safe, { create: true });
  leases.push(safeLease);
  safeLease.assertActive();
  const broad = join(base, 'broad'); mkdirSync(broad, { mode: 0o700 }); chmodSync(broad, 0o755);
  await rejectPrivate(privateDirectory(broad));
  const secret = join(safe, 'secret'); writeFileSync(secret, 'glm53-fixture-only', { mode: 0o600 });
  symlinkSync(secret, join(safe, 'alias'));
  await rejectPrivate(privateFile(join(safe, 'alias')));
  const hard = join(safe, 'hard'); linkSync(secret, hard);
  await rejectPrivate(privateFile(hard));
  expect(existsSync(join(safe, 'alias'))).toBe(true); // Rejections never delete fixture state.
});
