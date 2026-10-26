# Windows ZCode Native Adapter 交叉核查（W4/W5/W6，#94，2026-10-27）

> 执行端：Windows GLM（独立 worktree）。验证基线：PR #92 head `7209be13f51dd2f193674aa6dde3fce527dd1f82`（领取时 Issue 所记 `cac33f342` 已前进两次：`15a3535` review-fix、`7209be1` syntheticPeer；本分支 merge 后在其上，**依赖 #92 未合并，不基于 main**）。#93 仍 open。真实 Windows 安装版 ZCode bundled CLI，loopback 固定响应推理，fake provider key，无登录态/GUI/真实模型；物理 E0–E5 未执行。

## W4 — Windows 原生验收（协议层）+ 静态审查发现

### 环境记录（脱敏）
- 入口：`zcode.cjs`（desktop 3.16.3 捆绑），**SHA-256 `97490d0f06a7a225d54d47817acf4b4859cdb268b59f2490caaeda982bef063a`**，15,242,397 字节；`--version` = **0.17.0**，与 Adapter `expectedVersion` 精确一致（不匹配即 fail-closed 的前提成立）。
- Host：win32 10.0.22621 x64，Node v24.12.0，pnpm 10.18.3。私有临时 root（G2 私有父目录下）。

### 静态审查发现（#92 代码 macOS 假设清单）
1. **生产入口 darwin-only**：`src/index.ts` `open()` 在非 darwin 抛 `unsupported`（#92 有意设计，注释明示）。Windows 生产入口不可用是**结构性缺口**，不是可悄悄绕过的测试问题——本分支不改 `src/**`，按 #94 规则记录为 blocker：放开 Windows native 入口需 #92 维护者为 Windows 二进制补充 pinned SHA 白名单与平台门调整（另立 Issue/PR，人工审查）。
2. **CI 状态核实**：#92 在 `15a3535` 的 Windows CI 实际为 **failure**（runs 40362928617/40362921919）——本机复现：`zcode.test.ts` 9 例中 8 例在 Windows 失败（全部死于平台门）。`7209be1` 引入 `syntheticPeer` 选项后 synthetic 全平台放行；本机 Windows 实测 **9/9 通过**。Issue #94 所引"#92 四组 SUCCESS"仅对 `7209be1` 之后的 head 成立。
3. `rpc.ts` win32 分支完备（`detached` 仅 darwin、fail 走 `child.kill('SIGKILL')`）——协议传输层无平台门，是本 runner 的合法复用面。
4. `native-smoke.mjs` 的 marker 命令是 POSIX `printf`（Windows 不可用）——本 runner 改为跨平台 `node -e writeFileSync`，且工具名探测放宽为 `bash|shell`。
5. `env()` 在 Windows 缺 `USERPROFILE/APPDATA/LOCALAPPDATA/TMP/TEMP`（只设 POSIX 形态）——真 CLI 在 Windows 上仍以 `--version`/app-server 正常运行（本 runner 实测），但若后续放开 Windows 入口，生产 `env()` 需补 Windows 变量（记入 blocker 附注，不改 src）。

### Windows native 协议层验收（`packages/zcode-adapter/test/windows-native-smoke.mjs`）
以生产 `ZcodeRpc` 传输驱动**真实安装版 CLI**，12/12 gate PASS（详见证据 JSON）：

| gate | 结果 |
|---|---|
| production-open-fail-closed-on-windows | PASS（生产入口如设计拒绝 Windows） |
| app-server-spawn-capabilities / cli-version-pinned | PASS（0.17.0 精确匹配） |
| session-create-subscribe | PASS（回显请求 ID + subscribe 生效） |
| send-stream-ordered-completed | PASS（delta 有序、文本 `W4 NATIVE OK`、turn.completed success） |
| in-flight-cancel-native-stop | PASS（HOLD 首 delta 后 native stop → cancelled） |
| permission-deny-fail-closed | PASS（真实 `interaction/requestPermission` 到达 1 次 → deny → turn 完成 → marker 不存在；fixture 侧确认 tool_call 携带 marker 命令且 tool trace 进入后续请求——因果链完整） |
| workspace-observable-control | PASS（受控路径可观测） |
| restart-resume-identity-and-live-events | PASS（换进程 resume 回 messages 数组、同 session ID、re-subscribe 后新 turn 流式完成） |
| no-external-models-accounted | PASS（fixture 请求 >0、外部 0） |
| owned-processes-all-stopped（W5） | PASS（无自建进程残留） |
| disposable-root-removed-or-kept | PASS（失败才保留） |

**证据等级**：`windows-native-local (protocol layer)`——adapter 生产入口在 Windows 为显式拒绝（自身即被验证的负例）；协议/编排语义由真实 CLI + 生产 Rpc 传输验证；SQLite/锁/idempotency 等 adapter 编排层语义由 synthetic 套件（Windows 本机 9/9）覆盖。**不得将本报告表述为 Windows 生产入口已启用。**

### Adapter 编排层（synthetic，Windows 本机）
`zcode.test.ts` 于 `7209be1` 在本机 Windows **9/9 通过**（映射/精确重试/冲突/串流归因/crash UNKNOWN/deadline UNKNOWN/foreign-session 终端丢弃/重启后新任务流式/哈希钉住拒绝/家目录拒绝）。

## W5 — Windows owned-process checker
内置于上述 runner：运行前后对本 run 标记（入口 basename + 本次 root）匹配的**自有**子进程做 CIM 快照 diff；只报告自建进程残留（`cleanup-uncertain` 如实保留），绝不杀系统既有 ZCode 进程（本机 Desktop 自身进程 9 个在 before 基线内、diff 为空）。正常退出/取消/重启换进程各路径后均零残留。

## W6 — 双端差距与窗口预备（不执行物理跨机）
- **ZCode 出站链条（引用 #93 W2，不重复执行）**：native tool 广告（fixture 请求体）→ 实际调用 → MCP server 独立执行计数 → native 收到工具结果，Windows 侧 verified。与 W3 SDK caller 的区别已在 #93 说明；E4 的 Windows 发起方建议 ZCode。
- **E4 最低可复现参数表**：`LAM_ZCODE_ENTRY=<安装版 zcode.cjs 绝对路径>`（本轮 SHA `97490d0f…`）、`LAM_ZCODE_BUILTIN_CONFIG=<入口同层 config/provider/zcode-builtin.json>`、loopback fixture base URL、官方 features.mcp + mcp.servers stdio 合同（#90/#92 形态）、fake key。危险边界：不继承用户 provider 凭据/不读用户配置根、deny 默认、marker 命令跨平台化。
- **DSH 非空 mcpServers native outbound 实验**：本轮 **NOT-RUN**（时间与前置：需先固定 DSH 侧 MCP server 配置形态与 fixture tool_call 循环的最小合同），维持 documented。不因 asar 类存在而升级等级。
- **E0–E5 前双方 checklist（准备，不开启）**：双方同源固定 SHA + clean + frozen install/check（E0）；身份/配对码人工双机核对；Windows 侧 W3 caller 凭据生命周期（grant→使用→revoke）与 Mac M2 接收方对齐；事件/任务关联键与游标约定；每侧 cleanup 清单（进程/端口/锁/临时根）与 `cleanup-uncertain` 上报路径；撤销/过期/UNKNOWN 不重放交叉复核（E5）。物理会话仍需用户另行批准窗口。

## 结果文件
- `docs/local/evidence/zcode-inbound/windows-20261027/windows-native-protocol.json`（12/12 PASS 原样报告）
- `docs/local/evidence/zcode-inbound/windows-20261027/synthetic-suite-windows.json`（9/9 摘要）
- `docs/local/evidence/zcode-inbound/windows-20261027/run-metadata.json`（命令/退出码/哈希）

## 遗留与建议
1. blocker：Windows 生产入口（平台门 + env Windows 变量 + Windows pinned SHA 白名单）——建议 #92 维护者在 PR 内或后续 PR 处理；本分支仅测试/文档。
2. W4 已证明协议层 Windows native 可行；入口放开后可把本 runner 的编排断言迁回生产 `ZcodeAdapter.open` 路径。
3. DSH 非空 mcpServers 实验列为下一工作包首选。
