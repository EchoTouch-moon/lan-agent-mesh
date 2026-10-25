# W-DSH-03 Windows 本机原生复验 — run `windows-native-local-20261025T1614Z` — **passed-windows-native-local**

固定执行源 `5fed1448337d82f72972270c99447205f02ea2d7`（PR #63 集成候选，组合 #47~#62 固定 head 与 #55/#56/#59；确认包含 W-DSH-02 执行源 `97a4be8` 为祖先）。领取：[#18 (comment)](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/18#issuecomment-6399996607)。本证据分支基于该源，仅追加本目录，无运行代码差异。

## 执行（全部退出码为真实子进程状态：直接调用 + 输出重定向文件后立即保存，无 grep/tail 管道末端替代）

- 全新完整历史干净克隆，HEAD 精确等于 5fed 源；clone 0 / checkout 0；`git status --porcelain` 为空。
- frozen install 0 / build 0 / typecheck 0。
- G2 独占 parent lineage 复验（native gate）：退出 0，五阶段 verified。
- launcher 与 pwsh 沿用 W-DSH-02 已核验入口，预核哈希与 #60 记录一致（launcher `c6c38be7…`、pwsh `362a356c…`），运行中经隔离 home 内复查（major 7）。
- `node packages/dsh-adapter/dist/smoke.js`（native，无 `--self-test`）：**退出 0，status=passed-windows-native-local**。原样报告：[dsh-adapter-native-w03-20261025T161412.json](dsh-adapter-native-w03-20261025T161412.json)（SHA-256 `7633e22b62ba738f678fea51d563432be63543f9e9cadb1b67fc78fdd117fc0a`）。

## 结果：六阶段全部 passed

sendStreamAndRetry、restartResume、permissions（四要素齐：正控/只读 sandbox 拒绝/reject_once/marker 未创建，permissionStages=2）、inFlightCancel、shutdownUnknown（不重放；硬杀未测）、mcpMesh（七工具/精确结果/重试不推理/在途取消/撤销；同机 loopback）。cleanup complete/rootRemoved/fixtureClosed，无遗留锁。externalModels=0，realModel=not-configured，physicalCrossHost=not-run（如实标注）。

## 边界

本运行验证组合候选 5fed 的单机 native 与 MCP/本机加密链；不证明跨实体 Mac→Windows、真实模型、GUI、DSH 出站 MCP、硬杀恢复。不重用 W3 配对、不启动 LAN/实体窗口、不改 ACL/PATH/防火墙。W-DSH-01 失败（PR #58）与 W-DSH-02 通过（PR #60）证据均原样保留。报告无本机路径/凭据。
