---
description: List remote LAM agents this ZCode is permitted to call
# Read-only: only mesh_list_agents may be invoked by this command.
allowed-tools: ''
---

Call the `mesh_list_agents` tool from the `lam-mesh` MCP server. Do not call any other mesh tool.

Present the result as a table with columns: agentId, peer, harness/kind (when reported), workspace aliases (when reported). If the list is empty, say so plainly and suggest the operator run the gateway `mcp-grant` command to scope a credential — do not attempt any workaround.

Never fabricate agent entries; only report what the tool returned.
