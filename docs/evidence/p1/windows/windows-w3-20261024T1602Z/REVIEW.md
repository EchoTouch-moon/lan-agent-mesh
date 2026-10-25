# Mac 端交叉复核（2026-10-25）

复核对象：PR #48 原始 head `21ee440e5d3604d21d33cb06a77c32b80c6744df`，只新增三份 Windows 操作者整理的证据，没有实现变更。执行源为 main `d226c2cc4bdea624e3807078a5b17f29aa380fa9`，与 Mac 本轮实际运行源相同；该 head 的 [CI 40111428449](https://github.com/EchoTouch-moon/lan-agent-mesh/actions/runs/40111428449) 四组成功。

## 接收的观察与依据

- Windows 与 Mac 的临时公开 peer ID 和执行源相符。完整码只在两侧本地展示；Mac 聊天中有人类明确比对确认，原生双侧 confirmed 后真实跨主机注册表请求成功。
- Windows→Mac 精确文本与恢复观察获得 [Mac PR #49](https://github.com/EchoTouch-moon/lan-agent-mesh/pull/49) 的接收端独立记录支撑：修正后 COMPLETED task 为两次 accepted receipt、仅4条事件；受控硬杀 task 在 RUNNING 时终止、exit137，同身份重启后 UNKNOWN；原参数 retry 后两次 accepted receipt、仍仅 started→unknown 两条事件。双方对原 task 的结果相符。
- 同一活实例下 resume 保留 ID、跨重启旧 Mock native state 的 not_found 与当前 Mock 的设计一致。不能把它解释成真实 Harness 的持久 resume 已验收。
- 撤销/停机、端口/文件检查可作为 Windows 操作者观察归档。长驻 Gateway 的独立退出码没有保留，原 stdout log 的 SHA 是空文件，原 stderr 指向更早的失败启动；这些日志不能独立证明实际长驻实例的生命周期。本报告不把其缺失值补为 exit0。

## 发现与处理

1. **[P1] “All W3 checklist items verified” 范围过大。** 实体 delivery ACK 丢弃注入没有执行；cancel 观察为 COMPLETED，不能算在途取消。本轮允许接收已观察子项，#15 整体验收仍未完成。PR 摘要和 SUMMARY 已明确 partial。
2. **[P2] “未见 Mac 入站任务”不能证明没有入站。** Mac 实际向这个预期 Windows peer 完成 spawn/send、精确响应与原参数重试；私密原件的 peer/task/session 哈希已在 #49 归档。Windows 没有附上接收方诊断/任务计数或有效长驻实例日志，因此只能说“未采集该接收方观察”，不能据此否定已发生的投递，也不能认定 Windows 接收端去重计数已独立核验。SUMMARY 修正表述，两个原 JSON 保留原字节并在此限定解释。
3. **[P2] 本目录是整理后的观察，不是完整原始事件/逐命令日志。** 元数据保留了部分本地原件哈希，但没有原始 JSON-RPC 事件、全部时间与逐命令独立退出码。`cached cards unavailable` 也没有对应的独立原始返回值。接受操作者回报，不能升级成独立原始记录已经完整复核。

原提交中两个 JSON 的 SHA-256（本次不修改）：

- `w3-transcript.json`：`b9e9ab46c7162628e0474fa541f172a6765440e700f2375a755ad20958aeb82d`
- `run-metadata.json`：`c2676a1d801b235ce4ba5b7bdebd557b7b69f6485816398f2fc50c6205ab3de1`

这不是拒绝实际跨主机观察，也不要求重跑已由双方证据支持的子项。后续仅补先提交、记录执行 SHA 的定点 ACK/在途取消探针，并在同一轮附接收方计数/事件与清理证据。#15/#42 G1 保持未完成；此复核不授权合并 #48/#49、关闭任务或启用真实 Harness。
