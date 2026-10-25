# Mac Codex Adapter 固定响应证据

- 执行源 `91772b1902c5950465bc80f1c46b1fe5173e04fe`，运行前源码已提交并推送、工作树干净；Codex 0.146.0、Node v22.23.2、macOS。完整窗口见原始报告。
- `pnpm check` exit 0：54 项定义、51 passed、3 Windows-only skipped；本机原始日志仅记录 SHA-256。
- [原始 Adapter smoke](codex-adapter-smoke.json) exit 0：send/stream 精确文本、重启后原生 ID 不变的 resume/原任务重试、在途 cancel/单 session 互斥、原生 decline + 同模板写入正向对照 + 目标 ENOENT、重启 UNKNOWN 无重放、同机双 Gateway 加密传输→真实 Codex→固定响应均 verified；Adapter 清理由 Gateway stop 接管。
- loopback 固定服务接收 6 次请求；未导入账户/模型凭据，仅配置该服务为 provider。报告的 externalModelRequests=0 表示该测试没有调用外部模型，不声称做了抓包级网络审计。
- 原始报告、原生二进制、执行脚本、TS 源码及本次 dist JS 的 SHA-256 见 [元数据](run-metadata.json)。哈希为原始 LF 字节，不是 Windows CRLF 投影。无原生 ID、私有路径、配对码、令牌或原生 stderr。

**边界**：这是本机固定响应 Adapter 证据；同机双 Gateway 自动核码不是实体 W3 的人工短码比对，也不证明真实 Harness 主动调用出站 MCP。Windows Codex unknown、GUI attach unsupported，真实模型/长期凭据未放行。#17/#19/#15 继续开放。核心接口实现及未完成范围见 [Adapter 说明](../../../CODEX_ADAPTER.md)。
