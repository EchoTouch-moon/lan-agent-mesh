# Windows 本地验证

**Windows LM 直接执行入口：[任务与 GitHub 回传约定](WINDOWS_AGENT_TASKS.md)。** 后续验证由 Windows 端从 GitHub 领取、执行并回传证据 PR，不再依赖用户中转文件。以下保留独立脚本的运行说明。

P0 基线已随 PR #33 合并到 main；后续 Windows 诊断与交接脚本仍在 feat/p0-foundation，实机证据见 PR #34。执行最新诊断任务时使用对应分支并记录实际 SHA。下列压缩包和手工回传步骤保留为历史运行说明；后续直接通过 GitHub 回传。

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

## Windows 原生接口验证包

布局报告已收到：ZCode 的入口文件与 Mac 实测文件哈希相同，因此验证包复用现有测试；Windows 的依赖和运行行为仍需单独验证。WorkBuddy SDK 与 Mac 版不同，暂不启动。DSH 桌面版和命令行仍分别记录。

1. 将 `lam-windows-native-probe.zip` 复制到 Windows 并全部解压。
2. 在解压目录打开终端，确认 `node --version` 为 22 或 24，然后运行：

```powershell
node .\probe-windows-harnesses.mjs
```

它默认读取 `%TEMP%\lam-windows-harness-layout.json`。若布局文件已移动，可将完整路径作为第一个参数传入。不要直接运行压缩包内的文件。此包只用 Node 标准库，无需安装项目依赖。

回传 `%TEMP%\lam-windows-native-probe.json`，即使报告包含 unknown 或失败也请保留。若尚未生成文件，请回传终端报错。报告可能包含安装路径，回传前可遮盖。

ZCode 会创建专属临时目录与会话，向本机环回地址发送固定测试请求，验证发送/流式输出、进程重启恢复、执行中取消和原生权限拒绝；权限测试只申请在临时工作目录写入一个标记文件，并回答拒绝。若实现意外执行了该操作，影响限于临时目录，并记录为失败。DSH CLI 只运行版本检查与 ACP 新建/关闭/列出/恢复，无提示词或推理请求；旧版本不支持时记录失败或 unknown，不升级。桌面 GUI、现有聊天、用户配置和真实模型账户均不使用。WorkBuddy 与未定位的 Codex 保持 unknown。

工程验证日志仍独立回传，不能由接口报告替代。

## 首次原生测试结果与诊断版 v2

首份报告已收到：ZCode 0.17.0 在新建会话阶段超时，尚未请求固定推理服务；DSH 0.1.1-rc.2 在初始化前退出。它们都不能记为通过，也不能仅凭本次结果判断产品不支持 Windows。DSH 的旧版发布包不会自动创建 ACP profile，首版探测在空临时配置中启动它的假设需要修正。

下载 `lam-windows-native-probe-v2.zip` 并解压到新目录，运行方式相同：

```powershell
node .\probe-windows-harnesses.mjs
```

回传 `%TEMP%\lam-windows-native-probe-v2.json`。v2 继续使用上次的布局文件，保留原报告；仅延长 ZCode 新建会话上限到 60 秒，并采集测试进程有限的启动错误、存储阶段、偏好请求/回复数量，以及本次临时目录中的启动日志摘要。路径和继承的密钥值会遮盖；不读取现有聊天/配置，不记录原生会话 ID 或完整日志。请仍在回传前检查报告。成功时会继续执行原本的固定响应测试，失败时保留诊断，不升级或修改任何安装。
