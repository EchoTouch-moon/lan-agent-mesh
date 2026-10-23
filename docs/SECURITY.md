# Security Model

## Baseline
- The gateway runs under the current user on both devices, not as administrator/SYSTEM.
- Control API and UI bind to loopback by default; private harness APIs also remain loopback-only.
- Pairing requires explicit human verification of a code/fingerprint cryptographically bound to peer identity.
- No unauthenticated peer may inspect private sessions, spawn jobs, send tasks or approve operations.
- Remote peers receive only policy-permitted registry metadata.

## Authorization
Effective authority is the intersection of gateway policy, native harness and operating-system privileges, and scoped human authorization. The gateway must never override native sandbox or approval restrictions.

Remote approval requests carry node, agent, session, task, concrete operation digest, expiry and single-use nonce. Only authenticated authorized human console identities can decide. Agents may request but cannot invoke an approval tool to approve themselves. Deny or timeout fail closed.

## Threats & mitigations
Identity spoofing/MITM: cryptographic peer binding and mutual authentication. Replay: durable idempotency keys, nonce binding and expiry. Lateral movement: workspace aliases and per-agent capability scopes. Prompt injection: remote task text and tool outputs remain untrusted data, never automatic privilege grants. Resource abuse: bounded message sizes, tasks, concurrency, budgets and delegation depth. Crash/partition: mark uncertain outcomes UNKNOWN; never automatically repeat non-idempotent actions.

## Critical limits
The gateway can only intercept and control permission hooks exposed by each harness. Its UI cannot enforce controls on tools executed entirely outside the gateway unless backed by native harness or OS isolation. Existing GUI-session injection is not presumed supported. Do not promise tamper-proof auditing without a separately justified trust design.

## Test gates
Unpaired access, revocation, forged approval, replay, cross-task token reuse, expired token, path traversal, malicious message, agent recursion, crash, reconnect and no double execution. See [LAM-20] through [LAM-24] issues.