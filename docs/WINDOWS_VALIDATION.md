# Windows 本地验证

此包包含当前 P0 源码及锁定依赖文件，在实现 PR 合并前，GitHub main 分支仍不包含这些代码；请使用此压缩包或对应实现分支。

1. 将 `lan-agent-mesh-p0-windows.zip` 复制到 Windows，用系统“全部解压缩”解压到普通用户可写目录。不要直接在压缩包里运行。
2. 准备 Node.js 22 或 24。安装后重新打开终端，运行 `node --version` 确认。
3. 在终端运行 `npm.cmd install --global pnpm@10.18.3`，然后确认 `pnpm.cmd --version`。
4. 双击解压目录的 `scripts\verify-windows.cmd`。也可以在项目目录的终端运行 `powershell.exe -NoProfile -File .\scripts\verify-windows.ps1`。
5. 等待安装、构建、类型检查、lint、测试和离线演示结束。出现 PASS 表示本次离线检查通过；失败也请保留日志。
6. 日志在 `%TEMP%\lam-windows-validation.log`。回传这个文件即可。系统转录可能包含本机用户名、目录和机器名，发送前可自行遮盖这些信息；请勿添加任何密钥或密码。

如果系统阻止 PowerShell 脚本，先把报错文字回传，不需要修改整机执行策略。脚本不会请求管理员权限。安装依赖需要网络；测试和演示使用 Mock，不调用模型服务，不连接其他机器，也不会更改现有 Harness 配置或 GUI 会话。

此脚本验证的是工程的 Windows 兼容性，不能代替 Codex、DSH、ZCode、WorkBuddy 的真实接口实测。后者需要在基础检查通过后，按实际安装版本分别验证。
