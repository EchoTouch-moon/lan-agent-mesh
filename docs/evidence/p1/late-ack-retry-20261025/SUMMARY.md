# 过期 cached ACK 重发修复 — 本机证据

实现/执行源 `491d8f4a8604fe3f88b2eb40f9f8e41bdc51d55c`。正式探针先提交推送再执行，工作树干净；两个原始 JSON、确切时间/字节哈希见 [元数据](run-metadata.json)。**不是实体 W3 结果。**

- 定点回归在旧 Runtime 下 exit1，错误为 cached reply 的 `Message expired`；修复后包括 task/session 副作用不重复、畸形/错关联缓存拒绝、篡改/过期原请求拒绝均通过。完整检查50项定义，Mac47 passed/3 Windows-only skipped；本地原始日志只保留哈希，源码/测试字节与已提交版本匹配。
- [快速探针](fast.json) exit0：有效 cached transport 原样使用，`transportReplyRefreshed=false`；原请求/outbox retry 与事件不重复。
- [真实等待31000ms探针](aged.json) exit0：旧 ACK 过期后更新传输 messageId/deadline，`transportReplyRefreshed=true`；完整业务/关联/身份摘要保持一致；同一个逻辑 COMPLETED task、同一份事件。新回复不重写原 inbox 或重做 Adapter 操作。
- 两个探针均再次验证 RUNNING→CANCELLED、准备身份接管、关闭前接收端快照、撤销/缓存与临时资源清理。自测只自动配对两个自有 loopback 节点，无真实 Harness/模型/GUI。
- [执行源 CI](https://github.com/EchoTouch-moon/lan-agent-mesh/actions/runs/40158755888) 以最终状态为准，包含跨平台回归和标准探针；31秒等待是单独本机运行，不声称四个 CI job 都等待31秒。

新源是 #50 的后续修复，前一轮 #48/#49 和 #50 a65ec3e 自测记录保持原样。第二轮实体任务按用户要求保留，未启动新 LAN 监听；只有以后双方新窗口、相同经审查源与原始报告交叉验证后才完成 #15。修复依据见 [审查说明](../../../ACK_RETRY_REVIEW_2026-10-25.md)。
