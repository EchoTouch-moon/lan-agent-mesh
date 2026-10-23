# P1 Mac implementation and Windows handoff

Goal: implement LAM-07..15 on the local Mac; publish Windows-only and physical Mac↔Windows validation as a separate task pack for the user tomorrow. Do not wait for Windows before completing Mac work. No real harness/model, existing GUI session, installer, privileged service, or user configuration is involved.

## Acceptance targets

- SQLite migrations for nodes/agents/sessions/tasks/messages/approvals/audit/inbox/outbox, atomic deduplication and explicit restart recovery.
- Same Gateway code on Node 22/24; controlled startup/shutdown and loopback authenticated local control, diagnostics and port-conflict cleanup.
- Untrusted mDNS discovery plus manual address connection; expiry and no private disclosure before pairing.
- Persistent cryptographic identity, two-sided human-confirmed session-bound pairing, revocation and rotation.
- TCP/Noise/Yamux encrypted authenticated transport, bounded framing/rate/concurrency, keepalive/reconnect.
- Filtered local/remote registry, conservative capabilities and stale/offline handling.
- Durable task routing, delivery ACK separate from completion, idempotency/depth/budgets, UNKNOWN without blind re-execution.
- Native-session mapping/resume and turn serialization; deterministic bidirectional Mock E2E and restart/fault/negative tests.
- GitHub PR and reproducible Mac evidence; Windows handoff contains exact source SHA, commands and report format, with physical cross-platform gates explicitly pending.

## Current state

P1 storage, mesh transport and runtime packages plus the executable Gateway are implemented on feat/p1-mesh-core. Current checks cover 36 contract/integration cases, real encrypted loopback peers, code/identity/expiry/oversize/plaintext negatives, lost ACK replay, concurrent-session protection, default permission denial, key rotation, cache expiry/change, native mapping recovery, IPC authentication and startup conflicts. The independent-process smoke has passed an exploratory run; formal evidence will be captured from committed clean source. Windows tasks are separated in P1_WINDOWS_TASKS.md; no physical cross-platform result is claimed.

## Decisions

Use built-in Node SQLite (minimum Node 22.13, actual pinned CI 22/24) to avoid native-addon installation; preserve ACID file storage. Retain planned libp2p TCP/Noise/Yamux and mDNS. Publish only peer identity and network endpoint until pairing. Pairing grants only explicitly exported mock agents/workspace aliases; approval allows remain unavailable in P1. No production human approval UI is implied.

## Validation findings addressed

- Explicit reconnect first closes stale connections before dialing the pinned identity.
- Pairing tests now select the matching session ID when a node has multiple pending peers.
- Offline detection is asynchronous: tests wait for the actual connection-close event rather than assuming zero network latency.
- Raw plaintext/silent sockets exposed the library default negotiation delay; incoming negotiation is now bounded at two seconds.
- Process reports require clean committed source by default; development runs cannot be labeled with an unchanged checkout SHA.

## Deliverables and remaining gates

Core: packages/storage, packages/mesh, packages/runtime, apps/gateway. Design: [ADR 0002](adr/0002-p1-mesh-runtime.md). Reproducers: scripts/p1-process-smoke.mjs and scripts/p1-mdns-smoke.mjs. Windows-only/user-coordinated work: [P1_WINDOWS_TASKS.md](P1_WINDOWS_TASKS.md).

Before marking Mac work delivered: capture pnpm check plus independent-process and multicast reports from a committed clean source, publish a reviewable PR, and inspect hosted CI. Physical Mac↔Windows evidence is deliberately deferred, so LAM-15 and whole-P1 acceptance must remain open. No user action is needed for continued Mac work.
