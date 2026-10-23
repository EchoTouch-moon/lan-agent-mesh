# Mac 端交付复核

复核日期：2026-10-24（Asia/Shanghai）。交付 PR #34，原始交付 commit `a71fc7aabb8fa2f1418359753ddf359e7e0e971a`，测试源码 `6eadd08b10148be5f80f02b5b30712bdfb231e7e`。

## 结论与范围

在报告声明的版本与测试范围内，未发现阻止接收本轮调查结果的问题。交付的 8 个文件均为文档/证据，没有功能代码修改。复核通过不等于已经合并，也不等于所有 Harness 能力可用。

- 检查全部 6 份 JSON 可解析，测试源码 SHA 一致且包含最低诊断基线。
- 安装清单、布局、metadata 与 native 报告的 ZCode 版本及完整入口哈希一致。工程报告逐条命令退出码为 0，包含 27 项合同测试与两项 helper 检查。
- native 报告支持 ZCode 当前 3.16.3 版本的新建、固定响应发送/流式输出、进程重启后保留会话文本、在途取消、原生 deny 和标记未创建。其错误日志中的取消事件对应主动取消测试，不是额外运行故障。
- DSH stderr 明确为 profile 缺失；不将该结果扩展为平台不兼容。桌面 ACP 组件仅有静态证据，运行时继续 unknown。
- [PR CI run 39987950738](https://github.com/EchoTouch-moon/lan-agent-mesh/actions/runs/39987950738) 的 macOS/Windows × Node 22/24 四项检查均通过。CI 的 fake ACP 不能替代真实 DSH 接口测试。

## 本次修正

交付 native 报告中的 DSH stderr 仍有 `file:///` 安装前缀，已改为 `[DSH_CLI_PACKAGE_ROOT]`；保留错误、相对源码位置和原始文件 SHA-256，并补充遮盖说明。同步更新了仍声称等待 Windows 报告或 PR #33 未合并的进度文字。

## 证据限制

Windows 原始未脱敏文件留在执行机器；本端无法对其重新计算哈希，保留的原始哈希是执行端提供的溯源记录。本端做跨文件一致性、源码范围与 CI 复核，未在 macOS 冒充执行 Windows native 测试，也不重复跑无改动的功能测试。

ZCode 3.16.2 的原始超时原因仍未知，因为应用版本和探测版本同时变化。WorkBuddy 入站、Windows Codex、桌面 DSH 运行时和全部现有 GUI 接入保持 unknown。PR #34 目标仍为 feat/p0-foundation；后续研究/证据尚未因此进入 main。
