# LAN Agent Mesh (LAM)

**A peer-to-peer local network for existing AI agent harnesses.** Discover, wake, message and delegate work across macOS and Windows while keeping each harness and machine's native execution permissions.

> **Status (2026-10-24):** P0 foundation and Windows research are merged ([PR #37](https://github.com/EchoTouch-moon/lan-agent-mesh/pull/37)). Working P1 P2P Gateway implementation is in open [PR #38](https://github.com/EchoTouch-moon/lan-agent-mesh/pull/38), Windows W1/W2 evidence in open [PR #39](https://github.com/EchoTouch-moon/lan-agent-mesh/pull/39), and scoped MCP-to-remote-Mock tools in open [PR #40](https://github.com/EchoTouch-moon/lan-agent-mesh/pull/40). **Physical two-host W3, Windows secure data-directory ACL, real Harness adapters and human approval are not complete.** See the [next-phase execution plan](docs/NEXT_PHASE_2026-10-24.md).

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
- [Next-phase plan (2026-10-24)](docs/NEXT_PHASE_2026-10-24.md) — PR integration, physical W3 acceptance, Windows ACL gate, Codex/DSH delivery
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

## Local development

Use Node.js 22 or 24 and pnpm 10.18.3 (pinned in packageManager). If Corepack is available, `corepack enable` makes the pinned pnpm available; otherwise install that pnpm version using your normal package manager.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm demo
```

`pnpm check` builds the packages, type-checks source and tests, runs lint and the offline contract tests. The demo prints mock response events and needs no model credentials. CI defines the same checks for macOS and Windows on Node 22/24. All four hosted jobs passed on the implementation commit; see [CI evidence](docs/evidence/ci-d64ff98.json) and [merged PR #33](https://github.com/EchoTouch-moon/lan-agent-mesh/pull/33).

Workspace layout:

- `packages/domain`: strict ownership/identity schemas, remote cache and graph fixture.
- `packages/protocol`: versioned typed messages, errors and UTF-8 size limits.
- `packages/adapter-sdk`: capability-gated inbound control contract.
- `packages/mock-adapter`: deterministic sessions, streaming, scoped mock permissions, cancellation and fault injection.
- `apps/cli`: offline demonstration. `apps/gateway` and `apps/console`: reserved entry points.

[ADR 0001](docs/adr/0001-p0-contracts.md) records contract decisions and limits. `pnpm probe:codex`, `pnpm probe:dsh` and `pnpm probe:zcode` optionally probe installed binaries without model inference; see the [version-specific matrix](docs/HARNESS_MATRIX.md). Optional `pnpm probe:codex:fixture`, `pnpm probe:dsh:fixture` and `pnpm probe:zcode:fixture` exercise the installed native harnesses against deterministic localhost inference, including streaming, cancellation and native approval denial. No external model is called. The macOS-only `pnpm probe:workbuddy:inventory` reads shipped SDK metadata without launching the app. These research probes are not required for CI.

## License

License selection is pending; do not assume a license grant until a LICENSE file is committed.

Windows local verification: run `powershell -File scripts/verify-windows.ps1` from the checkout after installing Node and the pinned pnpm. It writes a report to the temporary directory, runs only the offline workspace checks/demo and does not start a real harness.

Windows agent handoff: [execution tasks and GitHub result contract](docs/WINDOWS_AGENT_TASKS.md). The assigned Windows runs are delivered and reviewed. PR #37 consolidates their shared history for integration into main; no additional native run is pending.
