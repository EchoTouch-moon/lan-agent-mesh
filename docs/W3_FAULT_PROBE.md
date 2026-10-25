# W3 定点 ACK／在途取消探针

第一轮实体证据 #48/#49 已验证双向精确 Mock、完整参数重试、恢复和 RUNNING 硬杀→UNKNOWN 不重放。本探针只补 delivery ACK 丢弃、真实在途取消、接收方计数、缓存失效及可审查的清理记录；不修改 Gateway 的协议、权限、重试或私有目录实现。

## 语义和判定

- **ACK 故障点**：调用方已通过真实 Mesh 收到与原 request/task/双方身份对应的 `task.accepted`，在 `sendEnvelope` 将 outbox 标记 ACK 之前受控丢弃回执。它是调用方 API 边界的故障注入，**不声称抓包证实网络丢包**。原始完整 envelope 必须仍在 durable outbox，`retry` 必须复用它，完成后 outbox 清除、原 task 的完整事件不增加。
- **接收方交叉记录**：观察钩子位于原生配对认证之后，完整调用原始业务处理器，不跳过认证/去重。重复 envelope 必须有相同请求摘要、同一缓存业务结果（含双方身份、关联、task、type、payload），只有一个逻辑 COMPLETED task。过期的传输回执可以更新 messageId/deadline，完整字节摘要也保留，但不要求旧传输时效继续有效。仅复制摘要、固定测试文本、task ID 哈希和事件，不输出密钥、Token 或配对码。
- **在途取消**：独立 session/task，首先观察真实 RUNNING/started，才发 `task.cancel`；必须收到 CANCELLED/cancelled 且没有 completed。晚到的 COMPLETED 是失败，不能改标 cancelled。实体接收方每块延迟10000ms，本机自测1000ms。
- **撤销/缓存**：调用方在缓存仍有卡片时 revoke，之后 registry 必须 permission_denied、卡片不可用。接收方记录运行中曾填充卡片、操作者显式 revoke 时的前后计数及拒绝；若对端已先断连使卡片失效，`cachedBefore=0` 如实保留，不冒充自己 revoke 独立导致了这次变化。

## 先提交，再运行

两端都使用协调者发布的**同一完整 SHA**，干净工作树、安装锁定依赖、构建；探针记录 Git 原始源码哈希和实际 dist 哈希，分开对待 Windows CRLF/工作字节，不推断二者必然相同。不会自动 checkout、安装依赖、改 ACL/防火墙、提权或读取真实 Harness 配置。Windows 使用 #46 中操作者自管安全 parent 的全新子目录；检查拒绝就报错，不绕过。

先在本机验证探针自身：

```sh
pnpm build
node scripts/p1-w3-fault-probe.mjs --self-test
# 可选：按实体接收方的最大延迟验证轮询和限流余量
node scripts/p1-w3-fault-probe.mjs --self-test --self-test-delay-ms 10000
# 可选：真实等到旧 ACK 的30秒有效期结束，验证缓存结果重发、任务不重做
node scripts/p1-w3-fault-probe.mjs --self-test --self-test-ack-age-ms 31000
```

自测只创建两个临时 loopback Mock 节点，自动配对仅发生在这两个自己创建的节点之间；报告明确标为 same-host，CI 也不把它算成实体 W3。

## 下一轮实体操作

只有双方及现场用户重新明确就绪后才启动。原测试窗口已经结束，不能因为本文件存在自动再开 LAN 监听。下面 `<SHA>` 是实际发布的探针提交，路径参数是各自本机选定的私有位置，均放在仓库之外；报告路径必须在 data 目录之外且不存在，防止覆盖和清理丢失。

1. Windows 接收方启动（全新不存在的 data）：

   ```text
   node scripts/p1-w3-fault-probe.mjs --role receiver --data <new-private-data> --output <private-reports>/receiver.json --expected-source <SHA>
   ```

2. Mac 先启动准备模式（同样全新 data）：

   ```text
   node scripts/p1-w3-fault-probe.mjs --role prepare --data <new-private-data> --output <private-reports>/prepare.json --expected-source <SHA>
   ```

3. 各自只操作本轮 data 的已提交 Gateway CLI `status/peers/pair/pairings/confirm`；自动发现失败可手动地址并固定 expectedPeer。**完整码仅在两台机器现场独立核对，分别明确批准，120秒内确认；不自动 confirm、不在 GitHub 上传 IP/配对码/控制文件。** 准备/接收模式 stdout 的地址仅供本地使用，不复制成公开报告。
4. 两侧信任建立后，只对 Mac prepare 执行认证 `control --command shutdown`。prepare 报告为 prepared 并保留专用标记/身份；Windows receiver 继续运行。不要 Ctrl-C 代替这一步：超时/信号按放弃窗口清理，不保留准备身份。
5. Mac 在同一源码运行 runner，复用刚才准备的自有 data：

   ```text
   node scripts/p1-w3-fault-probe.mjs --role runner --data <same-prepared-data> --output <private-reports>/runner.json --expected-source <SHA> --peer <Windows-public-peer-id> --address <private-host:port> --peer-platform win32
   ```

   runner 只接受该探针同 SHA 的 prepare 标记，拒绝任意旧 Gateway/用户数据目录；必须已有人工配对，绝不自动批准。只寻找明确的远端 `mock/default`、kind=mock/version=mock/1，不能交给真实 Harness。完成后自动撤销调用方信任并停止、检查端口、删除自己的测试 data。
6. Windows 用自己的认证 control 对 Mac peer 执行 `revoke`，再 `registry/spawn` 拒绝检查，最后 `shutdown`。receiver 会在关闭前捕获固定请求与任务计数，报告两次相同 ACK 请求对应一个 COMPLETED task、另一个 CANCELLED task、撤销记录和端口/数据清理。缺任何项就保持 partial；长驻实例自身进程结束的退出码应另行记录。
7. 两端都检查各自进程结束与报告，保存原始本地报告并记录原件 SHA-256；只上传报告 JSON/元数据的脱敏版本与哈希，不上传 ready stdout、密钥、Token、配对码、数据目录或数据库。双方相同 task/peer 哈希、原 envelope 摘要、执行 SHA/源码哈希与时序匹配后，才考虑 #15 剩余项。

prepare/receiver 默认最多等待2小时（`7200000` ms）；可用 `--wait-ms 14400000` 延长至最多4小时。ready 本地输出和报告记录本角色的实际预算和 UTC 到期时间，双方的时钟分别计算。runner 不接受此参数；它不延长任务、传输回执或配对码的有效期。到时或信号会停止自有服务；正常 prepare 的认证 shutdown 是唯一保留测试身份供 runner 接管的路径。所有新目录先经过私有目录检查，标记含本轮随机 nonce；清理前再次检查，不删除其他目录、不杀进程名、不修改已有 ACL。报告新建为私有文件，拒绝覆盖已有文件。

## 慢机器与异步协作（下一窗口）

用户已要求两端通过 GitHub 自行协调，并给 Windows 留出更长时间；**尚未宣布 Windows 已获授权或两端本轮在线**。以下流程只在 Windows 操作者授权其 LM、双方确认本轮就绪后启用；本文和自动 goal 继续均不代表开窗。协调入口为 #15，不另建重复任务。

1. **先构建，不开监听**：Windows LM 在 #15 领取，注明本轮使用的完整 SHA；Mac 核对双方源一致。双方先完成锁定依赖安装、构建与私有 parent 检查，分别回报 `BUILD_READY`。Windows 可以先完成 #18 的单机任务，但不能以该任务代替 #15。
2. **再约定长窗口**：双方在 #15 约定同一 run 标签、Mac/Windows 分工和北京时间/UTC 截止时间。Windows receiver、Mac prepare 使用同一完整 SHA，建议显式 `--wait-ms 14400000`，为慢机器最多留4小时。记录各自本地 ready 的实际到期时间，双方共同窗口取较早者。临近到期不继续提交新测试；不无限续期或在超时后盲目重启。
3. **只做一次必要的人工核对**：先自动发现，验证预期 peer ID；完整配对码由用户在两机独立核对并分别批准。不能让两个 Agent 互相抄码或代替用户确认。120秒内未完成就清掉过期请求、重新生成，并重新请用户核对；不得延长码有效期。自动发现失败时，只能使用已通过私密渠道提供的地址；没有地址则报 `NEEDS_OPERATOR`，不把地址贴到公开 GitHub。
4. **信任建立后双方推进**：Mac 按上文 prepare→runner 流程执行，Windows 保持 receiver 直到记录足够的任务/ACK/取消证据。双方在 #15 只发脱敏阶段状态（`BUILD_READY`、`WAITING_PAIR_CONFIRM`、`PAIRED`、`RUNNING`、`RUNNER_DONE`、`RECEIVER_DONE`、`BLOCKED`），附 SHA、run 标签和时间，不发本地 ready 原文。Mac 回报 `RUNNER_DONE` 后，Windows 执行本地 revoke/拒绝检查/认证 shutdown；不能仅因看到一个任务结束就提前停接收方。
5. **错误由双方定位，禁止自动换键重放**：保留原请求参数、任务 ID 和幂等键；部分步骤失败先回传原始脱敏报告和实际退出码，不能换新 ID 掩盖 UNKNOWN、弱化断言、绕过权限或自行改系统设置。双方失联或窗口过期则按既有清理逻辑退出，标记 partial/blocked；下一窗口需要重新确认，不自动拉起。
6. **自行收证和交叉复核**：双方各自保存报告、哈希、执行 SHA、版本、退出码和清理检查，提交结果 PR 并在 #15 回传；另一端交叉核对共同任务/请求摘要。缺少接收方记录或清理证据就保持 partial。用户只在配对核对、缺失私密地址或权限问题时介入。双方不会因此自动获得合并、关闭、真实模型或 GUI 接管授权。

GitHub 是异步交接，不保证 Agent 离线时被自动唤醒；每端必须保持自己的执行会话运行并检查约定入口。不要把公开评论、旧锁文件或“正在执行”的口头信息当作进程仍在线的证明。
