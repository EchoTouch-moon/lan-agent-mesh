# 下一阶段实施计划：从跨平台验证到真实 Agent 协作（2026-10-24）

> **执行更新（2026-10-24）**：G0 软件基线已按用户授权通过 PR #44 合入 main（05ca853），合并后 macOS/Windows × Node22/24 CI 全通过。#38 已 merged，#39/#40/#43 已收拢关闭；#15/W3 和 #41 用户宿主复验仍开放，G1/G2 以及真实 Harness/生产门槛没有因此完成。下文“当前事实”和候选合并步骤是规划起点快照；最新软件集成状态见 [集成审查](INTEGRATION_REVIEW_2026-10-24.md)。

> 状态：**执行规划 / 未授权自动合并或扩大执行权限**。本文件在 `main` 中记录截至 2026-10-24 已核实的进展；尚未集成的 PR、未完成的实体跨机测试与 Windows ACL 问题必须持续保留为未完成。
>
> 协调入口：[NEXT Issue #42](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/42)；新安全任务：[Windows ACL #41](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/41)。

## 1. 进度事实与可信度边界

| 模块 | 已核实的证据 | 尚未成立的结论 |
|---|---|---|
| P0 基础 | [PR #33](https://github.com/EchoTouch-moon/lan-agent-mesh/pull/33)、[PR #37](https://github.com/EchoTouch-moon/lan-agent-mesh/pull/37) 已合并 main；Mac/Windows 多次固定响应的 Codex、DSH、ZCode 可控制接口探针，未知能力已界定 | WorkBuddy 入站、Windows Codex、已有 GUI 接管 |
| P1 Mesh | [PR #38](https://github.com/EchoTouch-moon/lan-agent-mesh/pull/38) 在 `feat/p1-mesh-core`，CI macOS/Windows × Node 22/24 的 37 项测试通过；Mac 端独立进程、mDNS、自动重连；[PR #39](https://github.com/EchoTouch-moon/lan-agent-mesh/pull/39) 的 Windows W1/W2 通过 | W3 **两台实体机器**相互连接、相互配对/任务和人类短码核对仍 pending；P1 整体验收不可宣称完成 |
| P2 MCP 入口 | [PR #40](https://github.com/EchoTouch-moon/lan-agent-mesh/pull/40) 在 `feat/p2-mcp-ingress`，七项 `mesh_*` MCP 工具、43 项测试、实际 stdio MCP SDK → Gateway → 远端 Mock 已通过跨平台 CI | 真实 Codex/DSH 适配器、真实模型对话或 GUI 注入未实现，#40 尚未合并 |
| Windows 数据保密 | [W2 有效 ACL 报告](https://github.com/EchoTouch-moon/lan-agent-mesh/blob/p1-windows-evidence-windows-20261024T082002Z/docs/evidence/p1/windows/windows-20261024T082002Z/w2-isolation-acl.json)：文件路径限制在指定目录，但受检位置继承对其他普通用户开放的访问 ACL | 不能宣称密钥/控制令牌/MCP 凭据已通过 Windows 本机用户隔离，见 [#41](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/41) |

**术语：**“hosted 跨平台 CI”、“一台机器的双进程 Mock”、“用户的 Windows 实机 W1/W2”、“Mac ↔ Windows 两台实体设备 W3”和“真实 Harness 双向调用”是五种不同的证据等级。测试升级必须按等级记录，不得互相代替。

## 2. 下一阶段战略：只走一个核心闭环

> **目标体验：Mac Codex 通过 MCP → Mac Gateway → Windows Gateway → Windows DSH（ACP）；反向由 Windows 上具备经验证的 MCP/工具调用能力的 Harness 发起 → Windows Gateway → Mac Gateway → Mac Codex。** Windows DSH 的入站 ACP 能力不自动证明它具有出站 MCP 调用能力；在确认该能力前，先用 Windows 本地 MCP 测试客户端证明反向 Mesh，再另外验收真正的 Harness 反向调用。

坚持对等节点、Gateway-mediated 接入、零中心服务、只暴露经授权的 Agent 和 workspace alias。优先 Gateway 自己创建的会话，不把“注入已有 GUI 聊天窗口”作为本轮阻塞项。

**不做**：现在扩大到 A2A、Rooms、自动组队、任意 Windows 命令执行、默认写权限、WorkBuddy 私有内部通信注入或大规模安装器。相关已有 #25–30 保留在后续。

## 3. 执行顺序与 Gate

### Gate G0 — 收敛分支与可审查的主干基线（优先）

涉及 [PR #38](https://github.com/EchoTouch-moon/lan-agent-mesh/pull/38)、[PR #39](https://github.com/EchoTouch-moon/lan-agent-mesh/pull/39)、[PR #40](https://github.com/EchoTouch-moon/lan-agent-mesh/pull/40)、[#42](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/42)。

1. 审查 #38 代码、ADR、严格默认拒绝和测试来源；确保 clean source SHA 与 CI/独立进程证据一致。达到代码质量门槛可先合并**实现**至 `main`，但 **#15 仍开放、P1 硬件验收仍 pending**。
2. #39 基于 `feat/p1-mesh-core` 的 Windows 证据分支。#38 集成后，审查祖先/差异，**只集成非重复的 Windows 证据**；必要时调整 base，不要把相同 P1 实现二次并入。
3. #40 也基于 `feat/p1-mesh-core`。单独检查 MCP scopes、临时凭据、跨工具 requestId 去重、丢 ACK、UNKNOWN、进程重启和 stdout 保密，再在以当前 `main` 为准的 CI 通过后考虑合入。MCP 的 Mock 验收与真实 Harness 验收必须独立。
4. 在 `docs/ROADMAP.md`、Issues 记录清楚“已集成实现”“实际 Windows W1/W2”“实体 W3”“真实 Harness”分别何时完成，保持 PR 和任务关闭动作可追溯。

**G0 完成判定**：主干含经审查的 P1 和 MCP Mock 基线；无重复补丁；新合并源在 macOS/Windows × Node22/24 CI 通过；未完成 Gate 不虚报完成。这里仅制定顺序，并未批准/执行合并。

### Gate G1 — 真实 Mac ↔ Windows W3 双向 Mock 硬件验收（优先）

执行清单：[P1 Windows Pack](https://github.com/EchoTouch-moon/lan-agent-mesh/blob/feat/p1-mesh-core/docs/P1_WINDOWS_TASKS.md)；归属 [#15](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/15)。当前 W3 的 pending 证据见 [PR #39](https://github.com/EchoTouch-moon/lan-agent-mesh/pull/39)。

- [ ] 两台实体设备在同一局域网；执行同一个**已提交 SHA**、干净工作树，记录各自 OS/Node/pnpm/源码 SHA。若升级分支，重新标识测试源，旧 W1/W2 证据不冒充新 SHA 的通过结果。
- [ ] mDNS 自动发现；失败记录网络原因并通过手动地址继续，不要求更改防火墙或获取管理员权限。
- [ ] 双方独立核对完整配对短码、验证 expected peer ID；未配对请求被拒绝。
- [ ] Mac → Win 和 Win → Mac 分别 spawn/send/读取 events，得到 `COMPLETED` 和**精确** `mock:cross-host fixture`。
- [ ] 丢失 ACK 以后重投原始幂等请求，接收端仍只有一个逻辑 Task；恢复为 UNKNOWN 时不重放副作用。
- [ ] 验证同一会话继续、进程重启后的 Mock 原生会话失效语义、撤销信任后的 registry/task 拒绝与缓存失效。
- [ ] 两边 Gateway 清理子进程，确认监听端口释放；证据留 GitHub，脱敏本地 IP、路径、Token、密钥并保存原始报告哈希。

**G1 完成判定**：具有同一 testedSourceSha 的两个物理宿主完整双向记录，配对/撤销/重放/恢复/清理均有可复现证据。如果用户不在场或 Mac peer 不在线，维持 pending，不以本机两进程代替。

### Gate G2 — Windows 凭据目录安全收口（与 G1 可并行；启用真实 Harness 前必须通过）

执行任务：[安全 Issue #41](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/41)；与 [Policy #20](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/20) 和 [failure tests #24](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/26) 对齐。

- [ ] 明确数据目录的有效 Windows DACL、继承和重解析点规则；隔离的是普通本机用户，不误将 SYSTEM/管理员当作等价攻击者。
- [ ] 在不安全数据目录下对真实凭据/真实 Harness 默认 **fail closed**；诊断不泄露身份密钥、控制 Token 或 MCP grant。
- [ ] 选定或由操作者创建具备适当独占访问控制的目录；**不静默修改宿主机 ACL，不通过提权或开放 Everyone 权限解决问题**。
- [ ] Windows 实机正、负测试附证据；Mac/POSIX 行为回归。

**G2 完成判定**：不安全目录不能使用生产凭据，安全目录可用且证据可重放。G2 未通过时，仅维持受限 Mock/fixture 实验，不能启动持续暴露真实 Agent 的工作模式。

### Gate G3 — 真正的 Harness Adapter 与双向任务（紧随 G0/G1/G2）

对应 [Codex #17](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/17)、[ACP/DSH #18](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/18)、[双向真实 Harness #19](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/19)。

1. **先 Codex App Server Adapter（Mac）**：Gateway-owned thread/start/resume/turn/start，事件游标、取消/超时、native permissions 默认拒绝；使用隔离 home 和固定 localhost inference。公开能力按版本 probe 实测，unsupported fail closed。
2. **再 DSH ACP Adapter（Windows）**：针对已验证的 DSH desktop bundled ACP 路径；session/new、prompt、resume（受版本能力限制）、cancel 与 `session/request_permission` 拒绝语义；不暴露 stdio 到 LAN。
3. **跨机桥接**：Mac Codex MCP → Windows DSH ACP；反向先由 Windows 本地 MCP SDK 测试客户端 → Mac Codex，验证对等网络与网关会话。之后单独确认 Windows DSH/ZCode/Codex 哪个拥有可靠的出站 MCP/工具调用接口，才将其标记为“真实 Windows Harness 主动发起”；不能以测试客户端代替真实 Harness。两边 task/session 事件、取消和恢复均须有证据，绝不换 ID 伪造上下文。
4. **真实模型试用需要另外明确操作授权**，不在纯固定响应证据里混入用户已有 GUI 对话/账号。Windows Codex 当前为 `unknown`，不强制假定可用；可另设实验支线补其真实双向适配，不能声称 Win Codex 完成。

**G3 完成判定**：两台真实机器上 Mac Codex→Win DSH 的 Harness-to-Harness 路径已验证，同时 Windows→Mac 网关反向 MCP 路径已验证；要声称“真实 Harness 双向主动协作”还必须有 Windows Harness 出站调用证据。Native permission 拒绝有效；工具调用、恢复、取消均有证据；G2 必须先通过才启用生产凭据和长期真实 Agent。

### Gate G4 — 可日常使用的审批与 Alpha

对应 [#20](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/20)–[#24](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/26)、[#27](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/29)、[#28](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/30)。

- Gateway 限制调用者/工作区/预算，原生 Harness 和 OS 权限仍有效。
- 人工授权采用独立认证面板，绑定 task/operation/nonce/expiry；Agent 的 MCP 工具**不能自批准**；无 native hook 时清楚显示不支持统一审批。
- 统一只读追踪先于任何危险的“允许”入口；审计要能关联两台机器上的任务且脱敏。
- Alpha 发布必须有负例、重启、重放和 Windows ACL 验收；否则保持开发版。

## 4. 建议分工与迭代包

| 迭代包 | Mac 工作 | Windows 工作 | 交付物 / 结束条件 |
|---|---|---|---|
| I — 集成与硬件联调 | 审查 #38/#40、提供 Mac peer、W3 另一半记录 | 审查 #39、执行 W3 Windows 部分、诊断 #41 ACL | G0 + G1 的源码/证据闭合，明确安全 blocker |
| II — 安全与 native 接入 | Codex Adapter，MCP 端到端 | DSH ACP Adapter，数据目录安全策略 | G2 + G3 的隔离 fixture 双向链路 |
| III — 审批与 Alpha | 管理面板、审计、Mac 打包 | 原生权限接入、Win 诊断/安装 | G4 负例与 Alpha 验收通过 |

每次任务交接至少记录：**源码 SHA、执行 OS/版本、严格命令/测试结果、原始报告哈希、失败范围、清理状态、PR/Issue 链接**。不要重复运行未变更且已验收的低风险探针；版本或代码变化时对对应范围重新测试。

## 5. 决策规则

- **代码可合并不等于功能可正式开放**。不把 #38/#39/#40 的通过范围扩张成两实体主机、真实模型或完整统一审批。
- **权限默认拒绝**。本阶段无须开放 shell 写权限、已有 GUI 注入或跨账户数据浏览。已有 harness 的原生权限是上限，不可由 Gateway 扩权。
- **无法完成时给出明确 blocker**：例如配对需要真人确认、宿主机 ACL 不受控、Windows Codex 接口缺失；不要以换概念“通过”。
- **先实现一个可靠双向闭环，再扩大 harness 支持面**。ZCode、WorkBuddy、群聊、A2A 按既有 backlog 后置。

## 6. 直达任务

- 协调与集成：[#42](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/42)
- 实体跨机：[#15](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/15)
- Windows 目录保密：[#41](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/41)
- MCP 入站：[#16](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/16)
- Codex：[#17](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/17)
- DSH：[#18](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/18)
- 真实 Agent 双向：[#19](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/19)
