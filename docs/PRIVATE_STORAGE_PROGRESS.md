# #41 实施记录

- 2026-10-24：按用户“认领 GitHub 新任务并实施”的指令认领 #41；#42 为顺序协调，不推导合并/关闭权限。
- 基于已验证 PR #40 head 5fe46b8，分支 fix/windows-private-storage-gate。引入 @lam/private-storage，Windows 句柄级 DACL/owner/重解析点/硬链接检查与目录 lease；创建不存在的目录时原子私有 ACL，不修改已有 ACL。
- Gateway 启动、管理控制读取、身份轮换、MCP 输出/读取均受门槛保护。发生 helper 丢失时停止服务，启动异步间隙检查 lease。所有 Mock 同样受保护，不设置危险旁路。
- 加入受控 Windows 主机脚本、针对性边界测试和 CI 步骤；执行前先提交，最终结果与执行 SHA 单独归档。
- 当前本地检查：初版 build/typecheck/lint 通过，既有 43 项测试回归通过；新增测试仍在验证，最终测试数量/Windows CI 以后续结果为准。
- 必须保留：#41 实体 Windows 允许/拒绝验证尚待运行；宿主策略不可达时记录 blocked。#15 W3 未执行，真实 Harness 与真实模型未开放。#38/#39/#40 未合并。

- 首轮 Windows CI 40085198044 发现实质失败：metadata-only 的句柄不足以阻止 rename；fixture 的 Get-Acl 受 PS7/PS5 模块路径冲突影响；MCP 部分启动失败。保留断言，将 native open 增加 FILE_READ_DATA/LIST_DIRECTORY（不读取内容），锁定 helper 系统模块路径，fixture 改用 .NET ACL API；增加安全 reason code、有效假凭据负例与 helper 丢失关闭测试，后续 CI 验证修正效果。
