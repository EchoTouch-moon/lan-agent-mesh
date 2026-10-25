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

角色默认最多等待20分钟；`--wait-ms` 仅用于 prepare/receiver，最大仍20分钟。到时或信号会停止自有服务；正常 prepare 的认证 shutdown 是唯一保留测试身份供 runner 接管的路径。所有新目录先经过私有目录检查，标记含本轮随机 nonce；清理前再次检查，不删除其他目录、不杀进程名、不修改已有 ACL。报告新建为私有文件，拒绝覆盖已有文件。
