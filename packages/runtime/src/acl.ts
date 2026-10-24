import { execFile } from 'node:child_process';
import { lstatSync, statSync } from 'node:fs';
import { join } from 'node:path';
export interface AclPrincipalGrant {
  sid: string;
  account: string;
  rights: string;
  inherited: boolean;
  deny: boolean;
}
export interface AclAudit {
  platform: string;
  safe: boolean;
  checkedUtc: string;
  reason?: string;
  offenders?: AclPrincipalGrant[];
  reparseDetected?: boolean;
  posixModeOctal?: string;
}
export type DataDirectoryPolicy = 'enforce' | 'warn';
const SENSITIVE_FILES = ['identity.key', 'control.json'] as const;
// SYSTEM (SY / S-1-5-18) and BUILTIN\Administrators (BA / S-1-5-32-544) are
// natural administrative principals, not "other ordinary users".
const ALLOWED_SIDS = new Set(['SY', 'BA', 'S-1-5-18', 'S-1-5-32-544']);
const ACCOUNT_NAMES: Record<string, string> = {
  WD: 'Everyone',
  AU: 'Authenticated Users',
  BU: 'BUILTIN\\Users',
  SY: 'NT AUTHORITY\\SYSTEM',
  BA: 'BUILTIN\\Administrators',
  'S-1-5-18': 'NT AUTHORITY\\SYSTEM',
  'S-1-5-32-544': 'BUILTIN\\Administrators',
  'S-1-5-32-545': 'BUILTIN\\Users',
  'S-1-5-32-546': 'BUILTIN\\Guests',
};
const displayName = (sid: string) => ACCOUNT_NAMES[sid] ?? sid;
export function parseSddlDacl(sddl: string): { owner: string; grants: AclPrincipalGrant[] } {
  const owner = /^O:(.+?)G:/.exec(sddl)?.[1] ?? '';
  const grants: AclPrincipalGrant[] = [];
  const aces = /\(([AD]);([^;]*);([^;]*);([^;]*);([^;]*);([^)]*)\)/g;
  for (const ace of sddl.matchAll(aces)) {
    const sid = ace[6] ?? '';
    grants.push({
      sid,
      account: displayName(sid),
      rights: ace[3] ?? '',
      inherited: (ace[2] ?? '').includes('ID'),
      deny: ace[1] === 'D',
    });
  }
  return { owner, grants };
}
function sddlOffenders(sddl: string, userSid: string): { owner: string; offenders: AclPrincipalGrant[] } {
  const allowed = new Set([...ALLOWED_SIDS, userSid]);
  const { owner, grants } = parseSddlDacl(sddl);
  return { owner, offenders: grants.filter((g) => !g.deny && !allowed.has(g.sid)) };
}
function checkReparseAndSensitiveFiles(directory: string): AclAudit | undefined {
  const problems: string[] = [];
  let reparse = false;
  if (lstatSync(directory).isSymbolicLink()) {
    reparse = true;
    problems.push('data directory is a symlink/reparse point');
  }
  for (const name of SENSITIVE_FILES) {
    try {
      const file = lstatSync(join(directory, name));
      if (file.isSymbolicLink()) {
        reparse = true;
        problems.push(`${name} is a symlink/reparse point`);
      } else if (process.platform !== 'win32' && file.mode & 0o077)
        problems.push(`${name} mode allows group/other access`);
    } catch {
      /* Not created yet; the directory ACL governs inherit-only creation. */
    }
  }
  if (problems.length)
    return {
      platform: process.platform,
      safe: false,
      checkedUtc: new Date().toISOString(),
      reason: problems.join('; '),
      ...(reparse ? { reparseDetected: true } : {}),
    };
  return undefined;
}
const SDDL_QUERY =
  '@{ sddl = (Get-Acl -LiteralPath $env:LAM_AUDIT_DIR).Sddl; user = ' +
  '[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value } | ConvertTo-Json -Compress';
const POWERSHELL =
  process.platform === 'win32'
    ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : 'powershell.exe';
async function queryWindowsAcl(
  directory: string,
): Promise<{ sddl: string; user: string } | { queryError: string }> {
  return new Promise((resolve) => {
    execFile(
      POWERSHELL,
      ['-NoProfile', '-NonInteractive', '-Command', SDDL_QUERY],
      {
        windowsHide: true,
        timeout: 20000,
        env: { ...process.env, LAM_AUDIT_DIR: directory },
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = `${error.message} ${stderr}`.slice(0, 300);
          resolve({ queryError: detail });
          return;
        }
        try {
          const parsed = JSON.parse(stdout) as { sddl?: unknown; user?: unknown };
          if (typeof parsed.sddl === 'string' && typeof parsed.user === 'string')
            resolve({ sddl: parsed.sddl, user: parsed.user });
          else resolve({ queryError: `unexpected Get-Acl output: ${stdout.slice(0, 200)}` });
        } catch {
          resolve({ queryError: `unparsable Get-Acl output: ${stdout.slice(0, 200)}` });
        }
      },
    );
  });
}
export async function auditDataDirectory(directory: string): Promise<AclAudit> {
  let early: AclAudit | undefined;
  try {
    early = checkReparseAndSensitiveFiles(directory);
  } catch (error) {
    return {
      platform: process.platform,
      safe: false,
      checkedUtc: new Date().toISOString(),
      reason: `audit failed closed: ${(error as Error).message}`,
    };
  }
  if (early) return early;
  if (process.platform === 'win32') {
    const acl = await queryWindowsAcl(directory);
    if ('queryError' in acl)
      return {
        platform: process.platform,
        safe: false,
        checkedUtc: new Date().toISOString(),
        reason: `failed to read the directory security descriptor (PowerShell Get-Acl): ${acl.queryError}`,
      };
    const { owner, offenders } = sddlOffenders(acl.sddl, acl.user);
    const allowedOwners = new Set([...ALLOWED_SIDS, acl.user]);
    if (owner && !allowedOwners.has(owner))
      return {
        platform: process.platform,
        safe: false,
        checkedUtc: new Date().toISOString(),
        reason: `data directory is owned by ${displayName(owner)}, not the current user or an administrator`,
      };
    if (offenders.length)
      return {
        platform: process.platform,
        safe: false,
        checkedUtc: new Date().toISOString(),
        reason: `data directory grants access to principals beyond the current user, SYSTEM and Administrators: ${offenders
          .map((o) => `${o.account || 'unnamed principal'}:${o.rights}`)
          .join(' ')}`,
        offenders,
      };
    return { platform: process.platform, safe: true, checkedUtc: new Date().toISOString() };
  }
  const mode = statSync(directory).mode;
  if (mode & 0o077)
    return {
      platform: process.platform,
      safe: false,
      checkedUtc: new Date().toISOString(),
      reason: `data directory mode ${(mode & 0o777).toString(8)} allows group/other access`,
      posixModeOctal: (mode & 0o777).toString(8),
    };
  return { platform: process.platform, safe: true, checkedUtc: new Date().toISOString() };
}
