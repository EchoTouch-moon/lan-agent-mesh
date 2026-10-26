# LHI-0 采用决策与后续任务建议（2026-10-26）

**taskId:** LHI-0 · **Issue:** [#79](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/79)
输入：[LOCAL_HARNESS_LANDSCAPE](LOCAL_HARNESS_LANDSCAPE.md) + [LHI_UPSTREAM_MATRIX](LHI_UPSTREAM_MATRIX.json)。全部基于 pinned 元数据与 README/docs 证据，**未运行任何第三方项目**；不构成新 runtime 依赖引入（该决策权在 R0 #66）。

## 1. 逐源决策（ADOPT / ADAPT / STUDY / DEFER）

| 来源 | 决策 | 理由 |
|---|---|---|
| Agent Intercom（AGPL-3.0） | **STUDY**（仅行为语义） | 交付语义与 LAM 不变式最接近（ACK-before-delivered、原 ID 重放、接收去重），可作为 LHI-5 语义参照；但 AGPL-3.0 传染性强，**禁止代码引入/复制**，连改编都要避免实质相似。README 明示纯 MCP 会话无主动 turn——双源佐证之一。 |
| agent-peers-mcp（MIT） | **ADAPT-semantics**（吸收语义，不引依赖） | lease+ack + 显式 `ack_messages` + reclaim 凭据 + 0o600 fail-closed 属主校验，值得映射进 LAM 既有 inbox/lease 语义对照；"Codex 无模型可见 MCP 中途推送通道"是 LHI-2/3 接收侧设计的关键外部证据。代码引入仍受 R0 #66 门控。 |
| ZCode CLI（Apache-2.0） | **ADOPT-as-target**（集成目标，非依赖引入） | 本工作线唯一目标 Harness；MCP 配置合同已 pin（`features.mcp` + `mcp.servers` + `mcp__` 命名）；installed 版本主动调用验证 = LHI-1 专属任务，本文不宣称。 |
| Borg MCP（client Apache-2.0；server 开放度 unknown） | **STUDY** | activity-log 显式受众路由、可重放读 + delivered 检查点、受限 representative 面对 LHI-4/5 有直接参考价值；但 server 侧开源状态不明、可跑私有 LAN（宽于 LAM loopback-first）、体量小（1 star），不引入。 |
| Concord MCP（MIT，695★ 最活跃） | **ADAPT-semantics**（仅 claim 语义） | 文件级 claim/overlap 前置检测 → LHI-5 资源声明 RFC 的主要输入；其 `concord setup` 大量改写宿主客户端配置的模式与 LAM scoped-grant 哲学冲突，明确**不**效仿。wake 机制未文档化 → unknown。 |
| brainstorm-mcp | **DEFER** | 已归档、license NOASSERTION；仅作 Borg 历史脉络记录。 |
| Softsensor Concord | **DEFER** | 多仓库团队治理定位，超出本机 Harness 互操作范围。 |
| MPAC/STORM 论文 | **STUDY**（LHI-5 输入） | first-class conflict objects / 写入时冲突检测为 claim 语义提供学术参照；无可部署实现。 |
| "tap" | **NOT-APPLICABLE / unknown** | 两个公开候选（Google TAP 测试基础设施、Visa TAP 身份签名）均非本机协作方案；ADR0005 §5 原所指无法确证，如实记 unknown，不猜测。 |

## 2. License 与依赖红线

- **AGPL-3.0（Agent Intercom）**：任何形式的代码链接/复制都可能触发传染义务 → 仅允许阅读文档与协议行为描述，产出物中不得包含其代码片段。
- **MIT（agent-peers、Concord）**：许可友好，但 LHI-0 轮**不引入任何 runtime 依赖**（#79 STOP：需等 R0 #66 的第三方依赖安全/许可结论）；吸收方式限于语义对照与独立实现。
- **Apache-2.0（ZCode、Borg client）**：同上，暂不引入；Borg server 开放程度 unknown，视为闭源处理。
- 本文三个文件均为独立撰写的行为/文档研究，未复制任何上游文本段落（引用均为短句证据并注明来源）。

## 3. Codex ↔ ZCode 双向路径要求与降级（LHI-3 输入）

**必需接口（双向各自成立的最小集）**：
- caller 侧：installed harness **真实发出** native MCP tool invocation（带原生事件、实际参数、tool result）——Codex 侧 PR #65 fixture 已证；ZCode 侧待 LHI-1。
- Gateway 侧：scoped MCP ingress（既有）+ Local Dispatcher 或 L0 双 Gateway loopback（ADR0005 §2）。
- receiver 侧：Gateway-owned `HarnessAdapter`（new session / resume / send / watch / cancel / deny / UNKNOWN）——Codex 侧 PR #65 baseline；ZCode 侧待 LHI-2。

**降级阶梯**（某侧无法支持时）：
1. **全 native 双向**：两方向各有 source-pinned native caller event + receiver 生命周期证据（L3 达成）。
2. **单方向 native + 对侧 poll-based**：对侧退化为 durable inbox + 下次工具调用取消息（agent-peers 模式）；该侧仅记 partial/L0，整体不得宣称双向完成。
3. **双侧 poll-only**：仅 L0-Config；L3 双向 BLOCKED，逐方向列 unknown。
4. **wake 不可用**：不做任何 GUI 唤醒/注入尝试（ADR0005 §7）；bodyless-turn 可行性记 unknown，留待实测。

**设计约束（来自双源交叉证据）**：Agent Intercom 与 agent-peers 都未实现"纯 MCP 会话接收主动消息"，分别用 app-server 桥和轮询绕行 → **ZCode 接收侧设计不得假设存在 MCP server→会话主动推送通道**；若 LHI-1 实测发现等价限制，接收侧一律按"下次工具调用取消息 + durable 持久"设计。

## 4. 对 LHI-1/2/3/4 的最小功能建议与非目标

### LHI-1（#80，ZCode native MCP 出站探针）
- **最小功能**：全新独占 HOME/XDG/ZCODE 目录；按官方合同（`features.mcp` + `mcp.servers` stdio）注册 fixture MCP server；记录 installed 版本 + 可执行文件摘要；捕获**真实 native tool-call 事件**（实际工具名 `mcp__…`、请求参数、tool result、执行计数）；负例：不可用 server 的失败/超时行为；清理证据。
- **非目标**：不碰用户现有配置/GUI；不连外网模型（固定 localhost/fixture 响应）；不做入站；不新增 runtime 依赖。
- **判据**：官方文档"工具注册≠鉴权≠执行权限"立场 → 仅当观察到真实 invocation 事件才记 L1-Outbound PASS，否则 unknown。

### LHI-2（#81，Gateway-owned ZCode Receiver Adapter）
- **最小功能**：新包 `packages/zcode-adapter/**` 包装已验证 session/* 接口；仅 **Gateway-owned 新会话**（spawn/resume/send/watch/cancel/deny）+ UNKNOWN 不重放 + default-deny 权限；独立状态库映射（Gateway session ↔ adapter/native session id）；synthetic 先行 + native localhost fixture 复测。
- **非目标**：不 attach 已有 GUI 会话、不导入用户会话库、不自动批准权限、不改 `packages/runtime` 共享代码（如需，先 RFC + 独立 PR）。
- **设计输入**：接收侧按 §3 的"轮询 + durable"约束设计，不假设主动推送。

### LHI-3（#82，Codex↔ZCode 同机双向）
- **最小功能**：L0 双 Gateway loopback 编排两方向（Codex→ZCode、ZCode→Codex），各自 source-pinned native caller event + receiver 生命周期 + scoped grant/取消/UNKNOWN 负例；fixture 复用 PR #65 既有脚本而不改写。
- **非目标**：物理跨机、SDK 测试客户端冒充 harness、跳过任一方向的独立证据。

### LHI-4（#83，Local Dispatcher RFC + Mock-only PoC）
- **最小功能**：先 RFC（caller 身份 ≠ peer=self、scoped `local:<agentId>` grant、与远端路径一致的幂等/UNKNOWN/预算/审计语义），后 Mock-only 受控原型；默认禁用 flag、可单独回退。
- **非目标**：native local dispatch（待 RFC 审查后另批）、修改 `packages/mcp-server/src`（避让 #74）、自设审批 allow 决策。
- **参考模式**（来自本研究）：Borg representative 的"受限只读中继面 + 单一寻址对象 + delivered 检查点"可作为 caller 面威胁模型的对照设计。

## 5. 决策留痕

- 本文档只做判断与建议；任何被接受的采用都要在对应 LHI-1..5 任务中按 [LLM_WORK_PACKETS](../../LLM_WORK_PACKETS.md) 另行 CLAIM/RESULT，且引入 runtime 依赖前必须先有 R0 #66 结论。
- 证据不可改写：后续实测（LHI-1+）如与本文 README-claimed 描述冲突，在对应任务报告中记录差异，不回写本文件的"当时证据"，只追加勘误注记。
