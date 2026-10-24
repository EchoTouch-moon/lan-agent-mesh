# Mac MCP ingress verification

Clean committed source: 0ad588001a46d3302a9805f061efc9a80bb2115a. Build/typecheck/lint and 43 tests passed. [Formal stdio report](mcp-smoke.json) uses an actual official SDK client, a child MCP server and real encrypted peer sockets to a deterministic remote Mock.

Verified: exact seven-tool list with no approval/admin endpoint; scoped session creation and exact-ID retry; streamed remote result; asynchronous task ID before completion; same logical task on retry; delegation/cancellation; admin/scoped-token separation; revoked-token rejection. The integration tests additionally cover legacy 2025-06-18 discovery/call, cross-grant resources, caller-chosen ID collision prevention, cross-tool concurrent IDs, lost ACK, malformed task events, expiry, MCP/Gateway restart and private-file CLI behavior.

Source/report hashes and check-log hash are in [run-metadata.json](run-metadata.json). No real model, GUI, existing host configuration or user credentials were used. Probe data and listeners were cleaned. [Setup and boundaries](../../../MCP_INGRESS.md); physical Windows and real Harness adapters remain separate.
