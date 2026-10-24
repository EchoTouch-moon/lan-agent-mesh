# #41 逐项完成审查

范围：PR #43 相对 #40；审查实现源 c5808ed、实际脚本、CI 原始日志和两份 hosted Windows 报告。结论：软件实现与受控 CI 已交付，**实体宿主验收仍缺失**，不标记 #41/goal 完成，不合并 #38～#43。此为本轮自查，不冒充独立安全审计。

| Issue 要求 | 当前证据 | 判定 |
| --- | --- | --- |
| 威胁模型：普通其他账号/进程、继承、reparse；区分管理员 | WINDOWS_PRIVATE_STORAGE.md 明确同 SID/管理员不可由此隔离；未知/条件 ACE 保守拒绝 | 已文档化 |
| 有效 ACL/owner 检查，不以 mode 代替 | windows-acl.cs 从句柄读 GetSecurityInfo，拒绝 null/空 DACL、未知/宽松 allow，原子创建私有 DACL，检查新文件 OI 继承 | 实现与 hosted 原生正负例通过 |
| 不安全即拒绝启动/签发，不改现有 ACL/防火墙 | Gateway 在 lock/key/db 前检查；control/rotate/MCP 读写同一门槛；输出失败撤销 grant；无不安全 Mock 旁路 | 实际 Gateway/CLI/MCP 与无秘密负例通过 |
| 明确用户操作指南与环境 blocker | 私有路径选择、存在目录只检查、无自动提权/修复；host report 支持 blocked/failed | 指南和执行包已提交 |
| 排除 reparse/路径替换，声明隔离级别 | 拒绝 junction/symlink/hardlink/网络路径；LIST_DIRECTORY 句柄不共享 DELETE，整条路径保留 lease；无 OI 规则拒绝新文件写入 | Windows 实际 rename 阻止/释放、helper 被终止后停服、继承/祖先/现有 key 负例通过；同 SID/管理员竞态明确排除 |
| Windows 真实用户宿主允许/拒绝及无泄漏 | 当前只有 hosted Windows；#39 是旧 SHA 的 ACL 观察 | **待办：必须回传实体宿主结果** |
| Mac/POSIX 与 Node22/24 × Mac/Win，联动 W2 | 四 CI 成功，Mac 实际 Gateway/MCP 报告；W2 新源回传尚无 | 回归已通过，W2 实机联动未完成 |

因果/隐私边界：负例要求明确的 ACL/owner/继承原因，不能用任意启动故障凑通过；MCP 公开假凭据先经同一 contract 校验，unsafe read 必须 exit 1 且带策略原因（非 timeout），正例为真实 SDK stdio；真实 bearer 从不放入不安全夹具。报告未包含私有路径、SID、IP、配置内容、token/key 或模型数据。未创建第二个系统账号登录试验，其他主体风险依据实际 allow ACE 与保守白名单验证，不冒充额外用户会话实测。

原生检查器由 Windows 构建从提交的 C# 源编译；运行时仅纯 .NET 加载和有界管道协议，不依赖 PowerShell cmdlet 自动加载。缺少二进制/运行时/无法检查均拒绝；不临时联网安装。软件代码本身须可信，此机制不防安装内容被篡改。
