# LHI-4 — 单 Gateway Local Dispatcher RFC（设计审查稿）

- **taskId:** LHI-4 · **Issue:** [#83](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/83)（本 PR 只交付第 1 切片：RFC，**不含** `packages/local-dispatch` 实现）
- **状态：** Draft for design review（未通过审查前不得进入 Mock PoC；Mock PoC 另受 §8 前置门阻塞）
- **基线：** `main@b09b28ccbdde8edc0034c7815c2a26d8986d7664`（2026-11-02 拉取核验）
- **架构约束：** [ADR0004](../adr/0004-standards-first-agent-interop.md) · [ADR0005](../adr/0005-local-harness-interop.md) · [LHI_WORKSTREAM](LHI_WORKSTREAM.md) · [LLM_WORK_PACKETS](../LLM_WORK_PACKETS.md)
- **modelClaimed:** Kimi-K3（用户当面指派；非 GLM-5.3，不占用任何 GLM 工作树，与 #75（CLOSED）、PR #92/#96 无文件交集）

> **证据等级声明**：本文所有关于本仓库的论断均来自对基线 SHA `b09b28cc` 的源码直读（文中给出文件与行号锚点）；对未合并 PR（#92、#96）的引用仅为**依赖状态说明**，不将其内容当作 main 已有能力；无任何第三方代码引入；docs-only，无 runtime 行为变化。

## 1. 背景与问题陈述

当前 Gateway 的 MCP 入站只对**远端已配对 peer** 开放，本机 Harness（Codex/ZCode）无法在不伪装成配对 peer 的前提下调用同一 Gateway 拥有的 receiving Adapter：

- Grant 作用域为 `{peers, agents, workspaces}`，`McpAccess.create` 对每个 peer 强制 `mesh.trusted(peer)` 并要求先配对（[mcp-access.ts L82-85](../../packages/runtime/src/mcp-access.ts)）。
- 所有 dispatch 经 `gateway.sendEnvelope(peer, …)` 走 Noise/Yamux P2P（[mcp-access.ts L318](../../packages/runtime/src/mcp-access.ts)、[index.ts L304-320](../../packages/runtime/src/index.ts)）；`Gateway.spawn/submit` 的第一个参数恒为 `peer`（[index.ts L321/L334](../../packages/runtime/src/index.ts)）。
- 接收侧所有权主体是字符串 `peer`：`tasks.peer`、`SessionBinding.owner`、`inbox.peer`/`outbox.peer`（[storage/src/index.ts L15-23、L46-49](../../packages/storage/src/index.ts)），`Router.receive` 以 Noise 连接身份核对 `request.source.nodeId !== peer`（[router.ts L70-71](../../packages/runtime/src/router.ts)）。

L0 临时验证（两套 Gateway loopback 互配对，PR #65/#96 证据）已证明语义可行，但它要求配对/Noise 开销且把"同机两个进程"建模为"两个节点"。LHI-4 的目标架构（ADR0005 §2）：**一个 Gateway** 接收不同本机 Harness 各自的 scoped MCP grant，经统一 Policy/Router/Store 调用 Gateway-owned 目标 Adapter，路由上区分 Local/Remote，语义上不区分。

## 2. 目标与非目标

### 2.1 目标（本 RFC 覆盖）

1. 定义 `LocalTarget` / `RemoteTarget` 显式联合类型与本机 caller 主体（principal）模型，**禁止** `peerId=self` 或任何 synthetic peer 假扮配对者（ADR0005 §3.1）。
2. 单 Gateway 多个相互隔离的本机 caller grant：grant A 不可枚举/发送/取消 grant B 的 Agent/Session/Task（对齐 #83 验收第 1 条与 #74 的隔离负例方向）。
3. 本机路径复用既有 Router/Store 不变式：执行前持久提交、幂等键+指纹、UNKNOWN 不重放、事件游标、deadline/深度/容量预算、审计（ADR0005 §3.3）。
4. 旧 MCP 七工具 API 的迁移路径（不破坏现有远端 caller）。
5. 默认关闭、loopback-only、可整体回退；存储只additive。

### 2.2 非目标（本 RFC 明确排除）

- **不**实现 `packages/local-dispatch`（第二切片，需本 RFC 审查通过 + §8 前置门满足）。
- **不**接入真实 ZCode/Codex native caller/receiver（需另行安全门，见 §8）。
- **不**新增默认监听、mDNS、公网/LAN 暴露；**不**改防火墙/ACL；**不**提权。
- **不**做 GUI attach、唤醒既有会话、消息注入（ADR0005 §7 / LHI_WORKSTREAM §7）。
- **不**修改 `packages/runtime`、`packages/mcp-server`、`packages/storage`、`packages/protocol`、`scripts/codex-mcp-*`、`packages/a2a-bridge/**`（GPT #67/#68）、`packages/zcode-adapter/**`（PR #92 预留）。
- **不**引入任何第三方 runtime 依赖（R0 #66 门）；LHI-0 结论（[LHI_DECISIONS](research/LHI_DECISIONS.md)）只允许语义参照。
- LHI-5（#84）的 ask/reply/claim/wake 协作原语**不在**本 RFC；本 RFC 仅在 §7.4 预留扩展点。

## 3. 现状关键事实（基线源码锚点）

| 事实 | 锚点 | 对本设计的约束 |
|---|---|---|
| Grant 绑定 `bootId`，Gateway 重启即失效（fail-closed） | mcp-access.ts L67、L142-154 | 本机 grant 沿用同模型，重启后不静默复活 |
| 幂等：同 `requestId` 不同指纹 → `conflict`；ACK 失败 → `UNKNOWN` 且提示不重发新键 | mcp-access.ts L295-296、L375-392 | 本机路径逐字保留该语义 |
| 执行前持久化预留（reservation BEFORE side effect） | router.ts L86-95 | 本机 admission 必须先写记录再碰 adapter |
| `tasks` 表 `UNIQUE(peer,key)`，`acceptTask` 指纹冲突拒绝 | storage L46、L111-137 | 主体字符串是本机/远端隔离的落点 |
| 崩溃恢复：`QUEUED/RUNNING/WAITING_INPUT` → `UNKNOWN`，永不自动重放 | storage L149-169 | 本机任务同表同语义 |
| 授权默认拒绝：permission 事件自动 `deny`，`humanId: 'gateway-default-deny'` | router.ts L184-194 | 本机路径不得引入自批准 |
| 预算：session≤100、tasks≤1000、events≤4096、in-flight≤16、rate 240/min、body≤64KB、deadline≤5min、delegationDepth≤4 | sessions.ts L145；storage L129/L142；mcp-access.ts L207；index.ts L167；router.ts L105-108 | 本机不放宽任何预算（ADR0005 §3.6） |
| 控制面已 loopback-only、拒 Origin、64KB 上限、10s 超时 | index.ts L144、L167、L190-192 | 本机入站复用同一 HTTP 边界，不新开端口 |
| `attachExistingGui` 在 AdapterClient 构造即拒绝 | adapter-sdk L46-47 | 本 RFC 不触碰 |
| `IdSchema` 不允许冒号（`^[a-zA-Z0-9][a-zA-Z0-9._/-]*$`） | domain L2 | §4.2 主体编码利用该性质 fail-closed |

## 4. 设计

### 4.1 目标引用：显式联合类型

```text
TargetRef = { kind: "remote"; peerId: Id }           // 既有语义，必须已配对 trusted
          | { kind: "local";  agentId: Id }          // 新增；仅指向本 Gateway 拥有并导出的 Agent
```

- 两个变体**不可互换**：`remote` 永远走 `sendEnvelope`/Noise 路径；`local` 永远走 §4.3 的本机 admission。不存在隐含转换。
- `local` 变体不接受 `peerId` 字段；`remote` 变体不接受本机 caller 语义。任何把本机调用编码成 `peerId = <本节点 id>` 的写法一律 `permission_denied`（对应 ADR0005 §3.1 "不能伪造 peerId=self"）。
- 工具输入层（§5）以该联合类型取代裸 `peerId` 成为唯一寻址方式。

### 4.2 主体（principal）模型与隔离落点

```text
Principal = "peer/<nodeId>"        // 远端配对 peer（Noise 连接身份）
          | "local/<grantId>"      // 本机已认证 caller（MCP scoped grant）
```

- **编码保证**：`local/` 与 `peer/` 前缀不含冒号以外的保留字符，完整主体串 `local/<uuid>` 因含 `/` 仍落在 `IdSchema` 字符集内、但**绝不可能等于任何真实 nodeId**（nodeId 由 mesh 身份派生，无前缀）；更关键的是 `mesh.trusted("local/…")` 恒为 false、`request.source.nodeId` 恒为裸 nodeId——任何误把本机主体送进 P2P 路径的代码都会在既有身份核对处 fail-closed。
- **落点复用**：`tasks.peer`、`sessions.owner`、inbox/outbox 的 `peer` 列**不改 schema**，直接存主体串。既有等值比较（`task.peer !== peer`、`binding.owner !== owner`）对任意主体类型天然正确；旧版本 reader 只查询自己写入的裸 nodeId 主体，不会读到本机行（additive 兼容，见 §6）。
- **会话绑定**：`SessionBinding.owner = "local/<grantId>"`；grant 撤销/过期/重启后，`McpAccess.live` 语义在本机 grant 上复刻（bootId 绑定），既有 binding 行保留但不再被任何活体 grant 解析——满足"撤销/重启/过期失效且不泄密"。

### 4.3 本机 caller grant（LocalGrant）

在既有 `mcp/grant/*` 之外新增独立记录类型（不复用远端 grant 结构，避免 peers 字段语义混淆）：

```text
local_grant = {
  id: uuid, secretHash: sha256, bootId,
  targets: ["local/<agentId>", …],        // 显式枚举，≤16；每项必须对应当前导出 Agent
  workspaces: [alias, …],                 // ≤16，必须与目标 Agent 的导出 alias 相交
  lifetimeSeconds ≤ 86400, expiresAt, revoked,
  delegationBudget: { maxDepth ≤ 4, maxConcurrentTasks ≤ 16 }   // 不超既有全局预算
}
```

- 签发只走既有管理员 `/command`（admin token、loopback），新 admin 命令如 `mcp-local-grant` / `mcp-local-revoke`；**不**新增监听端口。
- 认证复用 `mcp.<id>.<secret>` token 形式与 timingSafeEqual 校验；`/mcp/command` 入口已按 `x-lam-node` 与 Bearer 分流（index.ts L149-153），本机 grant 在同一入口按记录类型分流到本机 dispatch。
- 每 caller 独立速率/并发计数（复刻 mcp-access.ts L207-212 的 240/min、16 in-flight），caller 间不共享额度。

### 4.4 Local Dispatcher（路由与 admission）

新增模块（未来 `packages/local-dispatch`，本 RFC 不实现）在 `Gateway` 内与 `Router` 并列：

```text
MCP ingress (authenticated local grant)
  → LocalDispatcher.dispatch(grant, tool, input)
      1. TargetRef 解析：{kind:"local"} → sessions.requireAvailable(agentId, caps)（本地注册表，非 remoteAgents）
      2. 授权：grant.targets 包含 local/<agentId> 且 workspaceAlias 在交集内；否则 permission_denied
      3. 循环/深度：构造 callerChain = [grantId, …上游 chain]；目标 Agent 若就是 caller 自身所在的 Harness 身份 → 拒绝自呼叫；
         chain 长度 > grant.delegationBudget.maxDepth → permission_denied（先验阻断，不靠模型自觉；ADR0005 §3.4）
      4. 预算：deadline ≤ now+5min、session/task/event 容量、会话 busy 检查——与 router.ts L105-112 逐项对齐
      5. 持久提交（任何 adapter 副作用之前）：
         - session.create 类：messages 键 `local-op/<grantId>/<idempotencyKey>`，先写 {fingerprint} 预留，成功后再补 response（语义对齐 router.ts L76-95）
         - task.request 类：store.acceptTask(taskId, "local/<grantId>", key, input) —— 同一张 tasks 表、同一 UNIQUE 约束、同一冲突语义
      6. 执行：复用与 Router.execute 等价的状态机（RUNNING 先提交、permission 事件默认 deny、无终态则 UNKNOWN、异常则 UNKNOWN 不重放）
      7. 事件游标：mesh_get_task 类读取按主体过滤（task.peer === "local/<grantId>"），游标语义不变
```

- **不**复用 `Router.receive`：它以 Noise peer 身份为信任根（router.ts L70-71），本机没有 Noise 连接；强行复用必然要求伪造 peer——这正是被禁止的路径。共享的是 `Store`、`Sessions`、状态机与预算常量，不是 peer 身份假设。
- cancel：`task.cancel` 要求 `task.peer === "local/<grantId>"`（他人任务 not_found）；`cancelRequested ≠ native cancelled`，终态只来自 adapter 事件流（对齐 router.ts L131-142 与 ADR0005 §3.5）。
- UNKNOWN：ACK 丢失/流无终态/崩溃恢复一律落 `UNKNOWN`，响应文案保留"不得用新键重发"；同原请求只引用原 taskId。

### 4.5 本机可见 Registry

- `mesh_list_agents` 对本机 caller 返回 **`sessions.exported()` ∩ grant.targets ∩ grant.workspaces** 的投影（而非 `remoteAgents()`），附 `target: {kind:"local"}`；离线/未导出/超范围一律不出现（不泄露存在性）。
- `mesh_list_sessions` 只列 `owner === "local/<grantId>"` 的绑定（与 mcp-access.ts L265-285 的 per-grant 过滤同构）。
- 注册表刷新的 probe/liveness 语义沿用 sessions.ts（1s 超时、kind 漂移下线），不因本机而豁免。

## 5. MCP API 迁移路径

| 现状（v1，保持不变） | v2（新增，与本 RFC 同 flag 交付） |
|---|---|
| `mesh_start_session{peerId, agentId, workspaceAlias, requestId}` | `mesh_start_session_v2{target: TargetRef, agentId, workspaceAlias, requestId}` |
| `mesh_list_agents{peerId?}` | `mesh_list_agents_v2{target?: TargetRef}`（省略时按 grant 类型给默认视图：远端 grant→其 peers 视图；本机 grant→其 targets 视图） |
| 其余五工具不带 peerId，按 grant 所有权过滤 | 不变，所有权主体泛化为 §4.2 的 Principal |

- v1 工具对远端 grant 行为**逐字节不变**；v1 输入对本机 grant 直接 `unsupported`（无 peerId 可寻址），强制使用 v2。无静默重解释。
- `mcp-contract` 的 `MCP_INPUTS` 以 additive 方式增加 v2 schema；旧工具 schema 字段一字不改。
- Credential schema（`CredentialSchema`）不变；`gatewayNodeId` 仍绑定本节点 id。

## 6. 存储与回退

- **Schema**：无破坏性变更。`tasks/sessions/messages/approvals/inbox/outbox/audit_events` 全部沿用；本机行只是新主体串与新消息键前缀（`local-op/`、`mcp/local-grant/`）。`PRAGMA user_version` 保持 1；若实现期选择为 local grant 建独立表，则 `user_version=2` 的迁移必须纯 additive（旧版本打开即按既有"schema 较新则拒绝启动"策略 fail-closed，storage L37-40，属可接受回退语义）。
- **Feature flag**：`enableLocalDispatch`（默认 `false`）。flag 关闭时：不注册本机工具变体、不创建任何 local 记录、控制面行为与端口与基线一致（验收以既有四组 CI + 端口行为对照证明）。
- **回退**：关闭 flag 即停用；已有本机行保留可读、状态诚实（UNKNOWN 不被改写）；撤销全部 local grant 即可吊销全部本机凭据；不触碰 P1 wire、Noise/Yamux、G2 Windows 私有存储（ADR0005 §3.8、§7）。

## 7. 威胁模型与安全边界

1. **同 OS 用户 ≠ 进程隔离**（ADR0005 §3.2）：同用户恶意进程可能读到其它进程的同用户文件/环境。本设计的 grant token 不提供对**恶意同用户进程**的防护；需要的是 #69 对照 SHADI 的进程隔离/文件 ACL/工具沙箱，属于后续独立工作。本 RFC 的防护对象是**拿到或不拿到 token 的 MCP caller**，不是 OS 级对手。
2. **Token 卫生**：token 只在签发响应与控制面 `control.json`（0o600）出现；日志/审计只记 grantId，不记 secret（对齐 mcp-access.ts L112 只存 secretHash 的现状）；测试报告不得含真实口令。
3. **loopback-only**：不新增任何监听；`Origin` 拒绝、64KB、超时等 HTTP 边界不变。mDNS 对本机路径非必需且默认关。
4. **权限上限**：Gateway grant 是上限，不放大 native 权限；permission 事件在本机路径同样默认 deny（effectiveAuthority 交集原则，ADR0004 §3）。
5. **跨 caller 隔离负例**（实现期必须进测试）：A 不可见/不可操作 B 的 agent/session/task；伪造 grantId、过期、撤销、跨 bootId、指纹冲突、`local/` 主体注入 `peerId` 字段、深度超限、自呼叫、预算超限——逐条 fail-closed。
6. **审计**：grant 签发/撤销、每次 admission 决策、每次冲突/拒绝进 `audit_events`（subject 不含 secret、真实路径、原生会话全文）。

### 7.4（扩展点，非本 RFC 承诺） LHI-5 协作原语如需 ask/reply/claim/wake，应在本主体模型上增加显式 inbox/lease 记录类型；本 RFC 不定义其语义，仅保证主体与所有权模型不阻碍其后续 additive 落地。

## 8. 前置门与当前阻塞状态（如实）

| 前置 | 状态（2026-11-02 核验） | 对本 RFC 的影响 |
|---|---|---|
| LHI-0 #79 研究 | PR #89 已合入 main | 满足（设计输入） |
| LHI-1 #80 ZCode outbound | PR #90 已合入 main | 满足（背景证据） |
| LHI-2 #81 ZCode Adapter | PR #92 OPEN，CI 8/8，**未经独立复审** | 本 RFC 不引用其代码；native 接入仍阻塞 |
| LHI-3 #82 双向 | PR #96 OPEN，总体 **PARTIAL**（C1 BLOCKED、C2 执行链 BLOCKED_NEEDS_USER_AUTH） | **Mock PoC 前置不满足**：#83 原文要求"实现原型依赖 LHI-3 至少有完整双 Gateway 对照基线" |
| #74 MCP scoped auth 负例 | **OPEN** | Mock PoC 前置不满足（"#74/#75 无未解决阻断"） |
| #75 恢复不变式 | CLOSED | 满足 |
| 本 RFC 设计审查 | 本 PR | 未过审查不建 `packages/local-dispatch` |

**结论**：本次只交付 RFC；Mock-only 原型在 (a) 本 RFC 审查通过、(b) #82 达成完整双 Gateway 基线、(c) #74 关闭 三者齐备前 **BLOCKED**，不预先写实现代码占位。

## 9. 契约测试矩阵（第二切片的验收规约，本文仅定义）

| # | 用例 | 预期 |
|---|---|---|
| T1 | 两个本机 grant 各自 list/start/send/get/cancel | 互不可见，越权一律 not_found/permission_denied |
| T2 | 撤销/过期/重启后使用旧 token | permission_denied；既有 task/session 状态不被篡改 |
| T3 | 同 requestId 同指纹重试 | 返回原 taskId，无新副作用 |
| T4 | 同 requestId 不同指纹 | conflict，无新副作用 |
| T5 | 提交后丢 ACK（注入） | UNKNOWN；客户端用原参数重试仍回原 task；无自动重放 |
| T6 | cancel 请求即时返回 | cancelRequested=true 但非终态；终态只能来自事件流 |
| T7 | 本机调用伪造 `target.kind="remote", peerId=<本机nodeId>` / 伪造 `local/` 主体 / 自呼叫 / 深度 5 | 全部 permission_denied |
| T8 | flag OFF | 全部既有测试与端口行为不变；无 `local-*` 记录 |
| T9 | 崩溃恢复 | 本机 QUEUED/RUNNING/WAITING_INPUT → UNKNOWN（同表现有 recover 语义） |
| T10 | 容量：session 101、task 1001、events 4097、rate 241/min | busy，且不产生部分副作用 |
| T11 | permission 事件 | 默认 deny + 审计；无自批准路径 |
| T12 | 旧 v1 工具 + 本机 grant | unsupported（不静默解释 peerId） |

## 10. 未决问题（review 时逐项裁决）

1. `local/<grantId>` 主体串直接复用 `tasks.peer` 列 vs. 迁移新增 `principal` 列（前者零迁移、后者更显式；本 RFC 倾向前者）。
2. v2 工具命名（`_v2` 后缀 vs. 同工具内 union 输入的向后兼容解析）——需对照 #74 进行中的 scoped-auth 测试口径。
3. 本机 grant 是否允许跨重启持久（现状 bootId 绑定 = 重启即失效；对长驻本机 caller 是否过严，需安全权衡）。
4. callerChain 的持久化粒度（记入 tasks.input 供审计 vs. 仅内存）——崩溃恢复后链信息缺失是否可接受。

## 11. 回退与影响面声明

- 本 PR：仅新增本文档，0 行 runtime 变更；回退 = 关闭 PR。
- 未来实现 PR：独立 `packages/local-dispatch` + additive 存储/契约变更 + flag 默认 OFF；回退 = 关 flag + 撤销 local grants，既有 P1/P2/A2A/G2 行为不变。
