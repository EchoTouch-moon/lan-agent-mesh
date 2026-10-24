# #41 实体 Windows 宿主复验：main 私有存储门槛（win-priv-20261024T145925Z）

执行源：main `8f549f2c3b12df99b0a35a790aa09aab1bcf8259`（独立克隆于含空格路径，每次脚本运行前 `git status` 干净）。本机即 #39 W2 观察到的宽松 ACL 宿主（默认 TEMP/profile 继承 Everyone:Full 与外来用户 ACE）。本目录补齐 [private-storage-20261024T104801Z](../private-storage-20261024T104801Z/SUMMARY.md) 留下的"用户实体宿主未运行允许/拒绝案例"缺口；实现与脚本全部为 main 已提交版本，未做任何新开发。

## 结果（[windows-private-smoke.json](windows-private-smoke.json)，exit 0，五项全 verified）

- **负例（默认宽松 TEMP 血统）**：Gateway 在任何秘密文件生成前拒绝（`unsafe_*`），目录保持为空——检查在本机真实宽松环境下正确 fail-closed。
- **正例（操作者显式准备的独占血统）**：按 [WINDOWS_PRIVATE_STORAGE.md](../../../WINDOWS_PRIVATE_STORAGE.md) 由操作者新建 `C:\lam-private-parent` 并自行收紧 DACL（当前用户/SYSTEM/Administrators 可继承 full control；未修改任何既有宿主目录、未提权）。原生检查器接受 C:\ 根至目标的完整祖先链，原子创建受保护随机测试目录。
- **真实 MCP stdio**：双 Gateway 配对、`mcp-grant` 签发 scoped credential（token 不进 stdout/stderr）、实际 MCP SDK stdio 连接 7 工具；不安全输出目录被拒绝且 grant 被撤销；不安全目录读取在解析前拒绝且 sentinel/bearer 不泄漏。

## `pnpm check` 环境对照（如实记录，未弱化）

- 默认 TEMP/TMP（宽松继承）：exit 1，18 项测试因临时 Gateway 拒绝不安全临时血统而失败——这是文档预期的环境门槛，不是代码缺陷，未关闭检查强行通过。
- 仅测试进程内将 TEMP/TMP 指向检查器验证过的私有目录（不改任何永久环境变量）：exit 0，**48 项测试通过**（1 项 POSIX-only 跳过），含私有存储全部用例。

## 哈希与限制

[run-metadata.json](run-metadata.json) 记录源 SHA、脚本源/产物 SHA-256、本次编译的原生 DLL SHA-256（报告内嵌执行时哈希）、各命令退出码与本地原始报告/日志哈希。清理：smoke 自证（自有 Gateway/句柄/临时夹具全部清理）；操作者 parent 目录保留（不含任何秘密）供后续 G2 使用。

**未完成门槛**：W3 实体 Mac↔Windows（#15）仍 pending，本运行不替代；真实 Harness 与长期真实凭据未因此放行（G2 审查决定）；PR #45（旧 P1 上的另一套 gate）按维护者复核保持 open 不合入。全程无真实模型/GUI/安装器/系统服务/既有配置/ACL/防火墙改动，无提权，外部模型调用为 0。
