# Mac Codex 原生 MCP 本机验收（M1/M2）

本轮接续 #17/#19 的 2026-10-26 工作包。只使用已验证的 `codex-cli 0.146.0`、全新私有 HOME/CODEX_HOME、确定性 localhost Responses provider 和本机 Gateway。没有外部模型配置，不导入用户登录、聊天或工具配置，不开启 LAN/mDNS 或已有 GUI。

## M1：由真实 Codex 发出七种工具调用

先构建并提交源码，在干净 checkout 中运行：

```sh
pnpm install --frozen-lockfile
pnpm build
LAM_CODEX_BIN=/absolute/path/to/verified/codex node scripts/codex-mcp-outbound-smoke.mjs --receiver mock --output /private/new/m1.json
```

输出文件必须不存在。`--allow-dirty` 仅供开发，报告 `sourceClean:false` 不能作为正式证据。全程有界等待，MCP 凭据仅写入本轮 0600 文件；进程环境不继承真实模型/代理/凭据变量。

fixture 根据真实 Codex 广告的工具名返回确定性的 function_call，**Codex 负责执行 MCP stdio 调用**，不是 MCP SDK 测试客户端。验收器要求对应 thread/turn 的原生 `item/completed`、`mcpToolCall` 类型、server/tool、精确参数与工具结果，模型回复文本不能作为证据。fixture 证明原生 MCP 调用能力，不证明模型自主规划能力。

覆盖七工具、工作区/peer scope 拒绝、会话归属、重复 start/send 的精确幂等、完整流和事件游标、RUNNING 后取消并观察 CANCELLED、凭据撤销。报告仅保存请求/结果及原生事件 ID 摘要；凭据、IP、绝对路径和原生历史不发布。`scripts/check-codex-mcp-contract.mjs` 检查伪造文本、错误线程/turn/server/tool/参数、重复和缺失原生结果均不能误判通过。

## M2：同机原生接收方组合

```sh
LAM_CODEX_BIN=/absolute/path/to/verified/codex node scripts/codex-mcp-outbound-smoke.mjs --receiver codex --output /private/new/m2-mcp.json
LAM_CODEX_BIN=/absolute/path/to/verified/codex node scripts/codex-adapter-smoke.mjs > /private/new/m2-lifecycle.json
```

第一条将 Mock 接收方替换为显式注册的 `@lam/codex-adapter`，验证真实 Codex caller→MCP→本机加密 Mesh→另一个真实 Codex receiver，两个实例均用独立私有 home 和固定 loopback provider；不默认导出生产 Agent。第二条复用既有完整生命周期脚本，覆盖重启 resume/native ID 稳定、精确 retry、native decline + 相同写入模板正控、UNKNOWN 不重放、互斥及清理。两份原样报告及各自退出码一起交付；没有改动生命周期实现时，不将历史证据重命名为新源结果。

## 实体交接与 M3

这些脚本自动配对的范围仅限同一进程创建的两个 loopback 测试节点。不能把它们改成接受任意远端地址，也不能用于绕过实体双端人类短码核对。Windows W1/W3 与共享 S1 runner 提交后，M3 再按固定 SHA 审查接口、失败注入、拒绝、清理及脱敏规则；后续实际窗口仍按 `NEXT_PHASE_2026-10-26.md` E0→E5 执行。

本机通过仅支持 M1 及 M2 本机组合；B1/B2/B3 跨实体、Windows 主动 MCP、真实云端模型和原有 GUI 接管均需独立证据。#15/#17/#18/#19 保持开放，PR 不自动合入。

配置依据：[官方 MCP 配置文档](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)；实际工具事件结构以本机 0.146.0 `app-server generate-ts` 生成合同为准，不以当前在线文档反推历史版本能力。
