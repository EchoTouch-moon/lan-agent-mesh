# ZCode Adapter 契约（@lam/zcode-adapter，LHI-2，2026-10-26）

**taskId:** LHI-2 · **Issue:** [#81](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/81) · **实现:** `packages/zcode-adapter/**`
**证据:** [evidence/zcode-inbound/](evidence/zcode-inbound/README.md)（darwin native 10/10 PASS + synthetic 6/6 + 调试历史）
**合同基线:** 与已审查的 `@lam/codex-adapter` 同一套 SDK 语义（owned home / 锁 / durable map / UNKNOWN 不重放 / 幂等 / 容量预算 / 原生权限恒拒）。

## 1. 打开条件（`ZcodeAdapter.open(options)`）

| 项 | 约束 |
|---|---|
| 平台 | 仅 **darwin**（本切片的原生验证平台；其它平台 `unsupported`，Windows 原生待独立验证） |
| executable | 绝对路径的 bundled CLI 入口（`.cjs`，由当前 Node 执行）；构造时即计算 **sha256**（`executableSha256`） |
| expectedVersion | 精确 `'0.17.0'`（`--version` 逐字节比对；不放宽常量） |
| home | 专用适配器目录：签名 marker（nodeId+executable+sha256+workspaces+version）+ `wx` 锁（陈旧锁一律拒绝，绝不带不确定历史重启第二个 app-server）；`privateDirectory` 0700/0600 校验 |
| workspaces | 1–64 个别名→规范化绝对目录（realpath 一致） |
| fixtureBaseUrl | **仅** `http://127.0.0.1:<port>/v1`（loopback、无凭据、无查询串；否则 `permission_denied`） |
| builtinConfig | 可选绝对路径（原生必需、synthetic 省略）；复制入 home 后强制 chmod 0600（copyFile 保留源模式的坑已修） |
| expectedExecutableSha256 | 可选 64 位小写十六进制；提供时与实际入口哈希**强比对，不匹配即拒绝打开**（fail closed），负例进 synthetic 测试 |
| syntheticPeer | 仅测试：声明可执行文件是合成协议对端而非安装版 harness——跳过 darwin-only 原生入口门（该门只约束安装版入口），版本与其余校验全部照常 |
| mode | `'plan'`（默认）或 `'build'`；**仅 build 模式会为工具调用弹原生权限请求**（本 CLI 世代实测），需要行使 deny 链的调用方显式选择 |

## 2. 隔离与凭据边界

- 子进程 env 为**显式白名单**：`PATH/HOME/XDG_*/ZCODE_*(全部指向 home)/TMPDIR/LANG` + 两个 provider 配置文件指针；**绝不继承**操作者的 `ZCODE_*`、任何 provider 凭据、代理或用户配置根。
- 推理仅指向调用方提供的 loopback fixture；适配器自写 `personal.json`（0600，假 key + `lam-zcode-fixture` provider + `defaultModelSelection`）。
- stderr 丢弃（原生诊断可能含凭据/路径）；RPC 错误体不透传（统一 `Native request rejected`）；诊断开关 `LAM_ZCODE_ADAPTER_DEBUG=1` 仅输出事件**类型/键名**与 home 已脱敏的初始化错误，不含内容。

## 3. 会话与任务语义（与 Codex/DSH 合同对齐）

- **spawn**: `session/create`（plan/build、immediate 持久化、禁 title 生成）+ `session/subscribe`；LAM session id 与 native sessionId **分离持久**（SQLite durable map）。服务端回调 `session/requestRuntimePreferences` 以固定 headless 应答；`interaction/requestPermission` **恒 deny**（计数器 `deniedNativeRequests`）；其它 server request 一律 -32601。
- **resume**: `session/resume` 后**显式 `session/subscribe` 重订阅**（重启后的新 app-server 进程没有订阅，不重订阅则该会话后续 turn 的事件不会投递——r13 以"重启后新任务真实流式完成"验证）。幂等回放历史。**已知边界**：resume 应答只含 messages、不含会话身份，适配器无法像 Codex 那样核对 native id 一致性——身份信任限于 id 往返（如实记录，LHI-3 集成时如需强核对须升级协议）。
- **send**: 幂等（key+fingerprint 冲突拒绝）、taskId 复用拒绝、1000 任务保留上限、deadline 校验、**reserve-before-RPC**（ACK 丢失/超时/进程死亡 → 持久 UNKNOWN，永不重放）、会话级串行（active/ambiguous 拒绝）。
- **watch**: 缓冲事件重放 + 终态即止。事件归属：生命周期事件按 `payload.inputId` 命中后**必须再通过会话归属交叉校验**（事件 `params.sessionId` === 该 run 所属会话的 nativeSessionId，不匹配即丢弃——外会话终态绝不收口他方任务，负例进 synthetic 测试）；**`model.streaming` 增量不带 inputId（原生实测形状），按 `params.sessionId` → 会话 active run 归属**；无法归属的增量一律丢弃（fail-closed，绝不猜）。容量：≤4090 事件 / 32768 字符。
- **cancel**: `session/stop`；实测对真正 in-flight 的流产生 `turn.completed(resultType=cancelled)` → cancelled 终态。**调用方应等首个流事件后再取消**（turn 未启动时 stop 的行为不在本切片验证范围）。
- **重启**: 非终态 run 一律 UNKNOWN（durable）；UNKNOWN 保守持有其会话（resume/send 拒绝），永不自动重放；幂等重试跨重启返回原 taskId。
- **deadline 到期**: 本地定时器 → 连接 poison → 持久 UNKNOWN + 适配器离线（后续操作 `unsupported`）。

## 4. 原生实测结论（darwin，desktop 3.16.3 / CLI 0.17.0 / 入口 sha256 `97490d0f…`）

new/resume/send/stream/cancel/**deny**（build 模式：原生 `interaction/requestPermission` → 适配器 deny → 工具**零执行**（marker 未创建）→ turn 正常完成）/ deadline-UNKNOWN / 重启 resume 同一 native id / 幂等重试 / 锁释放与目录清理 —— **10/10 断言 PASS**（含清理证明）。

## 5. 观察与已知限制（如实记录）

1. **原生 turn 引擎无模型迭代上限**：模型反复请求同一工具时观测到 ~1400 次模型调用（120s deadline 内）。适配器侧由 deadline + 事件预算兜底；上游行为记录在案。
2. **plan 模式不弹权限请求**（工具静默拒绝，fail-closed 仍成立）；行使 deny 链需 `mode:'build'`。
3. 续接请求按**最后一条 user 消息**判定阶段——fixture 教训：按全历史判定会把 post-denial 续接误路由到早期标记。
4. Windows：synthetic 跳过（非 darwin `skipIf`）、原生 NOT-RUN；`unsupported` 平台 `open()` 即拒绝（fail-closed，不猜）。
5. 未覆盖：GUI attach（明确不支持，SDK 层 `attachExistingGui` unsupported）、`session/setMode` 运行时切换、http/sse MCP 传输、多会话并发 streaming 归属（单 active 会话已验证；多会话并发为 LHI-3 范围）。

## 6. 集成边界（未发生）

本包**未在任何 Gateway CLI / runtime / mcp-server 中注册**（Issue 要求：正式集成仅经显式可关闭的 adapterFactories，属后续独立 PR）。回滚 = 删除 `packages/zcode-adapter/**` 与两份文档。
