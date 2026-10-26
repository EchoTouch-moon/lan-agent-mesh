# ZCode inbound evidence（LHI-2 运行原始证据索引）

结论与判读见 [ZCODE_ADAPTER_CONTRACT](../../ZCODE_ADAPTER_CONTRACT.md)。

## 运行记录

| 运行 | 时间（UTC） | 平台 / Node | 入口（CLI / sha256 前 16） | 结果 | 证据 | sha256 |
|---|---|---|---|---|---|---|
| native r1–r2 | 2026-10-26 ~15:4x | darwin arm64 / v22.23.2 | 0.17.0 / `97490d0f06a7a225` | FAIL（smoke 缺陷：workspace 未建 + `/var`→`/private/var` realpath；已修） | 未归档（本地 stdout） | — |
| native r3–r4 | 2026-10-26 ~15:5x | 同上 | 同上 | FAIL（**适配器缺陷**：text_delta 事件不带 inputId，按 inputId 归属丢弃全部增量 → 空文本完成；经 `LAM_ZCODE_ADAPTER_DEBUG` 事件形状捕获证实，改为按 sessionId→active run 归属） | 未归档 | — |
| native r5–r6 | 2026-10-26 ~16:0x | 同上 | 同上 | 部分 PASS（send/stream/cancel 通过；permission 阶段 fixture 按全历史判定 → post-denial 续接误入 hold 分支挂满 deadline；另观测到 plan 模式不弹权限 → 增加 `mode` 选项） | 未归档 | — |
| native r7–r11 | 2026-10-26 ~16:1x | 同上 | 同上 | 收敛中（deny 链原生打通 denials=1；restart 重开失败 → `copyFileSync` 保留 0644 源模式违反 0600 校验，chmod 修复；deadline-UNKNOWN 会话保守锁定致 resume 拒绝 → smoke 改用独立会话） | 未归档 | — |
| **native r12** | 2026-10-27 ~00:45 | darwin arm64 / v22.23.2 | 0.17.0 / `97490d0f06a7a225` | PASS（10/10；首轮审查前版本） | [zcode-adapter-native-darwin-20261027T0045Z.json](zcode-adapter-native-darwin-20261027T0045Z.json) | `db11714cf365a54a8205b20be68a1506bb8c8ad8adfbbf01b3401096aa0328e9` |
| **native r13** | 2026-10-27 ~01:10 | darwin arm64 / v22.23.2 | 0.17.0 / `97490d0f06a7a225` | PASS（11/11；审查修复验证。随后发现 Windows CI 上全平台 synthetic 被 darwin-only 平台门拦截——平台门本意只约束**安装版原生入口**，增加显式 `syntheticPeer` 选项让测试对端在任意平台运行、原生路径不变） | 未归档（被 r14 取代：src 变更后按最终代码归档原则重跑） | — |
| **native r14** | 2026-10-27 ~01:25 | darwin arm64 / v22.23.2 | 0.17.0 / `97490d0f06a7a225` | PASS（11/11 断言），与 r13 相同断言集（含重启后新任务流式、真实原生拒绝 denials=1、sha256 pin） | [zcode-adapter-native-darwin-20261027T0125Z.json](zcode-adapter-native-darwin-20261027T0125Z.json) | `6bc78f21dc4b049d8279d76322b8faa89f53c20bdc05b33863a729e457a9ca4a` |
| **native r15（当前归档）** | 2026-10-26 18:25 UTC | darwin arm64 / v22.23.2 | 0.17.0 / `97490d0f06a7a225` | **PASS（12/12 断言，exit 0）**。复审修复验证：① `expectedExecutableSha256` 必填，native-smoke 改用 HARNESS_MATRIX 独立批准常量（`97490d0f…`），删除"从被测 entry 现算"自批准；② 删除"唯一活跃 run"事件归属 fallback，新增缺双标识事件丢弃负例。**协议证据**：两个 adapter 实例的全部 `model.streaming` 事件均带 `params.sessionId`（首实例 8/8、重启后 1/1），`droppedUnattributedEvents=0`，denials=1，fixture 请求 6、外部模型 0 | [zcode-adapter-native-darwin-20261026T1825Z.json](zcode-adapter-native-darwin-20261026T1825Z.json) | `7d277e5f496d7f683c237b1afec678f6f72758b7db996e9484dc2bea81056b94` |

（注：r12–r14 行的时间为当时本地时间（UTC+8）误标 Z；r15 起为真实 UTC。）

**synthetic（CI 内，全平台）**：`packages/zcode-adapter/test/zcode.test.ts` **10/10**——原 6 项 + 跨会话终态负例（foreign session 声称的 cancelled 必须被丢弃、真实终态才收口）+ 重启后 resume 会话上的新任务流式完成（fake 只对已订阅会话投递事件，缺失重订阅会使该测试失败）+ sha256 pin 负例（**缺失**/错哈希/非十六进制均拒绝、正确哈希通过）+ **缺双标识事件负例**（无 inputId 且无 sessionId 的 delta/terminal 在唯一活跃 run 存在时也必须丢弃并计数，真实终态才收口）。审查指出 Windows CI 此前只跑顶层 RPC 测试，现全生命周期 synthetic 已在**所有平台**运行（原 darwin-only skipIf 已移除）。

归档时源码 SHA-256（r15）：`src/index.ts` = `372960fd2c072482b2d2bf77cd40df463b6d92c865db1ae909e82604c8de5862`；
`src/rpc.ts` = `10436775df398daf6586bc8223b8d326beb9d2e79273b2512b2032436ba896fe`；
`test/native-smoke.mjs` = `a0001f6390dc8f0e653805e8b07f3ff9e88cd208d508ee68e8ba1014f18192a8`；
`test/zcode.test.ts` = `9bb2d1c5fa2d066f94facb4bbba798a9f6c2a34f1b556df74ef5790ebb67db99`；
`test/fake-zcode-server.mjs` = `affd876d4b83bc65f9f824f70f716bf7096e335430039b8828baefe0557a19f3`。

复现：`pnpm --filter @lam/zcode-adapter build && pnpm vitest run packages/zcode-adapter/test/zcode.test.ts && node packages/zcode-adapter/test/native-smoke.mjs`
（native 入口默认 `/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs`，可用 `LAM_ZCODE_ENTRY`/`LAM_ZCODE_BUILTIN_CONFIG` 覆盖；仅 darwin。）

失败历史不删除；Windows 原生 NOT-RUN（需独立复验，不借用 darwin 结论）。
