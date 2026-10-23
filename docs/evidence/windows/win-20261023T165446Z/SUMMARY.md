# Windows P0 后续验证摘要 — run `win-20261023T165446Z`

第二轮 Windows 执行，接续 `win-20261023T161616Z` 与 Mac 端复核（REVIEW.md）。仓库基线 `da5eeeb`（PR #34 头，含复核提交）；该 SHA 尚未包含本轮两个新探针，它们首次提交于 `85a3c37`，归档哈希及溯源限制已补入 run-metadata.json。原先的 testedSourceSha 字段表示基线，不是完整运行快照，工作分支 `windows/p0-followup-win-20261023T165446Z`，PR base 仍为 feat/p0-foundation。领取评论：[#1 (comment)](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/1#issuecomment-6370168396)。

## F1：DSH 桌面捆绑 ACP 运行时 — 元数据生命周期全部 verified

通过桌面自带正式 CLI 入口 `resources\runtime\cli\bin\dsh.cmd`（其内部以 `ELECTRON_RUN_AS_NODE=1` 将桌面 exe 作为无头 Node 宿主运行 `dsh-desktop-host` cli.js，**不启动 Electron GUI**），在隔离临时 `DSH_HOME`/`USERPROFILE`/`APPDATA` 下：

| 步骤 | 结果 |
|---|---|
| `dsh.cmd --version` | verified — 0.2.1-rc.2 |
| ACP `initialize` | verified — agent `deepseek-harness-acp` 0.0.1，protocolVersion 1 |
| `session/new` | verified — 返回 sessionId |
| `session/close` | verified |
| `session/list` | verified — 原 session 出现在 inactive 列表 |
| `session/resume` | verified — 接受原 sessionId |

`acp` profile 在隔离 home 内由随包模板自动初始化，**无需联网安装任何组件**；进程干净退出（exit 0，无 stderr）。证据：[dsh-desktop-acp-runtime.json](dsh-desktop-acp-runtime.json)。

结论：**Windows 上存在可用的 DSH ACP 控制面，由桌面 0.2.1-rc.2 分发**；CLI 0.1.1-rc.2 的"无 ACP"边界不变。本轮为元数据生命周期（无提示词/无推理/无权限交互），send/stream/cancel/permissions 与 attach-existing-GUI 保持 unknown；未运行 `command-path.ps1`（那是修改用户 PATH 注册表的安装器）。新探针脚本 `scripts/probe-dsh-desktop.mjs` 已随本 PR 提交。

## F2：WorkBuddy 5.7.7 Windows 静态清单 — 与 Mac 口径一致，控制面仍 unknown

新脚本 `scripts/probe-workbuddy-inventory-win.mjs`（Mac 探针的 Windows 镜像）读取安装内 `install-manifest.json` 与 `resources/wb-guest-sdk/wb.js`：guest SDK 61,239 字节、SHA-256 `9d6df2e4…`（与首轮布局记录一致，区别于 Mac 文件）；`window is undefined` 守卫、`window.__wbInvoke` 桥、`__wb_port_init__` 引导三个标记均存在——属渲染进程传输内部结构，**不构成独立控制 API**。全部能力保持 unknown。未启动应用。证据：[workbuddy-inventory-win32.json](workbuddy-inventory-win32.json)。

## F3：Codex Windows 定位 — 找到 MSIX，包内 CLI 尚未检查

只读检索在 PATH、npm 全局、开始菜单和 per-user Programs 中未定位到 Codex CLI。安装清单显示名称 ChatGPT、包身份 `OpenAI.Codex` 26.825.6671.0，但未检查该包的可执行文件，因此不能排除包内 Codex/CLI。用户 `.codex` 目录仅列名、内容未读；目录存在不能证明独立 CLI 用过或由哪个产品创建。[官方文档](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan)支持在 ChatGPT 桌面应用中使用 Codex，显示名称不能用于排除 Codex 功能。Windows app-server 控制入口仍未建立，能力保持 unknown。证据：[codex-search-win32.json](codex-search-win32.json)。

## 矩阵影响与未解决项

- HARNESS_MATRIX：DSH 桌面 0.2.1-rc.2 Windows 行的 create/resume/list 更新为 verified（ACP，捆绑无头 CLI），send/stream/cancel/permissions 注明未行使；Codex Windows 行限定为“MSIX 已定位，包内 CLI 未检查”。
- 未解决：DSH 桌面 ACP 的 send/stream/cancel/permissions（需固定响应 fixture 或获授权的本地推理路径）；attach-existing-GUI 全平台；WorkBuddy 入站；ZCode 3.16.2 旧超时根因。
- 需要 Mac 端接续：无阻塞；如接受本轮扩展范围（桌面捆绑 CLI 无头运行）请复核 PR；PR #34 与本 PR 为叠加关系，合并顺序不影响证据完整性。

Mac 端复核及修正见 [REVIEW.md](REVIEW.md)。后续探针的 Windows 路径引用、无 sessionId 的返回值和失败诊断脱敏已加固，但不是本轮原始安装实测的重新执行。
