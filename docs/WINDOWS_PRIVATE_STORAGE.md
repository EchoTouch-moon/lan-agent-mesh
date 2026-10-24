# Windows 私有数据目录与凭据门槛（#41）

状态：实现与受控验证进行中。Windows 实体宿主复验独立记录，不能因 hosted CI 成功就关闭 #41；W3 实体跨机仍归 #15。代码基于 PR #40 → #38，不包含合并授权。

## 威胁与边界

保护对象是 identity.key、control.json、SQLite/辅助文件及 MCP scoped credential。其他普通本机账号可能通过继承 DACL 读取它们，或替换路径/文件。允许当前登录 SID、SYSTEM、Administrators；当前账号下的任意恶意进程、已提权管理员/SYSTEM、内核攻击不属于同账号文件 ACL 能隔离的对象。不能把不同进程等同于不同安全主体。

Windows 不以 0600/0700 推断机密性。没有 PowerShell、无法读取安全描述符、未知 ACE、无法锁定路径、宽松权限都拒绝，不回退到 POSIX mode。检查是保守的允许主体白名单，**不尝试**用组 deny 抵消一个 broad allow：会拒绝一部分实际可能安全但无法在此模型下证明安全的目录。

## 默认行为

- 所有 Gateway 启动（包括 Mock）在创建 lock、identity、SQLite、control 前检查目录；没有不安全目录跳过开关。
- 缺失的目录可创建，使用原生 CreateDirectoryW 的 SECURITY_ATTRIBUTES **原子携带**当前 SID、SYSTEM、Administrators 的受保护、可继承 full-control DACL。不先在宽松目录中创建密钥再收紧权限。
- 已有目录、文件和其 ACL 均不修改。验证现有 identity/control/lock/SQLite/WAL/SHM；现有秘密文件必须为普通文件、单硬链接，owner 和 allow ACE 只能属于上述主体。新文件继承已经验证的目录 DACL。
- 验证磁盘根至目标的整条路径；拒绝网络/非固定驱动器、UNC、设备/ADS、带尾随点/空格的别名、超长路径、不支持的 owner、任何 reparse point（包括 junction）。祖先目录允许普通读取/遍历及创建兄弟项，但不允许其他主体删除、改 owner/DACL、写属性/EA 等可能替换路径的权限。祖先中的 TrustedInstaller 按系统维护主体处理，最终私有目录仍使用三主体规则。
- PowerShell 中的固定 C# helper 通过请求 LIST_DIRECTORY/READ_DATA 的 **句柄**读取 owner/DACL/属性，所有祖先/目标目录句柄不共享 DELETE，整个 Gateway 生命周期保持；已有 DELETE 句柄导致开锁失败。因此拒绝路径替换竞态，而非先 stat 后在任意可改的父目录中使用路径。对同 SID/受信任管理员的竞态不作跨主体防护承诺。
- Helper 通过 stdin 读取参数，不拼接 shell 命令，不读用户配置、不接受 ACL 修复指令。stdout 只发固定协议；不转发 PowerShell 诊断。Node 退出/关闭 stdin 后释放句柄；helper 意外退出会使 Gateway 停止服务，后续命令拒绝，异步密钥生成与 control 发布前也再次检查 lease。
- `control` 读取管理 token、离线 rotate-identity、MCP 读取 credential、CLI 签发 credential 的输出目录都使用同一门槛。输出失败则撤销刚创建的 grant；不输出 bearer。MCP 启动异常、Gateway CLI 异常不打印配置 JSON 或原始异常。
- POSIX 保持 UID 与私有 mode 检查；拒绝所选目录/敏感文件为符号链接，以及秘密文件多硬链接。Windows 的句柄/全祖先保证不作为 POSIX 新增保证。

这属于可审查的进程/文件系统隔离实现；它不防止当前 SID 的其他进程或管理员改变 ACL。更强隔离（独立服务账号/受限 token/内核对象 broker）是后续增强，不以当前实现冒充完成。

## 用户显式选择目录

先选择本机 NTFS 上个人独占的父目录；不要使用共享盘或其他普通用户可修改的目录。示例（绝对路径仅为占位，需替换）：

```powershell
node apps/gateway/dist/index.js serve --data 'C:\Users\YOUR_USER\PrivateLAM\gateway' --mock
```

若 `gateway` 不存在，启动器只在整条已有父路径通过检查后创建私有目录。若存在，直接检查，不修复。宿主策略如 #39 中的 Everyone:Full 祖先会被拒绝；**仅创建一个 0700 子目录并不能消除祖先可替换风险**。

拒绝时先由用户/管理员检查自己的目录策略，选择不同安全位置，或在理解影响后自行管理 ACL；项目不自动执行提权、Set-Acl、icacls grant/reset、改防火墙或修改用户 profile。不得通过删除检查/降低断言获得“通过”。若没有可验证安全的本地路径，就是环境 blocker，保持真实凭据和长期 Harness 门槛关闭。

MCP 使用 `docs/MCP_INGRESS.md` 的签发方式，把 `--output` 放在通过相同检查的私有目录；MCP 读取时会再验证。不要把真实凭据放进用于负例的目录。

## Windows 主机领取与回传

使用此修复分支的已提交源；不使用 PR #39 的旧 SHA。只执行已经提交的脚本，工作树必须干净：

```powershell
git status --porcelain
git rev-parse HEAD
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm check
node packages/mcp-server/dist/windows-private-smoke.js --parent 'C:\SAFE_PARENT' --output 'C:\REPORT_LOCATION\windows-private-storage.json'
```

不传 `--parent` 时使用系统 temp 的新子目录，仍要通过完整祖先检查。`--output` 为新的、不存在的报告文件，报告不含 token、SID、私有路径、配对地址；它不包含秘密，不要求与数据目录相同的位置。输出目录需要已存在。测试必须在独立 clone 中进行，固定执行 SHA 和 Node/pnpm 版本；原始报告做 SHA-256，结果与限制提交证据 PR，回传 #41，并关联 #42/G2。

脚本**只改它自己创建的可丢弃测试目录**：构造 Everyone 可读的负例，验证 Gateway 在任何秘密文件生成前拒绝；创建私有正例并启动真实 Gateway/Mock 及 MCP SDK stdio；验证 CLI 不安全输出被拒绝并撤销 grant，MCP 不安全读取在解析前拒绝，stdout/stderr 不含 sentinel/bearer。不是修改宿主现有目录 ACL，不启动真实模型/GUI/安装器/服务，也不改防火墙。

若宿主不能提供安全 lineage，仍尝试记录负例，报告 `blocked`、exit 1，正例保持未验证。所有自有 Gateway/目录句柄和测试目录必须清理；清理失败报告 failed，不能声称通过。若有失败，不上传配置文件或原始私有错误；仅提交固定 schema 的脱敏报告。

单元测试额外覆盖 inherit-only 危险 ACE、宽松祖先、现有 key 宽松 DACL、junction/hardlink、目录在 lease 持有时不能改名、lease 释放后可改名，以及 POSIX 回归。Hosted Windows 与实体宿主证据必须分别标注。

Win32 sharing 不能由仅查询属性的 metadata-only handle 推断成立；因此目录 lease 请求 LIST_DIRECTORY，测试必须实际尝试 rename。[Microsoft 文件系统行为说明](https://download.microsoft.com/download/4/3/8/43889780-8d45-4b2e-9d3a-c696a890309f/file%20system%20behavior%20overview.pdf)区分 metadata 与 data access；未以“传了 share flags”代替实测证据。
