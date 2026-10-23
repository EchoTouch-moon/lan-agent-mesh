# P0 implementation record

Updated 2026-10-23. Branch: `feat/p0-foundation`. Implementation commit d64ff980e0b33a271b83eb41fdb43903833a47c6 is in [draft PR #33](https://github.com/EchoTouch-moon/lan-agent-mesh/pull/33). All four hosted CI matrix jobs passed on that implementation commit. This record update changes documentation/evidence only. GitHub Issues remain open and the PR is not merged.

## Delivered locally

| Task | State | Evidence |
|---|---|---|
| LAM-01 feasibility | Partial | [Version-specific matrix](HARNESS_MATRIX.md), [Codex](evidence/codex-darwin.json), [DSH](evidence/dsh-darwin.json), [desktop app inventory](evidence/desktop-apps-darwin.json), [ZCode control](evidence/zcode-darwin.json), [Codex native fixture](evidence/codex-fixture-darwin.json), [DSH native fixture](evidence/dsh-fixture-darwin.json) |
| LAM-02 workspace / CI | Local + hosted macOS/Windows checks pass | Pinned pnpm workspace, TS/lint/test/build, macOS+Windows / Node 22+24 workflow, [clean snapshot](evidence/clean-install-darwin.json), [hosted CI](evidence/ci-d64ff98.json) |
| LAM-03 domain | Implemented and tested | Strict schemas, relationship validation, expiring remote cache, graph fixture, [ADR](adr/0001-p0-contracts.md) |
| LAM-04 protocol | Implemented and tested | Type-specific version 1 envelopes, errors, deadline/UTF-8/size validation |
| LAM-05 Adapter SDK | Implemented and tested | Capability gates/negotiation, async streams, cancellation and scoped native approval hook |
| LAM-06 mock | Implemented and tested | Sessions, streaming, deny/expiry/cancel/failure, busy-session checks, idempotency, UNKNOWN on disconnect |

## Verification

- `pnpm check`: build, source + test type checks, lint and all 27 tests passed on macOS / Node 22.23.2 / pinned pnpm 10.18.3.
- Fresh source snapshot without node_modules or dist, in a path with spaces: frozen install, full checks and compiled mock demo passed. Saved output in [clean-install-darwin.json](evidence/clean-install-darwin.json).
- Final probe script edits passed lint; contract test strengthening passed tests and type checks.
- No external model requests or existing GUI-session changes were made. New native Codex/DSH probes use deterministic localhost inference to exercise real send/stream, persisted-session resume, in-flight cancellation and native approval denial. Both Codex and DSH resume succeed after a process restart. ZCode now answers runtime queries and creates/closes sessions after supplying client runtime preferences; its empty closed session cannot resume. WorkBuddy's local controlled-session API remains unknown.

- [Hosted PR CI run 39967637548](https://github.com/EchoTouch-moon/lan-agent-mesh/actions/runs/39967637548): macOS and Windows on Node 22 and 24 all passed install/build/typecheck/lint/tests/demo. These hosted mock checks do not establish the user's Windows Harness capabilities.

## Pending work and input

The user confirmed ZCode and WorkBuddy are in /Applications, and can provide a Windows machine. App identification is complete. The user chose to run the local Windows validation script and return its report; the report is pending. [verify-windows.ps1](../scripts/verify-windows.ps1) is ready with a double-click CMD launcher and a Chinese guide, but has not been run on Windows here.

LAM-01 still needs real-provider/account verification distinct from fixtures, remaining version-specific ZCode/WorkBuddy control tests, and Windows verification. ZCode framing and its required runtime-preference callback have been identified. Read-only documentation distinguishes outbound MCP, optional hosted Open API routes and actual direct control. Hosted WorkBuddy access is a future optional integration candidate because it requires cloud coordination.

## Boundaries

P1 network transport, durable execution/replay records and pairing, P2 real adapters/MCP ingress, and P3 authenticated human approval/UI are not implemented. Mock permissions test binding and fail-closed outcomes; humanId metadata does not authenticate a human. No native adapter or existing-GUI attachment support is advertised as verified beyond the specific probes above.
