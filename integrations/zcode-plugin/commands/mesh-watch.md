---
description: Watch one LAM mesh task until it reaches a terminal state (read-only)
argument-hint: <taskId>
---

For the taskId from $ARGUMENTS, call `mesh_get_task` from the `lam-mesh` MCP server and report: state, the latest events in order (deltas summarized), and whether the state is terminal (COMPLETED / CANCELLED / FAILED). Repeat the call a few times with a short pause while the state is running, then summarize.

Read-only: do not send, delegate, cancel or retry anything. If the state is UNKNOWN, say UNKNOWN and explain that the outcome must not be retried with a new request id without an explicit new user decision.
