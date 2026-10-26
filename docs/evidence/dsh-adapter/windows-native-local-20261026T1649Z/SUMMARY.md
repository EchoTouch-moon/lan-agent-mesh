# W1：DSH 接收方组合在当前 main 的 native 复验（2026-10-26T16:49Z）

> Issue [#18](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/18) 2026-10-26 工作包 W1。上一轮 W-DSH-03（`5fed144`，PR #63/#64）后 main 已前进（#88 storage/runtime 变更、#89/#90/#91），按执行包「程序或配置变化时重新复验」执行。单机 native + MCP/本机加密链；不证明跨实体 Mac→Windows、真实模型、GUI、DSH 出站 MCP；不重用 W3 配对、不开 LAN/实体窗口。

## 执行源与前置核对

- **testedSourceSha `88fa3c8f60b56f37a116c8618efbd6eaba3a6b8f`**（分支 `win/w1-w2-w3-20261026`，W2/W3 代码提交；运行时 `git status` 干净，含 W-DSH-02 源 `97a4be8` 与 SDK/ACK 祖先检查通过——runner 自检）。
- Host：Windows 10.0.22621 x64，Node v24.12.0，pnpm 10.18.3，PowerShell 7.6.5（规范实体，major 7 于隔离 home 内复查）。
- 程序哈希与 #60 记录一致、未变更：launcher `c6c38be7f9f66a7bfb96d5ac9490618f9713df5ffb552cb7e66b831affb20ab9`、pwsh `362a356ce7f0940ec74f73a8fc2c990a2cc24a38a11c90bbd8eca947110ad139`。desktop 0.2.1-rc.2。
- G2 私有 parent 复用已验证 lineage；fixture root 在其下的一次性 `lam-dsh-acceptance-*` 目录。

## 命令与真实退出码（输出重定向文件后立即保存 `$?`，无管道末端替代）

| 命令 | 退出码 |
|---|---|
| `pnpm install --frozen-lockfile` | 0 |
| `pnpm build` | 0 |
| `pnpm typecheck` | 0 |
| `node packages/dsh-adapter/dist/smoke.js --expected-source 88fa3c8… --parent <已验证G2 parent> --launcher <原入口> --launcher-sha256 c6c38be7… --pwsh <规范实体> --pwsh-sha256 362a356c… --output <仓库外报告>`（无 --self-test） | **0** |

## 结果（`passed-windows-native-local`，六阶段全部通过）

sendStreamAndRetry、restartResume、permissions（正控/只读 sandbox 拒绝/reject_once/marker 未创建，permissionStages=2）、inFlightCancel、shutdownUnknown（UNKNOWN 不重放；硬杀未测）、mcpMesh（七工具/精确结果/重试不推理/在途取消/撤销；同机 loopback 双新身份）。cleanup complete/rootRemoved/fixtureClosed，无遗留锁；externalModels=0。

**原样报告** [report.json](report.json)，SHA-256 `20337ef31e11de9773ce7b5b4fa7a7e057c54937e5ecda132479d0076d44ede6`（含 powerShellSha256/launcherSha256，无本机路径）。运行元数据见 [run-metadata.json](run-metadata.json)。

结论：#88 起的主干变更未破坏 DSH native 接收方链路；W1 复验通过。W-DSH-01/#58 失败与 W-DSH-02/#60、W-DSH-03/#64 历史证据原样保留，本报告只声明新执行源的结果。
