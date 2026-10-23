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

## Mac evidence

[mac-20261023T195045Z](evidence/p1/mac-20261023T195045Z/SUMMARY.md) records clean source 4714ed9, full checks (36 tests), independent-process bidirectional/crash/identity tests, and observed local mDNS. Both helpers exited successfully and removed their owned state/listeners. Implementation and separated Windows pack are published in [PR #38](https://github.com/EchoTouch-moon/lan-agent-mesh/pull/38). Hosted cross-platform checks are inspected separately; physical Mac↔Windows gates remain pending by user request.

## Mac delivery audit (2026-10-24)

Mac-local work is complete and reviewable. [CI 40014756437](https://github.com/EchoTouch-moon/lan-agent-mesh/actions/runs/40014756437) on bf2c0bc passed all four macOS/Windows × Node22/24 jobs, including the independent Gateway process smoke. This proves hosted single-machine portability and does not replace physical Windows or Mac↔Windows tests. No real Harness/native account experiment is pending for this P1 Mac scope.

| Task | Mac implementation and acceptance evidence | Deferred Windows gate |
|---|---|---|
| LAM-07 | SQLite migration, transaction rollback, reopen, unique key and UNKNOWN recovery tests | W1 physical filesystem validation |
| LAM-08 | Actual Gateway process, authenticated loopback control, directory/port conflicts, graceful stop | W1 on user's Windows machine |
| LAM-09 | Actual local mDNS observed; manual connection used by encrypted peer tests; expiry bounded | W2 Windows multicast and W3 cross-system discovery |
| LAM-10 | Two-sided session/code confirmation, identity pinning, expiry, revocation and rotation tests | W3 independent human comparison on both physical devices |
| LAM-11 | Real TCP/Noise/Yamux, encrypted frames, plaintext/oversize negatives, pinned reconnect | W3 actual LAN behavior |
| LAM-12 | Export filtering, capability intersection, stale/offline/change invalidation | W3 physical registry exchange |
| LAM-13 | Durable ACK/outbox retry, deduplication, crash UNKNOWN, budgets and cancel | W3 physical partition/retry observations |
| LAM-14 | Persisted gateway/adapter/native mapping, busy protection, surviving-adapter resume and lost-Mock fail-closed | W3 physical session observations |
| LAM-15 | Two independent processes, both directions, exact fixture output, crash/restart/no replay | W1/W2/W3 required before whole-P1 hardware acceptance |

The user intentionally deferred these Windows gates. They are published in Issue #15 with source, safe commands and result contract, and do not block delivery of the requested Mac work. PR #38 remains unmerged for review; P1 issues stay open, and overall cross-platform P1 acceptance is not claimed. No persistent test listener is left on this Mac.
