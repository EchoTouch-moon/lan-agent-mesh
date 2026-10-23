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

## Harness 安装版本采集（LAM-01）

工程日志验证基础代码；另运行 `powershell.exe -NoProfile -File .\scripts\inventory-windows-harnesses.ps1` 可采集已安装 Harness 的版本线索。它只查询 Codex/DSH 的版本及相关应用的卸载注册表信息，不登录、不调用模型、不启动 GUI、不访问会话。结果为 `%TEMP%\lam-windows-harness-inventory.json`，可与工程日志一起回传。路径可能包含本机用户名，回传前可遮盖。便携版应用可能不在注册表中，缺失项保持 unknown。此脚本是在初始离线压缩包发出后增加的，可从 PR 分支或聊天提供的独立文件获取；初始压缩包的基础代码保持不变。

## 已收到的安装清单与下一步

2026-10-23 回传清单确认：DSH CLI 0.1.1-rc.2、DSH 桌面版 0.2.1-rc.2、ZCode 3.16.2、WorkBuddy 5.7.7。Codex 未出现在 PATH，不等于未安装。两个 DSH 版本分别记录，不据此升级或修改安装。

下一步下载独立的 `inspect-windows-harness-layout.ps1`，在文件所在目录运行：

```powershell
powershell.exe -NoProfile -File .\inspect-windows-harness-layout.ps1
```

回传 `%TEMP%\lam-windows-harness-layout.json`。脚本只读取匹配应用的安装注册表、安装目录浅层文件名、特定入口文件的大小和哈希，以及命令行安装目录下的 DSH 包名/版本；不会执行卸载命令、命令行入口或桌面程序，也不读取用户配置、密钥或会话。报告可能包含安装路径，回传前可遮盖。

若便携版未被自动定位，可指定其安装目录（示例路径需替换）：

```powershell
powershell.exe -NoProfile -File .\inspect-windows-harness-layout.ps1 -ApplicationRoot "D:\Apps\ZCode"
```

本次布局采集仍不能代替真实接口测试。工程检查的 `lam-windows-validation.log` 也尚未收到，可一起回传。
