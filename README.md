# LAN Agent Mesh (LAM)

**A peer-to-peer local network for existing AI agent harnesses.** Discover, wake, message and delegate work across macOS and Windows while keeping each harness and machine's native execution permissions.

> **Status: planning only.** This repository currently contains design documents and a 30-issue engineering backlog, **not a working gateway**.

## Goal

Install the **same Gateway** on a Mac and a Windows PC. Register local Codex, DSH, ZCode, WorkBuddy or other supported harness agents. Each machine can discover permitted agents on the other, create or resume supported sessions, send messages and delegate tasks, with a common human approval console.

```text
  Mac: Codex / WorkBuddy / ZCode         Windows: Codex / ZCode / DSH
            |                                     |
        local MCP                              local MCP
            |                                     |
    +-------v---------+        P2P         +------v----------+
    | LAM Gateway     | <---------------> | LAM Gateway     |
    | adapters/policy |  pair + encrypt   | adapters/policy |
    +-----------------+                   +-----------------+
         |                                     |
    native adapters                       native adapters
```

**Key constraints:** symmetric nodes, no mandatory cloud coordinator, no replacement harness, capability-checked adapters. MCP supplies *outgoing* tools; controlling existing sessions requires native APIs (Codex App Server / ACP / RPC as supported). Attaching to already-open GUI conversations is **not guaranteed**.

## Architecture & planning

- [Architecture](docs/ARCHITECTURE.md) — components, ownership, layers and integrations
- [Protocol draft](docs/PROTOCOL.md) — authenticated P2P envelopes, registry, sessions and tasks
- [Security model](docs/SECURITY.md) — pairing, delegated authority, native permission boundaries
- [Harness matrix](docs/HARNESS_MATRIX.md) — required version-specific capability tests
- [Roadmap](docs/ROADMAP.md) — staged implementation and Alpha exit criteria
- [Backlog](docs/BACKLOG.md) — task index; [GitHub Issues](https://github.com/EchoTouch-moon/lan-agent-mesh/issues) contain the work items

## First demonstration

Mac Codex → local MCP → Mac Gateway → paired Windows Gateway → Windows DSH/Codex → result to Mac. Then perform the reverse direction from Windows Codex to Mac Codex. Test retained session context, permission denial and dropped network ACKs.

## Proposed stack (subject to spike)

TypeScript, Node.js, pnpm, js-libp2p (mDNS/TCP/Noise), official MCP TypeScript SDK, local ACP/App Server adapters, SQLite/Drizzle, Fastify, React/Vite, Vitest and Playwright.

## Security principles

1. Pairing requires human-verifiable cryptographic device identities; discovery itself grants no access.
2. Effective privileges cannot exceed each harness' native sandbox/OS permissions.
3. Remote approval is authorized *human* action bound to a specific operation, task and expiry; Agents cannot self-approve.
4. Unknown task outcomes are not blindly replayed when they may have caused side effects.
5. Gateway controls only operations mediated by supported interfaces; it cannot promise interception of all native tool execution.

## Development plan

P0: interface feasibility + SDK (LAM-01..06) → P1: P2P core (07..15) → P2: MCP + Codex/ACP (16..19) → P3: policy, UI, audit (20..24) → P4: ZCode, WorkBuddy, releases (25..28) → P5: rooms and A2A bridge (29..30).

## License

License selection is pending; do not assume a license grant until a LICENSE file is committed.
