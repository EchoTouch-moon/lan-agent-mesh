# W-DSH-01 Windows 本机原生验收 — run `windows-native-local-20261025T1227Z` — **failed（permissions 阶段）**

固定执行源 `60e6e8835469e29babc1840bab0b533200d7230d`（PR #54 分支上的已审查执行源；本归档分支基于 PR #54 当前 head `fdf9a39`，仅追加本目录证据，无运行代码差异）。领取评论：[#18 (comment)](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/18#issuecomment-6397526168)。

## 执行过程（全部命令退出码见 run-metadata.json）

- 全新完整历史干净克隆，HEAD 精确等于 40 位执行源；`git status --porcelain` 为空。
- `pnpm install --frozen-lockfile` / `pnpm build` / `pnpm typecheck` 全部退出 0。
- 复用 G2 操作者独占 parent；运行前用既有 native private-storage gate 重验完整 lineage，五阶段全 verified，退出 0。
- launcher 为已安装 desktop 0.2.1-rc.2 捆绑 dsh.cmd（本机路径不公开），SHA-256 `c6c38be7f9f66a7bfb96d5ac9490618f9713df5ffb552cb7e66b831affb20ab9`。
- `node packages/dsh-adapter/dist/smoke.js`（native 模式，无 `--self-test`）**退出 1，status=failed，stage=permissions**。原样报告：[dsh-adapter-native-20261025T202716.json](dsh-adapter-native-20261025T202716.json)（SHA-256 `4fcc31b77879d75a17c681569a2c9559eb267fd266a1e6d12adb57eba7e71271`）。

## 结果

| 阶段 | 结果 |
|---|---|
| sendStreamAndRetry（原生 send、精确流序、原参数重试不加推理、改参数冲突） | passed |
| restartResume（关进程重开、显式 resume 同一 nativeId、原任务重试不再推理） | passed |
| permissions | **failed**：正控 PowerShell 写/删通过、目标 marker 未创建、pwsh 已通告，但 `sandboxDenied=false`、`rejectedOnce=false`、`permissionStages=1`（预期 2），`session/request_permission` 从未到达 |
| in-flight-cancel / shutdown-UNKNOWN / MCP 链 | 未到达（runner 在 permissions 断言处停止） |
| cleanup | complete / rootRemoved / fixtureClosed |

本轮**不构成** `passed-windows-native-local`；#18 验收框保持未勾选。清理完整，无遗留锁或私有子目录。

## 根因（A/B/D 环境对照，探针零修改）

方法：用历史 R4 已提交探针（`4f17ff0` 的 `scripts/probe-dsh-desktop-fixture.mjs`，scope=permissions，探针自身继承式环境）重跑三次，唯一变量是子进程 PATH。三份原样输出均已归档：

| 运行 | 子进程 PATH | initialSandboxDenial | reject_once | fixture 请求 |
|---|---|---|---|---|
| A [r4-replica-fullenv.json](r4-replica-fullenv.json) | 完整继承（pwsh 7 可解析） | true | verified | 3 |
| B [r4-replica-restrictedpath.json](r4-replica-restrictedpath.json) | System32 + WindowsPowerShell\v1.0（= smoke 允许列表值） | **false** | 未到达 | 2 |
| D [r4-replica-runnerpath-with-pwsh.json](r4-replica-runnerpath-with-pwsh.json) | 允许列表值 + 本机 pwsh 7 所在目录 | true | verified | 3 |

结论：desktop 0.2.1-rc.2 行为与 R4 观测一致，未变化。失败由 smoke 的净化 PATH 允许列表引起——DSH 的 pwsh 解析顺序为 ①`Program Files\PowerShell\7\pwsh.exe` ②PATH 各项下 `pwsh.exe` ③`System32\WindowsPowerShell\v1.0\powershell.exe`（5.1 兜底）。本机 pwsh 7.6.5 仅经用户目录安装（在正常用户 PATH 上、不在允许列表上），受限 PATH 下解析静默降级到 5.1 兜底；fixture 持有的写入在 5.1 兜底下执行后，其 tool_result 不再含 fixture 匹配的 `sandbox: file access denied` 方言，权限阶段停在第 1 阶段，`session/request_permission`/`reject_once` 无法到达。D 证明允许列表 PATH 补上经核验的 pwsh 7 目录即完整恢复四要素（输出与 A 字节级相同）。

修复方向（实现与方言取舍归 maintainer 审查）：`packages/dsh-adapter/src/native.ts` 的 `fixtureEnvironment` 需要为 pwsh 提供经核验的解析（如把经核验的 pwsh 目录加入允许列表 PATH，或显式钉住 pwsh 路径），而不是静默降级到 5.1 兜底。本轮未修改任何源码。

## 边界

失败运行如实保留，未改写为成功；不含跨实体 Mac→Windows、真实模型、GUI、DSH 出站 MCP 或硬杀恢复声明；未做主机网络监听声明。诊断不捕获原始 tool_result 文本（报告脱敏设计如此），只隔离环境变量。
