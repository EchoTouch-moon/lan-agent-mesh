---
description: Delegate a task to a remote LAM agent (requires explicit user approval)
argument-hint: <agentId> <workspaceAlias> <task text>
---

Delegate a task to a remote agent over the mesh. Follow these steps exactly; the tools are asynchronous — none of them returns the task result directly.

**1. Resolve the target (read-only).** Call `mesh_list_agents` and find the entry whose agentId matches $ARGUMENTS. Note its **peerId** and confirm the workspace alias is listed for that agent. `mesh_start_session` requires `peerId`, `agentId` and `workspaceAlias` together — an agentId alone is not enough.

**2. Confirm with the user.** Echo back the peerId, agentId, workspace alias and the exact task text, and ask for explicit confirmation. If the user does not confirm, stop before calling any side-effecting tool. The ZCode host's native permission prompt still governs each actual tool call; this command never bypasses or auto-approves it.

**3. Start the session.** Call `mesh_start_session` with `{peerId, agentId, workspaceAlias, requestId}` where requestId is a **fresh UUID** (this is the idempotency key for the session). It returns `{sessionId, ...}` — keep that sessionId.

**4. Submit the task.** Call `mesh_delegate_task` with `{sessionId, text, requestId}` (its own fresh UUID, different from the session's; `timeoutSeconds` optional, 1–300, default 60). It returns only `{taskId, delivery, deadline, retry}` — **delivery is submission status, not the outcome**. There is no result text here.

**5. Poll to the terminal state.** Call `mesh_get_task` with `{taskId, cursor: 0}`; each call returns the current `state` plus **at most one** persisted `event` and the next `next` cursor. Poll no faster than every 500 ms, always advance `cursor` to the returned `next`, and keep polling until the state is terminal (**COMPLETED / FAILED / CANCELLED**) **and** the remaining events are drained (empty event with unchanged `next`). Terminal COMPLETED events carry the result text. If the state is **UNKNOWN**, stop and report UNKNOWN — never re-run the task under a new requestId.

**Cancellation.** If the user asks to abort, call `mesh_cancel_task` with `{taskId}`; it returns only `{cancelRequested: true}` — that is a delivery acknowledgement, **not** proof of cancellation. Continue the step-5 polling; only state CANCELLED proves cancellation, and COMPLETED after a cancel request means the task finished first.

**Retries.** A retry means re-invoking the **same tool with identical arguments and the identical requestId** (start retry reuses the session requestId; task retry reuses the task requestId). Any other retry — new requestId, changed text — is a new operation with new side effects. Denials (permission_denied / conflict / scope) are final for this attempt; do not vary parameters to search for an allowed shape.
