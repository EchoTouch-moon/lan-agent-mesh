# LAN Agent Mesh Architecture

Status: target architecture. P0 domain/protocol/adapter/mock contracts are implemented locally; P1 network Gateway components are implemented on the P1 branch for Mac-local verification; physical cross-platform acceptance remains pending. See [ADR 0002](adr/0002-p1-mesh-runtime.md). See [ADR 0001](adr/0001-p0-contracts.md).

## Vision
Each macOS/Windows machine runs an identical Gateway with peer-to-peer capabilities. Local harness adapters register Agents and Gateway-managed Sessions. Each node may discover, call, or delegate work to a paired node. No central coordinator is required on the LAN.

## Components
- MeshTransport: mDNS/DNS-SD discovery + manual endpoint; authenticated encrypted P2P connection, reconnection, peer revocation.
- AgentRegistry: discover local harness instances, agents, capabilities, and remote service cards; filter by visibility policy.
- SessionManager: map Gateway sessions to native session identifiers; spawn, resume, send, stream, cancel and concurrency control subject to adapter capabilities.
- TaskRouter: durable inbox/outbox, message acknowledgements, idempotency, task lifecycle, unknown-outcome handling, delegation depth.
- PolicyEngine: per-peer and agent authorization, workspace aliases, user approval, execution budget and audit.
- MCP ingress: tools for *calling* other agents from local harnesses.
- Harness adapter: capability-gated control for *being called*; MCP support alone does not make a GUI session remotely controllable.

## Identity & ownership
Node != Harness instance != Agent service != Session != Task. The executing node owns native sessions and authoritative task execution state. Peer registries are caches; offline entries must not imply availability.

## Local components
Gateway background process (non-admin user), SQLite, local MCP server, loopback control API and web console. Windows and macOS load different adapters but the same core program.

## Initial adapters
Codex App Server; ACP/DSH after version-specific validation; ZCode RPC/API feasibility spike; WorkBuddy MCP as an outgoing caller first. Never promise attaching to already-open GUI sessions without a supported API.

## MVP sequence
1. Domain schemas, adapter SDK, mock adapter.
2. Encrypted paired two-node messaging, registry, durable task/session state.
3. MCP tool ingress, Codex and ACP adapter proof.
4. Policy + human approval bridge + web console + audit.
5. Cross-platform failure tests and alpha distribution.

Refer to GitHub Issues with [LAM-xx] IDs. See PROTOCOL.md, SECURITY.md and ROADMAP.md.