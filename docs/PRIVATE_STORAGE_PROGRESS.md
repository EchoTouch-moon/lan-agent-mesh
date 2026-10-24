# #41 实施记录

- 2026-10-24：按用户“认领 GitHub 新任务并实施”的指令认领 #41；#42 为顺序协调，不推导合并/关闭权限。
- 基于已验证 PR #40 head 5fe46b8，分支 fix/windows-private-storage-gate。引入 @lam/private-storage，Windows 句柄级 DACL/owner/重解析点/硬链接检查与目录 lease；创建不存在的目录时原子私有 ACL，不修改已有 ACL。
- Gateway 启动、管理控制读取、身份轮换、MCP 输出/读取均受门槛保护。发生 helper 丢失时停止服务，启动异步间隙检查 lease。所有 Mock 同样受保护，不设置危险旁路。
- 加入受控 Windows 主机脚本、针对性边界测试和 CI 步骤；执行前先提交，最终结果与执行 SHA 单独归档。
- 当前本地检查：初版 build/typecheck/lint 通过，既有 43 项测试回归通过；新增测试仍在验证，最终测试数量/Windows CI 以后续结果为准。
- 必须保留：#41 实体 Windows 允许/拒绝验证尚待运行；宿主策略不可达时记录 blocked。#15 W3 未执行，真实 Harness 与真实模型未开放。#38/#39/#40 未合并。

- 首轮 Windows CI 40085198044 发现实质失败：metadata-only 的句柄不足以阻止 rename；fixture 的 Get-Acl 受 PS7/PS5 模块路径冲突影响；MCP 部分启动失败。保留断言，将 native open 增加 FILE_READ_DATA/LIST_DIRECTORY（不读取内容），锁定 helper 系统模块路径，fixture 改用 .NET ACL API；增加安全 reason code、有效假凭据负例与 helper 丢失关闭测试，后续 CI 验证修正效果。

- 第二轮 CI 40085681453：Windows ACL 正负例、目录不可改名及 helper 丢失关闭均通过；MCP 仍在 helper 初始化超时。增加固定 phase 握手，待 helper 完成输入编码/编译初始化后才发送路径参数，排查其在 MCP stdio 子进程环境中的启动差异；不增加超时或跳过权限验证。另保留忙会话断言，仅延长可被 cancel 中断的 Mock 等待，避免 200ms 在编译负载下提前结束。

- 第三轮 40086194783 将剩余 MCP 失败定位为 helper_timeout_compile；原生正负例及租约断言继续通过。改为 Windows 构建阶段编译受版本控制的 C#，运行时固定加载构建 DLL，保持权限门槛和原启动上限；报告记录 DLL SHA-256。补 final directory 必须有当前 SID 的私有 OI/full-control 继承规则，避免新文件回退 token default DACL；新增无继承负例。

- 第四轮 40086716124 的 native 构建与 Mac 检查通过，Windows 主机脚本拒绝例/私有根通过但后续失败，报告仍标 failed。补每个阶段与白名单原因；runtime PS helper 移除 Join-Path/ConvertFrom-Json 等 cmdlet 自动模块加载，以纯 .NET 加载及有界 base64 行协议传递路径，继续避免 MCP 精简环境下的冷启动模块发现。未输出路径/凭据作为诊断。

- 第五轮 40087036656（执行 head ecf3037）四组 CI 全部通过：Windows 权限主机脚本和 stdio Mock 链路成功，原有/新增边界断言均保留。补强最后的因果判定：负例必须返回 ACL/owner/继承策略原因而非任意启动失败；公开假凭据先经过同一 contract 校验，再验证 MCP 仅因存储政策拒绝。后续收集最终源与对应 CI 证据。
