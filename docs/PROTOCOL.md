# Mesh Protocol v1 (Design Draft)

Transport candidate: js-libp2p/TCP/Noise/Yamux. Discovery via mDNS/DNS-SD plus manually configured peer addresses. Discovery announcements are untrusted; authenticated pairing required before exchanging private registry data.

## Message envelope
```json
{
  "version": 1,
  "messageId": "uuid",
  "correlationId": "uuid",
  "idempotencyKey": "uuid",
  "type": "task.request",
  "source": {"nodeId":"mac","agentId":"mac/codex/default"},
  "target": {"nodeId":"win","agentId":"win/dsh/test"},
  "taskId": "task-uuid",
  "deadline": "2026-10-23T10:00:00Z",
  "payload": {"text":"Run Windows compatibility tests","workspaceAlias":"project-a"}
}
```

## Message classes
- peer.hello, peer.capabilities, registry.snapshot, registry.delta
- session.create, session.resume, session.message, session.event, session.cancel
- task.request, task.accepted, task.event, task.result, task.cancel
- approval.request, approval.decision, approval.expired
- ack, error, ping

## Task state
QUEUED → AUTHORIZING → RUNNING → COMPLETED/FAILED/CANCELLED, with WAITING_INPUT and UNKNOWN for outcomes not confirmed after interruption. Do not blindly replay irreversible work on UNKNOWN.

## Rules
Validate schemas and limits before dispatch. Correlation and idempotency keys are mandatory for side-effecting calls. The receiver persists a deduplication record before execution and records transitions durably. Acknowledge delivery separately from task completion. Serialize turns on the same native session. Apply queue limits, deadlines, cancellation and max delegation depth. Avoid arbitrary absolute paths: use receiving-node workspace aliases.

This draft is an internal contract, not a claim of A2A wire compatibility. External A2A bridge deferred to P5.

## P0 implementation

`packages/protocol` implements strict per-type schemas, encoding/decoding and errors for the message classes above. [ADR 0001](adr/0001-p0-contracts.md) defines required fields and the 64 KiB UTF-8 limit. Correlation, idempotency and message identifiers use UUIDs; task/session/node IDs remain opaque bounded strings. Transport authentication, persistence and execution authorization are later components.
