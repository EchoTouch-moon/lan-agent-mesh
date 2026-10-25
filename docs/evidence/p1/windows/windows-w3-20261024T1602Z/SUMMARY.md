# W3 实体 Mac↔Windows 硬件门槛 — Windows 侧证据（run windows-w3-20261024T1602Z）

> **Mac 端复核：partial，不是 #15 全部验收通过。** 双方证据支持下列实际观察；实体 ACK 丢弃注入和在途 CANCELLED 仍缺失，Windows 接收方任务计数和完整原始日志也未附。两个原 JSON 保留原字节，其解释范围以 [REVIEW.md](REVIEW.md) 为准。

执行源：main `d226c2cc4bdea624e3807078a5b17f29aa380fa9`（协调方指定 SHA，独立干净 checkout，含空格路径；Windows 10.0.22621 x64 / Node v24.12.0 / pnpm 10.18.3；install + build（含原生 DLL）exit 0）。Windows peer ID `12D3KooWQLnQfNd2ENTtLgYGXjUrNzdsX9Xjn3rhAS9jEGBZgPtN`，Mac peer ID 与协调方公布一致（`12D3KooWDybXuF...T2n25qh`）。Mac 侧另一半记录由 Mac 执行者在 #15 独立回传。

逐项结果见 [w3-transcript.json](w3-transcript.json)，哈希与环境见 [run-metadata.json](run-metadata.json)。摘要：

## 通过项
- **配对（人工比对）**：Mac 主动发起；完整配对码仅现场展示给用户，两侧独立人工比对一致后 confirm（16:02:41Z `trusted:true`）。第一个码在人工核对期间过期被拒绝（permission_denied，如实记录的负例），Mac 自动重发后成功。
- **Win→Mac 任务链路**：registry（darwin 节点跨 LAN 获取）→ spawn（跨机会话）→ send → events 流式读取 → **COMPLETED，精确 `mock:cross-host fixture`**（1s 与 10s 延迟两个接收方实例各验证一次）。
- **exact retry**：完整保存 key/taskId/deadline 后原样重发被接受返回同 taskId，事件游标不动——**不重新执行**；接收方独立确认同一逻辑任务仅两条 accepted receipt、四条事件。（附带一次过期 deadline 被拒的操作失误记录。）
- **resume**：运行中接收方 resume 同会话返回**一致 nativeSessionId**；接收方重启后旧会话 resume **not_found 拒绝**（不静默新开上下文）。
- **受控崩溃 UNKNOWN/no replay**：精确文本 `w3 controlled crash fixture` 发出并观察到 RUNNING；Mac 硬杀接收方并同目录同身份重启；原参数 retry 被接受，事件流 `started → unknown`（"Gateway restarted; execution outcome uncertain, never auto-replay"），状态 **UNKNOWN**，无第二个 started、无新 completed——**不重放副作用**。
- **未配对负例**：假 peer 的 registry/spawn 均 `permission_denied`。
- **撤销**：revoke 后 registry/spawn 均 `permission_denied`，缓存卡片不可用。
- **停机清理**：shutdown ack、node 进程退出、48731 端口释放（无 LISTEN）、gateway.lock 与 control.json 移除，私有 data 目录仅剩 identity.key 与 mesh.sqlite。

## 如实记录的限制
- **mDNS 发现失败**：Gateway 自动发现 30 秒无结果；物理网卡直接 `_lam._udp.local` 多播查询亦无应答；本机 TUN 代理造成全网段 TCP 假接受，扫描不可用。走**手动地址回退**（Mac 直接向 Windows 48731 发起）。未改防火墙/ACL、未提权。
- **cancel 时序**：task.cancel 被接受并 ack，但 1000ms mock 任务已完成（COMPLETED）——竞态如实记录。
- **Gateway 退出码未捕获**：长驻实例的输出重定向错接到了先前一次失败启动（EADDRINUSE）的文件；优雅停机由 shutdown ack + 进程消失 + 端口释放 + lock/control 清理四项证据支撑。
- **Mac→Win 方向**：Mac 侧 caller 的记录见 [PR #49](https://github.com/EchoTouch-moon/lan-agent-mesh/pull/49)，包含真实 Windows peer 的精确响应；Windows 本目录未采集接收方任务日志/计数，不能推断不存在入站任务，也不能据此确认接收方去重计数。

## 边界
本目录为 Windows 一半证据；实体双向完整结论以两侧记录合并为准（#15 保持 OPEN 至协调方审阅）。Mock-only：无真实 Harness/模型/GUI/安装器/服务，未改防火墙与既有 ACL，无提权，外部模型调用 0。
