# Dual-gateway evidence（LHI-3 运行原始证据索引）

结论与判读见 [DUAL_GATEWAY_ACCEPTANCE](../../DUAL_GATEWAY_ACCEPTANCE.md)。runner：`scripts/lhi-codex-zcode-e2e.mjs`（`--self-test` = 无 native 的确定性全链基线；`--native` = 追加 C2 尝试）。

## 运行记录（darwin arm64 / Node v22.23.2 / main `b09b28cc`）

| 运行 | 时间（UTC） | 模式 | 结果 | 证据 | sha256 |
|---|---|---|---|---|---|
| st1–st5 | 2026-10-27 ~01:0x | self-test | FAIL（runner 自身缺陷迭代：waitUntil 对 async 谓词失效、无参命令须传 `{}`、过期凭据在 CLI 启动层被拒导致 connect 抛错在 try 外、cancel 测试编排错误——目标任务因 busy 从未被接纳，`not_found` 是正确语义） | 未归档（保留于本表教训） | — |
| nat1–nat8 | 2026-10-27 ~01:3x–02:0x | native | C2 调试迭代（codex 绝对路径、adapterFactories 需显式 exportAgents、双层转义正则、plan 模式拒非只读工具的发现） | 未归档 | — |
| **st-final（归档）** | 2026-10-27 ~02:10 | self-test | **PASS 19/19 门**：双 Gateway Noise 测试配对、scoped grant、官方 MCP SDK 客户端经真实 mcp-server 桥的全链基线、两轮任务、幂等重试单一执行、在途取消 CANCELLED、receiver 失联→UNKNOWN 不重放、7 项安全负例 + HTTP 层过期拒绝 + caller 重启旧 token 拒绝、锁释放与目录删除 | [lhi3-selftest-darwin-20261027T0235Z.json](lhi3-selftest-darwin-20261027T0235Z.json) | `021e0f95627524e1d1ac96d60af5f71cb33fe833a7c3223a320da5c8d6f1ece8` |
| **native-final（归档）** | 2026-10-27 ~02:05 | native（含 self-test 全部 19 门 + C2） | 门 19/19 PASS；**C2 双链评级**：`readOnlyNativeChain: VERIFIED`（ZCode 原生 `mesh_list_agents` → 桥 → 双 Gateway → CodexAdapter 注册表，真实 agent 数据回流 ZCode 模型上下文）+ `executionChain: BLOCKED_NEEDS_USER_AUTH`（plan 模式拒非只读工具；build 需 allow，夜间包不授予） | [lhi3-native-darwin-20261027T0240Z.json](lhi3-native-darwin-20261027T0240Z.json) | `f8d23e87c86d56f521316446569b55449456f870ec5d2812a755b41102bb56b0` |

归档时 runner SHA-256（lint 修复后最终代码）：`37434a6083330ff5917b42873b417ac28c13e51db3a45ba8ea1256dfd616bf5a`；self-test 证据 `021e0f95…`、native 证据 `f8d23e87…`（完整哈希见 shasum 输出/RESULT）。
证据脱敏：临时目录路径 → `<disposable-root>`；grant token → `mcp.<grantId>.<redacted-secret>`。

## C1（Codex caller → ZCode receiver）

**BLOCKED**：PR #92（ZcodeAdapter）截至本归档仍 OPEN、修复已推（head `7209be1`）但**无独立复审**——夜间包 §2C 门明确要求复审通过才可启用 receiver native。未引用/未复制其任何代码。

## C2 关键证据摘录（native-final）

- fixture 步骤追踪：`mcp__lam-mesh__mesh_list_agents` 真实调用 → 工具结果含 `12D3KooW…/codex/default`（capabilities 全 supported）→ fixture 据此发起 `mesh_start_session`（peerId/agentId 提取自真实结果）→ ZCode 返回 `Plan mode only allows read-only, non-destructive tools` → 按工作包规则收敛为 BLOCKED_NEEDS_USER_AUTH。
- caller 侧审计：`mcp.grant.created`；外部模型请求 0（全部 loopback 定值推理）。
- receiverTasks: 0（无任务抵达 Codex 执行——与执行链 BLOCKED 一致）。

## 观察项（如实记录，未改生产代码）

1. **busy 拒绝在 MCP 层表现为 delivery UNKNOWN**：接收方 adapter 明确 `busy` 拒绝（会话已有活跃 turn）与网络失败同样落入 `McpAccess` 的 UNKNOWN 分支，调用方无法区分。合成基线中复现（send2 delivery UNKNOWN + 无法 cancel 未接纳任务）。如需语义区分应另开 issue 讨论（本 PR 不改共享代码）。
2. **adapterFactories 注册的 agent 不自动 export**：仅 mock 自动加入 exported 集合；工厂适配器需显式 `exportAgents`（公开选项）。已在验收文档记录。
3. ZCode plan 模式对非只读 MCP 工具的拒绝是**静默**的（工具结果错误文本，无原生权限请求）；build 模式才会询问（与 LHI-2 结论一致）。
