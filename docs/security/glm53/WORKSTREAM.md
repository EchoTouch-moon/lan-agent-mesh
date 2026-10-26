# GLM-5.3 专项工作线：防御性安全审查、故障注入与可靠性加固（2026-10-26）

> **GitHub 任务入口**：[G-S0 #72](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/72) · [G-S1 #73](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/73) · [G-S2 #74](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/74) · [G-R1 #75](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/75) · [G-S3 #76](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/76) · [G-X1 #77](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/77)。尚未领取/执行或通过，Issue 的存在不等于验证完成。

**计划状态：READY FOR CLAIM，尚未执行安全测试，也未自动派发到 GLM 服务。** 此文档用于使用 GLM-5.3 的编码 Agent 主动领取独立任务。仓库基线（编写计划时）`main@1c5697219a7d3281f37d57981b5b548d7c1c9d5b`；每个 Agent 实际执行时必须重新获取最新 main 与已占用文件范围。

**总路线不变**：先读 [AGENTS.md](../../../AGENTS.md)、[ADR0004](../../adr/0004-standards-first-agent-interop.md)、[INTEROP_REBASELINE](../../INTEROP_REBASELINE_2026-10-26.md)、[LLM_WORK_PACKETS](../../LLM_WORK_PACKETS.md)。这是**横向防御性验证线**，不替换 #66 R0、#67 R1、#68 R2 等 GPT 正在进行的 A2A 研发，也不假冒 #19 真实双机 Harness 验证。

## 1. 为什么选择这些任务

Z.ai 于 2026-08-14 发布 GLM-5.3，官方宣称在 CyberGym 漏洞发现任务达到 84.5% 并提升长程编码表现。NIST CAISI 于 2026-09-17 发布独立评估，认为 GLM-5.3 在当时是网络安全能力最强的开放权重模型，但仍弱于当前美国前沿模型。来源：https://z.ai/blog/glm-5.3 和 https://www.nist.gov/news-events/news/2026/09/caisis-assessment-zais-glm-53-cyber-capabilities 。

这是选择其承担**自己的代码审计、可重现的拒绝负例、状态机回归、资源边界测试**的理由，不是“GLM 写的安全补丁天然可信”。所有结果必须经独立 CI/人工审查；报告中应区分 proven finding、suspected finding、false positive。

## 2. 已占用工作与硬边界

- **GPT 已领取** [#66](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/66) R0，上游 A2A/AGNTCY/SHADI API、License、安全审查。GLM 不重做 `docs/research/upstream-locks.json` 或 `R0_DECISIONS.md`。
- **GPT 既有的 A2A 研发计划** [#67](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/67) / [#68](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/68) 分别规划新增 `packages/a2a-bridge/**` 和相关接口映射。GLM **不得修改 A2A 运行代码或重定协议**。可在将来其 PR 就绪后另开独立审查，但不暗自并行更改。
- **Mac M1/M2** 已有 [PR #65](https://github.com/EchoTouch-moon/lan-agent-mesh/pull/65)，不要重复接入 Codex/修改其 fixture 出站脚本。Windows W1/W2/W3、#19 实体实验不由 GLM 自主触发。
- **SEC-A #69** 聚焦“SHADI/AgentBridge 对比与沙箱研究”；GLM 本工作线聚焦**LAM 自有代码的安全性和测试**，不在 #69 已有范围内另起外部依赖审查。
- 测试资产原则上仅增加命名为 `glm53-*.test.ts` 的专用测试文件及 `docs/security/glm53/**` 报告。对真实代码的任何修改只能**单独修复 PR**、凭已通过的最小可复现失败测试、明确受影响文件后再审查；不得擅自重写 core。
- 漏洞研究仅限**本仓库授权源码 + 本机完全隔离的 synthetic/fixture**；禁止外部网站/第三方系统扫描、真实凭据、远程利用、窃取信息、持久化、横向移动或公网监听。拒绝“在本机安全实验中可用”为借口操作用户生产目录。
- 不更改既有 G2 private-storage、Noise pairing、native approval 默认拒绝、UNKNOWN 非重放、不删除旧失败证据；不启用真实模型、现有 GUI、真实在线服务、系统防火墙/ACL 修改或提权。

## 3. 推荐执行顺序与不冲突的文件所有权

| 包 | 对应 Issue | 独占首选文件范围（只新增，不改既有实现） | 启动顺序 | 交付 |
|---|---|---|---|---|
| G-S0 威胁建模与白盒审计 | [#72](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/72) | `docs/security/glm53/threat-model.md`, `findings.md` | 首先；可和测试包并行 | 按优先级证据化的缺口、可复现计划 |
| G-S1 协议输入与 RPC 边界测试 | [#73](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/73) | `packages/protocol/test/glm53-envelope-invariants.test.ts`, `packages/mesh/test/glm53-peer-boundary.test.ts` | 立即 | 有界解析/恶意输入/身份绑定回归 |
| G-S2 MCP 授权和秘密信息拒绝负例 | [#74](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/74) | `packages/mcp-server/test/glm53-scope-boundary.test.ts`, `docs/security/glm53/mcp-scope-review.md` | 立即 | 七工具跨作用域/失效凭据/控制面隔离 |
| G-R1 durable 状态机与崩溃恢复 | [#75](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/75) | `packages/storage/test/glm53-ledger-invariants.test.ts`, `packages/runtime/test/glm53-recovery-invariants.test.ts` | 立即 | ACK/幂等/UNKNOWN/取消竞态负例 |
| G-S3 Windows 私有存储与原生子进程清理 | [#76](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/76) | `packages/private-storage/test/glm53-private-storage.test.ts`, `packages/dsh-adapter/test/glm53-cleanup.test.ts` | G-S0 可并行、Windows 允许 CI | 私有目录拒绝/lock/进程树清理（仅 fixture） |
| G-X1 跨任务安全复核（独立 reviewer） | [#77](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/77) | `docs/security/glm53/final-review.md` | 以上 PR ready 后 | 分类 finding、覆盖空白、重复测试与下一轮建议 |

每项都需独立分支 `glm53/<task-id>-...` 和独立 PR，不直接改 main、不互相 cherry-pick 未审查修复。S1/S2/R1/S3 初期只能新增测试，遇到真实问题写 **FAIL + minimal red test + separate fix proposal**；修复 PR 的范围先在 GitHub Issue 明确后再安排。这样与 GPT 主线和不同 GLM 任务不存在共享源文件写冲突。

## 4. 详细安全测试纲领

### G-S0 — 静态白盒威胁模型
- 威胁主体：LAN 上未配对节点、已配对但权限受限 Peer、被污染的 MCP Tool 输入、被控 Agent 的恶意文本、Host 同机其他用户、意外崩溃的 Native child、异常/篡改的持久回执。
- 信任边界：mDNS → Noise 身份 → 双侧人工 pairing → registry → scoped MCP → Router/Store → native Adapter/OS；区分**真正能执行**的测试面与假定前提。
- 针对 `packages/protocol/src`、`packages/mesh/src`、`packages/runtime/src`、`packages/mcp-server/src`、`packages/private-storage/src`、`packages/dsh-adapter/src` 审查输入边界、信任错配、错误码泄漏与失败处理。
- Findings 级别：confirmed (有复现)、hypothesis (有代码依据但未复现)、not-applicable、false-positive。不要把单纯“可能有风险”包装成已确认漏洞。不要公开附可滥用的实用 exploit chain；使用最小合成失败样本。

### G-S1 — 协议边界及 P2P 身份负例
- 输入种子：非 JSON、缺少字段/额外字段、wrong version/type/node ID、变更 source/target、超时/未来 deadline、错误 UUID、超过64KiB frame、分段 UTF-8、合成重复消息、registry 大小/缓存失效。
- 目标：拒绝应 fail closed；没有未认证的 registry/task/approval 侧效应；错误信息/日志不能出现私有凭据；不能因随机输入挂起无限任务。
- 使用 deterministic seed（配置在报告），不追加 CI 随机不稳定性；默认测试在数秒到分钟内有界。不要在真实 LAN 开监听；已有测试入口仅在 loopback fixture 使用。

### G-S2 — MCP 权限与秘密暴露负例
- 校验七个 `mesh_*` 工具之间身份/资源归属，尤其 `send_message` / `delegate_task` 共享 requestId 命名空间；跨凭据 Session/Task/Agent 不可读取/取消/执行。
- 无/失效/撤销/过期 token、grant 失效、Gateway 重启、CORS/Origin/Token route 错用、路径溢出、URL 重定向、恶意工具参数；观察错误码和 stdio 不含 bearer。
- 禁止读取用户现有配置目录；所有 sentinel 为假凭据/临时资源。无需实现新授权端点或 MCP 工具。

### G-R1 — durable 恢复与副作用不重复
- 从 `packages/storage` 的 inbox/outbox/tasks/messages 原子约束构造有限状态模型，对固定序列进行可重现枚举：first accept、lost ACK、expired cached ACK、receipt missing、duplicate same vs changed request、restart UNKNOWN、cancel before/after terminal、offline adapter、容量达到上限。
- 测试不变式：同一作用域 key 只执行一个逻辑任务；冲突参数拒绝；UNKNOWN 不自动重放；收到 cancel != CANCELLED；不同 peer 不可复用他人资源；进程/Store 关闭失败不隐瞒。
- 如需 fault hooks，只能显式 fixture/test-harness 注入，默认生产路径零行为变化；不能通过缩短生产 deadline 或清空账本让测试变绿。

### G-S3 — Windows 私有数据及 Native child
- 在 synthetic 临时目录检验路径名含空格/Unicode、父目录 ACL 约束、软链接/junction/hardlink 处理、helper 丢失、安全目录正控、不安全目录负例；Windows 无法复现的情况标 UNSUPPORTED/UNKNOWN，不能在 Mac 虚构 Windows 正式通过。
- DSH ACP 只测试自己 spawn 的 synthetic 子进程（含受控子进程），`taskkill /T /F` 等清理失败必须报告 uncertain；保留现有锁/UNKNOWN，不按 PID 存活状态删除 lock。终止仅自建 PID，不接真实系统 PID。
- 不需要改系统 ACL 或永久环境。G2 既有实体实测的证明范围不应被 synthetic 替代。

### G-X1 — 独立复核
- 检查每个 PR 的源/实际 tests/log/evidence、unverified、误报与漏测、是否和 #66–68 / #69 / #65 同路径冲突；复核不会把新增测试造成的 CI 失败直接当漏洞；给每项建议 `accept` / `revise` / `reject`，并说明理由。
- 不批准合并，也不删除/改写失败记录。只提交报告或评论；实际修复由单独 PR 追踪。

## 5. 测试证据与阻塞处理

统一 CLAIM/RESULT 采用 [LLM_WORK_PACKETS](../../LLM_WORK_PACKETS.md) 格式。补充：
- `modelClaimed: GLM-5.3` 是操作者记录，不等于 GitHub 能验证底层模型身份。
- 每个测试 seed/hash、被测源 SHA、Node/OS、`pnpm check` 退出码及四组 CI 链接、被测执行等级（docs/synthetic/native-local）、特定拒绝/泄漏/重复操作的观测；报错不掩盖、未运行记 NOT-RUN。
- 明确修改范围：test-only / docs-only / production-fix-proposed，不能“审计过程中顺手重构”。
- 若发现严重安全问题：先报告至负责人控制的私有渠道/私有仓库 Issue 的**最小必要细节**，限制真正可滥用细节公开，标记 blocker；不得对任何非受控目标验证漏洞。
- 测试失败不能通过跳过/降低断言/开放权限/刷新原始日志伪造 PASS。
- 只有明确授权才能执行需要两台真实设备的实验；本工作线首轮全部为 isolated read-only 或 synthetic。

## 6. 给 GLM 的直接工作指令

> 你是 GLM-5.3 的防御性安全与可靠性开发 Agent。先读取仓库 `AGENTS.md`、`docs/security/glm53/WORKSTREAM.md`、`docs/LLM_WORK_PACKETS.md`，再领取一项 `G-S*` 或 `G-R1` Issue。已知 #66 由 GPT 领取，#67/#68 属 GPT A2A 方向；PR #65 属 Mac Codex，请勿修改这些代码/文件。只在你自己新建的 `glm53-*.test.ts` 与 `docs/security/glm53/*` 范围内添加受控合成负例和证据；找到缺陷提交最小失败测试/审计发现，不直接扩大生产权限或更换协议。必须给出具体的源 SHA、失败/通过、范围、回退、CI、原始报告哈希与未验证项。不要启动真实模型、公网监听、现有 GUI、外部扫描、提权或跨实体联调，未经审批不合并、不关 Issue。

## 7. 并行的 GLM Local Harness 工作线（不属于本安全线 #72–77）

新增 [LHI_WORKSTREAM](../../local/LHI_WORKSTREAM.md) 与 [ADR0005](../../adr/0005-local-harness-interop.md)，Issues [#79–#84](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/79)：研究同机 Codex↔ZCode、ZCode Native MCP/Receiver、双 Gateway same-host 受控集成，最后审查单 Gateway Local Dispatcher。**已 CLAIM 的 #75 应当先完成/交接，不允许同一 GLM 工作树另开 LHI 分支覆盖其文件。** LHI 单独限制 `docs/local/**`、`scripts/lhi-*`、新 `packages/zcode-adapter/**` / `packages/local-dispatch/**`，共享 core 的修改只能经过独立 RFC 和维护者审查。不要把 LHI 新开发视为 G-S 安全测试已完成，也不要让 LHI 自动扩大 Native permissions 或已有 GUI 控制。
