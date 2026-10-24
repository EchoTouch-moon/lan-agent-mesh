# Codex App Server Adapter — #17 本机切片

`@lam/codex-adapter` 实现 Adapter SDK 的 Gateway-owned thread/turn 生命周期。当前只启用 **macOS、明确指定的 `codex-cli 0.146.0` 和 `http://127.0.0.1:<port>/v1` 固定响应服务**。Windows 入口尚未验证；不执行 MSIX 中的候选文件、不导入用户登录、不开 GUI、不提供真实模型或生产凭据配置入口。此限制保留待验收的实际接口边界，不代表 #17 整体完成。

接口依据：[官方 App Server 文档](https://learn.chatgpt.com/docs/app-server)。接口文档不能替代本机实际运行证据。使用 newline-delimited stdio、initialize/initialized、thread/start、thread/resume、turn/start、item/agentMessage/delta、turn/completed 和 turn/interrupt；只把 completed 当作成功。

## 会话、失败和权限

- Adapter session ID、Gateway session ID 与 Codex native thread ID 独立；原生映射及任务记录写入 adapter 专用 SQLite，不接触 Codex 内部数据库。
- 正常关闭后可恢复自己的 home；若 Gateway 父进程崩溃留下 lock，即使该 PID 已不存在也拒绝自动清除。父 PID 消失不证明原生子进程或工具已退出；必须由操作者确认清理后再恢复。UNKNOWN 任务不会因此重放。
- `home` 必须是明确指定的独占目录。首次仅接受空目录，写入与 node/executable/workspace/version 绑定的所有权标记；拒绝非空未标记目录。使用私有目录检查和单进程锁；重启只恢复自己的目录。环境不继承 OPENAI/CODEX 凭据、代理或用户配置根，HOME/CODEX_HOME/XDG 根均为该专用目录。
- 工作区由本机操作者注册为规范绝对路径，远端只传 alias。每 session 只允许一个 turn；100 个 session、1000 个保留 task、4090 个 delta、32768 字符输出和 1 MiB stdio 缓冲有明确上限，达到上限拒绝继续。
- 发送前持久保留原始幂等键与输入。完全相同的重试返回原 task；不同输入不能复用键。丢连接、超时、未确认接收或进程停止均保留 UNKNOWN；含 UNKNOWN 的 session 不允许 resume 或新 turn，禁止猜测和自动重放。重启后的已完成 session 要显式 resume；不对任意外部 thread ID 提供恢复入口。
- 取消已有原生 turn ID 时调用 turn/interrupt，并等待原生 terminal 事件判定结果。若发送尚未返回身份，停止自己的原生进程并记录 UNKNOWN，不伪造“已取消”。
- command/file-change 审批一律 decline，permissions 审批返回空权限；其他服务器请求返回 unsupported。SDK `answerPermission` 与 GUI attach 标为 unsupported。不提供 allow 路径，不把 Agent 回复当作人工审批。read-only sandbox 仍不是独立的工作区读取隔离策略，不能据此启用生产 Agent。
- 不透出原生 stderr、RPC 错误正文、原生历史或路径。stdio 调用最多同时保留 64 项，默认 15 秒超时；连接被污染后不复用。进程退出/关闭清理本次创建的 macOS 进程组。

## Gateway 接入

Gateway 的本机 `adapterFactories` 在节点身份建立后构造 Adapter。显式注册和导出是两个步骤，默认不导出新 Adapter：

```ts
new Gateway({
  directory: gatewayDirectory,
  exportAgents: nodeId => [`${nodeId}/codex/default`],
  adapterFactories: [async ({ nodeId }) => CodexAdapter.open({
    nodeId,
    executable: verifiedAbsoluteCodexPath,
    expectedVersion: 'codex-cli 0.146.0',
    home: dedicatedEmptyAdapterDirectory,
    workspaces: { fixture: canonicalTemporaryWorkspace },
    fixtureBaseUrl: 'http://127.0.0.1:PORT/v1',
  })],
});
```

Gateway 注册 probe 的真实 kind/version，停止时关闭其已接管的 Adapter；某个 Adapter 关闭失败也继续清理其他 Adapter、Mesh、control 文件及私有目录 lease，最终向操作者报错。该包没有接入 Gateway CLI 的生产启动参数，避免未验收的真实 Harness 被误开启。

## 验证与后续

标准 `pnpm check` 包含协议合成进程测试：超时/诊断脱敏、拒绝用户配置目录/外部 provider/重复进程占用、持久映射、精确重试/冲突、原生 decline、互斥、取消、崩溃 UNKNOWN 和重启后拒绝重放。真实 Codex 不作为 CI 安装依赖，合成进程测试不宣称真实 Harness 已通过。

在脚本已提交、工作树干净、完成构建后，本机固定响应演练：

```sh
LAM_CODEX_BIN=/absolute/path/to/codex node scripts/codex-adapter-smoke.mjs
```

脚本只创建临时私有 home/workspace 和本机环回服务；审批测试先用相同写入命令模板写入/删除正向对照，再要求原生 decline 与目标 marker 的 ENOENT 同时成立。还验证同机两 Gateway 的加密传输→Adapter→真实 Codex→固定响应链路、注册元数据和停机清理。它不是 W3，也不代表真实 Harness 主动调用 MCP。

仍待完成：#15 实体 W3；Windows Codex 的已授权入口与版本实测；跨实体 MCP/Adapter 调用；真实模型与长期凭据另行放行；Policy 工作区隔离及人工审批桥接仍归 #20/#23。#17/#19 保持开放。

最终实现的真实本机证据：[mac-20261024T153146Z](evidence/codex-adapter/mac-20261024T153146Z/SUMMARY.md)；此前实现的原始记录保留，不覆盖历史执行 SHA。
