# 2026-10-26 下一阶段执行计划：P2 已集成 → 实体双机受控 Harness 闭环

> 状态：**已确认的开发/实验路线，不是任何真实模型、既有 GUI、长期凭据、系统权限或新 LAN 测试窗口的执行授权**。Windows 与 Mac 可以立即各自开展不联网的研发与确定性本机 fixture 验证；实体跨机步骤需要双方设备就绪、用户现场核对配对并明确安排窗口。
>
> 统一协调入口：[#42](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/42)；实体 Mock：[#15](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/15)；Codex：[#17](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/17)；DSH：[#18](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/18)；Harness 跨机：[#19](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/19)。

## 1. 审查基线与不可混淆的进度

- 截至 2026-10-26，`main` 已按明确授权合并 [#63](https://github.com/EchoTouch-moon/lan-agent-mesh/pull/63)，merge SHA `0f2f38af03882d4ebd4e8b5e8fed712bf4222c06`。合并后 [push CI #40212173437](https://github.com/EchoTouch-moon/lan-agent-mesh/actions/runs/40212173437) 的 macOS/Windows × Node22/24 四组全部 success。该 CI 表明集成代码通过 hosted 检查，不等于当前主干进行过新的实体 Mac↔Win Native E2E。
- #47～#62 实现/证据已由 #63 完整纳入，#64 三个 Windows 组合验收证据文件以原字节纳入；旧分支和失败记录保留，#45 替代 ACL 方案继续排除。不要重新合入已覆盖的旧 PR，避免重复补丁。
- Mac Codex 0.146.0、Win desktop DSH 0.2.1-rc.2 各自的**本机真实二进制 + loopback 固定响应**验收已在相同执行源 `5fed1448337d82f72972270c99447205f02ea2d7` 通过。参见 [Mac/综合报告](evidence/integration/p2-20261025T160043Z/SUMMARY.md) 和 [Windows W-DSH-03](evidence/dsh-adapter/windows-native-local-20261025T1614Z/SUMMARY.md)。它们未验证两个真实 Harness 之间的跨实体路径，也不证明真实云端模型已运行。
- 实体 W3 Mock 第一轮是 `d226c2c`，第二轮定点 ACK/在途取消是 `8c6b4c6`。第二轮交叉复核有效，但**两个执行源不是一次完整同 SHA 全量验收**；部分 Windows 辅助命令退出码/配对时刻依旧 unknown。[#15](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/15) 保持开放；不把旧报告重写成现有 `main` 的执行结果。
- G2 Windows 私有存储 fail-closed 已通过实体正/负验收并纳入主干；但现有 Gateway 尚未默认开启 Native Adapter，跨机人工审批 Policy Engine 仍未完成。安全门槛不能因 CI 通过而放宽。

## 2. 架构判断：不改主线，只修改工作重心

继续使用**两个同构 Gateway + 互信加密 P2P + 本地 MCP 出站 + 本地受控 Harness Adapter 入站**。节点与原生会话归各自宿主所有；远端可见的只是有作用域的 Agent 和 workspace alias。Native permission 必须以被调用 Harness 自己的拒绝/授权作为上限，Gateway 不得代替 Agent 自批准。

下一轮先实现和验证**「MCP 客户端 → 本地 Gateway → 对端 Gateway → 对端真实 Harness（固定 loopback 推理）」**；之后再验证**「Harness 自身主动调用 mesh_* → 对端 Harness」**。这两层不要混为一谈：
1. **B1（双向网关控制链路）**：Mac 本地 MCP SDK 客户端 → Windows DSH；Windows 本地 MCP SDK 客户端 → Mac Codex。SDK 客户端证明的是连接/适配/权限，不算 Harness 主动发起。
2. **B2（Mac Harness 主动发起）**：Mac Codex **真实原生 MCP 工具调用** → Windows DSH，仍可用确定性 localhost model fixture；必须有 Codex 发起 tool invocation 的证据，不能把 SDK 测试客户端重命名为 Codex。
3. **B3（Windows Harness 主动发起）**：Windows DSH/ZCode/Windows Codex 中至少一个经版本探针证实支持出站 MCP/工具调用，再由它调用 Mac Codex。**DSH ACP 入站不证明 DSH MCP 出站**。若没有受支持的出站接口，写明 BLOCKED/unknown，不捏造双向 Agent 协作。
4. **B4（Alpha 级协作）**：B2+B3 通过后，再引入 Policy/审批/审计和可日常使用入口；真实模型、长期凭据、已有 GUI attach 是另行批准的更高权限范围。

## 3. 双端可并行执行的开发包（无需现在建立跨机监听）

### Mac 端 — M1 / M2（#17、#19）

- [ ] **M1 出站能力探针**：在已验证 Codex 0.146.0 的**全新隔离 `CODEX_HOME`** 中，以用户已可审查的配置/SDK 合同验证 Codex 能否连接并调用七个 `mesh_*` 本地 MCP 工具；先用本机 Mock 与确定性 loopback 返回，不读取真实用户登录、聊天、工具配置。记录 native tool-call 请求、scope 约束、响应及版本；未成功前不得宣称「Codex 发起」。
- [ ] **M2 Mac 接收方组合**：用 main 当前的 `@lam/codex-adapter`/Gateway 显式注册 `codex` fixture Agent（默认不导出/不上线），确认本机新 session、精确重试、流式事件、真正的在途取消、原生 decline+写入正控、UNKNOWN、清理。为后续 Windows MCP SDK → Mac Codex 提供可复现的干净执行脚本/报告。
- [ ] **M3 审查跨机实验 runner**：审查 Win 提交的脚本和负例，不为图方便开放任意 shell、绝对路径、native thread ID 或 native answerPermission。准备实体窗口的 Mac 端 operator guide，先提交代码再实验。

### Windows 端 — W1 / W2（#18、#19）

- [ ] **W1 DSH 接收方组合**：在独立的 user-exclusive 路径中使用当前 `@lam/dsh-adapter`，仅固定的 desktop DSH 0.2.1-rc.2、绝对 launcher/pwsh 路径与 SHA-256、PowerShell7、localhost fixture；编写可提交的端到端接收方 runner。验证真实原生 session/new→prompt/stream→resume/cancel、reject_once+marker 正控、UNKNOWN 不重放及进程树/lock 清理；程序或配置变化时重新复验，未变化不必重复历史六阶段。
- [ ] **W2 出站可行性探针**：对 Windows 已安装的 DSH、ZCode、Codex 候选逐一核实**实际版本支持的出站 MCP/工具调用**及可用配置边界，优先公开或已验证接口；不执行未知 MSIX 候选二进制、不反向工程宿主私有凭据、不触碰现有 GUI。输出「verified/documented/unknown/unsupported」能力表和最小 fixture 复现实验。找到受支持的候选后才实现 B3。
- [ ] **W3 反向 MCP SDK 调用方**：准备 Windows 本地真实 MCP SDK stdio 客户端，通过 scoped/revocable grant 调用 Mac Codex；验证 Agent 发现权限、会话归属、结果游标和取消，不以 SDK 路径宣称 Windows Harness 已具备 MCP 出站能力。

### 两端共享 — S1 / S2

- [ ] **S1 预提交 deterministic 跨实体 runner**：统一 CLI/fixture、同一请求数据与哈希、任务/会话/事件关联键；至少有一组成功、一组拒绝和一组失败注入。核心不得直接读取对端本机配置。runner 提交并跑 CI 后再实机执行；执行期间不得换源码。
- [ ] **S2 增量可靠性回归**：包含旧 ACK 超时后原 envelope 重试只返回一个逻辑 Task、已落盘 Session reply/未落 inbox receipt 的恢复、Adapter 离线不再广告新服务、取消要见 native terminal 才记 CANCELLED、进程死后 UNKNOWN 不自动重做。保留完整失败用例，不将 completed 当作 cancel 成功。
- [ ] **S3 证据标准**：每个角色保存 testedSourceSha、clean worktree、OS/Node/pnpm/Harness版本、二进制/关键脚本哈希、逐条实际退出码、起止时间、成功/失败/unknown 原样结果、双方 event/task IDs 脱敏摘要、接收方计数、私有目录/子进程/端口退出状态与报告 SHA-256。敏感 IP、路径、配对码、token 和原生历史不可上传。

## 4. 下一实体实验窗口（仅在双方确认、有人在场后执行）

| 顺序 | 实验 | 能声称的结果 | Gate / Stop |
|---|---|---|---|
| E0 | 双端 checkout **同一个新固定代码 SHA**，`pnpm install --frozen-lockfile`、`pnpm check`，验证私有数据目录/现有 G2 拒绝规则；人工核对双方身份与配对码 | 实体窗口前置条件 | 任一端不 clean、不在私有目录或环境缺失，停止 |
| E1 | 快速 Mac↔Win 双向 Mock smoke + 未配对/撤销拒绝，必要时按 #15 重验特定历史缺口 | 当前代码的基本硬件链路 | 不复写旧 W3 全量结论 |
| E2 | Mac **MCP SDK**→Win DSH fixture；Win **MCP SDK**→Mac Codex fixture：注册→新会话→两条关联消息→流式回执→在途取消与权限拒绝→精确重试 | B1 双方向成立 | 有一端无可审核原生接收方证据则不升级 |
| E3 | Mac **Codex** 的真实本地 MCP 工具调用 → Win DSH fixture（必须有 native tool invocation 记录） | B2 成立 | M1 未通过则标 BLOCKED，不改用 SDK 冒名 |
| E4 | Windows 已验证 Harness 的真实 MCP/工具调用 → Mac Codex fixture | B3 成立 | W2 未找到支持接口则单列 unknown，不把 E2 冒充 E4 |
| E5 | 信任撤销/凭据过期、ACK 丢弃、重启 UNKNOWN/不重放、默认拒绝与完整清理交叉复核 | 当前测试源的安全可靠性边界 | 不用未知结果凑通过 |

**禁止升级的范围**：无真实在线模型/用户长期密钥，禁止无人看守服务、私有文件写入授权、自动批准、额外防火墙/ACL 修改、提权、公网打洞、原有 GUI/账号会话接管。短期只允许用户在场、隔离 workspace 与固定本地响应的可控实验。新权限需求作为独立提案审查。

## 5. 交付与合并规则

1. 两端分别从最新 main 拉独立 `mac/...` / `win/...` 实验分支；先提交测试 harness 和脚本，再执行并归档独立 evidence PR。不要同时直接修改共享核心的同一区域。
2. 每个 PR 必须说明目标 Gate、实测与未实测项、关键补丁、CI 四组状态、native 与 synthetic 区别、原始失败/unknown、负例、清理结果。必要时用固定 head 集成候选验证，主干合并要独立审查；不以 PR CI 代替实体硬件。
3. 保留 #15、#17、#18、#19 开放直到各自原验收条件具备证据；无用户授权不启动新的实体联调/真实模型，不自动关闭父 Issue。
4. **本轮完成定义**：E2 双方向原生接收方路径及 M1/W2 出站能力结论全部可审计；有支持接口才争取 E3/E4。E2 通不过先修网关/Adapter可靠性，不转向 P3 UI、A2A、群聊或新 GUI 接管。
5. 这轮代码验证后更新 [ROADMAP](ROADMAP.md)、[HARNESS_MATRIX](HARNESS_MATRIX.md)、[#42](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/42) 状态；能力字段 `unknown` 不随希望而变成 `verified`。
