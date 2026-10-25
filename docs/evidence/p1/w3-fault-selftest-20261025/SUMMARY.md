# W3 定点故障探针本机验收

执行源 `a65ec3e58837152df854186a0cdaf82f6a4a0f19`，脚本先提交推送，运行前工作树干净。**这是同机 self-test，不是实体 W3 完成证据。**

- [标准延迟](fast.json) 和 [每块10000ms延迟](slow.json) 均 exit0/status=passed；源/产物/工作字节哈希在各报告，原始报告字节 SHA-256 和确切时序见 [元数据](run-metadata.json)。同源码 [CI 40114103895](https://github.com/EchoTouch-moon/lan-agent-mesh/actions/runs/40114103895) macOS/Windows × Node22/24 四组成功，含 build/typecheck/lint/test 与新增自测。
- 真实本机两节点传输先接受 task，再在调用方 API 边界丢弃 correlated ACK；outbox 保留原 envelope，原 outbox retry 后清除；两次接收同一 envelope/缓存 reply 摘要，接收方仍只有一个 COMPLETED task、四条事件。
- 独立 task 先观察 RUNNING，再发取消，得到 started→cancelled/CANCELLED，没有 completed。
- 测试准备节点的显式停机、同标记/同身份/同信任接管、接收方 Store 关闭前快照、撤销拒绝与卡片失效；最终所有自有 Gateway/端口/临时数据清理。自测自动配对只在自己创建的两个 loopback 节点之间，不作为人工比对记录。
- 验收器拒绝把 ACK/cancel 两个任务终态交换、不同 envelope 重发伪装为通过；接收方查询全部固定 fixture tasks，避免只数已观察回执而漏掉额外逻辑执行。

Gateway 业务/权限实现没有改动。第一轮 #48/#49 的缺口仍存在，只有以后双方相同已提交 SHA、现场人工配对、receiver+runner 报告交叉验证后才可勾选。下一轮只补缺项，操作见 [说明](../../../W3_FAULT_PROBE.md)。原错误/修正历史未重写，不补造第一轮退出码或修改原始观察。
