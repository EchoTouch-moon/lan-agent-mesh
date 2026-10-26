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
| **native r13（审查修复后，当前归档）** | 2026-10-27 ~01:10 | darwin arm64 / v22.23.2 | 0.17.0 / `97490d0f06a7a225` | **PASS（11/11 断言）**：resume 后显式重订阅并以"重启后新任务真实流式完成"验证；权限门收紧为**必须观察到真实原生拒绝请求**（denials=1 + marker 未创建 + turn 完成）；可执行文件 sha256 **pin 强校验**（不匹配即拒绝打开） | [zcode-adapter-native-darwin-20261027T0110Z.json](zcode-adapter-native-darwin-20261027T0110Z.json) | `6bc78f21dc4b049d8279d76322b8faa89f53c20bdc05b33863a729e457a9ca4a` |

**synthetic（CI 内，全平台）**：`packages/zcode-adapter/test/zcode.test.ts` **9/9**——原 6 项 + 新增：跨会话终态负例（foreign session 声称的 cancelled 必须被丢弃、真实终态才收口）、重启后 resume 会话上的新任务流式完成（fake 只对已订阅会话投递事件，缺失重订阅会使该测试失败）、sha256 pin 负例（错哈希/非十六进制拒绝、正确哈希通过）。审查指出 Windows CI 此前只跑顶层 RPC 测试，现全生命周期 synthetic 已在**所有平台**运行（原 darwin-only skipIf 已移除）。

归档时源码 SHA-256（r13）：`src/index.ts` = `1ea38a9f1a66996847cc096428a9d04073dbb8d6fb5289824712e74245acf146`；
`src/rpc.ts` = `10436775df398daf6586bc8223b8d326beb9d2e79273b2512b2032436ba896fe`；
`test/native-smoke.mjs` = `f8f001b0694f426a5744238d2b83dfc40d9c59398727dbc465fcced526c2d022`；
`test/zcode.test.ts` = `2e976f56d8872b303f70e37284e011ffc9a359dc103246ec617e326438ca70ba`；
`test/fake-zcode-server.mjs` = `3372deb5f5ca071ad5872da0fc6d92893235fe64f947d8d3000511556790d173`。

复现：`pnpm --filter @lam/zcode-adapter build && pnpm vitest run packages/zcode-adapter/test/zcode.test.ts && node packages/zcode-adapter/test/native-smoke.mjs`
（native 入口默认 `/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs`，可用 `LAM_ZCODE_ENTRY`/`LAM_ZCODE_BUILTIN_CONFIG` 覆盖；仅 darwin。）

失败历史不删除；Windows 原生 NOT-RUN（需独立复验，不借用 darwin 结论）。
