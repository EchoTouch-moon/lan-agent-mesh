# DSH ACP process client — implementation foundation for LAM-18

This package implements the owned-process protocol portion of [LAM-18](https://github.com/EchoTouch-moon/lan-agent-mesh/issues/18).
It is **not yet a `HarnessAdapter`** and is not registered or exported by Gateway.
Native DSH execution, durable Gateway/native mapping, and remote Mac→Windows acceptance remain outstanding.

## Contract and evidence

`packages/dsh-adapter/src/index.ts` exports `DshAcpClient`. Its dialect is based on the previously committed
[Windows R3 fixture observations](evidence/windows/win-20261023T174935Z/)
and [R4 permission correction](evidence/windows/win-20261023T190428Z/).
Those historical reports cover their exact probe sources, **not this new client**.

The standard transport/prompt behavior was checked against the primary ACP v1 documentation:

- [Transports](https://agentclientprotocol.com/protocol/v1/transports): newline-delimited UTF-8 JSON-RPC over stdio.
- [Prompt turns](https://agentclientprotocol.com/protocol/v1/prompt-turn): streamed `session/update` notifications and terminal `session/prompt` reply.
- [Session setup](https://agentclientprotocol.com/protocol/v1/session-setup): `session/load` requires advertised support.

This implementation deliberately uses DSH's observed `session/resume` extension, not an inferred `session/load`.
Initialization pins ACP protocol 1 and agent `deepseek-harness-acp` version `0.0.1`.
This identifies the ACP agent; it does not independently verify the desktop distribution version.

## Implemented behavior

- Initialize before session operations; create and resume with `mcpServers: []`.
- Remember native session IDs within the client. A restarted client may explicitly resume a caller-supplied ID;
  this does not implement persistent Gateway session ownership or crash recovery.
- Preserve streamed text order; correctly decode UTF-8 characters split across OS reads.
  Ignore resume history and non-text/thought/tool updates rather than exposing them as new task output.
  End output attribution synchronously at the terminal reply, even if a late notification follows
  in the same OS read. The regression fixture reproduces the prior Promise-microtask ordering bug.
- One outstanding operation per native session. Separate known sessions can run concurrently.
- `prompt()` resolves only on the terminal native reply. It returns the native stop reason; the SDK adapter
  still needs to distinguish successful, cancelled and incomplete outcomes.
- `cancel()` sends one `session/cancel` notification. It does not synthesize a successful cancellation;
  the original prompt must return `cancelled`. Text may still arrive before that terminal reply.
- Permission requests for an active prompt select only `reject_once`. Missing rejection options,
  foreign sessions, initialization, and requests after cancellation get `cancelled`.
  No native allow option is selected. File/terminal/other client requests get method-not-supported.
- Never retain or forward native stderr or RPC error contents. Public failures expose a fixed code
  and an `ambiguous` flag. A lost prompt response, malformed stream or timeout poisons the connection;
  no request is automatically retried or reconstructed.
- Close is idempotent, rejects pending calls, and waits for the owned process to close.
  POSIX uses the dedicated process group. Windows invokes system `taskkill /T /F` while the parent exists.
  Termination failure rejects `close()`; it must not be interpreted as successful cleanup.

Bounds: 1 MiB inbound frame, 256 KiB queued writes, 32 pending RPCs, 100 tracked/reserved sessions,
32 KiB / 4096 text chunks per prompt, and 4096 distinct native request IDs per process.
Unexpected or duplicate response/request IDs fail closed. The native request-ID limit intentionally
requires a new owned process instead of unbounded retention.

## Ownership boundary

This is a **low-level process client**, not a safe default launcher for user installations.
The caller supplies an absolute executable, argv, absolute cwd and the complete child environment;
the transport never merges the parent environment and does not invoke a shell implicitly.
It does not create a private home, validate private-storage lineage, enforce workspace aliases,
pin executable hashes, restrict network access, or construct a Windows `.cmd` command line.
Do not wire it to production configuration before the adapter layer implements those requirements.

The next adapter layer must retain #47's Gateway ownership/lifecycle conventions, require a marked
private home with an exclusive lock, allow only a version-pinned desktop launcher and loopback model
fixture, sanitize the environment, map and persist Gateway/native sessions/tasks, enforce durable
idempotency, and turn ambiguous native execution into UNKNOWN without re-execution.
An unclean process exit does not prove all descendants stopped, especially on Windows; stale locks
must remain refused until explicit operator cleanup. POSIX groups and `taskkill` do not establish
containment against deliberately detached/breakaway descendants.

## Validation

Run `pnpm exec vitest run packages/dsh-adapter/test/process.test.ts` for the process contract tests,
or `pnpm check` for repository checks. The existing macOS/Windows × Node 22/24 CI runs these tests.
`test/agent-fixture.mjs` is an actual spawned **synthetic peer** with fixed messages and its own temporary
files. It never invokes DSH or a model. It covers restart/resume, text framing, out-of-order responses,
in-flight cancellation, late permission rejection, unknown methods, busy operations, bounded input,
malformed/oversized/invalid UTF-8 frames, unknown/conflicting replies, timeout, exit, error redaction,
pending-call capacity, and an owned descendant's termination. These are implementation regression
tests, not evidence that DSH's sandbox prevented a write. That native permission test still needs the
R4 positive-control method when the new adapter is exercised on Windows.

The separately deferred #15 physical Mock window is not started by building or testing this package.
No real Harness, GUI, user configuration, model credentials, ACL or firewall changes are needed here.
