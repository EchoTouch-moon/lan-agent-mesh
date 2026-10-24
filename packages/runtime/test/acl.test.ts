import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it, expect } from 'vitest';
import { parseSddlDacl, auditDataDirectory } from '../src/acl.js';
import { Gateway } from '../src/index.js';
const roots: string[] = [],
  gateways: Gateway[] = [];
afterEach(async () => {
  while (gateways.length) await gateways.pop()!.stop().catch(() => {});
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 5 });
});
function temp(label: string) {
  const directory = mkdtempSync(join(tmpdir(), `lam-acl ${label} `));
  roots.push(directory);
  return directory;
}
function icacls(args: string[]) {
  execFileSync('icacls', args, { windowsHide: true, stdio: 'pipe' });
}
// Captured from a real zh-CN Windows 11 host whose user temp directory inherits
// Everyone:Full plus two other ordinary-user SIDs (issue #41 evidence).
const HOST_TEMP_SDDL =
  'O:S-1-5-21-2971833369-4206531648-1616761423-1001' +
  'G:S-1-5-21-2971833369-4206531648-1616761423-513' +
  'D:AI(A;OICIID;0x1301bf;;;S-1-5-21-2971833369-4206531648-1616761423-1005)' +
  '(A;OICIID;0x1301bf;;;S-1-5-21-982422687-1343005798-1304759771-775646674)' +
  '(A;OICIID;FA;;;SY)(A;OICIID;FA;;;BA)' +
  '(A;OICIID;FA;;;S-1-5-21-2971833369-4206531648-1616761423-1001)(A;OICIID;FA;;;WD)';
const USER_EXCLUSIVE_SDDL =
  'O:S-1-5-21-2971833369-4206531648-1616761423-1001' +
  'G:S-1-5-21-2971833369-4206531648-1616761423-513' +
  'D:AI(A;OICIID;FA;;;SY)(A;OICIID;FA;;;BA)' +
  '(A;OICIID;FA;;;S-1-5-21-2971833369-4206531648-1616761423-1001)';
const USER = 'S-1-5-21-2971833369-4206531648-1616761423-1001';
describe('SDDL DACL parsing', () => {
  it('extracts the owner and all allow ACEs from a real inherited host listing', () => {
    const { owner, grants } = parseSddlDacl(HOST_TEMP_SDDL);
    expect(owner).toBe(USER);
    expect(grants).toHaveLength(6);
    expect(grants.every((g) => g.inherited && !g.deny)).toBe(true);
    expect(grants.find((g) => g.sid === 'WD')!.account).toBe('Everyone');
    expect(grants.find((g) => g.sid === 'WD')!.rights).toBe('FA');
  });
  it('parses a user-exclusive descriptor with only SYSTEM, Administrators and the owner', () => {
    const { owner, grants } = parseSddlDacl(USER_EXCLUSIVE_SDDL);
    expect(owner).toBe(USER);
    expect(grants.map((g) => g.sid)).toEqual(['SY', 'BA', USER]);
  });
  it('marks explicit deny ACEs without treating them as allow grants', () => {
    const { grants } = parseSddlDacl('O:BAD:AI(D;OICI;FA;;;WD)(A;;FA;;;SY)');
    expect(grants.find((g) => g.sid === 'WD')!.deny).toBe(true);
    expect(grants.find((g) => g.sid === 'SY')!.deny).toBe(false);
  });
});
describe('auditDataDirectory on the real host', () => {
  it.skipIf(process.platform !== 'win32')(
    'accepts a test directory restricted to the current user and rejects one granting Everyone read',
    async () => {
      const account = `${process.env.USERDOMAIN ?? ''}\\${process.env.USERNAME ?? ''}`;
      if (!account.includes('\\') || account.endsWith('\\')) throw new Error('Missing USERDOMAIN/USERNAME');
      const safe = temp('safe');
      icacls([
        safe,
        '/inheritance:r',
        '/grant',
        '*S-1-5-32-544:(OI)(CI)F',
        '/grant',
        `${account}:(OI)(CI)F`,
      ]);
      const safeAudit = await auditDataDirectory(safe);
      expect(safeAudit.safe).toBe(true);
      const unsafe = temp('unsafe');
      icacls([unsafe, '/grant', '*S-1-1-0:R']);
      const unsafeAudit = await auditDataDirectory(unsafe);
      expect(unsafeAudit.safe).toBe(false);
      expect(unsafeAudit.offenders?.some((o) => o.account === 'Everyone')).toBe(true);
    },
  );
  it.skipIf(process.platform === 'win32')(
    'accepts 0700 directories and rejects group/other access by mode',
    async () => {
      const safe = temp('safe');
      chmodSync(safe, 0o700);
      expect((await auditDataDirectory(safe)).safe).toBe(true);
      const unsafe = temp('unsafe');
      chmodSync(unsafe, 0o754);
      const audit = await auditDataDirectory(unsafe);
      expect(audit.safe).toBe(false);
      expect(audit.posixModeOctal).toBe('754');
      expect(audit.reason).toContain('754');
    },
  );
  it.skipIf(process.platform === 'win32')('rejects symlinked data directories', async () => {
    const target = temp('target'),
      link = join(tmpdir(), `lam-acl-link-${Date.now()}`);
    roots.push(link);
    symlinkSync(target, link);
    const audit = await auditDataDirectory(link);
    expect(audit.safe).toBe(false);
    expect(audit.reparseDetected).toBe(true);
  });
});
describe('fail-closed data-directory policy', () => {
  async function makeUnsafe(label: string) {
    const directory = temp(label);
    if (process.platform === 'win32') icacls([directory, '/grant', '*S-1-1-0:R']);
    else chmodSync(directory, 0o754);
    const audit = await auditDataDirectory(directory);
    expect(audit.safe).toBe(false);
    return directory;
  }
  it('refuses to start or issue credentials in a non-mock gateway on an unsafe directory', async () => {
    const directory = await makeUnsafe('enforce');
    await expect(new Gateway({ directory }).start()).rejects.toMatchObject({
      code: 'unsafe_directory',
    });
    expect(existsSync(join(directory, 'identity.key'))).toBe(false);
    expect(existsSync(join(directory, 'gateway.lock'))).toBe(false);
  });
  it('keeps mock runs working on an unsafe directory while recording the warning', async () => {
    const directory = await makeUnsafe('mock');
    const gateway = await new Gateway({ directory, mock: true }).start();
    gateways.push(gateway);
    expect(gateway.aclAudit?.safe).toBe(false);
    const diagnostics = (await gateway.command('diagnostics', {})) as {
      dataDirectoryAcl: { safe: boolean };
    };
    expect(diagnostics.dataDirectoryAcl).toMatchObject({ safe: false });
    expect(gateway.sessions.exported().length).toBeGreaterThan(0);
  });
  it('starts a non-mock gateway on a user-exclusive directory', async () => {
    const directory = temp('allowed');
    if (process.platform === 'win32') {
      const account = `${process.env.USERDOMAIN ?? ''}\\${process.env.USERNAME ?? ''}`;
      icacls([
        directory,
        '/inheritance:r',
        '/grant',
        '*S-1-5-32-544:(OI)(CI)F',
        '/grant',
        `${account}:(OI)(CI)F`,
      ]);
    } else chmodSync(directory, 0o700);
    const gateway = await new Gateway({ directory }).start();
    gateways.push(gateway);
    expect(gateway.aclAudit?.safe).toBe(true);
  });
});
