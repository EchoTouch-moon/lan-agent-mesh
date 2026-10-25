# 第二轮双端交叉复核

结论：**接收本轮实体 Mac→Windows 定点 Mock 的 ACK 重试、在途取消、撤销与清理证据**。本轮双方已停止，不必等到约定窗口结束。没有自动合并或关闭 #15，没有开启新的真实 Harness 窗口。

## 固定原件

| 项目 | 固定版本／SHA-256 |
| --- | --- |
| 实际执行源码 | `8c6b4c614140280a0b990a4e80db858c41e3be75` |
| Mac prepare 原件 | `7dd31a037c35d540c3f43636e7aeb167f79c8f58d719f183dda27e4c638e2c38` |
| Mac runner 原件 | `3e7020278cd8ce4f1374c865861b80a89ddf0423b1ada275edf235c3f28b39a5` |
| Windows receiver 原件 | `d098b993b7049efaa7bb941559939d82378ca4f9beef4e482b927bca0de6e35f` |

Mac 原件在本目录，最初归档提交 `d5f96cef049828167810a533fea2fed61900aba7`（#61）；Windows [原件与整理元数据](https://github.com/EchoTouch-moon/lan-agent-mesh/tree/0068e6248d33b6f205c5841d8d6a24f83e7a4fdd/docs/evidence/p1/win-w3-r2-20261025T140000Z)在 #62，最终复核提交 `0068e6248d33b6f205c5841d8d6a24f83e7a4fdd`。Windows 最初提交 `b73ba0003d8755e8bbb6f89a2165aab59ca6334d` 之后仅修正 SUMMARY/metadata，receiver 原件未修改。

## 逐项核对

- 双方相同完整执行 SHA、启动前干净；双方节点 ID 摘要互相匹配，Mac 观察远端 `win32`，Windows 记录对端 `darwin`。
- ACK 有两次相同 envelope、相同业务 outcome 和同一个 task 的投递记录，对应唯一 COMPLETED 任务。双方四个完整事件（started/delta/delta/completed）、顺序和固定文本完全相同。
- 另一 task 先 RUNNING/started 后取消；双方事件均为 started/cancelled，没有 completed。Windows 固定 fixture 总共只有这两个逻辑任务。
- 三条接收投递时间均落在 Mac runner 的 UTC 15:19:31.246→15:19:53.987 窗口内。
- Mac 在缓存仍有卡片时 revoke，后续 registry 拒绝、卡片不可用。Windows 后执行 revoke，其 cachedBefore/After 均0；运行中确实曾填充缓存，探针内部断言 `g.sync` 因 permission_denied 拒绝。当前0值不能归因为此次 Windows revoke 独立清掉了卡片。
- Mac prepare/runner 和 Windows receiver 的主进程退出均实际为0。Windows receiver 于 UTC15:28:11.649 认证关闭，报告 control_shutdown；两端报告端口释放、Gateway停止和本轮data删除。没有用状态文件推断进程退出。
- 六份 canonical 源码哈希匹配固定 Git 源；Windows 探针工作字节哈希由同源 CRLF转换得到，Mac 为LF。五个 dist 哈希相同；storage产物的差异匹配源码及编译配置未改变的 Windows CI 构建，不能把源文件换行差异误判成另一个实现。

请求、业务及任务的完整摘要见双方原件，未根据评论缩写重建或改写报告。

## 已校正的整理限制

Windows 的 pnpm 和辅助 control 命令经 bash 管道/grep/tail 执行，最初误记的0是管道末端退出码。独立 pnpm/Node CLI 退出码未留存，最终 metadata 已记 null/unknown；HTTP响应体和原始探针断言是相应行为证据，不能声称所有辅助命令均退出0。receiver 主进程直接运行并单独捕获退出0，未受该管道问题影响。

精确 Windows confirm 时刻未独立记录，metadata 已删除15:17:xx占位并记null。Mac三次配对请求前两次过期、第三次成功；Windows本地只观察到两个pending，记录的是不同计数口径。最终双侧信任由当前 pending 双确认、Windows trusted:true、Mac实际registry成功和后续双方匹配的任务共同支持。没有复用过期码，没有延长120秒有效期。

上述未知项明确保留，不根据预期退出码补造，也未重跑已清理的节点。最初 Mac 编排未在过期检查失败后停止的问题保留在 SUMMARY；该次没有有效confirm，最终成功依赖独立的实际确认与授权结果。

## 验收范围

这份复核补齐第一轮 #48/#49 所缺的定点 ACK/在途取消及本轮接收记录。第一轮执行源 `d226c2c` 与本轮 `8c6b4c6` 必须分开对待，不能称作所有双向、恢复及负例在同一新 SHA 完整重跑；第一轮原始记录局限不因此消失。

本轮只涉及 Mock；没有证明真实 Harness 主动 MCP 出站、Mac Codex→Windows DSH、GUI、真实模型、网络抓包丢失或硬杀恢复。#15/#18/#19 的总体状态和候选代码集成另行审查，不从本轮通过推导合并、关闭或部署授权。
