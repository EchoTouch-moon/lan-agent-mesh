# G0 reviewed integration candidate

Candidate source **94fe9ae3baf354230a94bde17f2466a5a38840c4**, committed and pushed before formal execution. [PR #44](https://github.com/EchoTouch-moon/lan-agent-mesh/pull/44) targets current main 3ff683ee32a876b6f2082c260ac8a4713e2a8427. This evidence archive does not change implementation.

- [Push CI 40088768221](https://github.com/EchoTouch-moon/lan-agent-mesh/actions/runs/40088768221) and [PR CI 40088814082](https://github.com/EchoTouch-moon/lan-agent-mesh/actions/runs/40088814082): all four jobs pass on both events. Mac 46 passed / 3 Windows-only skipped; Windows 48 passed / 1 POSIX-only skipped; 49 defined cases.
- [Mac independent processes](mac-process-smoke.json), [actual stdio MCP](mac-mcp-smoke.json): encrypted dual-direction Mock, recovery without replay, identity continuity, streaming/cancel, scoped management boundary and revoke all pass; no external models, resources cleaned.
- [Hosted Windows Node22](hosted-windows-node22.json), [Node24](hosted-windows-node24.json): private-storage allow/deny, real MCP SDK, failed credential write/revoke and pre-parse unsafe read rejection all verified; native DLL hashes captured and resources cleaned. These are **hosted runner reports, not the user's physical-host acceptance**.
- [Metadata](run-metadata.json): pinned main/#38/#39/#40/#43 heads are all ancestors; #39 contributes six evidence files only, five JSON reports remain byte-identical; original CRLF source hashes verified. Source/report/log hashes and precommit development-test provenance are explicit.

[Review and corrections](../../../INTEGRATION_REVIEW_2026-10-24.md): missing durable session-operation capacity was reproduced then fixed; exact retries and UNKNOWN history preserved; #39 Mac evidence link corrected; newer main planning documents retained.

**Remaining**: G0 requires explicit merge authorization, main integration and post-merge CI. #41 needs user-host allow/deny revalidation; #15 needs physical two-host W3. No parent task is closed, no real Harness/long-term credentials enabled, no GUI/configuration/firewall/old ACL modified. Software candidate success does not satisfy these remaining gates.
