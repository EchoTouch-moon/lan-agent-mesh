# Implementation Roadmap

P0 foundation code was merged in PR #33. The macOS/Windows feasibility evidence is reviewed, with unsupported or untested interfaces explicitly bounded; Windows follow-up integration was merged in PR #37. See the [acceptance audit](P0_ACCEPTANCE.md) and [P0 progress](P0_PROGRESS.md). P1 Gateway implementation is available for review in [PR #38](https://github.com/EchoTouch-moon/lan-agent-mesh/pull/38), while physical Mac↔Windows W3 acceptance remains open. Windows W1/W2 evidence is in [PR #39](https://github.com/EchoTouch-moon/lan-agent-mesh/pull/39); P2 scoped local MCP ingress (Mock-only) is in [PR #40](https://github.com/EchoTouch-moon/lan-agent-mesh/pull/40). These three PRs remain open; the integration candidate also includes the fail-closed software fix from [PR #43](https://github.com/EchoTouch-moon/lan-agent-mesh/pull/43). See the [integration review](INTEGRATION_REVIEW_2026-10-24.md) for exact sources, corrections and remaining gates. Main integration is pending approval, and user-host ACL revalidation is still required. Windows user-isolated ACL is a blocker for production credentials ([#41](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/41)). See the [2026-10-24 next-phase plan](NEXT_PHASE_2026-10-24.md) and [coordination #42](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/42).

| Phase | Deliverable | Planned IDs | Exit criteria |
|---|---|---|---|
| P0 | protocol + adapter foundation | LAM-01..06 | tested schema, mock adapter, harness feasibility evidence |
| P1 | two-node P2P mesh | LAM-07..15 | encrypted pairing, reliable task lifecycle, cross-platform mock E2E |
| P2 | real harness integration | LAM-16..19 | Mac→Windows and Windows→Mac with MCP, Codex and ACP/DSH |
| P3 | governance and UI | LAM-20..24 | policy, scoped human approval, audit, failure injection |
| P4 | expansion and alpha | LAM-25..28 | ZCode feasibility, WorkBuddy guide, installers, alpha criteria |
| P5 | optional future integrations | LAM-29..30 | rooms/@mentions, external A2A bridge |

## Alpha acceptance
1. macOS and Windows gateways mutually discover, explicitly pair, and authenticate without a cloud coordinator.
2. Mac Codex delegates to a Windows agent and gets an attributable result.
3. Windows Codex delegates back to Mac Codex.
4. A Gateway-owned session can continue across messages and resume when supported.
5. An unpaired node cannot see private sessions or initiate work.
6. Denied mediated permission never becomes approved or executed; reconnect does not replay side-effecting operations.

## Current priority (2026-10-24)
1. Review P1/P2 stacked PRs without treating an implementation merge as hardware acceptance.
2. Run physical cross-host W3 with user-confirmed pair code; leave #15 open until passed.
3. Resolve Windows ACL fail-closed posture before any production credential or persistent real-harness execution (#41).
4. Build Codex + ACP/DSH adapters (#17/#18) and demonstrate both directions (#19).
5. Layer Policy/approval/UI and release gates afterward (#20-24, #27-28).

This sequence and evidence levels are governed by the [dated execution plan](NEXT_PHASE_2026-10-24.md). Time estimates remain tentative pending real-machine tests.