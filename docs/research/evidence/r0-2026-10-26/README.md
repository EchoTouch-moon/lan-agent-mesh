# R0-A 证据索引

任务 #66，基线 main `1c5697219a7d3281f37d57981b5b548d7c1c9d5b`，证据等级 docs / documented。此目录不含真实模型、Harness、凭据、native ID、私网地址或跨机证据。

- `preflight-failures.json`：先前插件 tags 查询拒绝及探索中发现的缺失项，不改写为成功。
- `source-01/sources.json`：固定来源响应状态/时间、tag/commit 解析、源文件全量 SHA256/git blob SHA、导航摘录、npm 元数据与发行物 integrity。摘录不等于完整文件；未下载 tarball、未核验发行签名、未运行上游。采集器依赖 Python 标准库。
- `validation-01.json`、`validation-01-*.log`：干净预提交源、工具版本、脚本/关键 lock 哈希、逐命令起止时间/退出码与 stdout/stderr 原件。metadata 中的 testedSourceSha 是执行前提交，不使用事后证据提交冒充被测源码。
- `SHA256SUMS`：证据原件校验表（不包含自身及此索引，避免自引用）。

`check.mjs` 复用本仓库 ESLint 已锁定的 Ajv 6.15.0，没有新装工具依赖；仅验证研究数据与静态安全约束，不声称运行时拒绝/撤销测试通过。

本仓库现有 CI 范围：macOS/Windows × Node22/24，包含 build/typecheck/lint/test 与既有 synthetic smoke。PR CI 实际结果在 Issue RESULT/PR 中记录，不因本索引描述了矩阵就标通过。

源码下载缓存仅含公开文本，保留在系统临时目录供本轮检查；可移除且可从固定 URL 重建。没有启动新的上游服务/端口/沙箱；不存在本轮待撤销的运行授权或凭据。回退研究 PR 不影响运行代码。

## 增量与原件解释

`source-02/sources.json` 与 `validation-02*` 补录实际 API 定义，并将最终 lock 与两份来源快照离线交叉核验；source-01 和 validation-01 保持原样。validation-01 的 `cleanup.newServiceListeners=0` 仅指本轮上游研究未启动 listener，不能解释为 pnpm check 没有启动既有 loopback Mock。既有测试确实启动 synthetic Gateway/MCP，107 通过、4 跳过；未另做端口/进程残留审计，独立清理证据为 unknown。后续报告使用更明确字段，不改原件。

MCP registry 元数据没有 gitHead，发行物与所选 source tag 的字节对应仍 unknown；A2A SDK registry gitHead 与选定 commit 一致。所有 integrity 是 registry 声明值，本轮未下载 tarball 比对或核验签名。
