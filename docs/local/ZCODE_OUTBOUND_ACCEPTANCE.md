# ZCode MCP 出站验收记录（LHI-1，2026-10-26）

**taskId:** LHI-1 · **Issue:** [#80](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/80) · **执行等级:** native-local（darwin 首轮）
**modelClaimed:** GLM-5.3（操作者记录）
原始证据：[evidence/zcode-outbound/](evidence/zcode-outbound/README.md)（含脚本、入口哈希、逐项观测与失败历史）

## 1. 结论

**darwin PASS（L1-Outbound）**：安装版 ZCode（desktop 3.16.3，bundled CLI `0.17.0`，入口 sha256
`97490d0f06a7a225d54d47817acf4b4859cdb268b59f2490caaeda982bef063a`）在一次性私有 HOME 下，经官方
配置合同（`features.mcp: true` + `mcp.servers.lam-lhi` stdio）注册本仓库只读 synthetic MCP server
后，**真实发出了模型发起的 MCP tool-call 并把工具结果送回模型上下文**；四项负例全部 fail-closed。
Windows 侧 **NOT-RUN**（按 Issue 要求独立复验，不借用本结论）。

判定阶梯（对照 LHI_WORKSTREAM §3）：
- ~~L0-Config（工具出现在列表）~~ → **已超过**：不但 advertised，而且真实执行
- **L1-Outbound：达成**——native caller 事件链完整（见 §3），固定本地推理，0 外部模型请求

## 2. 实验配置（可复现）

- 探针：`scripts/lhi-zcode-mcp-outbound-smoke.mjs`（runner）+ `scripts/lhi-zcode-mcp-contract.mjs`
  （MCP fixture，官方 `@modelcontextprotocol/server` 2.4.0 SDK 实现，`--self-test` 先行自证）
- 隔离：一次性 `HOME/XDG_*/ZCODE_*` 全部指向 `mkdtemp` 私有目录；用户全局 `~/.zcode`、真实凭据、
  GUI 一律未触碰；推理经 loopback Chat Completions 定值响应（假 key）
- MCP 注册（官方 07-mcp.md 合同原文形态）：`{ "mcp": { "servers": { "lam-lhi": { "type": "stdio",
  "command": "<node>", "args": ["<repo>/scripts/lhi-zcode-mcp-contract.mjs", "--stdio"],
  "enabled": true, "timeoutMs": 5000 } } } }`
- 正控计数：MCP server 自身把每次已验证调用写入独立 JSONL（`LHI_MCP_LOG`），与 harness 自述无关

## 3. 正向证据链（darwin-r2，全部 PASS）

| 阶梯 | 证据 |
|---|---|
| advertised | 推理请求 `body.tools` 中出现 `mcp__lam-lhi__probe_echo` / `mcp__lam-lhi__probe_hang`（19 个工具内，命名符合官方 `mcp__<server>__<tool>` 规则） |
| issued tool-call | 定值推理器返回 tool_call（args `{phrase:"lhi-positive"}`）→ turn `turn.completed/success` |
| native 执行 | server 端 JSONL 恰好 1 条 `probe_echo invoked {phrase:"lhi-positive"}`（执行计数正控） |
| result 关联 | 下一个推理请求的 messages 含 `lhi-echo:lhi-positive`（工具结果回流模型上下文），随后终文本 `LHI OUTBOUND ECHO VERIFIED` |
| 无外呼 | `externalModelRequests: 0`；fixture 请求 10 次（每相位 ≤2） |

## 4. 负例（全部 fail-closed，turn 均正常收束不崩溃）

| 场景 | 观测 |
|---|---|
| 未知工具 `…lam-lhi__nonexistent_tool` | 后续请求含错误信息；无 server 端执行 |
| 类型违规 `phrase: 12345` | 后续请求含 schema 校验错误（"expected string"类）；无执行 |
| 服务端挂起 `probe_hang` | server 记录 1 次调用后不返回；harness 约 **5141ms**（≈配置 5000ms `timeoutMs`）后放弃并回错误；turn 完成 |
| 配置级禁用（`features.mcp:false`，新 app-server 进程） | advertised 从 19 → 17，**不含** fixture 工具；强制发起调用得到错误回执；server 端零执行（JSONL 仅 2 条：echo+hang） |
| 权限 | 全程 `interaction/requestPermission` 默认 deny 策略；本轮未触发（只读工具） |

## 5. 观察与限制（如实记录）

1. **turn 事件流不广播 MCP 工具执行中间事件**：订阅流仅见 `turn.started` / `turn.completed`。
   因此"native event"证据 = 事件流完成信号 + 后续请求中的 tool result + server 端计数，双通道互证。
   若 LHI-2 接收侧需要更细粒度事件，不能依赖 turn 流。
2. **harness 不对重复 tool_call 去重**（darwin-r1 失败运行观察：模型侧 fixture 每请求重发同一
   tool_call id，harness 每次都真实执行，778 次）。MCP `tools/call` 本无幂等语义；依赖模型/调用方
   自律。对 LAM 语义映射的启示：durable/幂等属 LAM 任务层，不能下推给 MCP 工具层。
3. darwin-r1 失败是**探针脚本缺陷**（同相位重复发 tool_call 导致 turn 永不完成），非 harness 缺陷；
   失败历史保留在 evidence README。
4. 未覆盖：GUI 会话、真实凭据、外网模型、入站（LHI-2 范围）、Windows（独立复验）、
   `type:http/sse` 传输（本轮只验 stdio 合同）。

## 6. 授权与安全边界确认（运行前已核）

- 已安装版本/入口/哈希见 §1；执行机器即领取机器（macOS 27.0 arm64）
- 授权范围 = 工作线第一轮既定约束：localhost / 假凭据 / 定值推理 / 独占私有 home-workspace；
  未触碰用户配置、真实账号、系统 ACL/防火墙、其它进程 PID
- 清理已核验：一次性 HOME 删除成功（`disposableHomeRemoved: true`），无端口/进程残留
  （fixture server 随 runner 关闭；MCP 子进程随 app-server 关闭）

## 7. 对 LHI-2/3 的输入

- ZCode 接收侧适配器 **可以假设** 出站 MCP 配置合同有效（本验收 pin 到 CLI 0.17.0）
- 双向路径（LHI-3）ZCode→Codex 方向的 caller 侧证据自本验收起成立（在本机版本范围内）
- 但 agent-peers/intercom 的"纯 MCP 会话无主动推送"限制仍待接收侧实测（LHI-2），不因本验收外推
