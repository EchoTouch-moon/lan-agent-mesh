# ZCode outbound evidence（LHI-1 运行原始证据索引）

本目录存放 [LHI-1（#80）](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/80) 探针
`scripts/lhi-zcode-mcp-outbound-smoke.mjs` 的脱敏运行报告。结论与判读见
[ZCODE_OUTBOUND_ACCEPTANCE](../../ZCODE_OUTBOUND_ACCEPTANCE.md)。

## 运行记录

| 运行 | 时间（UTC） | 平台 / Node | 入口（bundled CLI / sha256 前 16） | 结果 | 证据 | sha256 |
|---|---|---|---|---|---|---|
| darwin-r1 | 2026-10-26 ~13:45 | darwin arm64 / v22.23.2 | 0.17.0 / `97490d0f06a7a225` | FAIL（**探针脚本缺陷**：同相位重复发 tool_call → 778 次推理请求、turn 45s 超时；期间已观察到真实 MCP 出站执行；教训见验收文档 §5.2/5.3） | 未归档（本地 stdout，失败历史保留于本表） | — |
| darwin-r2 | 2026-10-26 ~13:48 | 同上 | 同上 | PASS（全部断言通过） | 未归档（被 r3 取代：r2 由 lint 修复前的工作树脚本产生，为使归档证据与提交脚本逐字节一致，用最终脚本重跑得 r3） | — |
| **darwin-r3（归档）** | 2026-10-26 ~13:56 | darwin arm64 / v22.23.2 | 0.17.0 / `97490d0f06a7a225` | **PASS**（正向 + 4 负例 + 禁用对照 + 清理全过；fixture 请求 10 次、外部模型 0、超时观测 5144ms） | [zcode-outbound-darwin-20261026T1356Z.json](zcode-outbound-darwin-20261026T1356Z.json) | `2452e4998df405112af4e8b2b6cea8cc54d109d5cbe14cd1c4c48c7a842055e3` |

归档时脚本 SHA-256：`lhi-zcode-mcp-contract.mjs` =
`1fa88ae0c474f62c6d2d6097e3abf1ceda25af22803a87467d69a1117f141dbf`；
`lhi-zcode-mcp-outbound-smoke.mjs` =
`0cc5af99286aa77306786004038fbf97b16d3d8d51b1e4ae41f340cbe5b5b5de`。

复现：`node scripts/lhi-zcode-mcp-contract.mjs --self-test && node scripts/lhi-zcode-mcp-outbound-smoke.mjs`
（入口可用 `LAM_ZCODE_ENTRY` 覆盖；默认 `/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs`。）

失败记录不删除；不同版本/测试等级的报告永不覆盖。
