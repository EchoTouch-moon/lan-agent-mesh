# 本机跨 Harness 协作研究（LHI-0 文献/能力差距审查，2026-10-26）

**taskId:** LHI-0 · **Issue:** [#79](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/79) · **执行等级:** docs（read-only research）
**modelClaimed:** GLM-5.3（操作者记录）

> **证据等级声明**：本文全部结论来自公开仓库元数据（`gh api`，读取时间 2026-10-26 ~13:00–13:10 UTC）、官方 README/文档原文与公开论文页。**没有任何第三方项目在本机被安装、运行或验证**；各项目 README 宣称的功能一律记为 "README-claimed"，不等于本机 verified。与本项目已实测的能力（[HARNESS_MATRIX](../../../docs/HARNESS_MATRIX.md)、[PR #65](https://github.com/EchoTouch-moon/lan-agent-mesh/pull/65)）严格区分标注。

## 1. 上游来源固定表（pinned sources）

| 来源 | URL | 固定 commit（默认分支 head，读取时） | License | 活跃度（读取时） |
|---|---|---|---|---|
| Agent Intercom（Codex 适配器） | https://github.com/dataforxyz/agent-intercom-codex | `ff1f0e2258ded8c81ae6fcf33048c78a7f8580fe`（2026-09-07） | **AGPL-3.0** ⚠️ | 3 stars；最新 release v0.10.0（2026-07-16） |
| agent-peers-mcp | https://github.com/Co-Messi/agent-peers-mcp | `dc81db4dbe9b3ddb97d3ba64fd24d5b743ef868b`（2026-07-13） | MIT | 8 stars；无 release（404） |
| ZCode CLI（官方） | https://github.com/zai-org/ZCode | `3c5b227649371507ddc4eb46ac5133afe6db1cab`（2026-10-20） | Apache-2.0 | 8264 stars；release v3.14.3（2026-09-24） |
| Borg MCP（client） | https://github.com/Byte-Ventures/borg-mcp-client | `d6e2a8beabbab698086bc3679d12171d08db3c17`（2026-10-22） | Apache-2.0 | 1 star；仓库推送至 2026-10-25 |
| Concord MCP | https://github.com/Get-Concord-AI/concord-mcp | `e49ec2703e519e8ad2a2761d2967cd52de6f059a`（2026-10-25） | MIT | 695 stars；npm `@concord-ai/concord-mcp`；CI badge 在 README |
| brainstorm-mcp（Borg 前身） | https://github.com/TheodorStorm/brainstorm-mcp | `088463645cbe147aa8ded2e93dd4224ef91ee0e8`（2026-08-09） | NOASSERTION | **已归档** |
| Softsensor Concord | https://github.com/Softsensor-org/concord | `9d7cf0ec0dc9c31695cf46b2e585b40d411e79cd`（分支 head 2026-08-26） | Apache-2.0 | 3 stars；定位为多仓库团队治理，非本机 Harness 互操作 |

Borg 说明：`borgmcp` npm 包由 borg-mcp-client 仓库发布（README 安装指引），自托管 server 随包提供（"start the local server"）；未发现独立开源 server 仓库（`Byte-Ventures/borg-mcp` 404），server 侧代码开放程度 **unknown**。

## 2. 各来源能力分析（六个维度）

维度取自 Issue #79：agent discovery / durable ask-reply / wake-on-message / 主动 MCP / 操纵新/已有 Native Session / 权限边界。速览表见 [LHI_UPSTREAM_MATRIX.json](LHI_UPSTREAM_MATRIX.json)；此处给证据。

### 2.1 Agent Intercom（protocol v3，AGPL-3.0）

- **discovery**：README-claimed——各 harness 适配器（Pi/Codex/Claude/OpenCode）向同一 local broker 注册 intercom 身份，跨 harness 会话互相发现。
- **durable ask-reply**：README-claimed，语义与 LAM 最接近——"A send is only reported as delivered after the receiving adapter acknowledges it. Unfinished outbound sends are persisted … and replayed with their original IDs after reconnect, making retries safe with receiver deduplication."（先 ACK 后 delivered、原 ID 重放、接收方去重）。
- **wake-on-message**：README-claimed——需要 `coi` sidecar（app-server 桥）唤醒 worker；**关键限制原文**："Plain Codex MCP sessions do not receive Pi-style unsolicited visible turns. Incoming messages are queued while the MCP server is running; call `intercom_pending` to read them."（纯 MCP 会话收不到主动消息，只能排队轮询）。
- **主动 MCP**：`codex-intercom-mcp` 在会话内暴露 intercom 工具（README-claimed）。
- **操纵新 Native Session**：`coi` 启动 Codex app-server、注册身份、按需启动 turn；orchestrator 可用 systemd cgroup/lease 管理 fleet（README-claimed）。**已有 GUI**：仅"turn 完成后刷新已 attach 的 TUI（idle 后 resume 同 thread）"，不是消息注入。
- **权限边界**：单用户本机模型；dormant `boss-run-v1` 合同显式 fail-closed（受保护 launch 在无 broker 拥有的 provider 时拒绝 `PROVIDER_AUTHORITY_UNAVAILABLE`）；reviewer read-only；拒绝 `danger-full-access`（README-claimed）。
- **License 风险**：AGPL-3.0 传染性强，只适合行为研究，不适合代码引入（见 DECISIONS）。

### 2.2 agent-peers-mcp（MIT）

- **discovery**：README-claimed——`list_peers` 作用域 `machine`/`directory`/`repo`。
- **durable ask-reply**：README-claimed——localhost:7900 SQLite+HTTP broker；"Messages are persisted before broker acknowledgement … re-present them until the model explicitly calls `ack_messages`"；**at-least-once**，消费方须容忍重复；磁盘 inbox `0o600`；lease+ack；reclaim 凭据允许同名会话重启后收回 UUID/清理 stale lease。
- **wake-on-message**：README-claimed + 关键证据："Current Codex CLI has no model-visible mid-task push channel for MCP servers"（当前 Codex CLI 没有模型可见的 MCP 中途推送通道）——Codex 侧只能在下次工具调用时取消息；"Wakeable mode can start a bodyless app-server turn for an idle session; **it is not a native MCP notification**"；Claude 侧有 best-effort 原生 channel 提示但以 durable inbox 为准。
- **主动 MCP**：标准 MCP 工具（send/list/ack 等）。
- **操纵新 Native Session**：wakeable 模式可为 idle 会话启动 bodyless app-server turn（README-claimed）；不注入已有 GUI。
- **权限边界**：**README 原文警告**："This is an experimental, single-user local collaboration layer for privileged coding agents—not a multi-user security boundary. Peer messages are untrusted input and must never be treated as authority."（单用户、非多用户安全边界、peer 消息是不可信输入）；per-user shared secret + per-peer session token；DB/WAL/secret 文件 0o600 且启动时 fail-closed 校验属主/权限。

### 2.3 Borg MCP（client Apache-2.0；server 开放程度 unknown）

- **discovery**：cube（共享协作空间）/drone（每个接入会话）/role（README-claimed）；roster 由 `borg quickstart`/`assimilate` 编排。
- **durable ask-reply**：activity-log 路由——每次 `borg_log` 必须显式 `to` 受众（broadcast 或非空 selector）；`borg_read-log` 排空未读；cube documents 为 immutable durable 内容带 revisions（README-claimed）；human representative 的读取"replayable until the host calls `deliver` after durably persisting the replies"（可重放读 + 持久化后 delivered 检查点）。
- **wake-on-message**：body-free wake hints（`borg representative listen`）（README-claimed）。
- **主动 MCP**：`borg_*` 工具族；representative 仅暴露 5 个受限 stdio MCP 工具。
- **操纵新 Native Session**：Borg 启动已安装的 agent CLI 并把会话接入 cube；`borg assimilate` 增加/恢复 drone、重接 saved worktree（README-claimed）。
- **权限边界**：cube 是信任边界（"the cube remains the trust boundary"）；representative 只能对接一个 Coordinator、不能寻址其它 drone、reply 内容仅在读取时可见；server 可跑 loopback 或**私有 LAN**（比本项目 loopback-first 更宽）；Git ref 溯源校验（7 位前缀不匹配拒绝）。

### 2.4 Concord MCP（MIT，695 stars，最活跃）

- **discovery**：README-claimed——共享 workspace（`.concord/`）内 reachable sessions 可互相 direct prompt/reply。
- **durable ask-reply / 资源声明**：README-claimed——live messages、**文件级 Claim/overlap 检测**（"Claim src/app/page.tsx → Overlap: Claude Code already owns this file"）、decisions 共享、带证据的 handoff、review state。
- **wake-on-message**：README 称 "live messaging / live prompts"，机制未在 README 说明 → **unknown**（不臆断）。
- **主动 MCP**：标准 MCP server（npm 分发）。
- **操纵新 Native Session**：无——只连接已运行会话，不 spawn（README-claimed，无 spawn 功能描述）。
- **权限边界**：local-first；`concord setup` 会**写入多个客户端配置**（`.mcp.json`、`.cursor/mcp.json`、`.gemini/settings.json`、`~/.codex/config.toml`、`CLAUDE.md`、`AGENTS.md`、`.codex/`、`.cursor/rules/` 等，README-claimed）——与 LAM"scoped grant、不改宿主配置"的哲学差异显著。

### 2.5 ZCode CLI（Apache-2.0，官方，作为被研究 Harness 本体）

- **主动 MCP 出站（配置合同，官方文档 pinned）**：`features.mcp` 启用后经 `mcp.servers` 注册，每 server 必须声明传输 `stdio`（command/args）/`http`（url/headers/oauth/timeoutMs）/`sse`；`protocolVersion` 支持 `auto`/`legacy`/`2026-07-28`；同名 server 用户配置优先于项目配置；工具名常见 `mcp__` 前缀、插件可加命名空间。来源：apps/zcode-cli/docs/usage/07-mcp.md @ `3c5b227`。**官方文档原文警示（与本项目 L0≠L1 立场一致）**："工具能注册不等于鉴权完成，也不等于有执行权限""检查请求中的实际工具名，不要仅凭模型声称'能访问 MCP'判断成功"。
- **会话操纵（本机已实测）**：[HARNESS_MATRIX](../../../docs/HARNESS_MATRIX.md) 已记录 darwin/Windows 安装版 native session create/resume/send/stream/cancel/deny 的 localhost 定值探针；**已安装版本的主动 MCP tool-call 尚未验证**（ADR0005 §1 明确：文档支持 ≠ 出站实验证据）——这正是 LHI-1（#80）的任务。
- **已有 GUI**：官方未提供 attach/注入承诺（ADR0005 §7 立场不变）。

### 2.6 研究论文类候选（tap/MPAC/STORM 等，均无可部署本机实现）

ADR0005 §5 列出的 "tap/MPAC/STORM" 经核验为**研究文献**而非本机协作产品（汇总页 getzit.org/prior-art，2026-10-26 读取）：

| 名称 | 核验结果 | 出处 |
|---|---|---|
| MPAC | 多主体协议：intents、first-class conflict objects、Lamport clocks、乐观并发；论文，无 GitHub 实现 | arxiv.org/abs/2604.09744 |
| STORM | 共享工作区**写入时**冲突检测（mediates every file read/write）；论文 | arxiv.org/abs/2605.20563 |
| "tap" | 两候选均非本机协作方案：Google TAP = 大规模测试基础设施（ICSE-SEIP 2017）；Visa TAP = 基于 RFC 9421 的 agent 身份签名（HTTP header）。**判 not-applicable/unknown**，ADR 原意无法从公开来源确证 | getstream.io / Medium 13-protocols 综述 |
| grite（附带） | git 内协调日志、无 server | arxiv.org/abs/2606.19616 |
| AgentRoom（附带） | MCP 之上文件级 claim/status/broadcast + CRDT 文件系统 | arxiv.org/abs/2608.23740 |

## 3. Codex ↔ ZCode 双向路径（LHI-3 前瞻）

**目标**：同机双方向 native MCP-origin → 受控 native receiver。

| 方向 | 需要的接口 | 现有证据 | 缺口 |
|---|---|---|---|
| Codex → ZCode | Codex native MCP tool-call（caller）→ Gateway ingress → ZCode receiving Adapter（receiver） | caller 侧：PR #65 Mac fixture 已证（未合并为 main 默认功能）；receiver 侧：HARNESS_MATRIX ZCode native session 七操作探针已过 | Gateway-owned `@lam/zcode-adapter` 不存在（LHI-2）；两证据尚未组合 |
| ZCode → Codex | ZCode **installed 版本真实发出** MCP tool invocation（caller）→ Gateway → Codex receiver（PR #65 baseline） | 配置合同官方文档已 pinned；**installed 版本主动调用未验证** | LHI-1（#80）全部工作；版本/可执行摘要、隔离 home fixture |

**降级阶梯（无法支持时的退化，写入 DECISIONS §LHI-3）**：
1. 全 native 双向（两方向各有 source-pinned native caller event）。
2. 单方向 native + 对侧 poll-based（agent-peers 模式：durable inbox + 下次工具调用取消息；该侧只算 L0/partial，不得宣称双向完成）。
3. 双侧均 poll-only：仅 L0-Config 级（工具出现在列表），双向宣称 BLOCKED。
4. wake-on-message 若 ZCode 侧不可用：不做 GUI 唤醒尝试（ADR0005 §7），仅记录 bodyless-turn 可行性 unknown。

**关键交叉证据**：agent-peers README 断言 "Current Codex CLI has no model-visible mid-task push channel for MCP servers"；Agent Intercom 同样绕行（app-server 桥 + `intercom_pending` 轮询）。两个独立上游都未实现"纯 MCP 会话接收主动消息"——**LAM 设计 ZCode 接收侧时不应假设存在 MCP server→会话的主动推送通道**，需以 LHI-1 实测为准。

## 4. 与 LAM 的能力差距摘要（细节见 MATRIX.json）

LAM 已有而上游普遍缺如：配对 peer 信任（Noise/Yamux）、(peer,key) 幂等 + fingerprint 冲突、UNKNOWN 不自动重放、事件/容量预算、scoped MCP grant 默认拒绝（详见 [ADR0004](../../../docs/adr/0004-standards-first-agent-interop.md)）。

上游已有而 LAM 缺如（按价值排序）：
1. **wake-on-message 的工程形态**（bodyless app-server turn / body-free wake hints，两家独立实现；均非 MCP notification）。
2. **文件级 claim/overlap 检测**（Concord；对应未来 LHI-5 资源声明 RFC）。
3. **可重放读 + delivered 检查点**（Borg representative；对应 LHI-5 消息语义）。
4. **同机无配对 discovery 的作用域模型**（machine/directory/repo，agent-peers）。
5. **受限人类代表面**（Borg representative 5 工具只读中继；对 LHI-4 Local Dispatcher 的 caller 面设计有参考价值）。
