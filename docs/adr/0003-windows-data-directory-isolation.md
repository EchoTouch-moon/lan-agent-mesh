# ADR 0003 — Windows data-directory confidentiality gate

Issue #41. The P1 Windows evidence (PR #39, `w2-isolation-acl.json`) proved that
the Gateway keeps every file inside the chosen data directory, but on real hosts
the *inherited* DACL of common placements (user temp, data-drive user
directories, even the user profile) grants other ordinary local users at least
read access — including `Everyone:Full` from host policy. POSIX `chmod 0o700`
calls have no effect on Windows ACLs, so a mode-based check cannot close this
gap. This ADR defines the auditable effective-ACL check and the fail-closed
policy that keep real credentials (`identity.key`, `control.json`, future MCP
grants) out of directories other ordinary users can read.

## Threat model

In scope: confidentiality and integrity of the data directory against **other
ordinary local user accounts** — inherited or explicit allow ACEs for Everyone
(`WD`/S-1-1-0), Authenticated Users, BUILTIN\Users/Guests, other users' SIDs or
unknown groups; reparse points (symlinks/junctions) redirecting the directory or
its sensitive files; ownership by a different ordinary user (the owner can
rewrite the DACL).

Out of scope as attackers (natural system privilege, per issue #41):
`NT AUTHORITY\SYSTEM` (`SY`/S-1-5-18) and `BUILTIN\Administrators`
(`BA`/S-1-5-32-544), which remain allow-listed. Other processes running **as the
same user** are not separated by any filesystem ACL; that boundary belongs to
future work (enhanced isolation below).

## Effective ACL audit (what is checked)

On Windows the audit reads the directory's real security descriptor as SDDL
with SID values through `powershell.exe` using **pure .NET calls**
(`[System.IO.DirectoryInfo]::GetAccessControl('Access, Owner').Sddl`) — cmdlets
such as `Get-Acl`/`ConvertTo-Json` live in optional PowerShell modules that
fail to load when the inherited `PSModulePath` targets PowerShell 7 (observed
on GitHub windows runners), while casts and method calls are language
built-ins that always work. The path travels in an environment variable — no
quoting surface, ASCII-only output. Name-based `icacls` parsing was implemented
first and rejected: `icacls` emits GBK bytes that Node decodes as mojibake, and
well-known names are localized on some hosts. SIDs are unambiguous.

The audit fails the directory when: it or an existing `identity.key` /
`control.json` is a reparse point; the owner is not the current user, SYSTEM or
Administrators; or any non-deny allow ACE names a principal outside
{current user SID, SYSTEM, Administrators}. Deny ACEs are not credited — the
operator must remove broad allows rather than try to mask them. Any query or
parse failure fails closed. On POSIX the audit keeps native mode semantics
(directory `0700`, sensitive files `0600`) and rejects symlinks — a regression
check, not a new gate.

Audit results carry account display names and rights only — never key/token
material, never absolute user paths — and are surfaced through the
`diagnostics` command as `dataDirectoryAcl`.

## Fail-closed policy

`Gateway.start()` runs the audit before creating the lock, the SQLite store or
the identity key. When the audit fails:

- **Non-mock start (production credentials): refused** with
  `MeshError('unsafe_directory')` and a reason naming the offending principals;
  nothing is issued, no listener starts. The CLI exits non-zero with a clean
  one-line JSON diagnostic. There is deliberately **no override flag** — a host
  whose policy makes a user-exclusive directory unreachable is an environment
  blocker to report, not a check to weaken.
- **Mock or explicitly warn-policy in-process runs: allowed with a stderr
  warning** and the audit recorded. This keeps G2-compliant isolated Mock
  experiments and the existing conflict/unit tests working on hosts with
  permissive temp directories, without exposing real long-lived credentials.

## Operator guide (creating a user-exclusive directory)

The Gateway never modifies host ACLs and never elevates. On Windows, create and
hand it a directory that only your account (plus SYSTEM/Administrators) can
reach, e.g. from a regular shell with the directory created by your user under
a non-inherited parent:

```powershell
mkdir $env:LOCALAPPDATA\lam-gateway
icacls $env:LOCALAPPDATA\lam-gateway /inheritance:r /grant "${env:USERDOMAIN}\${env:USERNAME}:(OI)(CI)F" /grant "*S-1-5-32-544:(OI)(CI)F"
node apps/gateway/dist/index.js serve --data $env:LOCALAPPDATA\lam-gateway
```

`/inheritance:r` removes inherited ACEs on **that new directory only**; verify
with `auditDataDirectory` (or just start the Gateway — it refuses unsafe
directories). On macOS/Linux ensure the parent chain is not group/other
readable (`chmod 700`). If every reachable placement on the host still grants
other ordinary users access, record the host as blocked for production
credentials and keep using `--mock`.

## Minimal vs enhanced isolation (honest boundary)

Implemented now (minimal viable): startup audit of the directory's effective
DACL + owner + reparse points of the directory and existing sensitive files;
fail-closed issuance for real credentials; SIDs over names; POSIX mode
regression.

Not yet implemented (enhanced, tracked for review): per-file SDDL audits of
files as they are created; re-verification of the ACL immediately before each
credential read; handle-based opens to narrow the TOCTOU window between audit
and use (a local same-user or racing administrator can swap the directory after
the audit — same-user attackers are out of scope, but the window is real);
separating same-user processes. Until those land, the residual risk is a
swap-between-audit-and-read race on hosts where other ordinary users can write
the *parent* of the data directory — place the directory in a parent they
cannot write.

## Verification

`packages/runtime/test/acl.test.ts`: SDDL parsing against a captured real zh-CN
host descriptor (Everyone:Full plus foreign user SIDs), deny-ACE handling,
real-host allow/deny integration (`icacls`-prepared directories), the three
policy behaviours (refuse non-mock + no `identity.key`/lock issued; mock
continues with recorded warning; non-mock starts on a user-exclusive
directory), POSIX mode and symlink cases. `scripts/win-acl-gate-smoke.mjs`
drives the committed CLI end-to-end on a real Windows host for evidence.
