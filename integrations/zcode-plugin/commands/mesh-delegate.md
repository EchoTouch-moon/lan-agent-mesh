---
description: Delegate a task to a remote LAM agent (requires explicit user approval)
argument-hint: <agentId> <workspaceAlias> <task text>
---

Delegate a task to a remote agent over the mesh. Before calling any tool, echo back to the user: the target agentId, the workspace alias, and the exact task text from $ARGUMENTS, and ask for explicit confirmation. If the user does not confirm, stop — do not call the tool.

On confirmation:

1. Generate one fresh requestId (UUID) for this delegation and reuse it verbatim for every retry of the same logical request.
2. Call `mesh_start_session` (only if no suitable session exists yet), then `mesh_delegate_task` with the task text, using that requestId.
3. The ZCode host's native permission prompt governs the actual tool call; this command never bypasses or auto-approves it.

Outcome handling:

- Completed: report the result text.
- Permission denied / scope denied: report the denial as final for this attempt; do not retry with different parameters or a new requestId.
- Timeout with unknown outcome: you may retry **once** with the **same requestId**. If it is still unknown, report UNKNOWN and stop; never issue a new requestId to "re-run" a task whose outcome is unknown.
- User asks to abort a running task: call `mesh_cancel_task` and report the terminal state it returns; do not claim cancellation succeeded unless the task state is CANCELLED.
