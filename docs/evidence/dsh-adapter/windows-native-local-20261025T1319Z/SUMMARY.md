# W-DSH-02 Windows 本机原生验收 — run `windows-native-local-20261025T1319Z` — **passed-windows-native-local**

固定执行源 `97a4be844f52148bcb57b70504831547287c9a56`（PR #59 `codex/dsh-verified-pwsh`，完整包含原验收源 `60e6e88`；本证据分支基于该源，仅追加本目录，无运行代码差异）。领取评论：[#18 (comment)](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/18#issuecomment-6398130517)。

## 执行过程（逐命令退出码见 run-metadata.json）

- 全新完整历史干净克隆，HEAD 精确等于 40 位执行源；`git status --porcelain` 为空；确认 `60e6e88`（原验收源）为其祖先。
- `pnpm install --frozen-lockfile` / `pnpm build` / `pnpm typecheck` 全部退出 0。
- 复用 G2 操作者独占 parent；运行前用既有 native private-storage gate 重验完整 lineage，五阶段 verified，退出 0。
- launcher 沿用已核验 desktop 0.2.1-rc.2 捆绑 dsh.cmd（路径不公开），SHA-256 `c6c38be7f9f66a7bfb96d5ac9490618f9713df5ffb552cb7e66b831affb20ab9`。
- pwsh：本机 `Program Files\PowerShell\7` 不存在，使用 #58 诊断中已存在的 PowerShell 7 规范实体（Store 包目录下真实 pwsh.exe；用户 PATH 上同名入口为其 reparse 别名，无法哈希）。显式绝对路径 + 64 位小写 SHA-256 `362a356ce7f0940ec74f73a8fc2c990a2cc24a38a11c90bbd8eca947110ad139`；runner 在隔离 home 内复查文件/哈希/major 7 并以同一显式入口执行正控。
- `node packages/dsh-adapter/dist/smoke.js`（native 模式，无 `--self-test`，新增 `--pwsh`/`--pwsh-sha256`）**退出 0，status=passed-windows-native-local**。原样报告：[dsh-adapter-native-w02-20261025T211951.json](dsh-adapter-native-w02-20261025T211951.json)（SHA-256 `b39907f994e751e2a19eb9d793243e7d892f8eb37f9a8fc839b8efed6c422672`）。

## 结果：六阶段全部 passed

| 阶段 | 结果 |
|---|---|
| sendStreamAndRetry（原生 send、精确流序、原参数重试不加推理、改参数冲突） | passed（fixtureCalls=1） |
| restartResume（关进程重开、显式 resume 同一 nativeId、原任务重试不再推理） | passed |
| permissions（正控同模板 PowerShell 写/删、只读 sandbox 初始拒绝、workspace-write 请求 reject_once、被拒 marker 未创建） | passed（permissionStages=2，四要素齐） |
| inFlightCancel（HTTP 在途观察到后取消，原 pending prompt 返回 cancelled） | passed |
| shutdownUnknown（关机 UNKNOWN 落盘、重开重试不重放、该会话保持 busy） | passed（硬杀未测，如实标注） |
| mcpMesh（真实 MCP SDK stdio → scoped Gateway → 本机加密 loopback peer → DSH：七工具边界、精确结果、重试不推理、在途取消、撤销） | passed（同机 loopback，如实标注非物理跨机） |

cleanup：complete / rootRemoved / fixtureClosed，无遗留锁或私有子目录。

## 边界

本轮为 PowerShell 前置条件修复（PR #59）后的本机原生重验，构成 W-DSH-02 的 `passed-windows-native-local`。不证明：跨实体 Mac→Windows、真实模型、GUI、DSH 出站 MCP、硬杀恢复。此前 W-DSH-01 失败运行（`windows-native-local-20261025T1227Z`，源 60e6e88）在 PR #58 原样保留，不改动。报告含 PowerShell/launcher SHA-256，不含本机路径；无合并/关闭动作。
