# Mac 端第四轮复核

复核日期：2026-10-24（Asia/Shanghai）。原交付 ad1c1a1049975e7615a3ebeeeb1b219d6c45b917；执行版本 4f17ff0bfe1dfa1bb4eb86d554a7afd4b4c4d910。

接收两项定点补测，无须再次执行已通过的生命周期测试。本轮相对执行版本仅新增证据和矩阵文字，探针源码未变。权限报告 scope=permissions、1 prompt、3 次环回请求、0 外部模型调用；send/stream/resume/cancel 的 unknown 表示本轮未执行，不撤销第三轮证据。

权限判定的四项输入均成立：Set-Content 正向对照写入/删除成功、原生 session/request_permission 回答 reject_once、原生只读 sandbox 初始拒绝已观察、目标 marker 未创建。执行版本的判定函数确实同时检查这些条件，marker 缺失不能单独通过。接收这一特定临时操作的拒绝效果，不扩展为所有命令或生产安全隔离保证。

静态报告明确投影唯一应用 App / app/ChatGPT.exe / Windows.FullTrustApplication，以及五个扩展条目中空的 ExecutionAlias 集合。候选 app/Codex.exe 的大小与完整 SHA-256 已记录。清单未将它注册为应用/别名，不能证明其为内部组件、不能直接启动或没有 CLI/app-server；全部控制能力仍 unknown。没有执行它。

## 溯源与限制

执行提交存在且包含修正后的探针；新增 review-source-hashes.json 由复核端从该提交原始字节计算，包括入口及相关 helper。Windows 回传没有提供运行前脚本哈希快照或 dsh.cmd 的哈希/脱敏关键行，不能补写成已采集；这是复现材料的限制，不否定本轮实际协议观察。原始输出留在 Windows，本端不能重算其哈希。原始 JSON 不改写。

endedUtc 已由作者单独修正为 19:07:00Z；首次证据提交时间为 19:06:40Z，最终修正提交为 19:08:43Z。因此结束时间只能作为作者报告的整体收尾时间，不作为精确到秒的执行计时证据。

交付头的 CI [40009363860](https://github.com/EchoTouch-moon/lan-agent-mesh/actions/runs/40009363860) 在 macOS/Windows × Node 22/24 全部成功。此次复核仅修改文档及派生源码哈希，检查 JSON、证据断言、链接和差异，不重复原生实测或合同测试。

LAM-01 的两项验收（矩阵附实测证据；未知明确标注）已有材料支持。Codex Windows 控制面、WorkBuddy 入站、已有 GUI 接入和旧 ZCode 超时原因继续保留 unknown，不作为强迫实验通过的待办。本轮 Windows 任务收束。P0 基线已在 main，后续探针与 Windows 证据仍待集成；未合并 PR 或关闭父任务。
