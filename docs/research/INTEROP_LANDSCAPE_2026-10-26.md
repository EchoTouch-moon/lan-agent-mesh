# 外部研究与开源能力吸收清单（2026-10-26）

本文件是**可审查的技术选型起点**，不是所有项目的安全认证或集成成功报告。技术描述来自各上游公开规范/仓库 README；固定 commit、发布版、许可义务、真实 Mac/Windows 支持和安全测试，必须在实际引入时重新核验。更新记录请写入本表与对应 PR，而不是默默升级依赖。

## 0. 选型门槛与评分

每个候选至少回答 8 个问题并在 PR 中保留证据：版本/冻结 tag；协议与 API 是否规范/受支持；所需权限和默认监听；是否引入中心/云服务；Mac/Win 安装依赖；崩溃/幂等/取消/审批是否符合 LAM；许可证/转依赖与供应链；退出/回退是否无损。状态枚举只允许 **verified / documented / experimental / unknown / rejected**；不能把 documented 写成 verified。

可复用策略：
- **ADOPT**：直接用官方/标准 SDK，不重造 schema 或消息解析；先 pin 版本。
- **ADAPT**：以独立 bridge 包接入，内部所有权/策略/持久化仍由 LAM 核心控制。
- **STUDY**：复现单个技术机制/写 ADR 和 benchmark，不直接导入依赖或开启监听。
- **DEFER**：待已有核心验收后再评估；不是删除历史 backlog。
- **REJECT**：经测试不满足硬性不变式后给出具体原因，不根据印象否决。

## 1. 外部能力矩阵

| 项目/规范 | 已公开的直接能力（不代表本仓库实测） | LAM 相关模块 | 建议/理由 | 当前未验证事项 |
|---|---|---|---|---|
| [A2A v1.0](https://a2a-protocol.org/v1.0.0/specification/) + [a2a-js](https://github.com/a2aproject/a2a-js) | Agent Card、message/send、task、stream、cancel；官方 JS SDK v1.0 支持 JSON-RPC、HTTP/JSON、gRPC | registry/router/bridge | **ADOPT + ADAPT P0**：独立北向适配器，不更换内部 wire | 身份/授权绑定、UNKNOWN 语义、取消 race、SDK 精确 tag 和 conformance |
| [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) | 官方 v2 stable `@modelcontextprotocol/server`、`@modelcontextprotocol/client` | mcp-server/mcp-contract | **ADOPT：已在仓库 v2.4.0**；仅做协议兼容/安全回归，无迁移任务 | 与 A2A 桥共用 scoped policy、版本升级风险 |
| [AGNTCY SLIM](https://github.com/agntcy/slim) | 数据/会话/控制面、MLS 会话、Agent 消息传输，与 A2A/MCP 集成 | mesh transport | **STUDY / DEFER**：先测资源占用和跨机稳定性，不替换 Noise/Yamux | 对本地优先零中心/个人设备部署是否更优；SDK/打包/安全边界 |
| [AGNTCY Directory](https://github.com/agntcy/dir) | OASF 结构化能力、分布式注册/发现、SDK 和服务部署 | AgentRegistry | **STUDY / DEFER**：可选联邦目录而非 LAN 强制依赖 | 目录认证/信任来源、缓存失效与 metadata 泄漏 |
| [ANP](https://github.com/agent-network-protocol/AgentNetworkProtocol) | DID、描述/发现、消息 Profile；部分元协议/授权仍 draft | identity/discovery | **STUDY**：考虑 identity 互操作，暂不强制 DID 或替换人类配对 | 协议子规范实际 release 状态、DID key rotation 与旧 peer trust 映射 |
| [SHADI + AgentBridge](https://github.com/agntcy/shadi) | OS 沙箱、受限 secret access、安全消息与 Coding Agent 的 A2A 桥接 | adapter sandbox/benchmark | **STUDY/ADAPT only after proof**：首要安全竞品；与 Codex/DSH fixture 做实际行为对照 | Mac/Win 同等隔离、进程树、Native permission、许可证、回滚 |
| [AgentLink](https://github.com/Oryntai/AgentLink) | 加密 owner 侧 broker、MCP、请求 Inbox、人工审核与 Codex/Claude 协作 | IPC/owner consent/benchmark | **STUDY/benchmark**：任务 Inbox、人与 agent 协调值得吸收 | 依赖 relay/ngrok 的实验拓扑；text bridge 不强制 native 工具权限 |
| [OpenAgents](https://github.com/openagents-org/openagents) | Workspace、Launcher、多 Agent 协作 Network SDK，MCP/A2A 支持 | deployment/interop/benchmark | **STUDY**：比较可部署性、协作体验，不整包迁移 | 共享服务/控制面的信任与个人设备所有权差异 |
| [AgentTorrent](https://github.com/raghavan/agent-torrent) | P2P 发现、任务委派、CLI sandbox 的研究原型 | P1 P2P/benchmark | **STUDY only**；上游明确无完整授权、传输加密、结果验证 | 不可替代已验证的 LAM 加密与授权 |
| [ACP / Codex App Server](https://github.com/deepseek-ai/deepseek-harness) | 受控 Native session/turn/permission（以安装版实际探针为准） | HarnessAdapter | **KEEP existing**；只重用官方/真实安装版契约 | DSH 真实 MCP 出站与 GUI attach 均未证实 |

## 2. 四项必须立即修正的认识

1. **A2A 不是 P5 以后才需要研究的可选玩具**：优先级前移到 **R0/R1**，但保持 optional、默认关闭；原 #32 不应直接关闭或篡改旧验收。
2. **MCP 已经采用现代 SDK**：仓库 `packages/mcp-server/package.json` 实际依赖 `@modelcontextprotocol/server@2.4.0`（测试 client 同版本），不用再进行“旧 SDK 迁移”。只有 pin/security/conformance 增量任务。
3. **不能把 A2A Task status 直接等同内部 UNKNOWN**：v1.0 终态集合中的 failed/canceled/completed 不代表未知的原生副作用一定失败或取消；细节见 ADR 0004。
4. **真实 Codex 或 DSH 接收固定响应 ≠ Harness 主动发起 MCP、跨机或线上模型**：历史 #17/#18 报告只证明列明的 native fixture 路径；#19 的 B1/B2/B3 必须独立验证。

## 3. 候选单项研究实验模板（R0）

每项提交最少：
- **问什么**：某一具体调用/权限/流语义能否被安全复用？拒绝写「全面研究整个项目」。
- **源**：repo URL + 上游 commit/tag + 协议 spec 日期 + LICENSE 文件路径和结论（允许 unknown）。
- **环境**：OS / CPU / Node/Rust/依赖版本；若未执行则写 NOT-RUN。
- **最小复现**：本地独立隔离，使用 fake key 与 loopback fixture；不得安装到生产用户配置或外部服务。
- **语义**：精确 task/session ID，cancel/retry/UNKNOWN 行为，事件顺序，authorization 缺失时失败模式。
- **风险**：第三方依赖、供应链、中心化/外网需求、不可观测子进程、明文/日志。
- **结论**：ADOPT/ADAPT/STUDY/DEFER/REJECT + 当前证据等级 + 回退方式；写 Decision Record，不仅口头建议。

## 4. 本项目的差异化研究问题（不是预设赢得比较）

1. **跨协议任务结果未知**：native 接收/执行不确定时，在 A2A+MCP 的表面如何保持诚实且不自动重复副作用？
2. **本机权限所有权**：不同所有者、不同 OS、不同 Harness 的默认拒绝、审批与 workspace 能否被端到端验证？
3. **状态/会话连续性**：Gateway/adapter/native 三层 ID、重启与任务游标在不同连接恢复条件下的可证明关系。
4. **操作成本**：相同双实体硬件、相同负载、相同安全策略下，与公开可执行对照项目的延迟、资源、功能和失败矩阵差距。
5. **标准互操作成本**：引入 A2A bridge 是否导致不合理性能/安全回退；以实验数据说明而非架构口号。

## 5. 对照来源（复核日期 2026-10-26）

- A2A v1.0 规范：https://a2a-protocol.org/v1.0.0/specification/
- 官方 JS SDK：https://github.com/a2aproject/a2a-js （当前 README 标注 v1.0 stable；实施时 pin tag）
- 官方 MCP：https://github.com/modelcontextprotocol/typescript-sdk （v2.4.0）
- SLIM：https://github.com/agntcy/slim
- Directory：https://github.com/agntcy/dir
- SHADI/AgentBridge：https://github.com/agntcy/shadi
- ANP：https://github.com/agent-network-protocol/AgentNetworkProtocol
- AgentLink：https://github.com/Oryntai/AgentLink （上游称 experimental v0.5）
- OpenAgents：https://github.com/openagents-org/openagents
- AgentTorrent：https://github.com/raghavan/agent-torrent （上游称 research prototype）

以上是外部公开资料的**documented** 级别；未对其 Mac/Win 实际安装二进制运行全量安全测试，也未核定全部许可证与依赖义务。正式采纳前必须 R0 evidence 和安全审查。
