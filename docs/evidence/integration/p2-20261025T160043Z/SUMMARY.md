# P2 组合候选：本机正式验收

固定执行源 `5fed1448337d82f72972270c99447205f02ea2d7` 已先提交并推送，两个验收入口均记录干净源码。它完整包含 #47～#62 的固定 head，排除 #45，详见 [候选清单](../../../integration/p2-candidate-manifest.json)。本目录只归档原件，不把归档提交冒充执行源。

- 完整组合代码先在 `ff726726daaeb2015730cffb40d072c20b630d90` 完成 frozen install/build/typecheck/lint 和107通过/4跳过（111定义）；它到执行源5fed的差异仅 README、候选说明与清单，无运行代码/CI配置变化。
- `dsh-synthetic.json`：退出0、passed-synthetic，六个验收阶段和MCP链通过，cleanup完整/rootRemoved/fixtureClosed。sandbox是合成的，不作为 Windows native 权限证据。
- `codex-native-mac.json`：退出0，实际 Mac Codex CLI0.146.0，六组固定响应验收通过，包括同机加密Gateway→真实Codex的组合路径、原生拒绝和正控、UNKNOWN不重放；cleanup verified。
- 两个节点均由本机新建并绑定loopback；没有重开已结束的物理W3窗口。原件中的 physicalW3=pending 表示本入口未执行真实Codex跨机路径，不否定历史Mock分项证据。

报告中的模型调用计数只描述固定fixture的配置/请求，未进行全主机网络监测；不作为主机所有外连的测量证明。两个 JSON 原样复制，原件 SHA 见 metadata；没有用户路径、物理地址、短码或控制凭据。

Windows 已在同一5fed源执行 [W-DSH-03 native 单机复验](../../dsh-adapter/windows-native-local-20261025T1614Z/SUMMARY.md)，六阶段与清理通过，真实逐命令退出0；Mac已复核原件、110源码文件、26个非DLL产物与同源WindowsCI以及程序哈希。原件SHA见追加metadata。旧 #60 的97源报告不改写成5fed已跑。真正 Harness 主动MCP/跨实体、GUI与生产模型仍未验证。本候选不合并或关闭任何PR/Issue。
