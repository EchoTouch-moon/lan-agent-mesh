# P0 implementation record

Updated 2026-10-24. The P0 foundation was merged in [PR #33](https://github.com/EchoTouch-moon/lan-agent-mesh/pull/33), merge commit 31bde708511e1d902b5aa892c3303221250c9381 on 2026-10-23. Later Windows probes, diagnostics and GitHub handoff commits remain on feat/p0-foundation; [cumulative integration PR #37](https://github.com/EchoTouch-moon/lan-agent-mesh/pull/37) includes those commits and all four reviewed Windows runs, targeting main; it is not merged. GitHub Issues remain open.

## Delivered locally

| Task | State | Evidence |
|---|---|---|
| LAM-01 feasibility | Evidence reviewed; unknown capabilities bounded | [Version-specific matrix](HARNESS_MATRIX.md), [Codex](evidence/codex-darwin.json), [DSH](evidence/dsh-darwin.json), [desktop app inventory](evidence/desktop-apps-darwin.json), [ZCode control](evidence/zcode-darwin.json), [Codex native fixture](evidence/codex-fixture-darwin.json), [DSH native fixture](evidence/dsh-fixture-darwin.json), [ZCode native fixture](evidence/zcode-fixture-darwin.json), [WorkBuddy inventory](evidence/workbuddy-inventory-darwin.json) |
| LAM-02 workspace / CI | Mac + user Windows + hosted CI pass | Pinned pnpm workspace, TS/lint/test/build, macOS+Windows / Node 22+24 workflow, [clean snapshot](evidence/clean-install-darwin.json), [hosted CI](evidence/ci-d64ff98.json), [Windows installation check](evidence/windows/win-20261023T161616Z/engineering-w01.json) |
| LAM-03 domain | Implemented and tested | Strict schemas, relationship validation, expiring remote cache, graph fixture, [ADR](adr/0001-p0-contracts.md) |
| LAM-04 protocol | Implemented and tested | Type-specific version 1 envelopes, errors, deadline/UTF-8/size validation |
| LAM-05 Adapter SDK | Implemented and tested | Capability gates/negotiation, async streams, cancellation and scoped native approval hook |
| LAM-06 mock | Implemented and tested | Sessions, streaming, deny/expiry/cancel/failure, busy-session checks, idempotency, UNKNOWN on disconnect |

## Verification

- `pnpm check`: build, source + test type checks, lint and all 27 tests passed on macOS / Node 22.23.2 / pinned pnpm 10.18.3.
- Fresh source snapshot without node_modules or dist, in a path with spaces: frozen install, full checks and compiled mock demo passed. Saved output in [clean-install-darwin.json](evidence/clean-install-darwin.json).
- Final probe script edits passed lint; contract test strengthening passed tests and type checks.
- No external model requests or existing GUI-session changes were made. Native Codex/DSH/ZCode probes use deterministic localhost inference to exercise real send/stream, persisted-session resume, in-flight cancellation and native approval denial. All three resume persisted conversations after a process restart. ZCode text deltas use model.streaming; build-mode native permission denial prevents the requested temporary write. Its empty-session resume failure is distinct from successful persisted-turn resume. WorkBuddy's local controlled-session API remains unknown.

- [Hosted PR CI run 39967637548](https://github.com/EchoTouch-moon/lan-agent-mesh/actions/runs/39967637548): macOS and Windows on Node 22 and 24 all passed install/build/typecheck/lint/tests/demo. These hosted mock checks do not establish the user's Windows Harness capabilities.

## Windows delivery and remaining work

The user chose GitHub handoff to Windows LM. [Execution tasks](WINDOWS_AGENT_TASKS.md) are indexed by LAM-01, with engineering results also linked in LAM-02. Run [win-20261023T161616Z](evidence/windows/win-20261023T161616Z/SUMMARY.md) delivered evidence in PR #34, using source 6eadd08b10148be5f80f02b5b30712bdfb231e7e on Windows build 22621, Node 24.12.0 and pnpm 10.18.3. Install/check (27 tests), offline demo and both probe helpers passed. The previously requested user-machine engineering report is now supplied through GitHub; no manual file forwarding is pending.

ZCode desktop 3.16.3 / CLI 0.17.0 passed create (3609 ms), fixed loopback send/stream, process-restart resume, in-flight cancellation and native permission denial with no marker write. The desktop version and entry hash changed since the earlier 3.16.2 failure while the probe also changed; the old version's behavior under v2 and the cause of the earlier timeout remain unknown. No repository-side runtime fix was needed for this Windows run.

DSH CLI 0.1.1-rc.2 lacks ACP in its isolated default distribution; this is not Windows incompatibility. Desktop 0.2.1-rc.2 separately passed metadata lifecycle and fixed-response send/stream/restart-resume/in-flight-cancel/native reject_once. The [fourth-run review](evidence/windows/win-20261023T190428Z/REVIEW.md) accepts the corrected four-factor denied-write check and complete MSIX static projection. Windows Codex remains unknown: app/Codex.exe exists but is not registered as an application/alias in the inspected manifest; that does not establish its executable role. WorkBuddy inbound and existing-GUI attachment remain unknown and grant no dispatch capability. These bounded unknowns satisfy LAM-01's explicit unknown-reporting requirement; no additional Windows experiment is pending. WorkBuddy hosted OAuth remains an optional future candidate.

[Mac-side review](evidence/windows/win-20261023T161616Z/REVIEW.md) checks source/version/hash/result consistency and the evidence-only diff. A remaining installation prefix in stderr was redacted while retaining the supplied original-file hash. This review does not rerun Windows native interfaces from macOS. PR #34 and the later research commits still need integration into main; no merge or parent-issue closure was performed by this review.

## Boundaries

P1 network transport, durable execution/replay records and pairing, P2 real adapters/MCP ingress, and P3 authenticated human approval/UI are not implemented. Mock permissions test binding and fail-closed outcomes; humanId metadata does not authenticate a human. No native adapter or existing-GUI attachment support is advertised as verified beyond the specific probes above.

## Acceptance and integration

[Requirement-by-requirement audit](P0_ACCEPTANCE.md) maps LAM-01..06 to implementation, tests and evidence. PR #37 is the cumulative integration route to main and contains #34/#35/#36 by ancestry. Existing evidence PRs need no independent patch application. No P1 work or new native experiment is included.
