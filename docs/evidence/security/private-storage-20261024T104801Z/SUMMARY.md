# #41 私有存储门槛：软件验证交付

执行前已提交并推送的源码：`c5808edd96d6481496c42c53103b1ad17a82766a`。报告均指向该实际执行 SHA。此目录仅归档证据，不修改实现。

- [最终源码 CI](https://github.com/EchoTouch-moon/lan-agent-mesh/actions/runs/40087327389)：Mac/Windows × Node 22/24 四组通过；Mac 45 passed / 3 Windows-only skipped，Windows 47 passed / 1 POSIX-only skipped，总定义 48 项。
- [Windows Node22](hosted-windows-node22.json)、[Windows Node24](hosted-windows-node24.json)：**hosted runner** 上的实际 DACL/owner/native handle 验证，不是用户实体宿主。无密钥生成的拒绝例、私有允许例、正式 MCP SDK stdio、签发输出失败撤销、MCP 在读取解析前因 ACL 策略拒绝均 verified；临时数据/进程/句柄已清理。每个报告记录实际 DLL SHA-256（独立编译产物哈希不要求跨 runner 相同）。
- [Mac 独立 Gateway 进程](mac-process-smoke.json)：加密双向 Mock、崩溃恢复/不重放、身份延续、退出通过。
- [Mac 实际 MCP](mac-mcp-smoke.json)：七工具、流、幂等、异步任务、取消、管理边界、撤销通过。
- [元数据与哈希](run-metadata.json)、[逐项审查与缺口](REVIEW.md)。源码条目哈希是 Git blob 规范化 LF；没有将其冒充 Windows checkout 原始 CRLF 哈希。Mac 本地全套检查对应较早的 2281194；最终 c5808ed 的全矩阵结果来自上述 CI，正式 Mac 进程/MCP 报告也使用 c5808ed。

[PR #43](https://github.com/EchoTouch-moon/lan-agent-mesh/pull/43) 基于 #40，不合并父 PR、不关闭任务。操作/实机执行见 [私有存储指南](../../../WINDOWS_PRIVATE_STORAGE.md)。

**未完成门槛**：用户 Windows 实体机还没有运行本修复源的允许/拒绝案例；#39 的旧主机 ACL 观察不能代替复验。#41/G2 继续开放，#15 W3 实体 Mac↔Windows 仍 pending，真实 Harness 和长期真实凭据未放行。所有演练仅为自有 Mock/本地 IPC，外部模型调用为 0。
