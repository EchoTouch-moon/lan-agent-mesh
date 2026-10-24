# P2 local progression

Selected task: LAM-16, local stdio MCP ingress. This is the next dependency-ready core task and needs no Windows hardware. P1 PR #38 remains open; this work is a stacked branch/PR against feat/p1-mesh-core. Do not merge or close parent tasks on this pass.

## Completion criteria

- Seven tools: mesh_list_agents, mesh_list_sessions, mesh_start_session, mesh_send_message, mesh_delegate_task, mesh_get_task, mesh_cancel_task.
- An actual MCP SDK client communicates over stdio and calls a paired remote Mock through the encrypted Gateway path.
- Calls use operator-created, revocable, expiring scoped credentials. MCP cannot access control/pairing/approval APIs or unrelated sessions/tasks/peers/agents/workspaces.
- Long tasks return an ID immediately; durable original requests support explicit idempotent retry. Uncertain outcomes are not silently repeated.
- Tests cover lifecycle, streaming cursor, cancellation, scopes, revocation/expiry, denial-only permissions and process cleanup. Formal evidence uses committed source.
- Publish PR and update Issue #16; keep physical Windows/real Harness gates separate. Codex/ACP adapter work (#17/#18) remains a next core candidate, not claimed complete here.

Current state: seven tools, a shared strict contract, scoped loopback endpoint, expiring/revocable process-bound credentials and operator credential-file CLI are implemented. Actual MCP stdio clients call the remote Mock through the encrypted P1 path. The suite currently contains 43 tests; final source-pinned smoke and hosted checks follow. No existing host MCP configuration has been edited and no real model/GUI is used.

## Decisions and audit fixes

- Use official MCP TypeScript SDK server/client 2.4.0 and a shared Zod 4 contract. P1 wire schemas keep their existing Zod 3 behavior; no wire migration is inferred.
- MCP and admin tokens use separate endpoints and are rejected on the other's route. MCP only sees scoped cards and its own operation records; native IDs and cached idle claims are not returned.
- Caller requestId is never the global remote task ID. Gateway-generated task IDs prevent cross-grant resource claims. Send and delegate share a retry lock/namespace, including concurrent requests on different sessions.
- Ownership/outcome are persisted in one row per operation; retries cannot lose the owning resource record between duplicate writes. New metadata allocation checks its hard bound synchronously before reservation.
- Exact original envelope retries handle lost ACK without another logical task. Gateway restart invalidates every earlier process's credential; MCP process restart retains scoped resources.
- Credential files use exclusive creation and private modes. A failed file write attempts revocation and reports an unconfirmed rollback; restarting Gateway invalidates that token generation.

## Delivery map

LAM-16 is the selected local task. Tests exercise all tools with actual stdio, scope/resource negatives, expiry/revocation, native default deny, ID races, dropped ACK, MCP/Gateway restart and operator CLI private-file behavior. The compatibility path also exercises a 2025-06-18 client. Hosted Windows can run the same deterministic checks; the user's physical Windows tasks remain separately deferred. LAM-17/18/19 are not marked complete and no Harness binary or user configuration is used here.

## Mac delivery evidence

Formal [mac-20261024T092555Z](evidence/p2/mac-20261024T092555Z/SUMMARY.md) was captured after committing and pushing source 0ad5880. All seven tools and the private credential boundary passed against a real stdio SDK client and encrypted remote Mock, with 43 full-suite cases. The implementation is in [PR #40](https://github.com/EchoTouch-moon/lan-agent-mesh/pull/40), stacked on PR #38. Hosted CI includes the same clean-source smoke. Physical Windows/real Harness tests remain explicitly separate; nothing was merged or closed.
