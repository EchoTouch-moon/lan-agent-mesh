# R0-A 上游冻结与安全边界审查

日期：2026-10-26（Asia/Shanghai）。任务：[#66](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/66)。
基线：`main@1c5697219a7d3281f37d57981b5b548d7c1c9d5b`；分支：`codex/r0-upstream-audit`。复核时远端 main 已前进至 `d939abab847be75aaeac95ecdfee4ab5a4882edf`，新增仅为独立的 `docs/security/glm53/WORKSTREAM.md`；保留原始起跑与 tested SHA，不将别的提交并作实测来源。

## 结论与证据等级

本轮仅完成公开规范、固定源码和包元数据的 **documented** 审查。未执行任何上游项目、Harness、模型、GUI 或跨机联调；不宣称 A2A conformance、OS sandbox、撤销或 native cancellation 已通过。

R0 研究产物可供复核：11 个记录（10 个仓库，AgentBridge 单独列出）均有固定 commit、许可原文和 API/平台来源。A2A 目标规范固定 v1.0.0，官方 JS SDK 候选固定 v1.3.0；并非将 SDK 版本号等同协议版本。MCP 保持现有 2.4.0，无依赖迁移。SHADI/AgentBridge、SLIM/Directory 只研究，不引入运行依赖。

**R0-G 尚待人工审查签出。** `upstream-locks.json` 是研究锁，不能充当包管理器 lock 或安全认证。全部 `runtimeDependencyApproved=false`；R1 在引入 SDK 时必须补选定入口的精确解析图、tarball integrity、转依赖许可/漏洞评估和 Mock 官方客户端证据。R2 依赖 R1；SEC/NET 的实际执行不由本报告授权。UNKNOWN/cancel、权限拒绝/撤销的检查在本轮只是静态文档契约负例。

## 1. 固定版本和许可

完整结构见 [upstream-locks.json](upstream-locks.json) 与 [Draft-07 schema](upstream-locks.schema.json)。commit 是权威 pin；tag 仅为可读来源，采集器重新解析 tag 并检查 commit 一致。没有把标签列表排序当作“最新发布”证据。SLIM/SHADI 是多组件仓库，以 workspace commit 固定，不能从一个 telemetry/CLI tag 推导所有组件版本。AgentTorrent 无 tag，用 commit。

| 上游 | 固定 tag / commit | SPDX（审查范围）与原文 | 决策 |
|---|---|---|---|
| A2A specification | `v1.0.0` / `173695755607e884aa9acf8ce4feed90e32727a1` | `Apache-2.0` · [许可原文](https://github.com/a2aproject/A2A/blob/173695755607e884aa9acf8ce4feed90e32727a1/LICENSE) | ADOPT |
| A2A JavaScript SDK | `v1.3.0` / `29417a5bb4038f804f310ce4fffd267a9375aa90` | `Apache-2.0` · [许可原文](https://github.com/a2aproject/a2a-js/blob/29417a5bb4038f804f310ce4fffd267a9375aa90/LICENSE) | ADAPT |
| MCP TypeScript SDK | `v2.4.0` / `951fe5603a7ec0b2dcb6a0b95d92cd86f93ad9e5` | `Apache-2.0 AND MIT AND CC-BY-4.0` · [许可原文](https://github.com/modelcontextprotocol/typescript-sdk/blob/951fe5603a7ec0b2dcb6a0b95d92cd86f93ad9e5/LICENSE) | ADOPT |
| AGNTCY SLIM | `cd505c2cf241481e44604b71a3d2d6d5d43c7839` / `cd505c2cf241481e44604b71a3d2d6d5d43c7839` | `Apache-2.0` · [许可原文](https://github.com/agntcy/slim/blob/cd505c2cf241481e44604b71a3d2d6d5d43c7839/LICENSE.md) | DEFER |
| AGNTCY Directory | `v1.8.0` / `337ddd89721bd66595c701c9675d6bfbb5a65997` | `Apache-2.0` · [许可原文](https://github.com/agntcy/dir/blob/337ddd89721bd66595c701c9675d6bfbb5a65997/LICENSE.md) | DEFER |
| SHADI | `4b56555e892517050f3c9a7a16d48afa6fb1baa9` / `4b56555e892517050f3c9a7a16d48afa6fb1baa9` | `Apache-2.0` · [许可原文](https://github.com/agntcy/shadi/blob/4b56555e892517050f3c9a7a16d48afa6fb1baa9/LICENSE.md) | STUDY |
| ANP | `release-20261014` / `463a9c8fbfc4683d13ff8ab492b830e81250b60c` | `Apache-2.0` · [许可原文](https://github.com/agent-network-protocol/AgentNetworkProtocol/blob/463a9c8fbfc4683d13ff8ab492b830e81250b60c/LICENSE) | STUDY |
| AgentLink | `v0.5.0` / `942a0a8c9af21313a45b70dabc513fc8bac021f5` | `MIT` · [许可原文](https://github.com/Oryntai/AgentLink/blob/942a0a8c9af21313a45b70dabc513fc8bac021f5/LICENSE) | STUDY |
| OpenAgents | `v0.8.5` / `5eab18f3592dee227ff479d40c365904dbc53f7c` | `Apache-2.0` · [许可原文](https://github.com/openagents-org/openagents/blob/5eab18f3592dee227ff479d40c365904dbc53f7c/LICENSE) | DEFER |
| AgentTorrent | `257d33386df4fc10b5464077565268a23d5a6e79` / `257d33386df4fc10b5464077565268a23d5a6e79` | `MIT` · [许可原文](https://github.com/raghavan/agent-torrent/blob/257d33386df4fc10b5464077565268a23d5a6e79/LICENSE) | STUDY |
| AgentBridge (SHADI workspace) | `4b56555e892517050f3c9a7a16d48afa6fb1baa9` / `4b56555e892517050f3c9a7a16d48afa6fb1baa9` | `Apache-2.0` · [许可原文](https://github.com/agntcy/shadi/blob/4b56555e892517050f3c9a7a16d48afa6fb1baa9/LICENSE.md) | STUDY |

许可结论仅覆盖所链固定源码：Apache 项目引入时保留许可证、版权及适用 NOTICE/修改声明；MIT 项目保留版权与许可文本。各文件及转依赖的义务不能从根许可证自动继承。以下是工程来源记录，不是对整仓库或发行物的法律认证。

特别发现：MCP package manifest 写 Apache-2.0，但根 LICENSE 说明项目正由 MIT 转为 Apache-2.0，未获重许可同意的贡献仍适用 MIT，非规范文档适用 CC-BY-4.0。因此锁使用仓库范围的组合表达式 `Apache-2.0 AND MIT AND CC-BY-4.0`，**不**声称每个文件同时适用三者；逐文件归属/NOTICE 完整性为 unknown。本轮没有新增依赖。

## 2. A2A API 与不可复用的默认行为

[docs/specification.md](https://github.com/a2aproject/A2A/blob/173695755607e884aa9acf8ce4feed90e32727a1/docs/specification.md) · [specification/a2a.proto](https://github.com/a2aproject/A2A/blob/173695755607e884aa9acf8ce4feed90e32727a1/specification/a2a.proto) · [src/client/transports/json_rpc_transport.ts](https://github.com/a2aproject/a2a-js/blob/29417a5bb4038f804f310ce4fffd267a9375aa90/src/client/transports/json_rpc_transport.ts)

- 固定规范 §5.2 的 JSON-RPC method 是 `SendMessage`、`SendStreamingMessage`、`GetTask`、`ListTasks`、`CancelTask`、`SubscribeToTask`；HTTP/JSON 是另一 binding（如 `POST /message:send`）。旧路线中的 `message/send` 是历史术语，不能作为 v1.0 method 编码。SDK transport 实际发送 `SendMessage`，其 `src/types/index.ts` 明确导出 v1.0 类型/codec。R1 仅选择一个 JSON-RPC/HTTP 入口，不能顺带开启 REST/gRPC/compat。
- proto 的枚举为 UNSPECIFIED、SUBMITTED、WORKING、COMPLETED、FAILED、CANCELED、INPUT_REQUIRED、REJECTED、AUTH_REQUIRED，完整名称带 `TASK_STATE_`。终态只有 COMPLETED/FAILED/CANCELED/REJECTED；UNSPECIFIED 不是 LAM UNKNOWN。规范 §3.3.1 对 Send Message 幂等仅 MAY，不能继承为 durable 去重保证。
- LAM UNKNOWN 不投射为任何终态，也不触发重执行。R2 需审阅非终态 + 明示 uncertainty metadata 的扩展与客户端行为；未满足前任务执行能力 unsupported，只推进 R1 只读卡片。Cancel RPC 收到或 SDK 接受请求，不足以证明 native 已取消；必须有 native terminal + durable event。
- 认证与能力授权分别执行；规范 §3.3.2 要求认证/授权错误，§13.1 限定资源可见范围。错误/撤销不得泄露任务、卡片或原生 ID；认证主体、peer、agent、session 和 fingerprint 共同限定幂等键，不延长原 deadline。

SDK 特别边界：

[src/server/owner_resolver.ts](https://github.com/a2aproject/a2a-js/blob/29417a5bb4038f804f310ce4fffd267a9375aa90/src/server/owner_resolver.ts) · [src/server/express/agent_card_handler.ts](https://github.com/a2aproject/a2a-js/blob/29417a5bb4038f804f310ce4fffd267a9375aa90/src/server/express/agent_card_handler.ts) · [src/server/request_handler/default_request_handler.ts](https://github.com/a2aproject/a2a-js/blob/29417a5bb4038f804f310ce4fffd267a9375aa90/src/server/request_handler/default_request_handler.ts)

1. `resolveUserScope` 对未认证调用返回共同的 `unknown` scope；这是共享命名空间，不能当拒绝。Gateway 验证身份、有效 grant、撤销和 agent 范围后才能进入 SDK。
2. Agent Card helper 的 provider 不接收请求，默认 `maxAge=3600` 并写 `Cache-Control: public`。不可把私有 scoped card 直接挂上该 helper；需显式按 caller 生成卡片、禁共享缓存（`no-store`）、拒绝先于缓存处理，防止撤销后缓存/304 继续泄露。仅设 maxAge=0 得到 no-cache，不等同 no-store。
3. 默认处理器/事件与存储 helper 不能取代 LAM durable inbox/outbox、原生权限、native ID 隔离或 UNKNOWN。Push/webhook、extended card、额外传输及自动兼容路由在 v0 不开启；避免 SSRF、签名/凭据泄漏和攻击面扩张。

依赖：SDK manifest 为 Node >=20，直接运行依赖 `jose:^6.2.3`；Express、protobuf/gRPC、better-sqlite3/Kysely/MySQL/Postgres 为 optional peers。Node22/24 落在声明范围仅是兼容线索，不是运行证明。本轮另记录 jose@6.2.13 的 registry 元数据（现有 LAM lock 同版本），不把它写成 SDK 已安装的解析结果。未启用的 DB/gRPC peers 不应为了“完整支持”安装。

## 3. 逐项平台、网络、依赖与回退

所有“支持”均为源码/文档声明；本轮 macOS/Windows 实测为 null。具体 pin 下的 API/平台/配置 URL 在锁和 source evidence 中，无平台证据之处明确 unknown。

| 上游 | macOS / Windows 证据与限制 | 外网、监听、关键依赖 | 不可复用项与回退 |
|---|---|---|---|
| A2A spec/JS | JS Node>=20；无 OS 实测 | 库本身不要求云模型；Express HTTP 需显式 loopback，不能复制公开示例监听 | ADOPT 规范、ADAPT scoped 入口；保持 disabled，撤销 bridge grants；内部 wire 不变 |
| MCP | Node>=20；该 tag 主工作流 Ubuntu Node20/22/24，不能当 Mac/Win 实机证据 | 本仓库现有 stdio；server/client/core 2.4.0 精确 pin，SDK modern/legacy handshake 独立于版本号 | 保持已有 scoped mesh_* 工具；无新增 HTTP listener/迁移 |
| SLIM | README Windows 10 Hyper-V / 11 WSL2 容器与 PowerShell7；macOS 命令示例，原生端到端可用性 unknown | Rust workspace 3.4.6、MLS/crypto/SQLite/telemetry；base server 示例 `0.0.0.0:46357` + insecure TLS；control-plane/coordinator 依拓扑选择，并非必需云服务已证明 | DEFER；不复制 base 配置、不替换 Noise/Yamux；未来停止独立 spike 即回退 |
| Directory | Go server/client/API、Docker 部署；Mac/Win 同等部署/清理未测 | 默认 gRPC `0.0.0.0:8888`，metrics 默认启用 `:9090`，authn/authz 默认 false，REST 默认 false；OCI/OASF schema，启用认证还需 SPIFFE socket；样例 schema URL 在外网 | DEFER；不能直接作为可信 registry；仅未来可选联邦目录，离线本地 pairing 继续有效 |
| SHADI | sandbox 0.3.0；Mac Seatbelt、Win AppContainer/Job Object，不能宣称等强；workspace 要求 Rust1.98 | Windows DACL grant/rollback journal；proxy env 可被 direct connect 绕过；Mac Keychain；非 Mac 默认 secret backend NotSupported，可选 1Password 另增外部依赖 | STUDY；不运行、不修 ACL；保留 LAM G2 owner/DACL gate，SEC 需新隔离授权方案 |
| AgentBridge | crate 0.5.0，Unix signal / Windows TerminateProcess 分支只是源码，不是完整树回收证据 | `a2a-lf@0.4.2` / `a2a-server-lf@0.5.3` 与 SLIM/DID/目录集成；不是 JS SDK 或 v1.0 conformance 证据 | STUDY；Codex profile 带 bypass approvals/sandbox，禁止直接复用；保留现有 Adapter/native default-deny |
| ANP | 协议文档，非跨平台 SDK/安装包；Mac/Win native 支持 N/A | DID-WBA 的 Web/DNS/HTTPS 解析；身份/描述/元协议子规范成熟度不同，vnext 不等于 release；吊销缓存和人类 pairing 映射 unknown | STUDY；不强制 DID、不替换 local trust；未来禁用联邦解析即可回退 |
| AgentLink | Node>=20；有 Windows 脚本/平台分支，完整双端行为 unknown | relay 默认 loopback 127.0.0.1:8787，可自托管；ngrok、legacy MCP、ws/zod，Electron 在 devDependencies；真实 Harness 可需账户 | STUDY；不跑 install-mcp/host/desktop，不继承配置；审批 Inbox 不等于 native 工具权限；无集成即无需运行回退 |
| OpenAgents | tag v0.8.5 的 manifest 其实 0.8.5.post4；Python>=3.8 与 README Python3.10+ 不一致；无本机验证 | workspace/server/Studio；grpcio/crypto/openai/mcp 等宽范围依赖，模型 provider 视配置；默认安全监听完整审查 unknown | DEFER；不整包迁移；不启动默认 server，保留 Gateway 独立部署 |
| AgentTorrent | Python>=3.11，PyNaCl；CI 仅 Linux+真实本地模型，未运行；OS sandbox 等效性 unknown | TCP bind 空 host（所有接口），UDP discovery 47474；上游自述无 auth/传输加密/结果验证，环境/cwd 隔离不能推断 OS 沙箱 | STUDY；只作不同威胁模型对照，不能替换安全 transport；不启动 peer/模型 |

关键源码导航：

- [LICENSE](https://github.com/modelcontextprotocol/typescript-sdk/blob/951fe5603a7ec0b2dcb6a0b95d92cd86f93ad9e5/LICENSE)
- [docs/protocol-versions.md](https://github.com/modelcontextprotocol/typescript-sdk/blob/951fe5603a7ec0b2dcb6a0b95d92cd86f93ad9e5/docs/protocol-versions.md)
- [config/base/server-config.yaml](https://github.com/agntcy/slim/blob/cd505c2cf241481e44604b71a3d2d6d5d43c7839/config/base/server-config.yaml)
- [Cargo.toml](https://github.com/agntcy/slim/blob/cd505c2cf241481e44604b71a3d2d6d5d43c7839/Cargo.toml)
- [server/config/config.go](https://github.com/agntcy/dir/blob/337ddd89721bd66595c701c9675d6bfbb5a65997/server/config/config.go)
- [install/docker/server.config.yml](https://github.com/agntcy/dir/blob/337ddd89721bd66595c701c9675d6bfbb5a65997/install/docker/server.config.yml)
- [crates/shadi_sandbox/src/platform/windows.rs](https://github.com/agntcy/shadi/blob/4b56555e892517050f3c9a7a16d48afa6fb1baa9/crates/shadi_sandbox/src/platform/windows.rs)
- [crates/shadi_sandbox/src/platform/macos.rs](https://github.com/agntcy/shadi/blob/4b56555e892517050f3c9a7a16d48afa6fb1baa9/crates/shadi_sandbox/src/platform/macos.rs)
- [crates/agent_secrets/src/platform/mod.rs](https://github.com/agntcy/shadi/blob/4b56555e892517050f3c9a7a16d48afa6fb1baa9/crates/agent_secrets/src/platform/mod.rs)
- [crates/agent_secrets/src/platform/noop.rs](https://github.com/agntcy/shadi/blob/4b56555e892517050f3c9a7a16d48afa6fb1baa9/crates/agent_secrets/src/platform/noop.rs)
- [crates/agentbridge/profiles/codex.json](https://github.com/agntcy/shadi/blob/4b56555e892517050f3c9a7a16d48afa6fb1baa9/crates/agentbridge/profiles/codex.json)
- [crates/agentbridge/Cargo.toml](https://github.com/agntcy/shadi/blob/4b56555e892517050f3c9a7a16d48afa6fb1baa9/crates/agentbridge/Cargo.toml)
- [02-anp-did-authentication-protocol-specification.md](https://github.com/agent-network-protocol/AgentNetworkProtocol/blob/463a9c8fbfc4683d13ff8ab492b830e81250b60c/02-anp-did-authentication-protocol-specification.md)
- [src/relay-server.js](https://github.com/Oryntai/AgentLink/blob/942a0a8c9af21313a45b70dabc513fc8bac021f5/src/relay-server.js)
- [package.json](https://github.com/Oryntai/AgentLink/blob/942a0a8c9af21313a45b70dabc513fc8bac021f5/package.json)
- [pyproject.toml](https://github.com/openagents-org/openagents/blob/5eab18f3592dee227ff479d40c365904dbc53f7c/pyproject.toml)
- [agenttorrent/peer.py](https://github.com/raghavan/agent-torrent/blob/257d33386df4fc10b5464077565268a23d5a6e79/agenttorrent/peer.py)
- [SECURITY.md](https://github.com/raghavan/agent-torrent/blob/257d33386df4fc10b5464077565268a23d5a6e79/SECURITY.md)

## 4. 威胁模型与后续 Gate（不宣称本轮实测）

资产：配对身份、scoped grants、私有 Agent Card/任务/native session ID、受控目录、secret 与 durable 执行记录。
攻击者：未配对远端、持有过期/撤销凭据的旧 caller、恶意卡片/工具输出、受攻击的子进程及依赖包。
信任边界：发现 → 认证 → per-agent 授权 → durable precommit → 接收端 native permission → OS 权限；任一层不可由 Card、DID、SDK owner 字符串或北向 token 替代。

| 输入/威胁 | 约束与后续验收 | 本轮证据 |
|---|---|---|
| 无/错/撤销 grant；跨 caller、agent 或 task | 卡片与 task 查询都拒绝，无私密缓存/ID/日志泄漏；过期或撤销后每次重新检查 | 规范错误/scoping + SDK owner/cache 源码；文档契约负例；行为 UNKNOWN |
| 重试、重启、deadline 改写、丢 ACK | caller+peer+agent+session+key+fingerprint，native dispatch 前 durable；原 deadline 不延长；UNKNOWN 不重放 | 规范只给 MAY，需 LAM 更强约束；运行 UNKNOWN |
| cancel/完成竞态、子进程死亡 | native terminal 确认后才返回 canceled；不确定保持非终态或不支持 | 标准枚举与静态负例，native 行为 UNKNOWN |
| webhook/远端描述/URL/Origin | push/extended card 禁用；未来 URL allowlist、大小与速率限制、DNS rebinding/SSRF/Origin 检查；远端文本仅为数据 | 无新 listener，无网络攻击测试 |
| Windows sandbox 或 bypass profile | 不修改现有 ACL，不使用绕过 native approval 的启动参数；对 OS 等效隔离另做 SEC | 源码揭示边界，未执行危险路径 |
| 依赖供应链/脚本执行/日志 | 精确版本+来源/哈希；不运行上游 install/build/demo；转依赖完整 SBOM、advisory/漏洞及二进制签名核查仍需补齐 | 固定文件 SHA256、npm integrity 元数据；无“无漏洞”结论 |

## 5. 可复核证据、检查与清理

- [证据入口](evidence/r0-2026-10-26/README.md)：分离预研失败、固定源码采集、文档契约与本仓库回归结果，保留真实退出码、时间、源 SHA、工具版本及 SHA256。
- `python3 docs/research/r0-tools/collect.py --output <全新目录>`：只读 HTTPS，重新解析 pin，记录全部目标源码 SHA256/git blob SHA 和定位摘录、npm 版本/许可/integrity；输出不覆盖旧目录。摘录不是完整源码，复核全文件须按固定 URL 下载比对 hash。AgentBridge 与 SHADI 共用 workspace sources。
- `node docs/research/r0-tools/check.mjs`：Draft-07 schema、固定 URL/许可 sanity；负例覆盖未知许可伪升级、浮动 pin、缺来源、虚构 verified、UNKNOWN 终态/失败映射、cancel 误报、认证/撤销约束缺失、研究越权运行。负例是检测到错误即 PASS，不冒充真实 auth/sandbox 测试。
- `python3 docs/research/r0-tools/check-evidence.py`：把最终 lock 的 API/许可 URL 与两次采集交叉核验；SDK registry gitHead 与 pin 对应，MCP registry gitHead 缺失仍 unknown。
- `pnpm check`：按根 AGENTS 要求执行现有 build/typecheck/lint/test；该命令不运行上游 demo、native probe 或新增跨机实验。四组 GitHub CI 范围是 macOS/Windows × Node22/24；实际 PR 结果单独记录，不把本机通过当四组通过。

未验证：所有上游安装运行/二进制/签名、转依赖完整许可与 advisories、实际 auth/revocation/SSRF/cache 行为、A2A 官方 client/server conformance、stream/cancel/UNKNOWN 扩展、Mac/Win 等强 sandbox、真实进程树/端口清理及跨机。ACP/Codex 继续现有 P2 任务，本轮不升级 launcher/API，也不补写任何历史物理证据。

清理：本轮只下载公开文本及生成文档证据；无新服务、端口、上游子进程、账户/凭据、ACL 或防火墙变更。已有本仓库测试启动的 Mock 由其测试清理；其日志保留，未另做独立的进程/端口残留审计，不能据 suite 通过宣称清理 verified。公开源码临时缓存可删除，审查复现不依赖缓存。回退仅撤销本研究 PR 的 docs 变更；内部 wire、SQLite、生产开关、依赖锁完全无 diff。不自动合并、关闭 #66 或任何父 Issue。
