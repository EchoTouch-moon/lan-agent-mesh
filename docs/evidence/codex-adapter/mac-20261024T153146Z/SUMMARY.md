# Mac Codex Adapter 最终实现固定响应复验

执行源 `ad202f5ae893d54da1bf6cd963c6c641b764cad2`，已先提交并推送，运行前工作树干净。macOS / Codex 0.146.0 / Node v22.23.2；[原始报告](codex-adapter-smoke.json) exit 0，6 次 loopback 固定响应请求，清理 verified。

六组结果 verified：send/stream；进程重启 resume + 精确重试；在途取消/单 session 互斥；原生 decline + 相同命令模板写入正向对照 + 目标 ENOENT；UNKNOWN 重启不重放；同机两个加密 Gateway→Codex→固定响应与关闭生命周期。Windows Codex unknown、physical W3 pending、GUI attach unsupported。

本次 source 在之前 91772b1 基础上额外拒绝**所有残留 Adapter lock**，不根据父 PID 消失推断原生子进程已退出。该定点拒绝行为由合成进程回归测试覆盖，四项通过；不声称真实杀掉 Gateway 父进程后自动恢复。本次真实 Codex 复验涵盖最终实现的正常关闭/恢复和 UNKNOWN 语义。

之前 91772b1 的本机 `pnpm check` 54 项定义、51 passed/3 Windows-only skipped；[当前源完整 CI](https://github.com/EchoTouch-moon/lan-agent-mesh/actions/runs/40107364905) 四组全部成功，单独对应本次实现源。证据严格区分这两个来源，详见 [run-metadata](run-metadata.json)，含本次脚本/TS/dist JS/原始报告/二进制哈希。

仅配置本机 loopback provider，未导入模型凭据；未作抓包级网络审计。同机自动核对配对码不是实体 W3 的人工核对，Gateway 调用不是 Harness 主动出站 MCP。#15/#17/#19 继续开放，无真实模型/长期凭据放行。接口与使用边界见 [说明](../../../CODEX_ADAPTER.md)。
