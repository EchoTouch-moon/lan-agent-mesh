# G-S3 Windows 私有目录与 DSH 自有子进程失败清理 — 受控合成回归审查（2026-10-26）

> Issue [#76](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/76) · taskId `G-S3` · 执行模型 GLM-5.3（操作者记录，GitHub 无法验证底层模型）。
> 首轮 **test-only / docs-only**：只新增 `packages/private-storage/test/glm53-private-storage.test.ts`、`packages/dsh-adapter/test/glm53-cleanup.test.ts` 与本报告；未修改任何生产文件或既有测试。发现真实问题需另开修复 Issue/PR，本报告不弱化任何生产断言。

## 1. 范围与方法

对主干 G2 private storage 与 DSH owned-process 清理建立**独立受控负例**，不替代 W-DSH-01/02/03 等既有实体通过证据：

- 所有目录 fixture 均为测试自建临时目录（含空格/Unicode 命名），随测试删除；**未触碰真实宿主 ACL、现存目录、防火墙或系统配置**。
- 子进程只用本测试自行 spawn 的 synthetic peer（既有 `agent-fixture.mjs` 只读复用）与 `node -e 'setInterval(...)'` 空转进程；**绝不按 PID 存活状态杀进程、绝不注入真实系统 PID**。
- 网络面：无监听、无外联（`permissions: no-network`）。无真实 Harness/模型/GUI 调用。

## 2. 环境

- 本机（Windows native-local）：zh-CN Windows 10.0.22621 x64，Node v24.12.0，pnpm 10.18.3。该宿主 `%TEMP%` 继承 `Everyone:(F)` 与外来用户 SID（issue #41 已记录的环境阻塞），因此本机运行时将 `TMP`/`TEMP` 指向已通过原生门禁的私有父目录 `C:\lam-private-parent` 下的子目录；**这不改变断言，只改变 fixture 根位置**。默认 GitHub CI（macos/windows × node 22/24）使用 runner 自身 TEMP，不依赖该私有目录。
- 证据等级：本机 Windows 为 synthetic（真实 PowerShell/C# helper 与真实 taskkill，但被测对象仍是受控 fixture）；CI 提供矩阵复现。**POSIX 上的运行明确跳过 Windows 专项，不构成 Windows native verified。**

## 3. 覆盖矩阵（用例 → 期望 → 观测）

### packages/private-storage/test/glm53-private-storage.test.ts（Windows 专项）

| 用例 | 期望 | 结果 |
|---|---|---|
| 安全临时目录正控（空格/Unicode）+ lease 生命周期 | 创建成功、`assertActive` 生效、close 后失效 | PASS（本机） |
| 不安全祖先 DACL（隔层 Everyone FullControl）+ 叶子目录 Everyone Read | fail-closed、无部分创建、失败后无残留句柄（可改名） | PASS（本机） |
| junction 作为路径中间组件 | 以 reparse 属性 `unsafe_object` 拒绝；真实目标下未创建子目录 | PASS（本机） |
| 文件符号链接（指向私有文件）、悬空文件符号链接、硬链接 | 全部按 `unsafe_object` 拒绝；悬空链接不视为"不存在" | PASS（本机；符号链接若 `EPERM` 则显式 SKIP） |
| ADS 冒号名（`a:b` 目录 / `name:stream` 文件名）、超长路径（>240）、带分隔符文件名、>64 文件列表 | 拒绝且无文件系统副作用 | PASS（本机） |
| SystemRoot 缺失/非盘符 → helper 不可用 | `helper_unavailable` fail-closed；环境恢复后可再次通过 | PASS（本机） |
| 杀死本测试唯一持有的 ACL helper（意外退出） | 恰好一次 loss 回调、`assertActive` 失效、close 可完成、目录可重新验证 | PASS（本机） |
| POSIX 分支对照（uid/mode/符号链接/硬链接负例） | POSIX 语义拒绝；仅在该平台运行 | PASS（macOS CI）；Windows 上 SKIP |

### packages/dsh-adapter/test/glm53-cleanup.test.ts（跨平台 + Windows 专项）

| 用例 | 期望 | 结果 |
|---|---|---|
| cancel→cancelled、close→taskkill 树杀（两轮），fixture 后代进程实亡；旁观长驻进程不受影响 | 后代 PID `ESRCH`；旁观者存活；`session/prompt` 恰 1 次 | PASS（本机；macOS CI 以进程组 kill 覆盖） |
| 自退出的自有子进程：版本探测豁免 vs 意外退出 | `allowVersionExit=true` 可过；否则报 `Owned process cleanup uncertain` | PASS（本机，Windows 专项） |
| taskkill 无法启动（SystemRoot 指向不存在目录） | 报 uncertain 而非假定成功；子进程实际存活、由测试自行收尾 | PASS（本机，Windows 专项） |
| 意外原生死亡：UNKNOWN 事件 + close 拒绝 + 锁逐字节保留；重开拒绝；仅显式"运维移除锁"后可恢复并干净关闭 | 全部成立；`session/prompt` 不重放 | PASS（本机 + macOS CI） |
| 健康生命周期正控 | close 释放锁、probe 不可用、单次 prompt | PASS（本机 + macOS CI） |

## 4. 发现与观察（不构成生产缺陷确认）

1. **[hypothesis · 已观测，非漏洞]** 尾点/尾空格路径组件（如 `end.`）在 Windows PowerShell 5.1 / .NET Framework 栈上于 `Path.GetFullPath` 阶段即被规范化剥离，`LamPrivateLease` 的 `unsupported_path` 检查永远看不到该组件，最终创建的是规范化名称下的普通私有目录。验证、加锁与命名一致，无别名/绕过面；按 fail-closed 口径不构成违反。已在测试注释与本报告记录，未对 `end.` 断言拒绝。
2. **[环境观察 · 非产品缺陷]** 本机（zh-CN Win10，带文件系统过滤驱动/杀软）对新建小文件的 `unlink` 可进入 delete-pending：`rmSync` 成功返回但目录项残留约 1 秒，期间以 `wx` 重建同名文件会失败。这正是"锁名被占用即拒绝"的诚实 fail-closed 行为；测试侧用「先 rename 出宿主目录再删除」模拟运维移除锁，规避时序瞬态，未改生产语义。
3. **[确认 · 符合设计]** 不安全祖先（含隔层）、reparse 中间组件、悬空/文件符号链接、硬链接、ADS、超长路径、helper 不可用、helper 意外退出全部 fail-closed，且错误消息为固定常量，不泄漏路径/UUID/ACE 细节。
4. **[确认 · 符合设计]** 意外原生死亡时 `adapter.lock` 逐字节保留、UNKNOWN 不重放、恢复只能由运维显式移除锁；taskkill 不可用时清理如实报 uncertain 且不误杀/不谎报。未发现按 PID 存活状态自动删除锁的路径。
5. **false-positive 澄清**：调研中一度怀疑 vitest 下恢复 open 失败为产品缺陷，定位后确认是上述第 2 条宿主 delete-pending 瞬态 + 测试时序问题，已按测试侧修复，不属于 LAM 代码问题。

## 5. 清理与未验证项

- 清理：全部 fixture 临时目录随测试删除；所有自有子进程（fixture、后代、旁观者、被测 sleeper）在断言后终止；无端口占用（未使用网络）；私有父目录 `C:\lam-private-parent\tmp` 中仅剩本轮残留的 `dbg-cwd`、`debug-fixture.mjs`、`debug-runner.mjs` 调试文件（可在审核后删除，不影响仓库）。
- 未验证 / NOT-RUN：真实 DSH desktop（0.2.1-rc.2 安装体）未接入（本轮 synthetic-only，按 Issue 前置约定）；跨用户/低权宿主 ACL 场景（需真实第二用户，未授权不执行）；POSIX 上不运行 Windows 专项，故 Windows native 结论仅由本机 + windows-latest CI 构成；`agent-fixture.mjs` 复用为只读引用，其行为正确性由既有测试负责。
- 回归：未修改任何既有测试；本机全量 `pnpm check` 在私有 TMP 下执行，既有套件不受影响。

## 6. 结论

G-S3 验收场景（不安全祖先/owner/DACL、link/reparse、helper 不可用/意外退出 fail-closed；自有 synthetic 子进程树退出/取消/清理；不确定清理保留 lock/UNKNOWN、平台未执行显式 skip）在本机 Windows 与 CI 矩阵上全部有受控负例覆盖，未发现需立即修复的生产缺陷。mergeRecommendation：test-only/docs-only，ready-for-review。
