# Implementation Roadmap

P0 foundation code and its macOS/Windows hosted CI checks are implemented and passing in draft PR #33; the full version-specific Harness feasibility matrix remains partial. P1 onward remains planned. See [P0 progress](P0_PROGRESS.md).

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

## Initial development priorities
P0 = release-blocking foundation. P1 = planned alpha enhancements. P2 = future backlog. Time estimates remain tentative pending interface validation.