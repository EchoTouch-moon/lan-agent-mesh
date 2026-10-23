# P0 implementation record

Updated 2026-10-23. Branch: `feat/p0-foundation`. Implementation commit d64ff980e0b33a271b83eb41fdb43903833a47c6 is in [draft PR #33](https://github.com/EchoTouch-moon/lan-agent-mesh/pull/33). All four hosted CI matrix jobs passed on that implementation commit. Later research commits add the ZCode native fixture and WorkBuddy static inventory; the foundation code and the distributed Windows validation baseline remain unchanged. GitHub Issues remain open and the PR is not merged.

## Delivered locally

| Task | State | Evidence |
|---|---|---|
| LAM-01 feasibility | Partial | [Version-specific matrix](HARNESS_MATRIX.md), [Codex](evidence/codex-darwin.json), [DSH](evidence/dsh-darwin.json), [desktop app inventory](evidence/desktop-apps-darwin.json), [ZCode control](evidence/zcode-darwin.json), [Codex native fixture](evidence/codex-fixture-darwin.json), [DSH native fixture](evidence/dsh-fixture-darwin.json), [ZCode native fixture](evidence/zcode-fixture-darwin.json), [WorkBuddy inventory](evidence/workbuddy-inventory-darwin.json) |
| LAM-02 workspace / CI | Local + hosted macOS/Windows checks pass | Pinned pnpm workspace, TS/lint/test/build, macOS+Windows / Node 22+24 workflow, [clean snapshot](evidence/clean-install-darwin.json), [hosted CI](evidence/ci-d64ff98.json) |
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

## Pending work and input

The user returned the Windows Harness inventory captured on 2026-10-23. [Sanitized evidence](evidence/harness-inventory-win32.json) records DSH CLI 0.1.1-rc.2, DSH desktop 0.2.1-rc.2, ZCode desktop 3.16.2 and WorkBuddy desktop 5.7.7. Codex was not found on PATH, which does not establish absence. The CLI/desktop DSH mismatch requires separate investigation; Mac ACP results cannot be transferred to either Windows installation. The original inventory remains untouched and its SHA-256 is saved in the sanitized evidence.

The full-project `%TEMP%\lam-windows-validation.log` is still pending. The user returned the [installation layout](evidence/harness-layout-win32.json); roots are redacted and the original SHA-256 is preserved. ZCode entry bytes match the Mac entry; WorkBuddy SDK bytes differ. A standalone Windows native probe pack now runs the existing ZCode localhost fixture and the DSH no-inference ACP lifecycle probe through Node JavaScript entries, avoiding .cmd spawning. It isolates Windows USERPROFILE/APPDATA/LOCALAPPDATA in temporary homes, refuses a changed ZCode entry or DSH manifest, and never launches the desktop GUIs. Its user-machine native result remains pending. Hosted Windows checks validate helper syntax and a synthetic layout fixture; they do not verify the user's native control interfaces.

LAM-01 still needs Windows native interface evidence. Mac native control feasibility for Codex/DSH/ZCode is verified with deterministic local inference; WorkBuddy direct inbound and existing-GUI attachment remain explicitly unknown. Real paid-provider account access/model quality is outside this offline interface probe, rather than a newly added requirement. ZCode framing, runtime-preference callbacks and per-send reasoning selection have been identified. Read-only documentation distinguishes outbound MCP, optional hosted Open API routes and actual direct control. Hosted WorkBuddy access is a future optional integration candidate because it requires cloud coordination.

## Boundaries

P1 network transport, durable execution/replay records and pairing, P2 real adapters/MCP ingress, and P3 authenticated human approval/UI are not implemented. Mock permissions test binding and fail-closed outcomes; humanId metadata does not authenticate a human. No native adapter or existing-GUI attachment support is advertised as verified beyond the specific probes above.
