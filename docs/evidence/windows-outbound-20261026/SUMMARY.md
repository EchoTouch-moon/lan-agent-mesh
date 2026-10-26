# W2/W3 Windows 出站能力与反向 MCP 调用方证据（2026-10-26）

> Issue [#18](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/18)（W1/W2/W3 工作包）、[#19](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/19)（B1 预演）· GLM-5.3 操作者执行。全部为本机 loopback/fixture：无真实模型、无外部网络、无既有 GUI/用户凭据接触、无系统 ACL/防火墙修改。testedSourceSha 与逐命令退出码见 run-metadata 与回传评论；实体跨机 E0–E5 未运行。

## W2 — Windows Harness 出站 MCP/工具调用能力表

证据等级：`verified` = 本机真实安装二进制 + 固定响应 loopback 推理的实际调用通过；`documented` = 安装包/协议内可复核的接口证据，未做端到端工具调用实证；`unknown` = 无公开可验证接口；`unsupported` = 有证据不支持。

| Harness（Windows 实测版本） | 出站 MCP/工具调用 | 证据 |
|---|---|---|
| ZCode desktop 3.16.3（bundled CLI，桌面版内 `resources/glm/zcode.cjs`） | **verified** | 复用 #90 的参数化原生出站探针（`scripts/lhi-zcode-mcp-outbound-smoke.mjs`，`LAM_ZCODE_ENTRY` 指向本机安装）在本机执行：16 项断言 15 项 PASS——原生 turn 内 MCP 工具广告（fixture 推理请求体观测）、真实 tool invocation + 回传、MCP server 侧独立 JSONL 执行计数（echo/hang 各恰 1 次）、四项 fail-closed 负例（未知工具/错误类型/调用方超时/MCP 禁用零执行）、native 权限请求 deny 链、零外部模型请求、app-server 两次干净退出、disposable HOME 移除。唯一 `unsupported-on-windows` 项（探针内置孤儿扫描无 Windows 实现）由操作者独立 CIM 复核补齐：探针运行后无任何 zcode.cjs/lhi-zcode-mcp-contract 残留进程、无残留临时目录（现存 ZCode 桌面自身进程与探针无关）。原样报告 [zcode-outbound-windows.json](zcode-outbound-windows.json)。 |
| DSH desktop 0.2.1-rc.2（launcher `--profile acp`，W-DSH-02/03 已核验入口） | **documented（未做出站调用实证）** | 安装包 `app.asar` 二进制只读检查：`"mcpServers": {` 配置对象形态存在、`McpServer` 类标识 204 处、`mcp_servers` 19 处——ACP 会话配置面含 MCP server 挂载实现；`dsh --help` 顶层无 mcp 字样（不是 CLI 公开面）。`@lam/dsh-adapter` 的 session/new 与 session/resume 已在 W-DSH-02/03 以 `mcpServers: []` 实跑（参数面存在且接受），但**非空配置下的原生 tool-call 循环未实证**，不宣称 B3 成立；作为 B3 前置候选，最小复现实验（fixture 推理返回 tool_calls + loopback MCP server）留待下一轮。 |
| Codex（Windows） | **unknown** | PATH 无 `codex`；uninstall 清单未列；历史记录的 MSIX OpenAI.Codex 26.825.6671.0 非 manifest 注册/无执行别名（HARNESS_MATRIX 既有结论），按工作包约束**不执行未知 MSIX 候选二进制**，维持 unknown。 |
| WorkBuddy 5.7.7 | unknown（不在本轮范围） | 仅 inventory 记录，未探测。 |
| PATH 上的 DSH CLI 0.1.1-rc.2 | unsupported（作为出站候选） | HARNESS_MATRIX 既有结论：该发行无 ACP 组件；本轮不使用。 |

只读安装盘点（脱敏）见 [inventory-windows-redacted.json](inventory-windows-redacted.json)。方法：探针/盘查均为一次性进程 + disposable HOME + loopback 固定响应推理，无登录态、无用户配置读取；ZCode 出站探针配置走官方 features.mcp + mcp.servers stdio 合同（#90 交付），provider 指向 loopback fixture。

**W2 结论**：Windows 侧 B3 候选目前为 **ZCode（verified 出站）**；DSH 为 documented 候选（需非空 mcpServers 实证后才可升级）；Codex Windows 维持 unknown。E4（Windows Harness 真实 MCP 调用 → Mac Codex）在窗口期优先以 ZCode 作为 Windows 侧发起方。

## W3 — Windows 反向 MCP SDK stdio 调用方（B1 预演）

`scripts/w3-mcp-sdk-caller.mjs`：真实 `@modelcontextprotocol/client` 2.4.0（工作区内 dsh-adapter 锁定版本，非新增浮动依赖）stdio 客户端。两种模式：

- `--self-test`：本机自建 caller/executor 双 Gateway（loopback Noise 自动确认的两个新身份，非实体配对）+ scoped grant，完整序列：七工具精确集合、grant 范围外 agent 不可见、会话归属与同 requestId 精确重试（不建第二个会话）、`mesh_get_task` 游标分页（每事件恰一页，本机实测 9 页/4 事件至 COMPLETED）、send 精确重试同 taskId 不重推理、delegate+cancel 仅从终态记 CANCELLED、未配对 peer 与越权 `mesh_start_session` 负例、`mcp-revoke` 后全部工具拒绝、cleanup 零异常且根目录移除。结果 **passed-self-test**，原样报告 [w3-mcp-caller-selftest.json](w3-mcp-caller-selftest.json)。
- `--peer <loopback-multiaddr> --credentials <grant-file>`：E2 窗口期对已配对对端（Mac Codex fixture）执行同一序列；runner 自身不配对、不监听、不授权。凭据由操作者在窗口内经本机 Gateway `mcp-grant` 产生。

**W3 边界**：SDK 客户端路径只证明连接/适配/权限/游标/取消语义（B1 Windows→Mac 方向的准备），**不**构成 Windows Harness 原生 MCP 出站证据（那是 W2/B3 的 ZCode verified 结论），也不得重命名为 Harness 发起。

## 复现

- ZCode 出站：`LAM_ZCODE_ENTRY=<本机 zcode.cjs 绝对路径> node scripts/lhi-zcode-mcp-outbound-smoke.mjs --self-test`（门禁自检）后不带 `--self-test` 运行同脚本。
- W3：`node scripts/w3-mcp-sdk-caller.mjs --self-test --output <仓库外绝对路径>`。
- 安装盘点：`scripts/inventory-windows-harnesses.ps1 -OutputPath <路径>`（只读）。
