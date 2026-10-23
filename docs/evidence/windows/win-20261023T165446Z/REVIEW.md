# Mac 端第二轮复核

复核日期：2026-10-24（Asia/Shanghai）。原始交付 commit `85a3c37515a19efb5dbeb5b2fac2b8eb767cd735`；相对前轮 `da5eeeb` 新增两份探针及本轮证据。

## 可接收的观察结果

- DSH 桌面 0.2.1-rc.2 的执行端报告支持 ACP 元数据生命周期：initialize 返回 protocolVersion 1、agent deepseek-harness-acp；新建返回 ID、关闭后列表包含原 ID、恢复接受原 ID，进程 exit 0。这里只接收这些实际行使过的能力，不扩大到发送/流式输出、执行中取消、审批或 GUI 接入。
- WorkBuddy 的 61,239 字节 guest SDK 哈希与前轮布局一致；三个字符串标记只表明渲染传输结构，能力保持 unknown。
- Codex 搜索定位到了显示名 ChatGPT、身份 OpenAI.Codex 的 MSIX。它未证明包内缺少 CLI，也不能从用户 .codex 目录存在推断独立 CLI 用过。保留原始观察，修正了排除性推断。[官方文档](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan)说明 ChatGPT 桌面可承载 Codex，因此显示名不能用于排除 Codex 功能。

## 修正与验证

1. 运行时证据的 testedSourceSha 原指仓库基线 da5eeeb，但该 commit 不含本轮新脚本，无法独立复现。保留旧字段并明确其含义，补充首次提交 85a3c37 的脚本归档 SHA-256；这不是单独保留的运行前源码快照。下一次真实运行应先提交脚本，记录实际执行 SHA 和脚本哈希。未伪造或倒填一份运行前快照。
2. 新探针的 cmd.exe 调用需要明确的外层引号和 verbatim 参数，才能可靠处理常见带空格的安装路径。已补固定参数引用、关闭 AutoRun/延迟变量展开、拒绝路径中的引号和百分号展开，并新增 Windows fixture 覆盖空格、字面 &、临时 home、返回值和错误路径。
3. session/new 不含有效 ID 时，原脚本仍将 create 标记 verified。现改为 unknown / 非零退出；未找到原 session 的 list 结果也不再标为 verified。失败诊断复用现有密钥/用户路径/原生 ID 遮盖，并覆盖安装根目录及其 JSON/file-URL 表示。
4. cmd 包装进程超时清理只针对本探针启动的 PID 及其子树，避免只结束 cmd 而留下无头宿主。Windows fixture 包含拒绝退出的测试宿主；不会按进程名结束其他应用。

这些改动属于后续探针加固，不是原 Windows 桌面实测的重新执行；原报告及原始文件哈希保留。新检查使用 fake ACP，只验证探针自身，不能取代真实安装实测。执行端对正式 launcher 的无头契约给出了说明，但尚未归档该安装脚本的哈希或脱敏内容；本端不把其叙述升级为独立验证的 GUI 行为证据。

## 剩余范围

DSH prompt 级测试需要可证明隔离的 loopback fixture；OpenAI.Codex 包内的可执行文件尚未检查。后续允许静态查看包安装元数据、清单与程序文件名，禁止读取用户配置、凭据或会话，也不启动 GUI、不安装/升级工具。ZCode 已通过版本的能力不因本轮复核重复运行。

本 PR 包含 #34 的祖先提交，目标仍为 feat/p0-foundation；没有执行合并。代码谱系与 main 的集成应依据实际 PR 状态处理，不能将“叠加”解释为任意合并策略都无差异。
