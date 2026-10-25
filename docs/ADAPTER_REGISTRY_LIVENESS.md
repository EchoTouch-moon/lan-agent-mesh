# Local Adapter liveness and registry refresh (LAM-12)

Previously, Sessions probed an Adapter only during registration. If its owned native process later
died, a fresh remote registry request could still return its old card as callable. The receiver also
trusted that registration snapshot for new work. A regression using two owned encrypted-loopback
Gateways reproduced the stale card before the fix.

## Read and admission behavior

- Every authenticated remote registry request refreshes visible providers before producing its snapshot.
  Unpaired requests remain rejected by Mesh before reaching this path; hidden providers are not probed
  for registry readers and hidden cards remain filtered.
- New session creation, session resume and fresh task admission check provider availability and the
  required effective capabilities again. A missing/offline/throwing/malformed/timed-out provider is not
  invoked for those operations. Failed fresh task admission does not allocate a task or call native send.
- After the asynchronous task check, the existing busy/session/Gateway limits are checked before
  the durable task reservation. Two concurrent requests sharing a probe still admit only one turn on
  the same idle session. Session capacity reservations likewise remain after the check.
  Task/create/resume deadlines are rechecked after the await and before invoking native effects.
- Available=false hides all of that provider's cards; it does not delete native/session mappings,
  task outcomes or idempotency records. Exact already-accepted envelope/outbox retries remain receipt
  lookups and do not need a live Adapter or cause another native operation.
- Capability changes intersect the current probe with the original discovered card's capabilities.
  A provider cannot promote a card beyond its registration scope, add workspace aliases/Agent IDs, or
  change its registered harness kind via a refresh. A fresh valid probe can restore the originally
  registered scope. Version and effective capability changes become the existing remote
  `capability_changed` invalidation on the next sync.
- Harness capability metadata uses the provider's probe, not the first Agent's restricted card.
  This permits multiple differently restricted Agents on one harness while keeping each card bounded
  by the harness. Different providers cannot claim the same registered harness ID.

The async probe budget is one second. Concurrent readers/admissions share a pending probe. Once it
times out, the provider is unavailable; the occupied slot remains until the underlying promise settles,
so repeated registry reads cannot launch unbounded replacement probes. Late results from the expired
check are discarded; only a subsequent fresh check may restore availability. Exceptions and invalid
payloads produce unavailability without forwarding native diagnostics. Probe code is trusted in-process
SDK code; this promise budget cannot preempt a synchronous infinite loop in a plugin.

Registration uses the same bounded probe. An initially unavailable provider still has no discovered
cards; this change does not automatically discover new Agents later. Re-registration of an already
registered Adapter is refused. Discovery defines the original ownership/capability/workspace scope.

## Retained semantics

`localRegistry()` remains a synchronous snapshot for in-process consumers. Network registry reads
refresh it first; a programmatic caller needing fresh local data can await `sessions.refresh()` first.
The existing five-second remote maintenance/sync and fifteen-second card TTL remain unchanged. A cached
card is never proof a native process will stay alive: admission and the concrete Adapter must still reject
loss between observation and execution.

Cancellation and shutdown still use the owned Adapter directly for best-effort stopping of existing
work. A failing availability probe must not disable cleanup. Session-manager close immediately hides
cards and prevents late probe/discovery/operation completions from publishing new records after close;
Gateway retains its existing Adapter/router/mesh/store cleanup order.

## Evidence scope

`packages/runtime/test/adapter-liveness.test.ts` covers fresh registry withdrawal/restoration through
actual encrypted loopback peers, raw receiver-side operation refusal, exact retained-result retries,
two differently restricted cards on one harness, malformed/changed-kind probes, a throwing property,
coalesced timeout and late/closed results, bounded registration, and concurrent task admission.
The initial stale-card test failed against the previous implementation. Existing router retention,
UNKNOWN and expired-ACK tests continue covering their original invariants.

These tests use Mock providers and new owned identities. They neither exercise an installed Harness
nor reopen the deferred physical window. Windows task #18 continues to use its already posted
`60e6e88` source; this independent runtime candidate does not replace that execution instruction.
