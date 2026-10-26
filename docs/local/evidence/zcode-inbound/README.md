# ZCode inbound evidence（LHI-2 运行原始证据索引）

结论与判读见 [ZCODE_ADAPTER_CONTRACT](../../ZCODE_ADAPTER_CONTRACT.md)。

## 运行记录

| 运行 | 时间（UTC） | 平台 / Node | 入口（CLI / sha256 前 16） | 结果 | 证据 | sha256 |
|---|---|---|---|---|---|---|
| native r1–r2 | 2026-10-26 ~15:4x | darwin arm64 / v22.23.2 | 0.17.0 / `97490d0f06a7a225` | FAIL（smoke 缺陷：workspace 未建 + `/var`→`/private/var` realpath；已修） | 未归档（本地 stdout） | — |
| native r3–r4 | 2026-10-26 ~15:5x | 同上 | 同上 | FAIL（**适配器缺陷**：text_delta 事件不带 inputId，按 inputId 归属丢弃全部增量 → 空文本完成；经 `LAM_ZCODE_ADAPTER_DEBUG` 事件形状捕获证实，改为按 sessionId→active run 归属） | 未归档 | — |
| native r5–r6 | 2026-10-26 ~16:0x | 同上 | 同上 | 部分 PASS（send/stream/cancel 通过；permission 阶段 fixture 按全历史判定 → post-denial 续接误入 hold 分支挂满 deadline；另观测到 plan 模式不弹权限 → 增加 `mode` 选项） | 未归档 | — |
| native r7–r11 | 2026-10-26 ~16:1x | 同上 | 同上 | 收敛中（deny 链原生打通 denials=1；restart 重开失败 → `copyFileSync` 保留 0644 源模式违反 0600 校验，chmod 修复；deadline-UNKNOWN 会话保守锁定致 resume 拒绝 → smoke 改用独立会话） | 未归档 | — |
| **native r12（最终代码，归档）** | 2026-10-27 ~00:45 | darwin arm64 / v22.23.2 | 0.17.0 / `97490d0f06a7a225` | **PASS（10/10 断言）**：send/stream、cancel-in-flight、**原生 deny 链**（`interaction/requestPermission`→deny→工具零执行→turn 完成）、deadline-UNKNOWN+离线、重启 resume 同一 native id、幂等重试、锁释放、目录删除验证；fixture 请求 5 次、外部模型 0 | [zcode-adapter-native-darwin-20261027T0045Z.json](zcode-adapter-native-darwin-20261027T0045Z.json) | `db11714cf365a54a8205b20be68a1506bb8c8ad8adfbbf01b3401096aa0328e9` |

**synthetic（CI 内，darwin 段）**：`packages/zcode-adapter/test/zcode.test.ts` 6/6（RPC poison/redaction、映射+幂等+冲突+deny+重启持久化、事件去重（foreign session / post-terminal）、串行+cancel+crash-UNKNOWN 跨重启、deadline UNKNOWN、home/provider/并发拒绝）。非 darwin 平台 darwin 段跳过，RPC 顶层测试全平台运行。

归档时源码 SHA-256：`src/index.ts` = `2206f2ee4ed6b91cd7a20e1b9da26209fccdd0f3b28b397c239b84a0e697376d`；
`src/rpc.ts` = `10436775df398daf6586bc8223b8d326beb9d2e79273b2512b2032436ba896fe`；
`test/native-smoke.mjs` = `033e0ba0f3607f241feca412a941913c819a15faa2913f521198d9b614b2a346`；
`test/zcode.test.ts` = `13b862b7409574e8867a5ebc34c30583a08f97b2af6f659f40cff1220bfb7d0d`；
`test/fake-zcode-server.mjs` = `f4a9010f6a7dc77d8ce3f0065a494f45a4cf95a28acc7e023837924abeb6abf6`。

复现：`pnpm --filter @lam/zcode-adapter build && pnpm vitest run packages/zcode-adapter/test/zcode.test.ts && node packages/zcode-adapter/test/native-smoke.mjs`
（native 入口默认 `/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs`，可用 `LAM_ZCODE_ENTRY`/`LAM_ZCODE_BUILTIN_CONFIG` 覆盖；仅 darwin。）

失败历史不删除；Windows 原生 NOT-RUN（需独立复验，不借用 darwin 结论）。
