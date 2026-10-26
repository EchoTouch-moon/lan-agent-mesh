# ADR 0004 — 标准优先的互操作架构与渐进吸收（2026-10-26）

- **状态**：Accepted for planning / implementation gated（接受路线作为研发指导；**不**代表任何外部组件已经安全可用或具备合并许可）。
- **基线**：`main@817ea9898b16bbd532cd3bbfcf86439cb7032397`（此次调整前）。P2 组合实现由 PR #63 合入 `0f2f38af`，四个平台/版本 CI 通过。保留 #15 两轮不同源码 SHA 的 W3 历史缺口、#17/#18 本机 Native fixture 证据与 #19 跨实体 Harness 待验收。
- **决策范围**：未来跨系统交互与研究路线。不得在本 ADR 中私自修改 P1 wire、Node 身份、受控目录、原生权限或现有数据格式。
- **对应执行**：[研究审查](../research/INTEROP_LANDSCAPE_2026-10-26.md) · [分阶段工程计划](../INTEROP_REBASELINE_2026-10-26.md) · [LLM 执行规范](../LLM_WORK_PACKETS.md) · [实验矩阵](../research/INTEROP_EVALUATION.md)。

## 1. 问题

此前 roadmap 将 A2A 视为 P5 附加项，而 P1/P2 已独立实现加密网关、Agent registry、持久任务、MCP 出站与 Gateway-owned Codex/DSH 入站。成熟协议/系统已覆盖一般的 Agent Card、跨系统任务、流式事件与部分 Coding Agent 桥接。继续扩大自定义公共协议将重复生态努力，并制造互操作成本；另一方面，直接以第三方框架替换 Gateway 会破坏已验证的 UNKNOWN 不重放、双端原生所有权、Windows 私有存储安全和源 SHA 证据链。

**新定位**：个人设备、异构 Harness 的 local-first interoperability runtime；研究贡献以「执行语义/安全边界/故障恢复」为核心，绝不宣称发明 Agent-to-Agent 或 P2P 本身。

## 2. 决策（目标分层）

1. **北向标准面（新增、默认关闭）**：用官方 A2A v1.0 / `@a2a-js/sdk` 提供经作用域筛选的 Agent Card、Message/Task 与可选 streaming；另保留已基于官方 MCP v2.4.0 `@modelcontextprotocol/server/client` 的现有七个 `mesh_*` 工具。A2A 面向外部 Agent API，MCP 面向本机 Harness 的工具调用。两者不是互相替代，也不得彼此旁路 Gateway Policy。
2. **核心领域层（保留）**：Node/Peer/Agent/Session/Task 领域模型、身份互信、Session/native ID 隔离、SQLite durable inbox/outbox、UNKNOWN 与事件游标、调用授权。Native 会话和工具副作用的最终权威在**执行节点**。
3. **南向执行面（保留可替换）**：Codex App Server、DSH ACP 等 HarnessAdapter，使用 Gateway-owned 全新隔离会话。与自带账号/GUI 对话隔离，ACP 入站不能证明出站 MCP，默认拒绝 Native permission。
4. **下层网络（暂不迁移）**：维持现有 libp2p TCP/Noise/Yamux、mDNS/手动地址和本机私有 IPC；先建立接口抽象及度量基线，再决定是否对照 SLIM。外部目录如 AGNTCY Directory/ANP 仅作**可选联邦目录适配**，不能取代局域网 pairing。
5. **安全与沙箱（研究后再采用）**：比较 SHADI 的 OS sandbox、凭据闸门与 AgentBridge。是否引入必须以 Mac/Windows 实验、许可证/供应链、安全审计、工具限制及回退方案为准。不能仅凭项目 README 宣称具有可用的生产级沙箱。

## 3. 核心不变式（任何适配器必须遵守）

- `effectiveAuthority = gatewayScopedGrant ∩ receivingNativeHarnessPermission ∩ OSProcessPrivilege ∩ explicitHumanConsent(if required)`。**任何接入不得放大权限**；第三方 Agent Card 不等于信任或授权。
- 网络发现 ≠ 身份确认 ≠ 能力可见 ≠ 运行许可。未经双方实体确认的 Peer/Token 不可查看私有卡片、会话或执行任务。A2A Server 默认 **loopback-only、disabled**；跨 LAN 显式启用仍需认证并走 Gateway policy。不得无意将 HTTP 公开到 0.0.0.0。
- 保持 Node、Gateway Session、Adapter Session、Native Session、A2A context/task 的**命名空间分离**，使用持久、受约束、可撤销的映射；不得回传真实本机路径、原生 thread ID、密钥、IP、完整私有日志。
- A2A `message/send` 规范的幂等性是 MAY，而现有 LAM 对相同原 envelope 提供更强本机去重。Bridge 必须限定键作用域（认证主体/远端 peer/agent/session + messageId 或独立 key + 输入指纹），原始 deadline 不延长；持久提交发生于 native 执行前，冲突返回结构化拒绝，不能通过重发“修复”UNKNOWN。
- **UNKNOWN 不得当作 A2A completed/failed/canceled/rejected。** 原生结果不确定时只可用规范允许的非终态表示，并附**明确私有/扩展的 uncertainty 元数据**（仅在版本确认/无泄漏的前提下）。若无法保证客户端不误读状态，应拒绝此能力/返回非终态的查询和受控错误；扩展使用是否合规需先做协议审查。不能擅自发明一个“标准 UNKNOWN 状态”。
- `CancelTask` 请求被接收 ≠ native 已完成取消。只有 native 终态 + durable event 确认后可对外标记 canceled；竞态完成与未知结果必须真实保留。流式事件应从 durable cursor 读取，限制 replay、队列和断线恢复；先规范分析再编码。
- Adapter 版本、二进制 hash、private home 和 G2 Windows owner/DACL/祖先检查不受北向协议影响。业务日志保持脱敏；未审阅的远端文本是数据，非权限或系统指令。

## 4. A2A 兼容边界：拟议映射（尚未宣称实现）

| 外部对象/操作 | 内部源 | 正常语义 | 禁止的快捷方式 |
|---|---|---|---|
| Agent Card | Scoped AgentRegistry | 仅授权客户端可见的 capability + 不暴露原生路径 | 公开整个发现缓存/隐式开放远端 agent |
| Agent Card identity | Gateway 对外投影 ID | 稳定映射经授权的 Agent，独立于 Node 的内部 peer ID | 对外泄露 Native ID |
| message/send | scoped SessionManager + TaskRouter | 预提交映射与请求 fingerprint，之后 native dispatch | 先 dispatch 后保存 idempotency |
| taskId/contextId | Bridge-owned durable ID map | 双向查找需验证 caller/agent/scope/expiry | 把内部原生 ID 直接当公开 ID |
| GetTask/ListTasks | owner-filtered task view | read-only / bounded / filtered，UNKNOWN 采用受约束视图 | 把 UNKNOWN 伪装成失败 |
| SendStreaming/Subscribe | durable event cursor | 单调事件顺序、断线恢复、界限 | 无边界转发原生 stdout/stderr |
| CancelTask | native cancel + final event | 仅确认的 terminal canceled | 发送 cancel 命令立即返回 canceled |
| Extended Card / Push | 无现成安全实现 | **v0 明确 unsupported**，需要单独 threat model | 任意 webhook SSRF 或私有卡泄露 |
| A2A authentication | 独立入口和 scoped grant | 身份认证与 per-agent 授权相互独立 | 仅靠 Card URL/Token 出处即信任 |

优先 A2A v1.0 JSON-RPC/HTTP 的单一经审查入口；不为追求功能列表同时开放 REST、gRPC、push 与公网路由。正式协议状态和扩展字段必须用 [A2A v1.0 specification](https://a2a-protocol.org/v1.0.0/specification/) 和所选 SDK 的固定 tag 检查；不得按本 ADR 表格代替规范。

## 5. 为什么不直接替换底层或复用所有框架

- **A2A** 定义可互操作的应用协议，不代替我们的 Node pairing、OS 沙箱、持久 native 会话权威。
- **MCP** 是受控 Agent 可调用本地工具的接口，不提供全局 Agent 发现/远程原生控制/任意 GUI 唤醒。
- **SLIM** 具备额外 data/session/control plane，引入可能增加运行依赖与部署条件，先做独立 spike，不动 P1。
- **Directory/ANP** 适合可选跨网络联邦；当前本地优先、无需中心组件是基础验收要求。初期不得新增必须登录/注册的依赖。
- **SHADI/AgentBridge、AgentLink、OpenAgents/AgentTorrent** 提供安全/交互/架构参考或 benchmark；不能把竞品现成 Demo 当成我们已满足相同威胁模型的证据。

## 6. 反对方案与拒绝理由

- 「整体改用 A2A 替代自定义 wire」：无法自动保持原生幂等/未知状态/人类 pairing 的语义，风险高。
- 「引入 SLIM 当唯一传输」：目前无相对 Noise/Yamux 的客观改善证据，且会扩大维护面。
- 「完整采纳 AgentBridge/SHADI 后删除 Adapter」：跨平台隔离、原生取消/恢复、失效模型和固定版本支持需先验证。
- 「优先做 UI/多 Agent 群聊」：会绕开尚未关闭的 #19 实体验收与统一权限边界。
- 「即刻把 #32 P5 A2A 做完」：应该提升优先级，但以**小型 optional bridge + conformance** 逐步实施，而非一次性大重写。

## 7. 分步迁移、回退与升级门

- **R0**：源代码/协议/许可证/安全矩阵审查，固定外部 tag/commit 和 SDK 版本，记录 Decision/Unknown。
- **R1**：A2A read-only scoped Agent Card + Mock-only API、被拒绝访问负例。默认 disabled、loopback、独立模块和新包；P1/P2 原程序行为必须字节/测试等价。
- **R2**：A2A Task/Session 映射 + durable 事件/UNKNOWN/cancel 契约，仍由 Mock 与 synthetic harness 验证；第三方官方客户端的 conformance，不带真实模型。
- **R3**：继续 #19 Mac/Win native fixture、受控跨机双端验证；同源实验必须在新窗口双方用户到场。安全研究支线对照 SHADI，不把能力验证等于集成。
- **R4**：比较已有网络 vs 可选 SLIM/Directory；如没有测得收益则保持 defer。
- **Rollback**：关闭 `enableA2A` feature flag / 停止 bridge 进程、撤销 bridge-issued grants；不改变 P1 wire 和 SQLite schema 的现有读者，任何新映射做 additive migration 并可完整忽略/回滚。保留全部原始失败/unknown 和 testedSource SHA。

**任何生产公开 A2A 端点、长期凭据、OS 配置修改、真实模型、GUI attach、统一批准功能均需要单独安全评审与用户明确授权。**

## 8. 成功判定与研究边界

工程上：标准 A2A 客户端在隔离测试中经合法 scoped auth 发现/调用 Mock；拒绝/撤销不泄漏；跨重启同 key 无副作用重放；pending UNKNOWN/取消语义不撒谎；Mac/Win 四组 CI 不退化。研究上：清楚地比较已有项目，提出可重复测量的异构 Harness 语义一致性与权限实验；若第三方已实现同样能力，承认已有成果并通过插件复用。

**源**：A2A v1.0 https://a2a-protocol.org/v1.0.0/specification/ · JS SDK https://github.com/a2aproject/a2a-js · MCP SDK https://github.com/modelcontextprotocol/typescript-sdk · SLIM https://github.com/agntcy/slim · Directory https://github.com/agntcy/dir · SHADI https://github.com/agntcy/shadi · AgentLink https://github.com/Oryntai/AgentLink
