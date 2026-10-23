# Mac 端第三轮复核

复核日期：2026-10-24（Asia/Shanghai）。原始交付 `d0b795a7c7f2d67c9cee625d25e1593d9d492405`；执行版本 `a0818d847483871ba3a18cf33607a4753fa4c2da`。

## 溯源与已支持结论

两份脚本确实存在于执行版本，按 git 中的原始字节重新计算 SHA-256，均与 run-metadata.json 及各报告一致。执行版本包含首次提交 a90f969；源码先提交后运行的流程已落实。原始未脱敏文件仍在 Windows 机器，本端不能重新计算这些原始文件哈希，只能核对报告之间的溯源一致性。

DSH 报告支持新建、发送 end_turn、fixture 文本流匹配、进程重启后接受原 session ID、在途取消及原生 session/request_permission / reject_once。接口请求日志明确为 /v1/messages，提供了 Messages SSE 固定响应的实测依据。GUI 接入未测试，恢复接受 ID 不扩展为额外的上下文质量保证。

MSIX 静态文件名列表支持 app/Codex.exe 存在，不能单凭文件名确认它是 CLI、GUI 或 app-server。没有执行该文件。

## 发现与修正

1. **写入拒绝效果的判定存在假阳性。** 原 probe 在 marker 不存在时无条件记 verified，即使没有原生拒绝也可能通过；同时向 pwsh 发送 printf，未证明它在该环境可实际写入。原运行的 native reject_once 事件仍成立，marker 缺失仍是观察事实，但该组合不足以作为有正向对照的写入阻止验证。原始字段保留，新增 reviewAssessment 将这一效果限定为 unknown。
2. 修正版改用 PowerShell 内置 Set-Content，先由探针自身在专属临时目录写入/删除另一个 control marker，证明命令有效；这不是授予 Harness 权限。只有命令正向对照、原生拒绝、原生只读 sandbox 拒绝和 marker 缺失同时成立，才将 deniedOperation 标为 verified。未知和权限错误不再当作文件不存在。可使用 permissions 范围单独补测，不重复发送/恢复/取消。
3. **MSIX 清单投影不完整。** 原报告的两个 application 条目缺少 Id/Executable，aliases=[] 不能证明没有执行别名。已改为显式读取 XML 属性，并按 local-name() 遍历带命名空间的 Extensions/ExecutionAlias，区分空清单与丢失字段。新增静态候选文件大小/哈希采集，仍不执行任何应用。
4. initialize 失败时连接尚未赋给外层 rpc，原 finally 无法清理它；connect 现在在抛错前关闭自己的连接。报告保留原始执行事实，后续修正版尚待 Windows 定点执行。

针对性检查覆盖“仅 marker 缺失不得通过”、其他必要证据缺失、有效写入却创建 marker 的失败判定，以及 Windows 上含引号/空格/& 的真实 PowerShell 写入。XML fixture 检查多应用、单应用、空应用集合和带命名空间的执行别名。fake fixture 只验证探针自身，不能冒充真实产品的新实测。

## 剩余任务

仅重验修正后的 permissions 路径及 MSIX 静态清单；已经通过且未变的 DSH send/stream/resume/cancel、工程和 ZCode 不例行重复。保留原始报告和源版本哈希，源码先提交再执行，并通过 GitHub 回传。未确定 Codex.exe 是独立 CLI 前不启动它，包的 GUI、用户配置、凭据和真实聊天仍不访问。没有执行合并或关闭父任务。
