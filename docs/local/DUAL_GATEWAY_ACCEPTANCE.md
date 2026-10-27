# Codex ↔ ZCode 双 Gateway 同机验收（LHI-3，2026-10-27 夜间包）

**taskId:** LHI-3 · **Issue:** [#82](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/82) · **执行实例:** GLM-5.3（Mac 隔离 fixture）
**runner:** `scripts/lhi-codex-zcode-e2e.mjs`（`--self-test` 为无 native、无外联的确定性模式，可进 CI）
**证据:** [evidence/dual-gateway/](evidence/dual-gateway/README.md)

## 0. 冻结的依赖状态（CLAIM 时核验）

| 依赖 | 状态 | 影响 |
|---|---|---|
| main | `b09b28ccbdde8edc0034c7815c2a26d8986d7664`（含 #90 LHI-1、#91 Win G-S3） | runner 基线 |
| PR #92（ZCode Adapter） | OPEN @ `7209be1`，修复已推、CI 8/8、**无独立复审** | **C1 receiver native = BLOCKED**（工作包明文门），不得引用其代码 |
| PR #65（Mac Codex MCP baseline） | OPEN @ `8bfe5a2`，未合并 | 仅只读参考，不复制/cherry-pick |
| PR #93（Windows） | OPEN @ `07b6c1a` | 无文件交叠 |
| ZCode bundled CLI | 0.17.0，entry sha256 `97490d0f…`（darwin；与已合并 #90/#92 证据一致） | C2 caller 可用 #90 已审方法 |
| Codex CLI | 0.146.0（`/opt/homebrew/bin/codex`；与 main 中 CodexAdapter `expectedVersion` 精确一致） | C2 receiver 可用 main 既有适配器 |

## 1. 拓扑与三身份链

```
Harness caller（ZCode native / Phase B 为官方 MCP SDK 客户端，明确标注 L0）
   | stdio MCP（mcp-server CLI + 0600 scoped credential 文件）
   v
Gateway A（caller 侧，loopback 127.0.0.1；无 adapter）
   | McpAccess: Bearer mcp.<grantId>.<secret> + x-lam-node；grant 限 peers/agents/workspaces/lifetime
   | mesh envelope（libp2p Noise + Yamux，显式隔离测试配对，非 peer=self）
   v
Gateway B（receiver 侧，loopback；adapterFactories）
   | Router/Store（幂等/UNKNOWN/cursor）
   v
Receiver adapter（Phase B: mock；C1: ZcodeAdapter(BLOCKED)；C2: CodexAdapter@0.146.0）
   | native session/turn（fixture 推理，假 key）
   v
native 结果 → 事件 cursor → mesh → MCP tool result → caller 模型上下文
```

**三身份链验收**：caller native tool event（推理请求中真实 tool_call/tool result）→ Gateway A grant/audit
（`mcp.grant.created`、owned task 记录）→ Gateway B router task/event cursor → receiver native session/turn
（receiver 侧 fixture 推理计数 + native session id）。任何一环缺失 → 该方向 PARTIAL。

## 2. 阶段与判定门

| 阶段 | 内容 | 门 |
|---|---|---|
| A 冻结 | 依赖 SHA/版本/审查状态记录（§0） | 未读到 → UNKNOWN，不推断 |
| B L0 synthetic | 双 Gateway + Noise 测试配对 + scoped grant + 官方 MCP SDK 客户端经 mcp-server CLI 的全链基线 + §4 全部负例 | 无 native、无外联；`--self-test` 可进 CI |
| C1 Codex→ZCode | Codex native caller → ZcodeAdapter receiver | **BLOCKED：#92 未获独立复审**（工作包 §2C 门） |
| C2 ZCode→Codex | ZCode native caller（#90 已审方法）→ main 既有 CodexAdapter（0.146.0） | 仅在既有授权内：隔离 ZCode HOME、loopback 定值推理、只测天然只读工具（mesh_list_agents）与固定文本任务；任何需 allow 的操作一律原生 deny；需新授权 → BLOCKED_NEEDS_USER_AUTH |
| D 负例 | §4 清单（synthetic 先行） | 缺项必须标注 NOT-RUN + 原因 |
| E 清理/证据 | 仅停自有 ChildProcess/run-UUID 归属后代；stat+ENOENT 删证；脱敏 | 扫描出错 = UNKNOWN ≠ clean |

## 3. mesh_* 工具覆盖（六项实际驱动 + 一项 NOT-RUN，如实计数）

| 工具 | 状态 | 验证点 |
|---|---|---|
| mesh_list_agents | 已驱动 | 仅 grant 范围内 agent/alias 可见；unavailable peer 列出 |
| mesh_start_session | 已驱动 | requestId 幂等；scope 外 agent/workspace 拒绝 |
| mesh_send_message | 已驱动 | exactly-once（同 requestId 同参重试不二次执行）；timeout/deadline 生效 |
| mesh_get_task | 已驱动 | 事件游标轮询；cursor 单调；UNKNOWN 不自动重放 |
| mesh_cancel_task | 已驱动 | 在途取消仅 native 终态判 CANCELLED |
| mesh_list_sessions | 已驱动 | 仅本 grant 创建的会话（恰一条且为本次创建） |
| mesh_delegate_task | **NOT-RUN** | 本基线不驱动 delegate 语义（仅 mcp-server smoke 覆盖）；报告中以 `tools.notRun` 显式标注，绝不计入 PASS |

## 4. 负例清单（Phase D）

1. 未配对 peer：grant 创建即拒（`Pair peer locally before`）
2. 越权 agent/workspace：`mesh_start_session` → permission_denied
3. grant 撤销：revoke 后任意调用 → 拒绝
4. grant 过期：lifetime=1s 到期 → 拒绝
5. requestId 复用不同参数 → conflict
6. 同 requestId 同参精确重试 → 同一 taskId、receiver 恰好一次执行（B 侧 tasks 计数=1）
7. 连续两轮任务互不串流（事件按 taskId 隔离）
8. 在途 cancel → 仅 CANCELLED 终态（mock delay 场景）
9. Gateway A 重启 → 旧 grant token 因 bootId 失效被拒
10. receiver 失联/重启 → 任务 UNKNOWN、同参重试不产生新执行
11. （C2 native，如执行）native permission 请求 → deny + 零副作用 marker

## 5. 超时/预算/回滚/脱敏

- 所有等待有界，预算为 runner 实际强制值：B/D 单步轮询 ≤45s；mesh 工具调用 timeout 30s（C2 内 receiver 任务 90s）；C2 native turn ≤180s；C2 启动前 `--version` 预检 ≤15s。清理 owned-process 扫描：3s 宽限（吸收 kill 后 reap 延迟）→ 仍存活且命令行可归属本 run root 的后代 SIGTERM→SIGKILL（每 PID 独立复核归属，防 PID 复用误杀）→ 复扫验证；扫描器失败 = UNKNOWN ≠ clean。报告记录 `startedAt/finishedAt/durationMs`。
- 退出码语义：0 = 基线门 PASS 且（self-test 模式，或两 native 方向均 PASS）；1 = 基线门失败或意外错误（恒为缺陷）；2 = 仅 `--native`：基线 PASS 但 LHI-3 总体 PARTIAL/BLOCKED（预期性部分报告，绝不当作完整 native 验收）。
- 回滚：runner/文档纯增量；删 3 个路径即回退。不改任何 `packages/**`、`scripts/codex-mcp-*`。
- 报告脱敏：不落 token/原始配对码/绝对本机路径（证据替换 `<disposable-root>`）；fixture 假 key 固定值。
- 两方向**独立评级**；任一 native 方向未成立 → LHI-3 总体 PARTIAL（工作包 §3.4）。

## 6. 夜间执行结果（2026-10-27，详见 evidence/README）

| 项 | 结果 |
|---|---|
| Phase B L0 synthetic（双 Gateway + SDK 客户端全链） | **PASS 19/19 门**（self-test 模式，确定性、无 native、可复现） |
| Phase D 负例 | 全部 PASS：未配对/越权 agent/workspace/撤销/过期（桥启动层 + Gateway HTTP 403 双层）/requestId 冲突/精确重试单一执行/在途取消 CANCELLED/receiver 失联→UNKNOWN 不重放/caller 重启旧 token 拒绝 |
| C1 Codex→ZCode | **BLOCKED**（#92 未复审，工作包门） |
| C2 ZCode→Codex | **PARTIAL**：只读原生链 **VERIFIED**（ZCode 原生 mesh_list_agents → mcp-server 桥 → 双 Gateway → CodexAdapter 注册表，真实 agent 数据回流 ZCode 模型上下文）；执行链 **BLOCKED_NEEDS_USER_AUTH**（plan 模式拒非只读工具；build 需 allow，夜间不授予） |
| LHI-3 总体 | **PARTIAL**（两方向 native 全链未同时成立，按工作包 §3.4） |

新增观察（未改生产，详见 evidence README）：busy 拒绝与网络失败在 MCP 层同为 delivery UNKNOWN；adapterFactories 需显式 exportAgents；ZCode plan 模式对非只读 MCP 工具静默拒绝。

## 7. 复审修复重跑（2026-10-26 18:45 UTC，最终 head 见 RESULT）

针对 PR #96 review 三项 P1 的修复与重跑（历史 §6 保留不改；中间轮 st-r2/native-r2 因挂入 CI 的 Windows leg 暴露 runner 预存缺陷——动态 `import(绝对路径)` 在 Windows 抛 `ERR_UNSUPPORTED_ESM_URL_SCHEME`，改 `pathToFileURL` 后以最终 head 产出 st-r3/native-r3）：

| 项 | 修复 | 重跑结果 |
|---|---|---|
| 顶层 PASS 假阳性 | `baselineVerdict`（B/D 门）与 `overallLhi3Verdict`（C1/C2，按工作包 §3.4：双 PASS 才 PASS、任一有证据即 PARTIAL、全无证据 BLOCKED）机器可读分离；`--native` 非完整时 exit 2 | self-test exit 0；native exit 2，`baseline:PASS` + `overall:PARTIAL` + `verdict:INCOMPLETE` |
| ZCode 入口校验 | 启动前 fail-closed 双预检：sha256 与 HARNESS_MATRIX 批准 pin（`97490d0f…`）逐字节比对 + **实际执行** `--version` 与 `0.17.0` 比对；不匹配即 BLOCKED、不启动 app-server；报告写实测值 | 实测 `'0.17.0'`、pin 一致（`sha256Pinned:true`） |
| 清理证据 | 独立 owned-process 扫描（argv 引用本 run 唯一 root 即归属；pgrep/powershell，失败=UNKNOWN）+ 端口释放核查；3s 宽限后对仍存活可归属后代**逐 PID 复核归属再 SIGTERM/SIGKILL**，全处置链入报告 | self-test 0 存活；native 捕获 1 个 ZCode 派生 MCP bridge 孤儿子进程（>10s 未退）→ SIGTERM 后清空（新观察 4） |

其余修复：`mesh_list_sessions` 补实际驱动断言（20 门）；`mesh_delegate_task` 与 ACK-drop 注入显式 NOT-RUN；时间预算文档对齐 runner 实际强制值；self-test 基线挂入 CI（mac/win × node22/24）；runner 动态 import 改 `pathToFileURL`（Windows 合规）。

### 7.1 复审二轮修复（2026-10-27 03:17 UTC）

| 项 | 修复 | 证据 |
|---|---|---|
| 公开证据路径脱敏 | 存活进程命令行同时替换 `<disposable-root>` 与 `<repo>`（仓库工作树）；**替换先于长度截断**（截断会截断路径使替换失效——实测发现）；已归档 r2/r3 就地补脱敏（仅路径替换，如实记录于 evidence README） | st-r4/native-r4/negative 报告全量扫描零 `/Users/`、零 tmp 绝对路径 |
| PARTIAL 评级须有真实工具证据 | C2 状态 = 双链 VERIFIED→PASS；**任一链 VERIFIED→PARTIAL**；零链证据→**BLOCKED**（含超时路径："启动过原生"本身不构成证据）。新增 `LHI3_NEGATIVE_NO_TOOLS=1` 负例开关 | negative-noevidence 归档：真实启动原生 + 1 次推理 + 0 工具调用 → C2/overall 均 BLOCKED、exit 2 |
