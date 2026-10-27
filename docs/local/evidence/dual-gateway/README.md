# Dual-gateway evidence（LHI-3 运行原始证据索引）

结论与判读见 [DUAL_GATEWAY_ACCEPTANCE](../../DUAL_GATEWAY_ACCEPTANCE.md)。runner：`scripts/lhi-codex-zcode-e2e.mjs`（`--self-test` = 无 native 的确定性全链基线；`--native` = 追加 C2 尝试）。

## 运行记录（darwin arm64 / Node v22.23.2 / main `b09b28cc`）

| 运行 | 时间（UTC） | 模式 | 结果 | 证据 | sha256 |
|---|---|---|---|---|---|
| st1–st5 | 2026-10-27 ~01:0x | self-test | FAIL（runner 自身缺陷迭代：waitUntil 对 async 谓词失效、无参命令须传 `{}`、过期凭据在 CLI 启动层被拒导致 connect 抛错在 try 外、cancel 测试编排错误——目标任务因 busy 从未被接纳，`not_found` 是正确语义） | 未归档（保留于本表教训） | — |
| nat1–nat8 | 2026-10-27 ~01:3x–02:0x | native | C2 调试迭代（codex 绝对路径、adapterFactories 需显式 exportAgents、双层转义正则、plan 模式拒非只读工具的发现） | 未归档 | — |
| **st-final（归档）** | 2026-10-27 ~02:10 | self-test | **PASS 19/19 门**：双 Gateway Noise 测试配对、scoped grant、官方 MCP SDK 客户端经真实 mcp-server 桥的全链基线、两轮任务、幂等重试单一执行、在途取消 CANCELLED、receiver 失联→UNKNOWN 不重放、7 项安全负例 + HTTP 层过期拒绝 + caller 重启旧 token 拒绝、锁释放与目录删除 | [lhi3-selftest-darwin-20261027T0235Z.json](lhi3-selftest-darwin-20261027T0235Z.json) | `021e0f95627524e1d1ac96d60af5f71cb33fe833a7c3223a320da5c8d6f1ece8` |
| **native-final（归档）** | 2026-10-27 ~02:05 | native（含 self-test 全部 19 门 + C2） | 门 19/19 PASS；**C2 双链评级**：`readOnlyNativeChain: VERIFIED`（ZCode 原生 `mesh_list_agents` → 桥 → 双 Gateway → CodexAdapter 注册表，真实 agent 数据回流 ZCode 模型上下文）+ `executionChain: BLOCKED_NEEDS_USER_AUTH`（plan 模式拒非只读工具；build 需 allow，夜间包不授予） | [lhi3-native-darwin-20261027T0240Z.json](lhi3-native-darwin-20261027T0240Z.json) | `f8d23e87c86d56f521316446569b55449456f870ec5d2812a755b41102bb56b0` |
| st-r2 | 2026-10-26 18:38 UTC | self-test | **PASS 20/20 门（exit 0，`baselineVerdict:PASS`，`overallLhi3Verdict:NOT-RUN`）**。复审修复后新增 `B-list-sessions-owned`（mesh_list_sessions 实际驱动、恰只列本 grant 会话）；清理证据升级为独立 owned-process 扫描（pgrep/powershell，0 存活）+ caller HTTP 端口释放核查 | [lhi3-selftest-darwin-20261026T1838Z.json](lhi3-selftest-darwin-20261026T1838Z.json) | `1e28e969db82ce361029f91002e70e305fa8ef7a3aa08924e73b9223b0129a2e` |
| native-r2 | 2026-10-26 18:38 UTC | native | **exit 2（预期性部分报告）；`baselineVerdict:PASS`（20/20 门）+ `overallLhi3Verdict:PARTIAL`，顶层 `verdict:INCOMPLETE`——不再以总 PASS 掩盖 C1/C2 未完成**。C2 启动前预检：实际 `--version` 输出 `'0.17.0'` 且 sha256 与 HARNESS_MATRIX 批准 pin 逐字节一致（`sha256Pinned:true`），任一不匹配即 BLOCKED 不启动 app-server。C2 清理证据：bridge 子进程存活被独立扫描捕获 → 3s 宽限 → 每 PID 归属复核后 SIGTERM → 复扫 PASS（观察 4）；fixture 双端口释放。C2 双链评级与 native-final 相同（readOnly VERIFIED / execution BLOCKED_NEEDS_USER_AUTH） | [lhi3-native-darwin-20261026T1838Z.json](lhi3-native-darwin-20261026T1838Z.json) | `62f0f3a9b09ba41e0391f92174429d22b49ed2cd568b21c0887cd0a31dad1848` |
| st-r3 | 2026-10-26 18:45 UTC | self-test | **PASS 20/20 门（exit 0，`baselineVerdict:PASS`，`overallLhi3Verdict:NOT-RUN`）**，最终 head 重跑（Windows import 修复后）；内容同 st-r2 | [lhi3-selftest-darwin-20261026T184528Z.json](lhi3-selftest-darwin-20261026T184528Z.json) | `b492025545753df52ce4c3f1cc115882f083371d491dec94c017148548c64d02` |
| native-r3 | 2026-10-26 18:45 UTC | native | **exit 2（预期性部分报告）；`baselineVerdict:PASS`（20/20 门）+ `overallLhi3Verdict:PARTIAL`，顶层 `verdict:INCOMPLETE`**，最终 head 重跑；C2 预检实测 `--version '0.17.0'` + sha256 与批准 pin 一致；C2 清理：bridge 孤儿子进程 → 3s 宽限 → 归属复核 SIGTERM → 复扫 PASS；fixture 双端口释放；双链评级同 native-final（readOnly VERIFIED / execution BLOCKED_NEEDS_USER_AUTH） | [lhi3-native-darwin-20261026T184528Z.json](lhi3-native-darwin-20261026T184528Z.json) | `be3a51a2ff08492259d945875056f1b42f1d7c1887a8d965ae50dc9cb669445a` |
| **st-r4（当前归档）** | 2026-10-27 03:17 UTC | self-test | **PASS 20/20 门（exit 0）**；复审二轮修复后最终 head 重跑（评级门 + 脱敏修复），报告零本机绝对路径 | [lhi3-selftest-darwin-20261027T0317Z.json](lhi3-selftest-darwin-20261027T0317Z.json) | `5a64f7f6bc65a11f3e515e78f83d2ea28093f6297e09933bf54abe0fa268413e` |
| **native-r4（当前归档）** | 2026-10-27 03:17 UTC | native | **exit 2；baseline PASS（20/20）+ overall PARTIAL**（C2 readOnly VERIFIED 为真实工具证据，故 PARTIAL 成立）；SIGTERM 处置命令行完整脱敏（`<repo>` + `<disposable-root>`） | [lhi3-native-darwin-20261027T0317Z.json](lhi3-native-darwin-20261027T0317Z.json) | `d03d5c00892de0ae25fb90896ae0c993c5c71ee4a0a10ec70bfef59ddee09ecf` |
| **negative-noevidence（当前归档）** | 2026-10-27 03:17 UTC | native（`LHI3_NEGATIVE_NO_TOOLS=1`） | **负例验证"启动≠证据"**：真实启动 ZCode 原生进程、推理请求 1 次、但 fixture 不提供任何工具调用 → C2 `BLOCKED`（reason: NO chain has verified native tool-call evidence）、overall `BLOCKED`、exit 2——**不再因启动过原生而评 PARTIAL** | [lhi3-native-noevidence-darwin-20261027T0317Z.json](lhi3-native-noevidence-darwin-20261027T0317Z.json) | `a6613e65cc3a9f0713751fba338393eb9e65edeaede8a383df1ad001db3af192` |

归档时 runner SHA-256：st-final/native-final = `37434a60…`；st-r2/native-r2 = `447a020c…`（head `461daf6`；随后其挂入 CI 的 Windows leg 暴露 runner 预存缺陷——动态 `import(绝对路径)` 在 Windows 抛 `ERR_UNSUPPORTED_ESM_URL_SCHEME`，已改 `pathToFileURL`）；st-r3/native-r3 = `6ad9ee50…`（head `0b21be2`）；st-r4/native-r4/negative（当前归档，复审二轮最终 head）= `6984ead993b6b7049c170edac742c53c4228463f4ff993b4d0eadd5e283494c8`。
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
4. **（native-r2 新观察）ZCode app-server 派生的 stdio MCP bridge 子进程在父进程被 SIGKILL 后仍存活 >10s**（实测 3s 宽限内未退出，`ps` 明细：`node mcp-server/dist/cli.js --credentials <disposable-root>/…`，孤儿化后靠自身逻辑延迟退出）。runner 现按合同 §2E 处置：3s 宽限 → 每 PID 重新读取命令行确认仍归属本 run root（防 PID 复用误杀）→ SIGTERM → 复扫验证 → 仍存活则 SIGKILL。全处置链记录于 `cleanup.ownedProcessScan.log`。生产含义（不在本 PR 修）：mcp-server CLI 在 stdin EOF 后的退出路径值得单独审计。

**归档后脱敏更正（2026-10-27 03:2x UTC，如实记录）**：复审发现 native-r2/native-r3 的 SIGTERM 处置命令行含未脱敏的仓库工作树绝对路径（bridge 子进程 argv 携带；runner 当时只替换了 disposable root）。已对这两个**已归档**文件就地执行且仅执行 `worktree 路径 → <repo>` 替换；其余内容未动（两文件各 1 处）。runner 已修复（先替换后截断，防截断破坏替换），st-r4/native-r4 起报告经全量扫描确认零本机绝对路径。
