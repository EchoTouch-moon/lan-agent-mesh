---
description: Show current LAM mesh sessions and task states (read-only)
---

Call, in this order, and report only what they return:

1. `mesh_list_sessions` from the `lam-mesh` MCP server — list sessions (id, agent, workspace, state when reported).
2. For each task id the user asks about (from $ARGUMENTS, or the most recent ones visible in the session data), call `mesh_get_task` and report state and the last events.

These are read-only tools. Do not start, send, delegate or cancel anything in this command. If a task state is UNKNOWN, report it as UNKNOWN — do not guess it completed or failed.
