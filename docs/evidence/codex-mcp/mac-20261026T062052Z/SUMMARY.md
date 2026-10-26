# Mac M1/M2 原生 MCP 本机验收

正式执行源 `73364a13a03c7d6c8b8c7f6e105aaacd59368723`，先提交/推送，三次运行开始时均 clean。macOS Darwin 27.0.0 arm64 / Node22.23.2 / pnpm10.18.3 / Codex0.146.0；具体 OS 与二进制、脚本、产物哈希以原件为准。

- [M1 Mock 接收方](m1-mock.json) exit0/status=passed：真实 Codex 的原生 MCP 调用覆盖七工具（29次调用，包括预期拒绝及事件轮询）。不是 MCP SDK 客户端冒名；命名空间 function_call 由固定本地 provider 发出，Codex 自己执行 MCP stdio，验收逐条关联 native thread/turn/item 与精确参数。证明调用能力，不证明模型自主决策。
- [M2 Codex 接收方](m2-codex.json) exit0/status=passed：同机两个真实 Codex，显式 Codex Adapter、两 Gateway 加密传输、本地 MCP；精确响应/流、start/send exact retry、单逻辑任务、RUNNING后取消到CANCELLED且无completed、peer/workspace拒绝、已有但不属于grant的session以not_found隐藏、撤销后拒绝均通过。
- [M2 生命周期](m2-lifecycle.json) exit0/status=passed：复用既有脚本，同一新源重新验证重启后resume/native ID稳定、精确retry、原生decline及相同模板写入正控、UNKNOWN不重放、会话互斥和Gateway清理。6次固定loopback请求，没有外部模型配置。
- M1/M2新脚本独立核对原生进程组无成员、所有已创建Gateway/control/fixture端口拒绝连接、私有目录删除；三个正式命令退出码均实际观察到0。

## 明确的测试批准例外

默认原生策略会对四个有副作用的Mesh工具发起elicitation，默认拒绝已在failed-03留下原件。用户在本聊天明确批准**仅本轮隔离本机fixture**预设 `mesh_start_session`、`mesh_send_message`、`mesh_delegate_task`、`mesh_cancel_task` 的工具策略为approve。脚本只有显式传 `--fixture-tool-approval` 才添加四条精确覆盖；不默认修改生产配置、不回复接受任何native approval/elicitation。Codex接收方原生写入请求继续decline。此例外不扩展到实体远端、在线模型、GUI或无人监管运行。

## 失败原件及修复依据

七份 `failed-*.json` 原字节保留，退出码均为实际1：前两次未识别0.146.0的namespace工具编码；第三次按默认策略拒绝有副作用的MCP调用；第四次错误预期跨grant会话应permission_denied，实际合同是not_found，随后改为测试**真实存在的foreign session**且断言未创建任务；最后三次业务检查通过但清理核验失败，保持failed。

初期清理中单步断言阻止其他资源清理，后改为独立尝试所有清理步骤并保留失败。随后观察到已退出组的kill返回EPERM，不能由此判断是否尚有进程；改为读取`ps`的纯数字pid/pgid列，先查询实际组成员，有成员才发信号，最后必须无成员并观察原生child实际退出。空/截断/非法进程快照按失败处理；不把EPERM直接当清理成功。后续人工核对并清理先前保留的自有目录/进程，见metadata；没有按进程名杀其他应用。

## 验证与边界

`pnpm check`：build/typecheck/lint成功，107 passed/4平台跳过/111定义。新增脚本最终单独lint成功；合同检查覆盖模型文本伪装、错误线程/turn/server/tool/参数、重复/缺失原生结果、有效拒绝与错误进程快照，已接入四组CI。CI链接待PR回传；CI不运行已安装Codex原生探针，也不能代替本目录的本机证据。

仅M1/M2本机组合通过。Windows W1/W2/W3及S1尚未提交可供M3审查的新runner（本次读取GitHub时）；实体E0–E5/B1–B3、Windows主动MCP、真实模型/已有GUI继续未验收。父Issue不关闭，主干不自动合入，未重开任何LAN窗口。
