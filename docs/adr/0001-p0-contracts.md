# ADR 0001 — Foundation contracts and ownership

Status: accepted for local P0 foundation, 2026-10-23.

## Decision

Use a pnpm TypeScript ESM workspace on Node 22/24. `domain` owns Zod schemas and their inferred types; `protocol` owns wire envelopes and predictable error codes; `adapter-sdk` owns the inbound harness control contract; `mock-adapter` provides a deterministic, process-local test implementation. Apps contain only reserved entry points plus an offline CLI demonstration. No transport or real adapter is implied by these packages.

Node is a physical Gateway identity. Harness is an installed software instance belonging to one Node. Agent is an advertised service belonging to a Harness on the same Node. Session maps that Agent to one native session and a registered workspace alias. Task belongs to a Session on its executing Node. The executing Node owns session/task state. A remote registry cache is advisory, expires, and never becomes authority to execute. `DomainGraphSchema` validates ownership links and `RegistrySchema` forbids advertising capabilities above those of the Harness. See [graph fixture](../../packages/domain/fixtures/graph.json).

Capability states are supported, unsupported, unknown. Only supported permits dispatch; negotiation takes the intersection. GUI attachment remains a declaration for research; this SDK has no attach method and rejects an adapter that advertises supported GUI attachment. A real GUI attach API requires a separate explicit contract.

## Wire contract

All messages use strict, type-specific payloads, protocol version 1, UUID message identifiers, source/target node addresses and an absolute deadline. Side effects require UUID correlation and idempotency keys. Task/approval messages require taskId; approval payload taskId must match it. Maximum UTF-8 encoded size is 65,536 bytes. Workspace values are receiving-node aliases, never arbitrary paths. Decode checks byte size, UTF-8, JSON, version, schema and deadline before returning an envelope. Schema validation is separate from peer authentication and policy, which arrive in P1/P3.

Errors: invalid_json, invalid_message, unsupported_version, message_too_large, deadline_exceeded, unsupported, not_found, busy, permission_denied, cancelled, disconnected, conflict, internal. Successful ACK means delivery only, not execution completion.

## Adapter contract

`probe/discover/spawn/resume/send/watch/cancel/answerPermission` separates controlled inbound APIs from MCP outbound tools. `watch` is an AsyncIterable with optional AbortSignal: detaching a watcher does not cancel execution. `cancel` targets a task; resume preserves the native session identifier. Only one active turn is admitted per session; independent sessions may run concurrently.

Permission decisions bind node, agent, session, task, operation digest, one-use nonce and expiry. `humanId` is metadata, **not authentication**. The caller must authenticate and authorize the human before invoking the SDK hook. No Gateway approval endpoint or agent approval tool exists in P0. Mock tests check scope, one-use decisions and deny/expiry behavior, not real human authentication.

## Mock semantics and limits

Mock supports injected chunks, per-chunk delays, permission waits, failures, disconnects, cancellation and deadline expiry. Duplicate idempotency keys return the original task for identical requests; conflicting input or task-ID reuse fails. UNKNOWN results remain UNKNOWN on identical retries, with history available to later watchers. Records are bounded and retained for the life of the mock (100 sessions/1,000 tasks by default). They do not survive process exit. Production durable deduplication, queueing, retries and UNKNOWN reconciliation belong to LAM-11..15.

The mock emits an echo response; it does not implement model reasoning or a network. A lost watch connection can reconnect to event history in the same process. An injected harness disconnect marks the execution result UNKNOWN rather than rerunning it.

## Verification

Tests exercise invalid ownership, strict fields, workspace traversal, cache expiry, wire errors, capability gates, multi-session concurrency, repeated calls, approval scope/deny/expiry, cancellation, failure, disconnect and observer detachment. CI defines clean-install checks for macOS/Windows on Node 22/24; passing locally does not assert those hosted jobs ran.
