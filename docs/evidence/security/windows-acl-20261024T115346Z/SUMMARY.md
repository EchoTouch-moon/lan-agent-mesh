# Windows ACL fail-closed gate — real-host verification (issue #41)

Executed source: `235333c6afe112af096fd11a53aa0babb8c020e8` (`feat/win-acl-fail-closed`, based on `feat/p1-mesh-core`), clean committed tree. This host is the exact environment whose inherited ACLs triggered #41: zh-CN Windows 10.0.22621, user temp/profile inheriting `Everyone:Full` plus foreign ordinary-user SIDs. Full `pnpm check` passed with 44 tests. See [run-metadata.json](run-metadata.json) for hashes.

- [Gate smoke](acl-gate-smoke.json), all three behaviours verified on the real host:
  1. **Deny case** — a directory additionally granting Everyone read: the non-Mock Gateway refused to start (`unsafe_directory`, exit 1), named the offending principals, and issued **no** `identity.key`/`gateway.lock`.
  2. **Mock continuation** — the same unsafe directory with `--mock`: started on loopback with a `[security]` stderr warning, served, and shut down cleanly (exit 0); no token on stdout.
  3. **Allow case** — a user-exclusive directory (`icacls /inheritance:r`, only Administrators + current user): the non-Mock Gateway started and shut down cleanly with no warning.
- The audit reads the real security descriptor as SID-based SDDL (PowerShell `Get-Acl`), which is immune to the console-codepage and account-name-localization problems that break `icacls` text parsing on this zh-CN host; reparse points are rejected; POSIX keeps mode/symlink checks and runs them on the macOS CI legs. Design, threat model and the minimal-vs-enhanced isolation boundary are in [ADR 0003](../../../adr/0003-windows-data-directory-isolation.md).
- The operator guide never modifies host ACLs and never elevates: the unsafe inherited policy of *this* host remains unchanged and is still an environment blocker for long-lived real credentials here until the operator creates a user-exclusive placement (guide in the ADR).

CI runs the smoke on all four matrix legs (macOS/Windows × Node 22/24). This closes the G2 *minimal gate* implementation and its real-host allow/deny evidence; it does not satisfy the physical Mac↔Windows W3 hardware gate (#15 remains pending) and does not by itself authorize real Harness or long-lived MCP credentials — that decision stays with the G2 review in #41.
