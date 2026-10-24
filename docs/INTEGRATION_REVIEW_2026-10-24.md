# G0 集成候选与审查记录（2026-10-24）

状态：本机审查与候选实现已准备，尚未合入 main；不关闭 #15/#41，不宣称实体双机或生产验收完成。关联 [#42](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/42)。

## 确切来源与整合范围

| 来源 | 固定 head | 内容与状态 |
| --- | --- | --- |
| 当前 main | 3ff683ee32a876b6f2082c260ac8a4713e2a8427 | P0 + 新阶段规划；NEXT_PHASE 与路线图必须保留 |
| PR #38 | d68fa6ac8eca1678745fb44813b27a1126d605a3 | P1 SQLite/Noise/TCP/Yamux、配对、registry/session/task、Mock、Mac 证据 |
| PR #39 | 70bf9c4018f7c7170117d4be350a977b343e5147 | 以 #38 为祖先，仅六份 Windows W1/W2/W3-pending 证据文件 |
| PR #40 | 5fe46b82b41eaf4ccffc221507c98c9d7589571e | 以 #38 为祖先的 scoped MCP 七工具、实际 stdio、Mock 测试 |
| PR #43 | bcd34be0018df9ce447006e5259f6e75963865d5 | 以 #40 为祖先的 Windows ACL/owner/inheritance/namespace gate 及其证据 |

本地候选从当前 main 创建，按 #38 → #39 → #40 → #43 做非快进合并；所有固定 head 都保留为祖先，不 cherry-pick 重复 P1 补丁。只在 README/ROADMAP 发生 #38 与 main 的状态文案冲突，保留较新的 main 规划，再补候选状态；没有拿旧分支覆盖 NEXT_PHASE_2026-10-24.md。此为**候选分支上的 Git 整合**，并非 GitHub PR 已合并或主干已改变。

## 可复现发现与纠正

1. **P2：会话操作持久化无容量上限。** Router 在调用 native spawn/resume 前记录 `operation/<peer>/<key>`，即便 agent/workspace 拒绝也保留不确定记录。原实现对这一 namespace 没有计数门槛；1000 条记录后第 1001 个请求仍成功并创建新 session。`packages/runtime/test/router-capacity.test.ts` 在修复前失败、修复后通过；现在新操作最多保留 1000 条，满额在任何 adapter 副作用之前返回 busy。exact retry 在门槛之前解析，已有成功回执/未知记录不删除，避免为腾空间重放副作用。这与 inbox/outbox/task/session/MCP 既有 retention gate 一致。
2. **证据导航链接失效。** #39 SUMMARY 中的 `../mac-...` 指向 windows 子目录内不存在的位置；已改为 `../../mac-...`。五份原始 JSON 内容不变，Windows 源码 CRLF 哈希仍按原报告解释，不以规范化 LF 哈希替换。
3. **当前 main 的规划与候选内容不一致风险。** 手动审查并解决两处状态冲突，保留新的阶段/出站 MCP 未验证说明；更新 checkout 的 package layout 与候选/硬件/生产区别，避免旧 README 声称 MCP 尚未实现或计划文档被回退。

## 代码审查覆盖

- #38：Noise peer ID 与 envelope source/target 一致性；双边短码确认前的私有请求拒绝；撤销/身份轮换；导出 Agent/workspace；持久队列与唯一 key；UNKNOWN 不重放；单会话互斥；默认 native permission deny；重连、缓存失效；IPC loopback/bearer/Origin/帧大小/并发/速率边界；PID lock 和退出清理。补齐上述 operation retention 缺口。
- #39：固定 head 的 parent/merge-base、相对 #38 六份证据差异、八份源码原始哈希与 Windows CRLF 对应、两份 smoke 报告原始哈希、JSON/时序与清理、ACL 和 W3 限制。接受 Windows 本机软件观察；不将 W2 containment 等同 ACL 隔离，不将本机进程当作跨实体主机。
- #40：凭据 boot/过期/撤销、Peer/Agent/workspace 范围、每凭据资源归属、同 requestId 的去重/并发/跨工具冲突；Gateway 生成远端 taskId；丢 ACK 原 envelope 重试；UNKNOWN；MCP 管理/审批越权拒绝、真实 SDK stdio/旧协议兼容、stdout 不输出 bearer。保留七工具限制。
- #43：默认拒绝、不修改既有 ACL、原子私有目录、OI 继承规则、owner/DACL/未知 ACE、reparse/hardlink/祖先句柄；helper 失效停服；control/rotate/MCP 读写；负例必须有 ACL 因果理由。参考既有 [逐项安全审查](evidence/security/private-storage-20261024T104801Z/REVIEW.md)，实体宿主仍缺失。

这是一轮集成自查，不冒充独立第三方安全审计。未来 native Adapter 实现仍须按 #17/#18 验证真实超时、事件/身份映射和原生权限；当前只放行 Mock 软件候选，不用 Mock 的行为证明未知 Harness。

## 验证与完成判定

本机 `pnpm install --frozen-lockfile`、`pnpm check` 已通过，Mac 46 passed / 3 Windows-only skipped，共 49 项定义；Windows 预期执行其对应平台断言，结果以候选最终 CI 为准。正式独立进程与 MCP 演练必须在候选提交并推送后的干净源执行，保存实际 SHA、报告/源码哈希与清理情况。CI、执行源和祖先核验写入后续证据，不借用父 PR 的绿灯作为本候选的结果。

G0 仍需要：当前候选完整证据、审查、明确主干合并授权，以及合并后的 main CI；不会因为此文档自动勾掉 #42 的 G0。#15 的 W3 必须两个物理宿主同一 SHA + 真人短码核对；#41 需要用户 Windows 宿主本修复源的正/负回传。两者都不能被本机/hosted 结果替代，真实 Harness/长期凭据门槛继续保留。
