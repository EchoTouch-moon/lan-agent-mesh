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
| **darwin-r5（二轮审查修复后，当前归档）** | 2026-10-26 ~14:46 | darwin arm64 / v22.23.2 | 0.17.0 / `97490d0f06a7a225` | **PASS（16/16 断言门）**：MCP 子进程 argv 携带唯一 `--run-id`（清理只按本运行标记匹配，绝不按共享脚本名杀进程）；server 日志首行自报 `pid+runId`（归属证明）；权限双向互斥断言（原生请求⇒零执行 / 无请求⇒恰好一次）；进程退出须 `code=0,signal=null`；HOME 删除以 `stat` ENOENT 判定；新增免 ZCode 门自测（19 个合成违规全部被抓） | [zcode-outbound-darwin-20261026T1446Z.json](zcode-outbound-darwin-20261026T1446Z.json) | `9a7a3c2b74c8621565d6c1db2a792832a779ea28908b68932713ed245cc23831` |

**当前有效脚本 SHA-256**（r5 归档时）：`lhi-zcode-mcp-contract.mjs` =
`e920a3b918572a8aa9d21d78ba55bc03e01a177768ab6df6418faf8fbfd03fef`；
`lhi-zcode-mcp-outbound-smoke.mjs` =
`03d3bd0b3853ad9366d958ad23cc479582779a43d129fad2a432ad29f349dd2f`。
断言数量以报告 `assertions[]` 实数为准（当前 16）；r1–r4 历史保留不删除。

复现：`node scripts/lhi-zcode-mcp-contract.mjs --self-test && node scripts/lhi-zcode-mcp-outbound-smoke.mjs`
（入口可用 `LAM_ZCODE_ENTRY` 覆盖；默认 `/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs`。）

失败记录不删除；不同版本/测试等级的报告永不覆盖。
