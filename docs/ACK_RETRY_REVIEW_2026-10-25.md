# 有效原请求重试遇到过期 cached ACK 的修复

## 问题与复现

Gateway 原请求可有2～4分钟 deadline，Router 的传输回执固定只有30秒。inbox 保存首次回执后，完全相同的原请求命中缓存会直接取回旧回执。若调用方未持久标记 ACK、超过30秒才从 outbox retry，原请求仍有效，但调用方验证旧回执时抛出 `deadline_exceeded / Message expired`，outbox 不能完成。

回归在真实两节点 loopback Gateway 间先丢弃已经关联核验的接受回执，保留原 outbox、完成任务，再只移动 `Date.now` 到原回执失效而原请求仍有效的时刻。旧实现确定性失败，新实现通过。另以真实等待31000ms的探针检查普通时钟/传输路径；这仍是本机自测，不是实体 W3。

## 修复边界

1. 先按既有流程验证原请求 schema/deadline、已认证 peer 与目标节点，再核对 inbox 的原 peer/完整请求指纹。
2. 校验原缓存回执的 schema、源/目标、correlationId 与 taskId 关联；畸形或错关联回执拒绝，不能在更新时间时洗成有效结果。原缓存回执仍有效时保持原返回。
3. 仅当缓存回执已过期时，用缓存的 type/payload 为同一请求生成新回执：新的 messageId 与30秒传输 deadline，关联仍指向原 messageId，task/双方身份来自已经核验的原请求。
4. 不进入 session/task 执行分支，不调用 Adapter，不增加任务或事件；inbox 原记录/指纹保留，容量界限不变。
5. 原请求本身已过期仍拒绝；同 messageId 篡改输入仍 conflict；不允许操作者更换原 taskId、key 或 deadline 来绕过拒绝。

## 验证与探针兼容

新增回归检查：旧 ACK 过期后的原 outbox retry 可以清除 pending；缓存业务结果不变；新回执关联/时效有效；单个 task 的事件和单个 session/native ID 不增加；原 inbox 未被改写；篡改及过期原请求继续拒绝。

PR #50 的探针同时保留完整回执字节摘要，并以**除 messageId/deadline 外的完整业务/关联/身份摘要**比较结果。这样可以验证合法的传输回执更新，并继续拒绝改变业务结果、请求 envelope、task 身份或终态的伪通过。是否更新传输身份作为独立观察记录。

本地完整检查的当前定义为50项（Mac47通过/3个Windows-only跳过），跨平台最终结果另以本修复源 CI 为准。新实体执行包必须固定经审查的修复源，不能把 PR #50 先前 a65ec3e 的记录改写成本修复已运行；#48/#49 的历史也保持原样。
