# 互操作与安全实验矩阵 — 可复现实验规范（2026-10-26）

**核心原则**：公平比较而非预先证明 LAM 更好。不同项目如无法在相同安全目标/硬件/API 下运行，标 `not-comparable` 并说明差异，不能靠关闭安全检查提升吞吐。R0/R1/R2 与 P2 Native/实体证据等级必须分别列示。

## 1. 四种独立实验等级

| Level | 系统/场景 | 关键结果 | 不得宣称 |
|---|---|---|---|
| L0 | schema/SDK 单元和 synthetic Mock | conformance、scope、状态映射、确定性负例 | 实际原生 Harness |
| L1 | 实机同机 Native+localhost inference fixture | native session、tool/permission 事件、进程清理 | 真实模型或跨机 |
| L2 | 两台实体 Mac/Win、被控 Native fixture | pairing + A2A/MCP Bridge + Session/Task 实际双机行为 | 两台 Harness 都主动发起 MCP |
| L3 | Agent 自己发起 native MCP/tool call 跨实体 | B2/B3 分方向 verified | 未确认的 GUI attach/真实模型/人工审批 |

## 2. 兼容性用例

- C-01 official A2A v1.0 SDK client 获取允许的 Agent Card，校验 card field/endpoint 与真实 scoped agent/version。
- C-02 Anonymous、错 issuer、过期 grant、跨 peer/agent、撤销后 Agent Card 不泄漏敏感能力/原生路径/IP。
- C-03 message/send：相同原始 key 与参数 = 同 task，一项参数或 deadline 改变 = conflict；gateway restart = 不再执行原 native side effect。
- C-04 真实多轮 context 映射、同一 native session continuity、caller 边界和 busy turn 拒绝。
- C-05 Subscribe/getTask 的事件严格单调，断线后 durable cursor 不重排/不丢失已提交 terminal 事件。
- C-06 CANCEL 在实际 native terminal 后才对外标 canceled；completed-before-cancel race 和 accepted-but-unknown 分别如实记录。
- C-07 native parent unexpected death 后 persistent UNKNOWN，不将其映射到成功/失败且不 blind replay。
- C-08 精确 drop-ACK、30秒 cached reply 过期重试、session reply 已提交但 inbox receipt 未写、adapter offline/stale 不广告新能力。
- C-09 Native reject_once/decline + marker 写入正控/拒绝后 ENOENT，未授权 workspace/目录穿越/credential 失败时无文件或工具执行。
- C-10 禁用 bridge 时，无额外监听/secret 和旧 P1/P2 测试行为回归。
- C-11 Windows G2：unsafe ancestor/owner/DACL/reparse fail closed；安全独占目录才允许新凭据（不更改旧 ACL）。
- C-12 与本机 agent outbound MCP 的真实 native event 关联，不得用 SDK client 冒充。

## 3. 基准方案

候选：LAM 原生 Gateway、LAM+A2A 可选 bridge、AGNTCY AgentBridge/SHADI、OpenAgents；SLIM、AgentLink、AgentTorrent 视 R0 部署及成熟度选择，不能硬凑进主图。协议层与应用层分别报告，避免混用。

变量控制：两台固定真实机器和 OS/CPU/RAM；同一 LAN/有线或 Wi-Fi；相同固定请求 payload (1KiB/16KiB/<=64KiB frame 限制)、并发(1/4/16)、固定本地响应不计云推理差异；同一权限设置；同一 warm/cold connection、同一测试时长/轮次；设置最大重试和 timeout。日志/原始 JSON 脱敏保留。

测量：连接/认证/配对准备耗时、消息 p50/p95/p99、吞吐、CPU 峰值、RSS、失败率、恢复到可接新任务的时间、取消生效到 terminal 时间、重复 native 执行次数、未授权漏信息次数、泄漏密钥次数、任务状态误报次数、清理遗留进程/端口数。成功样本量和置信区间必须列出；数据集太小时报告原始点而不是夸大统计显著性。

故障：响应 ACK 丢弃、断开与重连、进程 SIGKILL/Windows taskkill、超时、收据写入失败、离线 Agent、重复/伪造 requestId、错 pair code、过期 grant；故障注入在同样协议/身份点位。工具层的丢 ACK 不可标作真实抓包网络丢包。

## 4. 审计型报告模板

```json
{
  "runId":"string",
  "benchmarkSourceSha":"40hex",
  "targetImplementation":"LAM|LAM_A2A|AGENTBRIDGE|OPENAGENTS|...",
  "environment":{"os":"string","cpu":"string","node":"string","network":"LAN/loopback","harnessVersion":"string"},
  "protocol":{"specVersion":"string","sdkCommitOrTag":"string","securityConfigDigest":"sha256"},
  "workload":{"payloadBytes":1024,"concurrency":1,"sampleCount":0,"fixedResponse":true},
  "observations":{"success":0,"failure":0,"unknown":0,"duplicateNativeExecutions":0,"unauthorizedLeaks":0,"latencyMs":[]},
  "artifactHashes":{"rawReport":"sha256","runner":"sha256"},
  "cleanup":{"portsReleased":null,"childrenStopped":null},
  "limitations":["unknown"]
}
```

不在公共仓库归档私密 IP、路径、pairing code、凭据、原生会话全文。原件哈希保留；原始失败不可覆盖。不同 runtime 版本或源码变化必须创建新 runId，不把不同 SHA 合为一个执行结果。
