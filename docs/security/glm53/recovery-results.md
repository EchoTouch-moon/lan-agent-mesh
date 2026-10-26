# G-R1 交付报告：durable 账本与 Router 崩溃一致性 / UNKNOWN 不重放回归（2026-10-26）

**taskId:** G-R1 · **Issue:** [#75](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/75) · **执行等级:** synthetic（本机临时目录 + 进程内 fixture，无网络、无真实模型）
**modelClaimed:** GLM-5.3（操作者记录；GitHub 身份无法证明底层模型）
**修改范围:** test-only + 本报告。仅新增 [packages/storage/test/glm53-ledger-invariants.test.ts](../../../packages/storage/test/glm53-ledger-invariants.test.ts)（24 用例）、[packages/runtime/test/glm53-recovery-invariants.test.ts](../../../packages/runtime/test/glm53-recovery-invariants.test.ts)（10 用例）与本文件；未修改任何生产文件、既有测试或持久化 schema。

## 1. 环境与来源

| 项 | 值 |
|---|---|
| testedSourceSha（生产代码基线） | `0edb77759e89a0b4ed7096193d9285d2c7c83ce5`（origin/main，CLAIM 时固定） |
| Node / pnpm / OS | v22.23.2 / 10.18.3 / macOS 27.0 (26A428) arm64 |
| worktree | 无 tracked 文件改动；untracked 仅上述两个交付测试文件与本机无关的 `.video_agent/` 宿主插件残留（未纳入提交） |
| 随机性 | 无随机种子分支：`randomUUID()` 仅用于协议身份字段；ScriptedAdapter 无定时器，行为全部由测试脚本决定；"崩溃"建模为 Store close → reopen + `recover()` |

## 2. Issue #75 验收场景 → 用例映射

**场景组 1：首次接收 / ACK 丢失 / 缓存过期 / 回执缺失 / 重启 UNKNOWN**

| 验收点 | 用例 |
|---|---|
| 首次接收 + 重复投递恰好一次分发（副作用计数正控 `send` spy =1） | runtime `dispatches a native task exactly once…` |
| ACK 丢失重试得到同一回执 | runtime 同上（`receive` 重放等于首次回复） |
| 缓存回复过期但原请求仍有效 → 只刷新传输字段 | runtime `refreshes only transport fields…` |
| 已提交任务但 inbox 回执丢失 → 重启后重导出回复、零二次分发 | runtime `re-derives the admission reply after a crash lost the inbox receipt…` |
| 重启 RUNNING → UNKNOWN、永不自动重放、会话保守锁定 | runtime `restarts an in-flight task into UNKNOWN…`；storage `recovers %s to UNKNOWN exactly once…`（QUEUED/RUNNING/WAITING_INPUT）×3 |

**场景组 2：幂等 key 冲突矩阵（一 key 一逻辑任务）**

| 验收点 | 用例 |
|---|---|
| 原键+原参数重放 → 幂等命中 | storage `keeps exactly one logical task per (peer,key)…` ×3（改 text/deadline/session 均 conflict）；runtime 重放断言 |
| 原键+变更 deadline / 变更输入 → conflict | storage 同上 + runtime `changed requests`（改 body、改 deadline、同 messageId 改 body） |
| 跨 peer：key 命名空间隔离 / 他人不可复用 | storage `namespaces the same key per peer…`；runtime foreign-peer ×3（permission_denied / conflict / not_found） |
| 重启 UNKNOWN 后同 key 重放仍去重、改参 conflict | storage `still deduplicates the original request after restart-UNKNOWN…` |

**场景组 3：cancel 竞态 / 写入失败 / 容量 / 离线差异**

| 验收点 | 用例 |
|---|---|
| cancel 已请求但 native 未终止 → 不谎报 CANCELLED | runtime `never reports CANCELLED while the native run ignores…`（cancel 挂起 + 迟到 completed 归 COMPLETED） |
| terminal 先完成 → 迟到 cancel 不改写终态 | runtime `keeps a completed task completed…`；storage settled 状态 ×4 不受 recover 影响 |
| Store 写入错误：事务原子性 / 失败回滚 / 连接可用 | storage `rolls back its own transaction…`（undefined payload → TypeError，账本无残留可重试）、`rolls back a receipt written inside a failed transaction` |
| 容量：任务表上限 / 事件预算 4096 / inbox+outbox 各 10000 | storage `enforces the caller-supplied task capacity limit…`、`bounds the durable event log…`、`bounds inbox and outbox retention…`；runtime inbox 满时准入门拒绝但任务仍推进且恰好一次分发 |
| Adapter 离线 vs 在线差异；分发失败 → UNKNOWN | runtime `refuses admission while the adapter probe is offline…`（离线 unsupported、恢复后 QUEUED、send 抛错 → UNKNOWN 且重放不再执行） |
| 事件流无终态 / 事件预算耗尽 → UNKNOWN 而非挂起 | runtime `bounds a chatty adapter…`（≤2049 事件、末事件 unknown、触发 cancel） |
| 出站 lost-ACK 模型（pending/ack/精确重入队不重发） | storage `models a lost ACK…` |

## 3. 命令与退出码（完整历史，不覆盖失败记录）

| # | 命令 | 退出码 | 结果 |
|---|---|---|---|
| 1 | `pnpm vitest run packages/storage/test/glm53-ledger-invariants.test.ts`（前次会话，17:55） | 0 | 24/24 通过 |
| 2 | `pnpm vitest run …glm53-ledger… …glm53-recovery…`（本次整合首跑，20:02） | 1 | 33 通过 / 1 失败：UNKNOWN 用例中"同 key+新 taskId"断言 `conflict`，实际 `busy`（见 F2；前次会话 sed 批量替换破坏了同 key 关联且未复跑即中断） |
| 3 | `pnpm check`（首跑，20:15） | 1 | build+typecheck 通过；lint 失败：runtime 测试文件未使用导入 `Capabilities`（迭代遗留） |
| 4 | `pnpm vitest run …glm53-ledger… …glm53-recovery…`（修正断言后，20:13） | 0 | 34/34 通过 |
| 5 | `pnpm check`（修复 lint 后复跑，20:16） | 0 | build + typecheck + lint + vitest 全绿：20 文件、141 通过 / 4 skip（skip 均为既有：private-storage ×3、dsh-adapter ×1，与本任务无关） |

## 4. 发现（suspected findings；均未在本 PR 内修复，按首轮 test-only 规则单独立案）

**F1（storage，已编码为防回归用例）：同 messageId 被第二 peer 占用时 `receipt()` 抛裸 SQLite 约束错误而非语义 MeshError。**
`store.receipt('msg-1','peer-b',…)` 命中 inbox 主键冲突时向上抛出原始 constraint error（非 `MeshError` 编码）。行为 fail-closed、无伪造回复可能（见用例 `fails closed when a foreign peer occupies the same message id`：原 peer 回执仍权威），但错误码不具备语义、调用方无法稳定分类。建议修复方向：`receipt()` 捕获唯一约束冲突并映射为 `MeshError('conflict', …)`。属兼容性收紧，需单独 Issue/PR 评审。

**F2（runtime，已以注释+断言固化观测）：会话级 busy 准入门先于账本 (peer,key) 冲突检查，UNKNOWN 占用期间 `conflict` 诊断被遮蔽为 `busy`。**
会话被 UNKNOWN 任务保守持有时，携带已绑定 key 的新 taskId 信封在 `Router.receive` 的 session-busy 门（`router.ts` admission）即被拒（`busy`），永远到不了 `acceptTask` 的 (peer,key) fingerprint 冲突检查（`conflict`）。**恰好一次不变式不受影响**（拒绝 + 零副作用 + 不产生第二逻辑任务），差异仅在诊断粒度；同 taskId 路径因跳过该门仍能返回 `conflict`（已覆盖断言）。建议修复方向：busy 门之前先查询 (peer,key) 绑定或将其并入 `acceptTask` 统一裁决。需单独 Issue/PR 评审，不在本 test-only PR 内改生产行为。

两项均标注 **suspected finding（行为/诊断层）**，非已确认安全漏洞；未发现可导致重复执行、越权或 UNKNOWN 被改写为完成的路径。

## 5. 未验证项（NOT-RUN / UNKNOWN）

- GitHub CI 四链路：PR 推送后由平台执行，结果以 PR 检查为准（本报告仅含本机 `pnpm check`）。
- Windows 侧行为：ownerSide 标 cross-platform，但本轮仅在 macOS 本机执行；未做 Windows CI 复核。
- 真实进程级故障注入：崩溃建模为 Store 干净 close→reopen（WAL + synchronous=FULL 下等价于已提交前缀），未做 SIGKILL 中途写注入。
- 未涉及任何真实 Harness 二进制、真实模型调用、网络监听或跨实体实验（round 为 isolated synthetic）。

## 6. 回归、回退与清理

- **regressions:** 无。`pnpm check` 全量通过（141/141 可运行用例），既有 4 个 skip 为历史遗留，非本 PR 引入。
- **rollback:** 纯新增测试与文档，无生产/ schema / 行为变更；删除两个测试文件与本文件即完全回退。
- **cleanup:** 所有临时目录由各用例 `finally` 中 `rmSync` 清理；无端口占用、无残留进程、无网络监听、无凭据写入。
