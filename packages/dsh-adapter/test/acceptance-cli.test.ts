import { execFileSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
const entry = fileURLToPath(new URL('../dist/smoke.js', import.meta.url));
function rejected(output: string) {
  expect(() => execFileSync(process.execPath, [entry, '--self-test', '--expected-source', '0'.repeat(40), '--output', output], { stdio: 'pipe' })).toThrow();
}
it('refuses an output inside the repository without creating it', () => {
  const file = join(process.cwd(), `invalid-dsh-report-${randomUUID()}.json`);
  rejected(file); expect(existsSync(file)).toBe(false);
});
it('records a source-preflight refusal outside the repository and never overwrites a prior report', () => {
  const root = mkdtempSync(join(tmpdir(), 'lam-dsh-cli-negative-'));
  try {
    const report = join(root, 'source.json'); rejected(report);
    expect(JSON.parse(readFileSync(report, 'utf8'))).toMatchObject({ status: 'blocked-or-failed', preflightStage: 'source', physicalCrossHost: 'not-run' });
    const existing = join(root, 'existing.json'); writeFileSync(existing, 'preserve-fixture'); rejected(existing);
    expect(readFileSync(existing, 'utf8')).toBe('preserve-fixture');
    expect(readFileSync(report, 'utf8')).not.toContain(process.env.HOME!);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
