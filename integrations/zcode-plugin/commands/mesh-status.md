---
description: Show current LAM mesh sessions and task states (read-only)
---

Call, in this order, and report only what they return:

1. `mesh_list_sessions` from the `lam-mesh` MCP server — list sessions (sessionId, agentId, workspaceAlias, state when reported). It lists only sessions created by this credential, never native GUI conversations.
2. For each task the user asks about (from $ARGUMENTS, or the most recent ones visible), call `mesh_get_task` with `{taskId, cursor: 0}`; it returns the current state plus at most one event per call — advance the cursor to the returned `next` and repeat (≥500 ms apart) to see further events.

These are read-only tools. Do not start, send, delegate or cancel anything in this command. If a task state is UNKNOWN, report it as UNKNOWN — do not guess it completed or failed.
