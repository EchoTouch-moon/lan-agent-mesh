# G-S3 Windows 私有目录与 DSH 自有子进程失败清理 — 受控合成回归审查（2026-10-26，rev1）

> Issue [#76](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/76) · taskId `G-S3` · 执行模型 GLM-5.3（操作者记录，GitHub 无法验证底层模型）。
> 首轮 **test-only / docs-only**：只新增 `packages/private-storage/test/glm53-private-storage.test.ts`、`packages/dsh-adapter/test/glm53-cleanup.test.ts` 与本报告；未修改任何生产文件或既有测试。发现真实问题需另开修复 Issue/PR，本报告不弱化任何生产断言。
> rev1（2026-10-26 晚）：按独立审查（PR #91 review [5654806323](https://github.com/EchoTouch-moon/lan-agent-mesh/pull/91#pullrequestreview-5654806323)、#76 评论）完成：A 分支合并最新 main `73a37ffc49f25e35523459f1006cdd2c3bc9606a`（原始 commit `e5c534c` 保留在历史中，未丢弃证据）；B 全部 Windows 负例改为断言**具体** `PrivateStorageError.reason`（实测值，见 §3）；C 本文档如实记录本机 `pnpm test` 非零与宿主残留状态；D bystander 收尾改为预注册、带上界（5s + SIGKILL 兜底）的退出等待。

## 1. 范围与方法

对主干 G2 private storage 与 DSH owned-process 清理建立**独立受控负例**，不替代 W-DSH-01/02/03 等既有实体通过证据：

- 所有目录 fixture 均为测试自建临时目录（含空格/Unicode 命名），随测试删除；**未触碰真实宿主 ACL、现存目录、防火墙或系统配置**。
- 子进程只用本测试自行 spawn 的 synthetic peer（既有 `agent-fixture.mjs` 只读复用）与 `node -e 'setInterval(...)'` 空转进程；**绝不按 PID 存活状态杀进程、绝不注入真实系统 PID**。
- 网络面：无监听、无外联（`permissions: no-network`）。无真实 Harness/模型/GUI 调用。

## 2. 环境

- 本机（Windows native-local）：zh-CN Windows 10.0.22621 x64，Node v24.12.0，pnpm 10.18.3。该宿主 `%TEMP%` 继承 `Everyone:(F)` 与外来用户 SID（issue #41 已记录的环境阻塞），因此本机运行时将 `TMP`/`TEMP` 指向已通过原生门禁的私有父目录 `C:\lam-private-parent` 下的子目录；**这不改变断言，只改变 fixture 根位置**。CI（macos/windows × node 22/24）使用 runner 自身 TEMP，不依赖该私有目录。
- 证据等级：本机 Windows 为 synthetic（真实 PowerShell/C# helper 与真实 taskkill，但被测对象仍是受控 fixture）；CI 提供矩阵复现。**POSIX 上的运行明确跳过 Windows 专项，不构成 Windows native verified。**
- 合并候选：分支合并 main@`73a37ff`（PR #90 已含）后的提交为合并候选 SHA，四组 CI 在 PR #91 上重跑；被测源为该提交（clean worktree）。

## 3. 覆盖矩阵（用例 → 期望 → 观测；Windows 负例均断言具体 reason）

`PrivateStorageError.reason` 为实测观测值（本机 Win10 PS5.1 与 GitHub windows runner 同栈），非"任何拒绝都算 PASS"：

### packages/private-storage/test/glm53-private-storage.test.ts（Windows 专项）

| 用例 | 期望（含具体 reason 断言） | 结果 |
|---|---|---|
| 安全临时目录正控（空格/Unicode）+ lease 生命周期 | 创建成功、`assertActive` 生效、close 后失效 | PASS（本机 + windows CI） |
| 不安全祖先 DACL（隔层 Everyone FullControl）+ 叶子目录 Everyone Read | fail-closed 且 reason=`unsafe_allow_ace`、无部分创建、失败后无残留句柄（可改名） | PASS（本机；实测 reason `unsafe_allow_ace`） |
| junction 作为路径中间组件 | reason=`unsafe_object` 拒绝；真实目标下未创建子目录 | PASS（本机，实测 `unsafe_object`） |
| 文件符号链接（指向私有文件）、悬空文件符号链接、硬链接 | reason=`unsafe_object`；悬空链接不视为"不存在" | PASS（本机，三者均实测 `unsafe_object`；符号链接若 `EPERM` 则显式 SKIP） |
| 冒号命名空间目录 `a:b` | 实测 `verification_failed`（.NET GetFullPath 先抛异常、被 helper 兜底包装）；若走 helper 自身组件检查则为 `unsupported_path`——断言允许二者 | PASS（本机，实测 `verification_failed`） |
| 超长路径（>240）、ADS 文件名 `name:stream`、带分隔符文件名 `sub/name.json`、>64 文件列表 | 依次断言 `unsupported_path` / `invalid_file_name` / `invalid_file_name` / `verification_failed`（客户端侧上限默认值）；无文件系统副作用 | PASS（本机） |
| SystemRoot 缺失/非盘符 | reason=`helper_unavailable` fail-closed；环境恢复后可再次通过 | PASS（本机） |
| 杀死本测试唯一持有的 ACL helper（意外退出） | 恰好一次 loss 回调、`assertActive` 失效、close 可完成、目录可重新验证 | PASS（本机） |
| POSIX 分支对照（uid/mode/符号链接/硬链接负例） | POSIX 分支抛同固定消息的普通 Error（无 reason 码），仅断言消息；仅在该平台运行 | PASS（macOS CI）；Windows 上 SKIP |

说明：不安全 DACL 场景的实测 reason 为 `unsafe_allow_ace`（widen fixture 追加的是 Everyone **allow ACE**，不改动 owner/DACL 保护标志）；`unsafe_owner_or_dacl` 对应 owner 为空/不受信或 DACL 缺失的情形，本组负例不构造该状态，故不作此断言。

### packages/dsh-adapter/test/glm53-cleanup.test.ts（跨平台 + Windows 专项）

| 用例 | 期望 | 结果 |
|---|---|---|
| cancel→cancelled、close→taskkill 树杀（两轮），fixture 后代进程实亡；旁观长驻进程不受影响（收尾为预注册 + 5s 上界 + SIGKILL 兜底） | 后代 PID `ESRCH`；旁观者存活；`session/prompt` 恰 1 次 | PASS（本机；macOS CI 以进程组 kill 覆盖） |
| 自退出的自有子进程：版本探测豁免 vs 意外退出 | `allowVersionExit=true` 可过；否则报 `Owned process cleanup uncertain` | PASS（本机，Windows 专项） |
| taskkill 无法启动（SystemRoot 指向不存在目录） | 报 uncertain 而非假定成功；子进程实际存活、由测试自行收尾 | PASS（本机，Windows 专项） |
| 意外原生死亡：UNKNOWN 事件 + close 拒绝 + 锁逐字节保留；重开拒绝；仅显式"运维移除锁"后可恢复并干净关闭 | 全部成立；`session/prompt` 不重放 | PASS（本机 + macOS CI） |
| 健康生命周期正控 | close 释放锁、probe 不可用、单次 prompt | PASS（本机 + macOS CI） |

## 4. 发现与观察（不构成生产缺陷确认）

1. **[hypothesis · 已观测，非漏洞]** 尾点/尾空格路径组件（如 `end.`）在 Windows PowerShell 5.1 / .NET Framework 栈上于 `Path.GetFullPath` 阶段即被规范化剥离，`LamPrivateLease` 的 `unsupported_path` 检查永远看不到该组件，最终创建的是规范化名称下的普通私有目录。验证、加锁与命名一致，无别名/绕过面；按 fail-closed 口径不构成违反。已在测试注释与本报告记录，未对 `end.` 断言拒绝。
2. **[环境观察 · 非产品缺陷]** 本机（zh-CN Win10，带文件系统过滤驱动/杀软）对新建小文件的 `unlink` 可进入 delete-pending：`rmSync` 成功返回但目录项残留约 1 秒，期间以 `wx` 重建同名文件会失败。这正是"锁名被占用即拒绝"的诚实 fail-closed 行为；测试侧用「先 rename 出宿主目录再删除」模拟运维移除锁，规避时序瞬态，未改生产语义。既有 `powershell.test.ts` 的 rm→mkdir 用例在本机的同类失败同源于此。
3. **[确认 · 符合设计]** 不安全祖先（含隔层）、reparse 中间组件、悬空/文件符号链接、硬链接、ADS、超长路径、helper 不可用、helper 意外退出全部 fail-closed 且 reason 与 C# helper 语义一一对应（§3 实测），错误消息为固定常量，不泄漏路径/UUID/ACE 细节。
4. **[确认 · 符合设计]** 意外原生死亡时 `adapter.lock` 逐字节保留、UNKNOWN 不重放、恢复只能由运维显式移除锁；taskkill 不可用时清理如实报 uncertain 且不误杀/不谎报。未发现按 PID 存活状态自动删除锁的路径。
5. **false-positive 澄清**：调研中一度怀疑 vitest 下恢复 open 失败为产品缺陷，定位后确认是上述第 2 条宿主 delete-pending 瞬态 + 测试时序问题，已按测试侧修复，不属于 LAM 代码问题。

## 5. 本机真实测试状态、清理与未验证项

**本机命令与退出码（操作者报告，宿主侧原始日志未独立交叉验证；CI 结果见 PR #91 checks）**：
`pnpm build`=0、`pnpm typecheck`=0、`pnpm lint`=0；全量 `pnpm test`=**1**（150 passed / 5 skipped / **2 failed，均为既有测试的宿主环境失败，非本 PR 引入**：① `adapter.test.ts` Windows facade 用例需要 `C:\Program Files\PowerShell\7`，本机 pwsh 仅 Store 安装（W-DSH-01 已知约束）；② `powershell.test.ts` rm→mkdir 撞名 EEXIST，源于第 2 条 delete-pending 瞬态。两者已在干净 main@`084dfe1` 复现同样失败，GitHub runner（含 PS7、无该过滤驱动行为）通过）。新增两份 glm53 测试文件在本机与 CI 全部通过。首轮 RESULT 中"既有套件不受影响"的表述以此处为准予以修正：既有套件在本机存在与本次改动无关的 2 例环境失败。

**清理与宿主残留**：测试 fixture 目录与自有子进程（fixture、后代、旁观者、sleeper）在测试内/afterEach 清理并实测退出；无端口占用。`dbg-cwd`、`debug-fixture.mjs`、`debug-runner.mjs` 等调试文件已删除；**仍保留在本机私有父目录 `C:\lam-private-parent\tmp` 的运行工件**：全量 check 日志两份、PR checks 日志一份、reason 探针脚本一份（均不进仓库，供审核者按需取阅，审核后可删）——故不宣称"宿主残留已全部清空"。

**未验证 / NOT-RUN**：真实 DSH desktop（0.2.1-rc.2 安装体）未接入（本轮 synthetic-only，按 Issue 前置约定）；跨用户/低权宿主 ACL 场景（需真实第二用户，未授权不执行）；POSIX 上不运行 Windows 专项，故 Windows native 结论仅由本机 + windows-latest CI 构成；`agent-fixture.mjs` 复用为只读引用，其行为正确性由既有测试负责。本 PR 不证明 #18/#19 W1/W2/W3 任何新的跨实体任务；W-DSH-03 的 native-local 六阶段证据由 #63/#64 历史独立支持，验证等级不同，不因本 PR 变化。

## 6. 结论

G-S3 验收场景（不安全祖先/owner/DACL、link/reparse、helper 不可用/意外退出 fail-closed；自有 synthetic 子进程树退出/取消/清理；不确定清理保留 lock/UNKNOWN、平台未执行显式 skip）在本机 Windows 与 CI 矩阵上全部有受控负例覆盖且断言到具体 reason，未发现需立即修复的生产缺陷。rev1 已按独立审查完成 A–D 四项修订。mergeRecommendation：test-only/docs-only，ready-for-review（是否构成 merge 候选以合并后 CI 复跑结果为准）。
