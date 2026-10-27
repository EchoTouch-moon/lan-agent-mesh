---
description: Watch one LAM mesh task until it reaches a terminal state (read-only)
argument-hint: <taskId>
---

Watch the task from $ARGUMENTS with `mesh_get_task` from the `lam-mesh` MCP server. The tool is cursor-based and returns **one event per call**:

1. Start with `{taskId, cursor: 0}`. Each response gives `state`, at most one `event` (started / delta / permission / completed / failed / cancelled / unknown) and the next cursor as `next`.
2. Wait at least 500 ms, then call again with `cursor` set to the previous `next` — never repeat the same cursor, it returns the same first event forever.
3. Report events in arrival order; summarize deltas.
4. Terminal states are **COMPLETED / FAILED / CANCELLED**. After reaching one, keep calling with the advanced cursor until the event stream is drained (no further event and `next` unchanged), so the closing event is not missed.
5. If the state is **UNKNOWN**, say UNKNOWN, stop polling and explain that the outcome must not be retried with a new request id without an explicit new user decision.

Read-only: do not send, delegate, cancel or retry anything in this command.
