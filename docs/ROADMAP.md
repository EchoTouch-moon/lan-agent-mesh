> **Mac 候选增量（2026-10-26）**：M1真实Codex原生调用七个Mesh MCP工具、M2同机Codex接收方及生命周期均已在干净73364a1源通过。[原样证据](evidence/codex-mcp/mac-20261026T062052Z/SUMMARY.md)保留默认审批拒绝及失败记录；仅四个本机fixture工具获本聊天明确测试例外，接收方native写入仍decline。跨实体E0–E5/B1–B3及Windows主动出站未验证；M3等待Windows新runner提交，#15/#17/#18/#19保持开放。

> **最新执行状态（2026-10-26）**：PR #63 已合入 `main`（`0f2f38af`），[合并后四组 CI 均成功](https://github.com/EchoTouch-moon/lan-agent-mesh/actions/runs/40212173437)。Codex 和 DSH 的相同组合源本机 native+loopback fixture 已分别验收；实体 W3 Mock 两轮记录仍有跨 SHA/部分来源限制，真正 Harness 主动 MCP 出站和跨实体双向尚未验证。旧计划部分“PR 尚未合并”是历史快照，**以 [2026-10-26 双端下一阶段计划](NEXT_PHASE_2026-10-26.md) 为准**。#15/#17/#18/#19 保持开放；#45 仍排除。禁止由代码集成推断真实模型或审批权限放行。

# Implementation Roadmap

P0 foundation and Windows feasibility were merged through PRs #33/#37. P1 Gateway, Windows W1/W2 evidence, scoped local MCP-to-Mock tools and the Windows fail-closed private-storage implementation are now integrated into main through [PR #44](https://github.com/EchoTouch-moon/lan-agent-mesh/pull/44), which includes the complete heads of #38/#39/#40/#43. The post-merge source 05ca853 passed all four [CI jobs](https://github.com/EchoTouch-moon/lan-agent-mesh/actions/runs/40090060616). See the [integration review](INTEGRATION_REVIEW_2026-10-24.md). Windows host ACL acceptance evidence is now merged through [PR #46](https://github.com/EchoTouch-moon/lan-agent-mesh/pull/46), completing the acceptance scope of [#41](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/41). **Physical W3 and production release remain incomplete**; [#15](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/15) stays open. The [next-phase plan](NEXT_PHASE_2026-10-24.md) and [coordination #42](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/42) retain these separate gates.

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
1. G0 implementation integration is complete through #44; retain separate hardware and production acceptance gates.
2. Run physical cross-host W3 with user-confirmed pair code; leave #15 open until passed.
3. G2 Windows ACL acceptance is complete through #46; retain the verified fail-closed checks and require separate authorization for production credentials or persistent real-harness execution.
4. Build Codex + ACP/DSH adapters (#17/#18) and demonstrate both directions (#19).
5. Layer Policy/approval/UI and release gates afterward (#20-24, #27-28).

This sequence and evidence levels are governed by the [dated execution plan](NEXT_PHASE_2026-10-24.md). Time estimates remain tentative pending real-machine tests.