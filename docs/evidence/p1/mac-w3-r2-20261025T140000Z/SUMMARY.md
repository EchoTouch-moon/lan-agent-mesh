# W3 第二轮定点 Mock：Mac 侧证据

Run：`w3-r2-20261025-long`。执行源：`8c6b4c614140280a0b990a4e80db858c41e3be75`，两角色启动前均为干净源码；本证据提交只归档，不冒充其自身执行过探针。

Mac `darwin`、Node `v22.23.2`、pnpm `10.18.3`。Mac/Windows 实体机使用同一提交；Windows receiver 已由 #62 回传并完成交叉核对，**本轮定点 ACK／在途取消双端证据通过**。最终复核及原始记录限制见 [CROSS_REVIEW.md](CROSS_REVIEW.md)，不宣称 #15 全部用例在单一 SHA 重新验收。

## 执行结果

- prepare：UTC 2026-10-25 14:00:38.277 → 15:18:58.522，认证 shutdown，退出0，`prepared`。端口释放，专用身份按协议保留给 runner 接管。
- runner：UTC 15:19:31.246 → 15:19:53.987，退出0，`passed`；远端报告平台 `win32`，新 peer 摘要与本轮 Windows READY 一致。
- delivery ACK：收到真实关联 `task.accepted` 后、outbox ACK 前在调用方 API 边界受控丢弃。原完整 envelope 重试，outbox 保留后清除，完整事件不增加，单个逻辑任务 COMPLETED。不是抓包证明网络丢包。本轮没有刻意等待30秒旧回执过期，`minimumAckAgeMs=0`。
- 在途取消：独立任务先观察 RUNNING/started，再取消；终态 CANCELLED，事件为 started/cancelled，没有 completed。
- 撤销：调用方缓存存在时 revoke，之后卡片不可用，registry 拒绝。
- Mac 清理：runner 自行停止 Gateway、验证端口释放、删除本轮 data。prepare 与 runner 的退出码均实际观测到0；不是根据文件或“已启动”消息推断进程结束。原始操作记录仍在本地私有目录，不发布其中的地址或短码。

## 配对与窗口

用户在本聊天明确授权本轮开窗、独立核对完整码，并批准 Mac；Windows 操作者在当地独立核对并批准。最终配对同时观察 localConfirmed/remoteConfirmed，真实 registry 授权成功后才运行 runner。

Mac 记录三次配对请求：第一次答复到达时已过期；第二次 Mac 已在有效期内确认但未及时收到 Windows 确认，过期后真实 registry 仍 permission_denied；第三次完成双侧确认。所有旧值均未重新使用，未延长120秒配对码时效。Windows 评论按其可见/处理次数记述，不能据此推断 Mac 请求总数。第一笔的本地编排遗漏了 shell 失败即停止，前置到期检查失败后又调用了缺少参数文件的 CLI，该调用也失败；没有执行有效 confirm，编排最终退出0不用于证明确认成功。后续命令启用失败即停止，最终成功由当前 pending 状态与实际授权请求独立证明。

共同窗口 UTC 14:00→18:00（北京时间25日22:00→26日02:00），按晚启动的剩余预算等待；Mac timer 记录到期18:00:00.529，Windows READY报告到期18:00:10.662，未把启动耗时当作延长共同窗口的授权。实际任务提前完成，Mac已清理，不等待窗口结束。mDNS 未发现，使用先前私密提供的端点作候选，连接后核对本轮新身份摘要；不复用旧信任或旧节点。

## 范围与待办

这里只补 #48/#49 第一轮缺失的定点 ACK/在途取消证据。不是重跑第一轮全部双向流程，不证明真实 Harness、GUI、真实模型或硬杀恢复。第一轮与本轮的不同执行 SHA 必须分开记录，不能称“单一 SHA 完整重跑”。

`prepare.json`、`runner.json` 是探针自动生成的原样报告，含源码、产物、探针工作字节哈希及角色清理结果。复制前扫描未见私密地址、用户绝对路径、完整短码或凭据；未导出数据库、身份密钥、control 文件。Windows 原样报告、主进程退出0、请求与业务摘要、两个固定任务的完整事件、撤销及清理记录已核对；辅助命令退出码与精确配对时刻未独立留存，已明确 unknown，不补造。#15 整体历史覆盖与后续真实 Harness 工作单独保留；无合并/关闭授权。
