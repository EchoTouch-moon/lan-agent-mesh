# LAN Agent Mesh (LAM)

**A peer-to-peer local network for existing AI agent harnesses.** Discover, wake, message and delegate work across macOS and Windows while keeping each harness and machine's native execution permissions.

> **Status (2026-10-24):** The P1 encrypted Gateway, Windows W1/W2 reports, scoped MCP-to-Mock tools and Windows private-storage checks are integrated into `main` through [PR #44](https://github.com/EchoTouch-moon/lan-agent-mesh/pull/44). [Post-merge CI](https://github.com/EchoTouch-moon/lan-agent-mesh/actions/runs/40090060616) passed on macOS/Windows × Node 22/24. Windows host ACL revalidation passed and its [Windows host evidence](docs/evidence/security/windows-private-win-priv-20261024T145925Z/SUMMARY.md) was merged through [PR #46](https://github.com/EchoTouch-moon/lan-agent-mesh/pull/46). **Physical Mac↔Windows W3, native Harness adapters and human approval remain incomplete; real Harness execution is not authorized by this evidence.** See [integration review](docs/INTEGRATION_REVIEW_2026-10-24.md) and the [next-phase plan](docs/NEXT_PHASE_2026-10-24.md).

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

Use Node.js 22.13+ or 24 and pnpm 10.18.3 (pinned in packageManager). If Corepack is available, `corepack enable` makes the pinned pnpm available; otherwise install that pnpm version using your normal package manager.

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
- `packages/storage`, `packages/mesh`, `packages/runtime`: persistent paired Gateway with bounded task/session routing.
- `packages/mcp-contract`, `packages/mcp-server`: scoped local stdio tools for remote Mock sessions.
- `packages/private-storage`: fail-closed Windows native ACL checks and POSIX private-mode checks.
- `apps/cli`: offline demonstration; `apps/gateway`: Gateway/control CLI; `apps/console`: reserved UI entry point.

[ADR 0001](docs/adr/0001-p0-contracts.md) records contract decisions and limits. `pnpm probe:codex`, `pnpm probe:dsh` and `pnpm probe:zcode` optionally probe installed binaries without model inference; see the [version-specific matrix](docs/HARNESS_MATRIX.md). Optional `pnpm probe:codex:fixture`, `pnpm probe:dsh:fixture` and `pnpm probe:zcode:fixture` exercise the installed native harnesses against deterministic localhost inference, including streaming, cancellation and native approval denial. No external model is called. The macOS-only `pnpm probe:workbuddy:inventory` reads shipped SDK metadata without launching the app. These research probes are not required for CI.

## License

License selection is pending; do not assume a license grant until a LICENSE file is committed.

Windows local verification: run `powershell -File scripts/verify-windows.ps1` from the checkout after installing Node and the pinned pnpm. It writes a report to the temporary directory, runs only the offline workspace checks/demo and does not start a real harness.

## P1 Gateway on a Mac

After `pnpm install --frozen-lockfile` and `pnpm build`:

```sh
pnpm gateway serve --data /path/to/private-test-directory --mock
pnpm gateway control --data /path/to/private-test-directory --command status
node scripts/p1-process-smoke.mjs --output /tmp/lam-p1-process.json
```

The first command stays running. Use a second terminal for control commands. Default transport and all control traffic bind to loopback. `--mock` explicitly exports a deterministic test Agent; without it no Agent is exposed. For a scheduled LAN test add `--listen /ip4/0.0.0.0/tcp/48731 --mdns`, compare the pairing code on both machines, and confirm locally on each before reading private registry data or sending tasks. Do not publish control.json or identity.key.

`control --command shutdown` stops the owned Gateway. Offline `rotate-identity --data <directory>` invalidates prior trust and requires pairing again. These commands run only the P1 test runtime and do not attach a GUI or start real inference. Node 22 may print its built-in SQLite experimental warning.

[P1 design and recovery rules](docs/adr/0002-p1-mesh-runtime.md) cover UNKNOWN, exact-message outbox retries, cache expiry and limits. [Windows tasks](docs/P1_WINDOWS_TASKS.md) separate Windows same-host checks from the actual Mac↔Windows hardware gate. P0's [historical handoff](docs/WINDOWS_AGENT_TASKS.md) is complete.

## Local MCP caller (P2 / LAM-16)

A local stdio MCP server now exposes seven scoped tools for remote Agent discovery, owned sessions, asynchronous turns/tasks, result cursors and cancellation. It has no pairing, policy-change or approval tool. The operator issues a separate expiring credential; the MCP process never reads the admin control token. See [MCP setup and permission boundary](docs/MCP_INGRESS.md) and [P2 progress](docs/P2_PROGRESS.md).

```text
node packages/mcp-server/dist/cli.js --credentials <explicit-private-credential-file>
```

No existing host configuration is changed automatically. The caller chain is validated against a paired remote Mock; Codex/ACP native adapters and physical cross-host acceptance remain separate tasks.
