import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { fixtureEnvironment, verifyFixturePowerShell } from '../src/native.js';

const roots: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function shell() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'LAM verified shell & 中文 '))); roots.push(root);
  const executable = join(root, 'pwsh.exe'), content = 'synthetic bytes; never executed';
  writeFileSync(executable, content);
  return { executable, sha256: createHash('sha256').update(content).digest('hex') };
}
it('accepts explicit canonical matching program bytes without discovering or executing them', () => {
  expect(() => verifyFixturePowerShell(shell())).not.toThrow();
});
it('rejects changed program bytes before launch', () => {
  const selected = shell(); writeFileSync(selected.executable, 'changed');
  expect(() => verifyFixturePowerShell(selected)).toThrow();
});
it('rejects a directory, missing program and relative paths', () => {
  const selected = shell(); rmSync(selected.executable); mkdirSync(selected.executable);
  expect(() => verifyFixturePowerShell(selected)).toThrow();
  rmSync(selected.executable, { recursive: true });
  expect(() => verifyFixturePowerShell(selected)).toThrow();
  expect(() => verifyFixturePowerShell({ ...selected, executable: 'pwsh.exe' })).toThrow();
});
it('rejects unpinned hashes and a PATH separator in the program path', () => {
  const selected = shell();
  expect(() => verifyFixturePowerShell({ ...selected, sha256: '' })).toThrow();
  expect(() => verifyFixturePowerShell({ ...selected, executable: join(dirname(selected.executable), 'unsafe;entry', 'pwsh.exe') })).toThrow();
});
it('adds only the selected directory after system tools and never inherits caller PATH or secrets', () => {
  const selected = shell();
  vi.stubEnv('SystemRoot', join(dirname(selected.executable), 'Windows'));
  vi.stubEnv('PATH', 'unexpected-user-directory'); vi.stubEnv('OPENAI_API_KEY', 'secret-canary');
  const env = fixtureEnvironment(dirname(selected.executable), 'http://127.0.0.1:1/', selected);
  expect(env.PATH?.split(';')).toEqual([join(process.env.SystemRoot!, 'System32'), join(process.env.SystemRoot!, 'System32', 'WindowsPowerShell', 'v1.0'), dirname(selected.executable)]);
  expect(env.PATH).not.toContain('unexpected-user-directory'); expect(env.OPENAI_API_KEY).toBeUndefined();
});
