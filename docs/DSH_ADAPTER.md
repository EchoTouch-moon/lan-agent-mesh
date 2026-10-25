# DSH Adapter: private fixture implementation

LAM-18 now has a `HarnessAdapter` implementation on the ACP process layer.
The candidate combines the existing Gateway factory/lifecycle changes from PR #47 and the ACP client
from PR #52. Neither dependency nor this implementation is merged by this work.

## Supported implementation path

The package exports `openDshAdapter(options)`. The public factory permits only Windows, an explicitly
selected absolute `.cmd` desktop launcher, operator-provided launcher SHA-256, version `0.2.1-rc.2`,
and an HTTP `127.0.0.1:<explicit-port>/` fixture root. It checks the launcher file/hash, runs its fixed
`--version` command inside the owned home, checks the hash again, then initializes the ACP agent.
ACP identity is separately pinned to `deepseek-harness-acp` `0.0.1`, protocol 1.
No PATH discovery, install, GUI attachment, user configuration import or real model credentials are enabled.
The launcher hash covers that file, not the full desktop runtime distribution.

Only required Windows system locations enter PATH. The child receives dedicated HOME/USERPROFILE,
APPDATA/LOCALAPPDATA, XDG paths, DSH_HOME and TEMP/TMP under `home/native`, a fixed fake model key,
the caller's loopback fixture URL, and `DSH_PERMISSION_MODE=read-only`.
Inherited model credentials, proxies, Node options, Harness configuration roots and PATH are excluded.
This configuration limits the intended fixture path; it is not OS network or tool containment.

Register using Gateway's `adapterFactories` and explicitly export `${nodeId}/dsh/default`.
The factory receives the Gateway's real node ID; `home` must be a separate adapter-owned directory,
and every workspace alias must name a canonical local directory disjoint from that state directory.
Gateway registry advertises actual `dsh` metadata and the fixture version, rather than labeling it Mock.
Gateway owns closing the adapter on shutdown and startup failure.

## Durable ownership and task rules

- Verify private storage before reading adapter state or starting a child. Existing nonempty unmarked
  directories, unexpected root entries, changed registration, unsafe files/lineage and symlinks are refused.
- Marker binds node ID, home, launcher/version/fixture registration, and sorted workspace aliases/paths.
  Changing a fixture URL requires a new registration/home; it is not silently substituted into old sessions.
- Acquire an exclusive nonce lock before SQLite or native startup. A stale lock is always refused;
  there is no PID liveness shortcut and no automatic lock removal after an unclean exit.
- Persist distinct Gateway adapter session and native session IDs. The outer Gateway stores its own
  owner-scoped session binding. Explicit resume preserves the original native identity; restored idle
  sessions must be resumed before new work. No existing GUI session can be attached.
- Persist the full task input before a native prompt. Original task ID, key, session, text and deadline
  must all match on retry; changed input/key reuse conflicts. Valid completed or UNKNOWN retries return
  the original task even while offline. Expired requests remain rejected; changing a deadline is not a retry.
- Reserve a session before awaiting native work. Busy/ambiguous sessions refuse new prompts and resume.
  Per-home retention is bounded at 100 sessions and 1000 tasks; old idempotency records are not evicted.
- Persist streamed text before exposing events. Only `end_turn` becomes COMPLETED. `cancelled` becomes
  CANCELLED; known incomplete stop reasons become FAILED. Sending a cancel notification does not
  synthesize cancellation. Native permission requests remain reject_once/cancelled; human answers and
  GUI attachment are unsupported.
- Recover valid committed in-flight records as UNKNOWN before connecting a new process. Reject corrupt
  ownership, input fingerprints, event/task correlation, event ordering and capacity before native startup.
  UNKNOWN locks that session indefinitely until explicit future reconciliation; it is never auto-replayed.
- Native loss and task deadlines make all affected in-flight work UNKNOWN. Closing also records UNKNOWN
  before terminating owned processes. Native acceptance is never inferred from lack of a response.
- Drain outstanding operations before closing SQLite. Remove only this instance's matching nonce lock,
  and only if persistence and cleanup succeeded and no unexpected process death/creation ambiguity occurred.
  If disk writes fail, emit a **volatile** UNKNOWN to wake watchers, keep the lock, and report cleanup uncertainty;
  do not claim the UNKNOWN was durably saved.

Windows termination requires successful `taskkill /T /F` while the owned ACP parent exists. An already
exited parent or nonzero taskkill does not prove its descendants stopped and makes cleanup uncertain.
The known `--version` command may exit normally; its bounded runner still kills the tree on timeout/error.
POSIX uses the owned process group. Neither path contains deliberately detached/breakaway descendants.
Retained state/locks need operator inspection; do not delete a lock merely to make a retry pass.

## Validation scope

`pnpm check` runs both DSH suites through the existing macOS/Windows × Node 22/24 CI.
`process.test.ts` covers ACP framing/lifecycle/failures. `adapter.test.ts` uses the same actual spawned
synthetic peer to cover persisted mapping, exact retries/conflicts, restart/resume, UNKNOWN recovery,
busy/cancel/default-deny, incomplete turns, deadlines, stale locks, capacity/corruption, I/O failure,
environment canaries and Gateway lifecycle. Its two-Gateway test uses owned loopback identities and
actual encrypted mesh transport, then checks output, exact retry execution count and in-flight cancellation.
The Windows-only factory test pins a **synthetic `.cmd` launcher**, including spaces, Chinese and `&`;
it validates quoting/version/hash/private-home wiring, not an installed DSH desktop.

Native Windows DSH fixed-response acceptance, causal permission marker positive control, actual restart
recovery and remote Mac MCP→Windows DSH are **not yet verified for this new adapter**.
Historical R3/R4 probe observations establish the dialect only; they do not transfer native verification
to this source. A dedicated committed native acceptance runner/evidence package is still needed.
DSH outbound MCP/tools, real models and GUI attachment remain separate unverified work.

The deferred physical #15 window is unchanged. Building or running these synthetic tests does not
start it, create a persistent listener, auto-confirm physical pairings, modify ACLs/firewalls, or access
the user's installed Harness configuration.
