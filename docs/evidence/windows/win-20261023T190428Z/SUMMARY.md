# Windows 第四轮定点重验摘要 — run `win-20261023T190428Z`

严格按第三轮 REVIEW.md "剩余任务"执行，仅两项定点重验；执行源码 `4f17ff0`（复核方修正并预先提交的探针，本轮未改动任何探针源码）。领取评论：[#1 (comment)](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/1#issuecomment-6372605613)。

## P1：DSH 桌面 permissions 路径（严格四要素契约）— verified

`LAM_DSH_FIXTURE_SCOPE=permissions`（1 个 prompt、3 次 loopback fixture 请求，0 外部模型）：

| 要素 | 结果 |
|---|---|
| 正向对照（探针自有 Set-Content 写入并删除对照 marker） | verified |
| 原生 `session/request_permission` + reject_once | verified |
| 只读 sandbox 初始拒绝被观察（initialSandboxDenialObserved） | verified |
| 被拒目标 marker 未创建 | verified |

第三轮被复核降级为 unknown 的 `deniedOperation` 在补齐因果证据后重新达到 verified；本轮**未重复** send/stream/resume/cancel（按复核要求）。证据：[dsh-desktop-permissions-r4.json](dsh-desktop-permissions-r4.json)。

## P2：修正版 MSIX 清单投影 — verified-statically

显式读取 XML 属性 + 命名空间感知的 ExecutionAlias 遍历（区别于第三轮的空投影）：

- 包内唯一注册应用：`Id=App`、`Executable=app/ChatGPT.exe`、FullTrust 入口；五个扩展类别（comServer、fileExplorerContextMenus、protocol、fileTypeAssociation ×2）**均无 ExecutionAlias**——这是被证明的清单事实，不再是缺失字段的默认值。
- `app/Codex.exe`：1,105,200 字节，SHA-256 `8f624c53c38a44a973460a127e5338b84f32c4a2423d705330835e12fea9bdd0`；无静态 VersionInfo 字段。**存在但不是清单注册的独立入口或执行别名**——更支持"应用内部组件"的解释；在确定其性质前仍不执行，全部控制能力保持 unknown。
- 证据：[codex-msix-win32-r4.json](codex-msix-win32-r4.json)（manifestProjectionStatus=verified-statically）。

## 矩阵影响与未解决项

- HARNESS_MATRIX：DSH 桌面 Windows 行 permissions 注记补"含因果对照的写入阻止验证"；Codex Windows 行更新为"清单无 ExecutionAlias、Codex.exe 非注册入口"。
- 未解决：Codex.exe 接口形态（需单独授权且可能仅 GUI 内部组件）；attach-existing-GUI 全平台；WorkBuddy 入站；ZCode 3.16.2 旧超时根因。
- 需要 Mac 端接续：复核本 PR 后，Windows 侧待办已收敛至上述需授权项。
