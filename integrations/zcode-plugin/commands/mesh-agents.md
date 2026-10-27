---
description: List remote LAM agents this ZCode is permitted to call
# Read-only: only mesh_list_agents may be invoked by this command.
allowed-tools: ''
---

Call the `mesh_list_agents` tool from the `lam-mesh` MCP server. Do not call any other mesh tool.

Each returned agent entry has the fields `id`, `nodeId`, `harnessId`, `name`, `workspaceAliases` and `capabilities` — **there is no `agentId` or `peerId` field in this response**; those names belong to `mesh_start_session` input only. Present a table with columns: id, nodeId, name, harnessId, workspaceAliases (the array as-is). Add one explicit note for the user: to start a session later, `agentId` is this entry's `id`, and `peerId` is this entry's `nodeId`.

If the list is empty, say so plainly and suggest the operator run the gateway `mcp-grant` command to scope a credential — do not attempt any workaround. If several entries share the same name or id prefix, show all of them and let the user pick by exact id.

Never fabricate agent entries; only report what the tool returned.
