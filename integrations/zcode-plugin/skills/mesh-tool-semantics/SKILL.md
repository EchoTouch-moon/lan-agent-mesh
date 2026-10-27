---
name: mesh-tool-semantics
description: Use when calling any lam-mesh mesh_* MCP tool — requestId/idempotency retry rules, UNKNOWN semantics, cancellation and scope-denial handling for LAN Agent Mesh tools. Not an authorization; grants and native permissions still govern.
when_to_use: Any turn that invokes mesh_list_agents, mesh_list_sessions, mesh_start_session, mesh_send_message, mesh_delegate_task, mesh_get_task or mesh_cancel_task.
---

# mesh_* tool semantics (LAM protocol v1)

- **requestId is the idempotency key.** One logical request = one requestId (UUID), reused verbatim across retries. A retried envelope with the same requestId returns the same logical task/session; issuing a new requestId for the same logical request creates a second, real task (double side effects).
- **UNKNOWN is not failure.** A task whose outcome is UNKNOWN (crash, restart, lost ACK, deadline) must not be re-issued under a new requestId. Report UNKNOWN and let the user decide.
- **Cancellation is terminal-state based.** `mesh_cancel_task` requests cancellation; success is only proven when the task state becomes CANCELLED. COMPLETED after a cancel request is a completion, not a cancellation.
- **Denials are final for that attempt.** permission/scope denials mean the grant or the host's native permission refused; do not vary parameters to search for an allowed shape.
- **Read-only tools**: mesh_list_agents, mesh_list_sessions, mesh_get_task. Everything else can cause remote side effects and needs the scoped grant plus, where the host enforces it, native approval.
- **Streams are ordered**: task events arrive in order; report them in that order and don't reorder by timestamp.
