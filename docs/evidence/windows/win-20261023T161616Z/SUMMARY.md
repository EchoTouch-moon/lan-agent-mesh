# Windows P0 验证摘要 — run `win-20261023T161616Z`

执行机器：Windows AMD64（OS build 22621），Node v24.12.0，pnpm 10.18.3。
测试源码：`feat/p0-foundation` @ `6eadd08b10148be5f80f02b5b30712bdfb231e7e`（含最低诊断基线 `8342640`）。工作分支 `windows/p0-validation-win-20261023T161616Z`。
领取评论：[#1 (comment)](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/1#issuecomment-6369432581)。全程未升级/降级任何应用、未安装插件、未调用外部模型、未读取既有聊天或真实用户配置。

## W-01 工程检查 — PASS

全部命令退出码 0：`pnpm install --frozen-lockfile`（12.9s）、`pnpm check`（各包构建、源码/测试类型检查、eslint、vitest 4 文件 27 项合同测试全部通过）、离线 demo、`check-rpc-probe.mjs`、`check-windows-probe-runner.mjs`。唯一提示：pnpm 按默认策略跳过了 esbuild 的 postinstall 脚本，平台二进制经 optional 依赖正常提供，后续构建与测试未受影响。明细见 [engineering-w01.json](engineering-w01.json)。

## W-02 ZCode 原生控制 — 全部 verified（附版本变化说明）

布局重新采集后运行诊断版 native runner（[native-probe-win32-v2.json](native-probe-win32-v2.json)，原始文件 SHA-256 `409b6e6b…`）。本机 ZCode 桌面现为 **3.16.3**（上一轮为 3.16.2），内置 CLI 仍报 0.17.0，入口 `resources/glm/zcode.cjs` SHA-256 为 `97490d0f…`，与上一轮失败的 `a055234a…` 不同。

| 能力 | 结果 | 证据 |
|---|---|---|
| runtime/capabilities | verified | 结果交换成功 |
| session/create | **verified，3609 ms**（上一轮 15s 超时未复现） | `startup.createElapsedMs` |
| send | verified | `turn.completed` / success |
| stream | verified | fixture 文本匹配，1 个 text_delta |
| resume（进程重启后） | verified | 重启后保留 fixture 文本，3 条消息 |
| cancel | verified | 在途 fixture 请求被取消，resultType=cancelled |
| permissions | verified | 原生 `interaction/requestPermission`，回答 deny |
| 被拒操作标记文件 | verified 未创建 | `deniedOperation.markerCreated=false` |
| attach-existing-GUI | unknown | 仅探测自建会话，本轮范围外 |

启动诊断：storage 走完 checking→migrating→committing→ready（首次 77 ms，重启后 10 ms）；4 个运行偏好请求（runtime-materialization ×2、user-execution ×2）全部得到回复；fixture 推理请求 4 次，外部模型请求 0 次。

**版本变化说明（重要）**：上一轮 v1 失败发生在入口 `a055234a…`（桌面 3.16.2、探测 v1、15s deadline）；本轮通过发生在入口 `97490d0f…`（桌面 3.16.3、探测 v2、60s deadline）。两次运行之间应用被外部更新过（非本轮所为），探测脚本也有修订，因此无法把“超时消失”单独归因于应用更新或探测改进。本轮未对仓库脚本做任何修复（无需修复）；3.16.2 在探测 v2 下是否通过保持 unknown（不允许降级重测）。turn 整体成功不等于被拒工具已执行——该结论与 Mac 侧一致，marker 检查单独成立。

## W-03 DSH 接口边界 — CLI 无可用 ACP（退出原因已定位），桌面静态含 ACP 组件

**CLI 0.1.1-rc.2（npm 全局安装）**：`dsh --version` verified；`--profile acp` 启动即退出（exit 1），v2 捕获的 stderr 给出直接原因：

```
Error: dsh: profile "acp" does not exist; create it with 'dsh plugin --profile acp add <package>'
    at loadProfile (…/@deepseek-ai/dsh-app-boot/lib/index.js:543:34)
```

静态核实（只读安装包，不装任何东西）：

- `dsh-app-boot` 的 `INSTALLATION_OWNED_PROFILE_TUPLES` 仅含 `web` 与 `headless`；随包 README 明确“`web` 和 `headless` 首次使用自动初始化，其余 profile 必须经 `dsh plugin` 创建”。
- 包依赖与内置 node_modules 中不存在 `@deepseek-ai/dsh-acp`、`dsh-acp-app` 或 `agent-client-protocol` 任何组件。
- 结论：**当前安装的 0.1.1-rc.2 在隔离默认配置下无可用 ACP**；initialize/session 生命周期保持 unknown（被启动失败阻断，非协议失败）。文档化候选接口为 `web`、`headless`（一次性任务）及经 `dsh plugin` 自建的 profile。这不是 Windows 不兼容，也不代表其他版本/渠道；为使测试通过而安装插件或升级超出本轮约束。

**桌面 0.2.1-rc.2（Electron，与 CLI 相互独立）**：仅静态检查 `resources/app.asar`（[dsh-desktop-static-win32.json](dsh-desktop-static-win32.json)），未启动 GUI。asar 内捆绑 `@deepseek-ai/dsh` 0.2.1-rc.2、`@deepseek-ai/dsh-acp` 0.2.1-rc.2、`@deepseek-ai/dsh-acp-app` 0.2.1-rc.2、`@agentclientprotocol/sdk` 1.4.0；其内置 README 写明 `web`/`headless`/`sdk`/`sdk-minimal`/`acp` 五个 profile 自动初始化，代码 `PROFILE_TEMPLATES` 含 `acp: { bundles: [dsh-base, dsh-acp-app] }`。即：**ACP 栈随桌面分发而随旧 CLI 不分发**——这是渠道边界，不是 Windows 能力差异。桌面 ACP 运行时行为未行使（unknown）。

WorkBuddy 5.7.7 与 Codex：沿用 unknown；本轮未启动、未新增结论。

## W-04 回传

- 证据目录：`docs/evidence/windows/win-20261023T161616Z/`（本目录）；清单、布局、native 报告均已脱敏并保留原始 SHA-256（见 [run-metadata.json](run-metadata.json)）。
- HARNESS_MATRIX.md 已更新 Windows 行并链接本目录。
- 未解决项：3.16.2 下探测 v2 的表现（不可降级，保持 unknown）；DSH 桌面 ACP 运行时验证（需允许启动桌面/其捆绑 CLI，超出本轮）；attach-existing-GUI 全平台 unknown。
- 需要 Mac 端接续：无阻塞项；如需复核请以本目录 JSON 与 PR diff 为准。
