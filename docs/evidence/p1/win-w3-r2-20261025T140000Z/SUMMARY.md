# Windows receiver 证据 — run `w3-r2-20261025-long` — **passed（待 Mac 交叉复核）**

专用源 `8c6b4c614140280a0b990a4e80db858c41e3be75`（`codex/w3-long-window`；本证据分支基于该源，仅追加本目录）。窗口：UTC 2026-10-25 14:00→18:00，receiver 实际 `--wait-ms 13210404`（到期 18:00:10.662Z），14:19:58 启动、15:28:11 认证关闭（`control_shutdown`），退出 0。

## 配对

三次请求：第一次码 120 秒内操作者批准未达（confirm 按预期 `permission_denied`，过期 pending 清理，未重放）；第二次码在有效期内双侧确认（Mac 侧 remoteConfirmed 在先，Windows 侧操作者核对同码后批准，`{"trusted":true}`）。码值全程未公开。本机 mDNS 不可用（TUN 环境），按既定私密渠道手动寻址。

## 接收记录（与 Mac RUNNER_DONE 锚点全部匹配）

| 锚点 | 值 |
|---|---|
| ACK task 摘要 | `14e5a0de997c17c9737225faad6c6c25e9202a1b519f77e10c280d3cb749d3d4` |
| 原 envelope 摘要 | `99b178f54ea274164bb9bb99d9e92707f9a09bc1c1ab19922c1c3a9040846162` |
| replyOutcome 摘要 | `c481874e98d6c4c8122d30997a86f6a50d8a075715bb5bb3d94522f0c9274bb0` |
| 取消 task 摘要 | `bd9a7b587532e8330a06b9be50876d0e12f7a06943be3ed05186a110de693acc` |

- **同一 envelope 两次投递**（15:19:32.068Z 与 15:19:52.749Z，envelope/reply/task 摘要完全相同）只对应**一个 COMPLETED task**（started→delta→delta→completed），无第二个任务、无新增推理。
- **取消 task**：started→cancelled，无 completed。
- externalModels=0。

## 撤销与清理（RUNNER_DONE 后按分工执行）

- `revoke` Mac peer → 退出 0；缓存条目撤销前曾在运行中填充，撤销后 cachedBefore/cachedAfter=0。
- `registry` / `spawn` 拒绝检查 → 均 `{"code":"permission_denied"}`。
- 认证 `shutdown` → `{"stopping":true}`；receiver `control_shutdown` 退出 0。
- cleanup：gatewayStopped / portsReleased / dataRemoved 全 true；无遗留锁。

## 原样报告

[receiver.json](receiver.json)（SHA-256 `d098b993b7049efaa7bb941559939d82378ca4f9beef4e482b927bca0de6e35f`）。报告只含摘要与 fixture 文本，无 IP、配对码、私密路径或凭据。Mac 侧证据见 PR #61；双方原件交叉核验后再判定本轮完整程度。本目录不合并、不关闭任何 PR/Issue。
