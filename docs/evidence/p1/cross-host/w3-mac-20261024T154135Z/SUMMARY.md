# W3 实体 Mac↔Windows 第一轮：已验证部分与缺口

固定 Gateway 源 `d226c2cc4bdea624e3807078a5b17f29aa380fa9`，双方均报告干净独立 checkout；Mac build/install exit0，Windows 环境/构建由 [就绪回报](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/15#issuecomment-6386328574) 和待审原始证据 PR 联合证明。只有 Mock，无真实模型/GUI。时间窗口见 [Mac 观察](mac-observations.json)。

## 已观察

- mDNS 双端未发现；手动地址连接与预期 Windows peer ID 匹配。首组码超过120秒确认被原生拒绝；第二组完整码由现场用户核对并分别确认，两侧信任建立。
- Mac→Windows 精确 `mock:cross-host fixture` 到 COMPLETED，读取完整 started/delta/delta/completed 及末尾空游标；同 key/taskId/deadline 重发返回相同接受结果；运行中 resume 原 nativeSessionId 不变。Windows 接收方计数仍待其原始 PR 复核。
- Windows→Mac 精确响应、正常恢复。首轮 retry 的 conflict **不算精确重试通过**；修正为完整保存参数的新案例后，Mac 接收方独立观察同一 COMPLETED 任务两次 accepted receipt、仅4条事件，与 Windows [修正回报](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/15#issuecomment-6386542335) 一致。
- Mac 观察约定 crash fixture 为 RUNNING，核对自有 PID 后 SIGKILL，exit137；同目录重启保留节点与公钥指纹，任务变为 UNKNOWN。Windows 在原 deadline 内原参数重试后，Mac 接收方记录同任务两次 accepted receipt、仍仅 started→unknown 两条事件；没有第二次执行。[Windows 复核](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/15#issuecomment-6386570751) 同样确认 UNKNOWN/no replay 和旧 Mock resume 的 not_found。
- Mac 撤销信任后 registry 返回 permission_denied（单独 CLI exit1）；最终 Gateway exit0，48731无监听、control/lock删除，临时 Gateway 数据已删除。只私密保留操作者 JSON 原件与 SHA-256，没有复制身份密钥、控制文件或数据库。

## 未完成，禁止升级为全通过

**#15 继续 OPEN**：没有注入 delivery ACK 丢弃；cancel 当时任务已经 COMPLETED，不等于在途 CANCELLED；Windows 原始报告与接收方计数尚待 PR 审查。CLI 操作轮次不含完整的可提交定点故障探针，部分早期组合命令未保留独立退出码；元数据只列确知值，不补造。

收尾前一次远端 registry 返回 invalid_message，不能把它解释为授权拒绝；本报告只认明确的本机 revoke 后 permission_denied。后续应使用先提交、记录执行 SHA 的定点 ACK/取消探针补证据，不能改写本轮原始结果。原始 hash 与源码/产物 hash 见 [元数据](run-metadata.json)。
