# ZCode outbound evidence（LHI-1 运行原始证据索引）

本目录存放 [LHI-1（#80）](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/80) 探针
`scripts/lhi-zcode-mcp-outbound-smoke.mjs` 的脱敏运行报告。结论与判读见
[ZCODE_OUTBOUND_ACCEPTANCE](../../ZCODE_OUTBOUND_ACCEPTANCE.md)。

## 运行记录

| 运行 | 时间（UTC） | 平台 / Node | 入口（bundled CLI / sha256 前 16） | 结果 | 证据 | sha256 |
|---|---|---|---|---|---|---|
| darwin-r1 | 2026-10-26 ~13:45 | darwin arm64 / v22.23.2 | 0.17.0 / `97490d0f06a7a225` | FAIL（**探针脚本缺陷**：同相位重复发 tool_call → 778 次推理请求、turn 45s 超时；期间已观察到真实 MCP 出站执行；教训见验收文档 §5.2/5.3） | 未归档（本地 stdout，失败历史保留于本表） | — |
| darwin-r2 | 2026-10-26 ~13:48 | 同上 | 同上 | PASS（全部断言通过） | 未归档（被 r3 取代：r2 由 lint 修复前的工作树脚本产生，为使归档证据与提交脚本逐字节一致，用最终脚本重跑得 r3） | — |
| **darwin-r3** | 2026-10-26 ~13:56 | darwin arm64 / v22.23.2 | 0.17.0 / `97490d0f06a7a225` | PASS（正向 + 4 负例 + 禁用对照 + 清理全过；fixture 请求 10 次、外部模型 0、超时观测 5144ms） | [zcode-outbound-darwin-20261026T1356Z.json](zcode-outbound-darwin-20261026T1356Z.json) | `2452e4998df405112af4e8b2b6cea8cc54d109d5cbe14cd1c4c48c7a842055e3` |
| **darwin-r4** | 2026-10-26 ~14:18 | darwin arm64 / v22.23.2 | 0.17.0 / `97490d0f06a7a225` | PASS（首轮审查修复：断言门/env 白名单/清理证明/权限负例） | [zcode-outbound-darwin-20261026T1418Z.json](zcode-outbound-darwin-20261026T1418Z.json) | `6c04d218f62a5479a41f2c395794a22eef64e2af9aa85c2c6c9aa4a4397ee458` |
| **darwin-r5** | 2026-10-26 ~14:46 | darwin arm64 / v22.23.2 | 0.17.0 / `97490d0f06a7a225` | PASS（16/16 断言门；二轮审查功能修复验证；随后仅做 lint 装饰性修改——删未用参数/变量，无行为差异） | [zcode-outbound-darwin-20261026T1446Z.json](zcode-outbound-darwin-20261026T1446Z.json) | `9a7a3c2b74c8621565d6c1db2a792832a779ea28908b68932713ed245cc23831` |
| **darwin-r6** | 2026-10-26 ~14:58 | darwin arm64 / v22.23.2 | 0.17.0 / `97490d0f06a7a225` | PASS（16/16 断言门；二轮审查修复后的最终代码验证） | [zcode-outbound-darwin-20261026T1458Z.json](zcode-outbound-darwin-20261026T1458Z.json) | `ac69ee5fa842705e413bc7aa50f26182b152a3119f0702f025c2fd8fa4fa0e44` |
| **darwin-r7** | 2026-10-26 ~15:07 | darwin arm64 / v22.23.2 | 0.17.0 / `97490d0f06a7a225` | PASS（16/16；三轮修复验证；随后四轮收口两项验收语义，见 r8） | [zcode-outbound-darwin-20261026T1507Z.json](zcode-outbound-darwin-20261026T1507Z.json) | `9150442d0f04eb1d2c52c274dc2c820cfe3113ea21107fb047948f89471d4eb2` |
| **darwin-r8（四轮审查收口后，当前归档）** | 2026-10-26 ~15:22 | darwin arm64 / v22.23.2 | 0.17.0 / `97490d0f06a7a225` | **PASS（16/16 断言门）**：清理门仅认**实际验证的** `clean`（`unsupported` 也算 FAIL，Windows 原生运行须先实现本平台扫描）；权限门更名为 `permission-deny-chain-demonstrated`，**必须实际证明 Native Deny 链**（无原生请求的"直接执行"分支不再可过，按 finding 处理）；自测违规样本增至 **26** 个全部被抓 | [zcode-outbound-darwin-20261026T1522Z.json](zcode-outbound-darwin-20261026T1522Z.json) | `092469d6b307c3c767eb6232bda553d1a184d3ee736f77781c2c1c0e8b367f7c` |

**当前有效脚本 SHA-256**（r8 归档时）：`lhi-zcode-mcp-contract.mjs` =
`7312618814b767b4e801f3ca81d1d21c175d2f6523a006eedfcbfeb261cbf8b0`；
`lhi-zcode-mcp-outbound-smoke.mjs` =
`1e25d18f5fe4d6d0f37cfc31ea56a2df0a6f80afe5eb80135e54d2c076bbbd0b`。
断言数量以报告 `assertions[]` 实数为准（当前 16）；r1–r7 历史保留不删除。

复现：`node scripts/lhi-zcode-mcp-contract.mjs --self-test && node scripts/lhi-zcode-mcp-outbound-smoke.mjs`
（入口可用 `LAM_ZCODE_ENTRY` 覆盖；默认 `/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs`。）

失败记录不删除；不同版本/测试等级的报告永不覆盖。
