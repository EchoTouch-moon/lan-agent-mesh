# Windows 第三轮验证摘要 — run `win-20261023T174935Z`

执行第二轮 REVIEW.md "剩余范围"预授权的两项。工作分支基于第二轮复核头 `09ab3d9`；**探针脚本先提交后运行**（初始提交 `a90f969`，fixture 形态经三次已提交的迭代收敛），成功运行使用的执行源码 SHA `a0818d8` 与两份脚本 SHA-256 见 [run-metadata.json](run-metadata.json)。领取评论：[#1 (comment)](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/1#issuecomment-6371205275)。

## G1：DSH 桌面 prompt 级 ACP — 全部 verified

在第二轮隔离元数据生命周期的基础上，用**本机环回固定响应 fixture**（SSE，`DEEPSEEK_BASE_URL` 指向 loopback、假 key、`DSH_PERMISSION_MODE=read-only`，0 外部模型调用）驱动完整能力集：

| 能力 | 结果 | 备注 |
|---|---|---|
| session/new | verified | |
| send（session/prompt） | verified | stopReason=end_turn |
| stream | verified | `agent_message_chunk` 文本与 fixture 完全匹配 + `usage_update` |
| resume（进程重启后） | verified | 接受原 sessionId |
| cancel（在途） | verified | fixture 请求在途时取消，stopReason=cancelled |
| permissions | verified | 原生 `session/request_permission`，回答 reject_once |
| 被拒操作标记 | verified 未创建 | `markerCreated=false` |
| attach-existing-GUI | unknown | 仅探测自建会话 |

**端点契约发现（本轮关键工程结论）**：桌面捆绑 0.2.1-rc.2 的模型客户端是自研 "DeepSeek Messages" 适配器——请求 `POST {DEEPSEEK_BASE_URL}/v1/messages`（Anthropic Messages 形态、SSE 流式、工具集为 `pwsh`/`edit`/`write`/`workflow` 等），SSE 事件须满足：`data` 为对象且 `event:` 行与 `data.type` 一致；`message_start.message` 必须含 `usage` 对象（缺失即报 "expected a JSON object"，这是初次失败的根因）；终止需要全部 block 关闭 + stop_reason + `message_stop`。适配器同时是 ACP 服务器（`deepseek-harness-acp`）。三次迭代过程全部保留在分支历史与 requestLog 证据中。

证据：[dsh-desktop-acp-fixture.json](dsh-desktop-acp-fixture.json)（fixtureRequests=5、promptsSent=3、externalModelRequests=0）。

## G2：OpenAI.Codex MSIX 静态检查 — 包内存在独立的 Codex.exe

`Get-AppxPackage` / 清单 / 文件名级检查（未启动任何程序、未读用户数据）：包 `OpenAI.Codex` 26.825.6671.0（family `OpenAI.Codex_2p2nqsd0c76g0`），可执行文件含 **`app/Codex.exe`**（以及 ChatGPT.exe、chrome_proxy 等渲染组件）；`Codex.exe` 无静态 VersionInfo 字段，版本以包版本为准。这修正了第二轮"OpenAI 界面仅为 ChatGPT 桌面"的表述：**包内确实携带独立 Codex 可执行入口**，但其接口形态（GUI / CLI / app-server stdio）未行使，全部能力保持 unknown；Mac 端验证的 `codex app-server` stdio 面在 Windows 仍未建立。证据：[codex-msix-win32.json](codex-msix-win32.json)。

## 矩阵影响与未解决项

- HARNESS_MATRIX：DSH 桌面 0.2.1-rc.2 Windows 行的 send/stream/cancel/permissions 更新为 verified；Codex Windows 行更新为"app/Codex.exe 已定位、stdio 面未建立"。
- 未解决：Windows Codex 控制接口（Codex.exe 形态未行使，需单独授权）；attach-existing-GUI 全平台；WorkBuddy 入站；ZCode 3.16.2 旧超时根因。
- 需要 Mac 端接续：复核本 PR（重点是 fixture 端点契约结论与 Codex.exe 定位表述）。

## Mac 端复核补充

执行 SHA 与两份脚本哈希已逐一核对。发送、流式输出、进程重启后接受原 session ID、在途取消及原生 reject_once 有对应记录；marker 未创建是观察事实，但原 pwsh 工具命令使用 printf，且原判定在没有审批事件时也可能通过，不能把这一项作为有正向对照的写入阻止验证。修正版使用 PowerShell Set-Content 正向对照并要求原生拒绝、只读 sandbox 拒绝和 marker 缺失同时成立。

MSIX 清单原投影丢失 Id/Executable 字段，其 aliases=[] 不能用于证明没有别名。静态文件名 app/Codex.exe 的发现保留；它不是已确认的独立 CLI。两项需要定点重验，其余已通过且未改动的能力不例行重复。完整复核见 [REVIEW.md](REVIEW.md)。原始报告及其哈希保留。
