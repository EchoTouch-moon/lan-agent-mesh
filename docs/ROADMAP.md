> **新增本机互操作工作线（LHI，2026-10-26）**：同机不同 Harness（优先 Codex↔ZCode）复用 LAM 的 Agent/Session/Task/UNKNOWN 语义。先研究与实际 Native MCP 能力，再通过**同机双 Gateway loopback** 完成两个方向的固定响应组合实验；**单 Gateway Local Dispatcher 只在安全 RFC/Mock 门槛通过后实现**。GLM-5.3 独立工作包 [#79–#84](local/LHI_WORKSTREAM.md)，决策 [ADR0005](adr/0005-local-harness-interop.md)。与 GPT #66–68、GLM #72–77、跨实机 #19 并行，仍默认隔离、拒绝权限、不接既有 GUI/真实模型。此为新增研究/研发计划而非功能已验收。

> **2026-10-26 重大路线调整（最新优先级）**：从自研 Agent 互联协议扩张转为 **standards-first local-first Harness interoperability**；新增 A2A v1.0 可选 scoped Bridge（R0→R1→R2，#66–#68）、SHADI/AgentBridge 安全对照（#69）、SLIM/Directory 后置性能 spike（#70）、公平 Benchmark（#71）。已存在的 MCP SDK v2.4.0、libp2p Noise/Yamux、G2 private storage、native permission default deny、UNKNOWN 非重放 **保持不变**。Mac/Win 的 #17/#18/#19 原生 Harness 及实体实验与 R-track 并行。首先阅读 [总计划](INTEROP_REBASELINE_2026-10-26.md)、[ADR0004](adr/0004-standards-first-agent-interop.md)、[LLM 工作包](LLM_WORK_PACKETS.md)、[研究矩阵](research/INTEROP_LANDSCAPE_2026-10-26.md)。本文下方的 2026-10-24 规划为历史快照；#32 A2A 从 P5 提前而非已完成，禁止自动扩大权限、重开跨机窗口或合并。协调 [#42](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/42)。

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