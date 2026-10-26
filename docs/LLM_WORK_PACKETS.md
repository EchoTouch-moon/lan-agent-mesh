# LLM/Agent 任务交接与执行规范（2026-10-26）

优先级顺序：用户最新明确要求 > 本仓库安全契约 [ADR0004](adr/0004-standards-first-agent-interop.md) > [互操作重规划](INTEROP_REBASELINE_2026-10-26.md) > [P2 双端硬件计划](NEXT_PHASE_2026-10-26.md) > 任务 Issue > 历史完成快照。若存在矛盾，**先停止有权限的操作**并在 Issue 标记冲突；不要擅自把旧「尚未合并」等历史说明当成当前状态。

## A. 每个 Agent 开工前必须执行的六项检查

1. **定位**：确认 `git status --porcelain` 空、`git rev-parse HEAD` 和当前 main/PR 来源；优先读取本任务 Issue 最新评论、所有前置 Gate。
2. **目标界定**：明确本次是 document-only、synthetic、native-local 还是 actual-cross-host；只有用户现场确认时才可以开展需要跨设备配对/监听的实验。
3. **依赖校验**：真实版本、已提交代码、官方规范、第三方 tag/license、当前本机可用的 Harness API。缺失即 `BLOCKED`/unknown，不据推断修改状态。
4. **边界**：仅在私有临时目录、固定响应 loopback、默认拒绝原生权限；不用用户现有账户和模型配置；无 system ACL/firewall 更改或自动提权。
5. **研发**：先写重现失败的 contract/regression 测试、受影响范围补丁，再运行全套 `pnpm check` 和实际可运行的 fixture；保持 Source SHA 与代码一致。
6. **交付**：分支与 PR 必须有下述记录、cross-host 双边原件哈希和真实退出码（确实未采则 null），不能用最后一个管道命令的退出码掩盖失败。

## B. 任务领取格式（Issue/PR 评论使用）

```markdown
### CLAIM
taskId: R0-A | R1-A | R2-A | M1 | M2 | W1 | W2 | W3 | SEC-A | NET-A | R3 | R4
ownerSide: Mac | Windows | cross-platform
baseSha: <40hex>
branch: <branch>
scope: <only files/feature involved>
dependsOn: <issue links and Gate status>
testClass: docs | synthetic | native-local | physical-cross-host
permissions: no-network | loopback-only | user-approved-LAN-only
stopConditions: <clear STOP>
expectedOutputs: <specific paths/tests/PR>
```

### 结果回传（原件不可改写）

```markdown
### RESULT
testedSourceSha: <40hex, must be precommitted>
headSha: <40hex>
worktreeCleanBefore: true | false
osNodePnpmHarness: <exact versions, or unknown>
binaryAndRunnerHashes: <sha256 or null>
commands: [{command,exitCode,startedAt,finishedAt}]
tests: [{case,expected,observed,result: PASS|FAIL|UNKNOWN|SKIP}]
nativeModelCalls: fixture-only | external-authorized | not-used | unknown
security: {defaultDeny, scopedIdentity, aclGate, revocation, noSecretLog}
cleanup: {gatewayStopped, adaptersStopped, portsReleased, privateDirsCleared, anomalies}
evidence: <paths + sha256 + remote-peer cross-review when applicable>
unverified: <exact list>
regressions: <old tests affected or not>
mergeRecommendation: ready-for-review | blocked | doc-only
rollback: <flag / no runtime effect / additive schema>
```

## C. 完成标准不可降级

- 文档研究：上游证据+决策理由+license/兼容/攻击面；未实际执行不得叫 verified。
- Synthetic：精确配置、临时目录、可复现出错与 negative、CI；不得叫真实 installed harness。
- Native Local：真实被测 Harness 二进制、与对应 source/构建 hash、原生拒绝和清理；不得叫跨实体。
- Physical Cross-host：Mac/Win 同一 tested SHA、双方主角色同一时段证据与事件/计数交叉复核、真人 pairing、清理；不得用两轮不同 SHA 拼作一个实验。
- Native Harness outbound：原生 Agent 发出的 MCP/tool event；不能拿独立 MCP SDK 客户端冒充。
- A2A conformance：独立官方 A2A client 与标准 server 接口，版本锁定，详细 negative/auth/stream/task 结果；手工 HTTP 200 不算完整规范通过。

## D. 文件/分支冲突处理

- 同一轮研究独立分支 `research/r0-upstream-audit`、`feat/a2a-readonly`、`feat/a2a-task-bridge`、`mac/codex-outbound-probe`、`win/dsh-remote-fixture`；分支名称是建议，不是说分支已经创建。
- Mac 主领 A2A 只读桥和 Codex，Windows 主领 DSH/出站 harness；跨端执行前由另一端审核 runner SHA。
- 单 PR 一个可验收 Slice；同路径不并行未经协调修改。先审查后集成，不先把 stacked PR 全部合并到 main。
- 上游依赖版本变更附 SBOM/lock diff/license review，不接受 `latest` floating install。
- 文档与原始证据可以互链；不替换失败报告或改成功态，不清空 lock/idempotency history 让测试通过。

## E. Agent 决策树

1. 有明确且安全的任务范围？无 → 在 Issue 写 `BLOCKED: scope`。
2. 依赖 Gate PASS？无 → 仅可进行无权限 read-only 调研，不写生产代码冒充 ready。
3. 只涉及本机 synthetic？是 → 可开发/验证；否 → 是否已得到用户的实体或真实资源授权？无 → 不执行。
4. 有原生能力证据？无 → 写 unknown，先做最小探针；不可用 SDK 测试客户端替代。
5. 测试红/结果不确定？留证据/明确 FAIL|UNKNOWN，修复后新增再次运行记录；不覆盖旧报告。
6. 完成后是否要 merge/close？除非另有明确授权，否则停在 PR ready-for-review 并贴 Issue 更新。

## F. 最短交接用语

「读取 ADR0004、INTEROP_REBASELINE_2026-10-26.md、LLM_WORK_PACKETS.md 和 Issue #<number> 最新评论；本轮仅领取 <taskId> 的 <scope>，在干净 main 分支实现可复现 fixture/synthetic 和拒绝负例，回传固定 SHA、真实退出码、CI、原始证据哈希及未验证项；不执行权限扩展、跨实体窗口、在线模型或未经批准的合并。」
