# ADR 0005 — 本机异构 Harness 互操作（LHI）：同一任务语义，两条执行路径

- **状态**：Accepted for research/design; implementation gated（允许研究及受控 fixture 研发，不等于已实现 Local Dispatcher 或已批准自动唤醒现有 GUI）。
- **日期**：2026-10-26；计划前的已验证 `main` 为 `0edb77759e89a0b4ed7096193d9285d2c7c83ce5`；各任务必须使用实际起始新 SHA。
- **相关**：[ADR 0004](0004-standards-first-agent-interop.md) · [LHI 工作线](../local/LHI_WORKSTREAM.md) · [原生 Harness 矩阵](../HARNESS_MATRIX.md) · [本机 Codex MCP PR #65](https://github.com/EchoTouch-moon/lan-agent-mesh/pull/65) · [ZCode #27](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/27)。
- **决策原则**：统一 Node/Agent/Session/Task/UNKNOWN/授权语义，区别只是 dispatch 路径；不把“同一台设备”和“同一个 OS 用户”自动等价为所有 Agent 间的可信授权。

## 1. 动机与当前事实

目前双向 Gateway MCP 路径主要对**远端**代理开放：`packages/runtime/src/mcp-access.ts` 的 grant 需要已配对 peer、远端 AgentRegistry 与 `Gateway.sendEnvelope(peer, ...)`；`packages/runtime/src/index.ts` 的 spawn/submit 经 Mesh request。原生 `Sessions` 已能把本地 Agent 对应到 Adapter，但没有供 MCP 同机 caller 受控调用同 Gateway-owned receiving Adapter 的独立 Local Dispatcher。

已存在的有效实测：
- PR #65（仍需独立合并审查）展示 Mac Codex 0.146.0 的真实 MCP tool-call，经 **两套同机 Gateway + loopback Noise pairing** 到 Mock 和另一 Codex 接收方；成功仅对其记录的 fixture / 隔离审批例外有效；既有 GUI 和实际跨机器未通过。
- 现有 `docs/HARNESS_MATRIX.md` 的 ZCode darwin 与 Windows 安装版本原生 **session create/resume/send/stream/cancel/deny** 探针已通过本机 localhost 定值响应，但没有正式 Gateway-owned `@lam/zcode-adapter`，更没有 Codex↔ZCode 双方向组合 E2E。
- ZCode 官方 CLI README 提供 `mcp.servers`（stdio/http/sse）与 `mcp__<server>__<tool>` 注册规则： https://github.com/zai-org/ZCode/blob/main/apps/zcode-cli/README.md 。文档支持 `MCP config` 不能当作我们装机版本**实际发出 MCP tool invocation** 的实验证据；必须再做隔离 home/fixture native event 检验。
- MCP 服务能发起工具调用，与远程读取或接管用户已打开 GUI 会话是不同能力。**不**承诺 GUI attach、无提示唤醒、任意已运行进程注入。

## 2. 目标架构（待实现）

```text
Codex / ZCode / DSH (caller, separate scoped MCP grants)
          |        local MCP stdio
          v
   Gateway Authenticated Ingress
          |  common policy + durable Router/Store + adapter capability
          +--> Local Dispatcher (future; same node, no synthetic peer pairing)
          |       +--> Gateway-owned Codex / ZCode / DSH Adapter
          |
          +--> P2P Dispatcher (existing; peer trust + Noise/Yamux)
                  +--> authenticated peer Gateway -> its Adapter
```

**L0 临时验证**：使用两 Gateway，同机 loopback + 明确测试 pairing，最小化产品变更；不是最终单 Gateway 本机方案。
**L1**：验证真实 ZCode 本机 MCP outbound（使用固定 localhost inferencer、全新独占 home、真实 native tool-call 事件）。
**L2**：实现严格受限的 ZCode receiving `HarnessAdapter`，独立包装新会话及自己的状态库；复用已审查的 Adapter SDK 语义，不直接操作用户的 ZCode DB/GUI。
**L3**：双 Gateway loopback 下 Codex→ZCode 和 ZCode→Codex 原生 MCP tool-call + 受控接收方，并检查 scoped grant、stream/cancel/retry/UNKNOWN/cleanup。
**L4**：设计并单独验收单 Gateway Local Dispatcher，先 Mock-only，授权/存储语义通过后才考虑真实 Native。
**L5**：消息 Inbox、显式 ask/reply/notify、claim/release/conflict、受控 wake/resume 属于**后续候选功能**，不可因为 L3 成功就自动加入公共 MCP API。

## 3. 不可破坏的不变式

1. **调用方身份**：每个本机 Harness/会话必须有独立、作用域受限、限时/可撤销的 grant，显式允许 `local:<agentId>` 或其它单独的明确 target 类型。不能伪造 `peerId=self`、把本机 caller 当成远端配对 peer，不能默认同机全 Agent 可见。Grant 与 Native 会话/资源所有权由 Gateway 验证，不信任 MCP 文本中的发送者。
2. **OS 同用户边界限制**：同一 OS 用户下运行的恶意 Agent 可能能够读取其它进程同用户目录/环境。单独 token 和 Unix/Windows 本机 Socket 并不是强制 OS 沙箱；若需抵抗恶意同用户进程，必须另行设计进程隔离、文件 ACL 和工具沙箱，并按 #69 对照 SHADI。测试报告明确 threat model。
3. **Local/Remote 唯一区分在路由**：共同操作应持久提交 caller/target、Gateway session ID/Adapter session ID/Native ID 映射、Request idempotency key/fingerprint、deadline、durable event cursor、UNKNOWN。Local path 不得因为免除 Noise 跳过 Policy、资源归属、审计和 Native default-deny。
4. **无循环委派/自呼叫默认禁止**：禁止 Agent 直接调用自身，委派需检查深度、调用链、预算和等待环。后续支持嵌套链时把 cycle detection 作为明确的先验门槛，不能依靠模型不会循环。
5. **副作用 UNKNOWN**：失去 ACK 或 Native 终态不明时不擅自重发新 key；相同原请求只引用原 task。cancel requested != native canceled；本机新 path 不能把任务完成文本当作工具执行证据。
6. **资源边界**：local dispatcher 也应有与远端一样的数量、尺寸、并发、timeout 和 retained result 限制；日志不可输出真实凭据、原生路径、会话全文；存储迁移应 additive。
7. **Native 权限**：Gateway grant 是上限，不允许突破 Harness 自己拒绝或 OS 权限。测试 harness 产生的允许路径必须显式标记 fixture-only，不可部署为默认自批准。
8. **不修改主干已通过的 G2 Windows private storage、P1 wire、Noise/Yamux 信任流程**。LHI 原型必须有 feature flag 默认关闭、loopback-only、可单独回退；不得新增强制服务或云账号。
9. **外部标准维持独立**：北向 A2A（#67/#68）及既有 MCP 是接口；LHI local dispatch 不应要求另造网络协议或修改 A2A 状态标准。

## 4. Native outbound 与被控入站不同

- **Codex 侧**：PR #65 有原生 MCP tool invocation fixture；若要合并该 PR，依其自己的 CI/验收/审查，而不是在 LHI 分支复制。
- **ZCode 出站**：核验已安装 exact版本、CLI 容器/stdio RPC 方言、在全新隔离 `HOME/XDG/ZCODE` 下通过所选 fixture model 注册独立 MCP server，并观察 ZCode 的原生 tool invocation / result 与固定请求参数。仅 `mcp list` 可见或模型文字提及工具不足。
- **ZCode 入站**：通过已验证 App Server 的 `session/*` 受控接口包装独立 `HarnessAdapter`；persist 新 Gateway-owned session 映射，default deny 原生 permission，cancel terminal、UNKNOWN 不重放；初期 no GUI attach、no production auth、no existing sessions。
- **本机双向**：需两项独立证据：`Codex native MCP tool call -> Gateway -> ZCode Adapter` 和 `ZCode native MCP tool call -> Gateway -> Codex Adapter`；SDK test client 只能算连接/工具层，不算 Harness 主动调用。

## 5. 先研究再扩展（参考项目）

- [Agent Intercom Codex](https://github.com/dataforxyz/agent-intercom-codex)：本机多 Harness broker、接收 ACK、wakeable worker；本机消息提醒与原生执行是两条不同路径。
- [agent-peers-mcp](https://github.com/Co-Messi/agent-peers-mcp)：SQLite durable inbox、lease/ack、session token 和 orphan 管理；上游说明单用户同机 Broker **不是多用户安全边界**。
- [ZCode CLI](https://github.com/zai-org/ZCode/blob/main/apps/zcode-cli/README.md)：MCP 注册、工具命名、配置边界。
- 其它候选：Borg MCP、Concord、tap/MPAC/STORM；需要 LHI-0 实际核验版本、许可证、可复现性后才吸收。
- 优先采用**行为语义**，不直接整包引入新 broker/supervisor，不复制未经许可的源代码。

## 6. 执行 Gate

| Gate | 明确证据 | 不通过时 |
|---|---|---|
| LHI-0 | 现有方案的版本/许可证/能力、与本项目差异、风险及采用决策 | 不引入依赖或宣称完全成熟 |
| LHI-1 | 安装版 ZCode 真正 native MCP tool-call 事件和拒绝/清理；不碰用户配置 | outbound = unknown，阻止双向宣称 |
| LHI-2 | Synthetic 与原生 localhost fixture ZCode Adapter new/resume/send/stream/cancel/deny/UNKNOWN | 不进入 LHI-3 |
| LHI-3 | 两个方向均有同机 dual Gateway/loopback Native 事件与 source SHA，完整负例 | 未通过的方向单独 BLOCKED |
| LHI-4 | Local Dispatcher 设计审查、Mock-only 原型的 caller scoped grant/幂等/取消/UNKNOWN/断线检查 | 不启用 native local dispatch |
| LHI-5 | 可选消息/资源协作语义 RFC、冲突/循环/唤醒 threat model | 继续 task-based collaboration |

## 7. Rollback

停用 Local Dispatcher flag / 停止本机 fixture worker / 撤销此工作线凭据，旧 Peer 信任、P1 wire、现有 Gateway 及 Adapter 保持不变；持久化新映射必须不影响旧 reader（additive schema）。不同版本/测试等级的报告永不覆盖。任何真实模型、已有 GUI 操作、额外 OS 权限、跨实体 LAN 新窗口需单独用户授权。

