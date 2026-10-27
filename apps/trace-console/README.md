# LAM Trace Console (OBS-0 V0, read-only)

A loopback-only web console that shows what the local Gateway can **legitimately
observe** about Mac↔Windows agent-to-agent calls: who initiated a task, which
peer received it, its state transitions (`QUEUED / RUNNING / WAITING_INPUT /
COMPLETED / FAILED / CANCELLED / UNKNOWN`), streamed delta text, permission
requests (deny-only) and terminal outcomes — in cursor order, from real Gateway
data, with explicit `NOT-OBSERVABLE` boundaries where no data exists.

It is an **observer only**. It cannot approve, pair, spawn, send, cancel, retry
or shut anything down, and it never sees the admin token.

## Run

```bash
pnpm build
# The Gateway must already be running and own <private-dir>/control.json:
node apps/trace-console/dist/index.js --data <gateway-private-directory>
```

Output:

```json
{
  "ready": true,
  "listen": "127.0.0.1:<port>",
  "loginUrl": "http://127.0.0.1:<port>/?t=<one-time-token>",
  "note": "Open the login URL in a local browser once; the token works exactly once."
}
```

Open `loginUrl` in a local browser. The one-time token is exchanged for a
`SameSite=Strict` session cookie (deleted when the window closes); the token is
then revoked. If the Gateway restarts and rotates its control token, press
**Re-attach Gateway** in the header.

## What you can watch

- **Nodes**: local node identity/fingerprint/addresses and the selected receiver
  peer side by side, with the arrow showing call direction.
- **Watched tasks**: paste a `taskId` (the caller/MCP side knows it) plus the
  receiver peerId. Auto-discovery only covers tasks **still awaiting an ACK in
  the local outbox** — a task the peer accepts quickly is usually gone from the
  outbox before the next 800 ms sample, so manual entry remains the primary
  path; V0 is not zero-touch full-chain tracing. Per-task polling is
  serialized (one in-flight request per task, stale responses dropped by
  generation, cursor-regressing pages refused), capped at 64 watched tasks and
  16 task queries per 800 ms cycle (adding a task triggers one immediate
  out-of-budget poll).
- **Timeline** per task: `seq / state / type / observed-at / preview` with text
  filter, type filter, pause-auto-scroll and **Export redacted JSON**.
- Task states, `WAITING_INPUT` permission events (Gateway policy is
  `deny-only`), `CANCELLED` only after the terminal event (a cancel *request*
  alone is not a terminal state), and honest `UNKNOWN`.

## Observability boundaries (by design, not gaps to "fix" silently)

- **Caller-side events only.** The Gateway exposes `events` for tasks this node
  *initiated*, read back over the encrypted mesh from the owning peer. Tasks
  **received** by this node (e.g. Windows→Mac calls) are `NOT-OBSERVABLE` from
  this page; run a second trace console on the Windows node for that side.
- **No invented data.** Native tool internals, the receiver's private
  reasoning, prompts of other harnesses and non-Mesh tool calls are never
  shown. Task events carry no embedded timestamp: the timeline shows the
  console's *observed-at* time plus the stable event sequence.
- **Sessions** are persisted by the node that owns the agent (the receiver);
  a caller-side Gateway legitimately has none. `nativeSessionId` is redacted
  server-side and never leaves the process.
- **Cross-grant invisibility**: asking about a task owned by an unpaired peer
  returns `notObservable`, exactly as the Gateway refuses it.

## Security model

| Property | Enforcement |
| --- | --- |
| Loopback only | Server binds `127.0.0.1`; Gateway control endpoint re-validated as `http://127.0.0.1:<port>` |
| Admin token confinement | Read once from `control.json` under a `privateFile` lease; never sent to the browser, a URL, a log line or an export |
| Browser auth | One-time 32-byte login token → `HttpOnly` + `SameSite=Strict` session cookie, ≤16 sessions, 12 h TTL, destroyed on process exit |
| CSRF | Double-submit: non-HttpOnly `lam_trace_csrf` cookie must be echoed in `X-LAM-CSRF` (used by `POST /api/reconnect`) |
| Origin / Host | `Origin` (if present) must equal the loopback origin; `Host` must name this listener (DNS-rebinding defence) |
| Read-only whitelist | Server proxies exactly `status, peers, sessions, diagnostics, events, outbox, pairings`; there is no route that can reach `pair/confirm/spawn/send/cancel/retry/shutdown/mcp-grant/revoke` |
| XSS | Static HTML (zero interpolation), `script-src 'self'` CSP, `nosniff`, all rendering via `textContent`; task text is inert JSON data |
| Redaction | Field whitelist per event type + text redaction of credential-shaped strings, long hex tokens, non-loopback IPs and private absolute paths; exports are redacted the same way |

## Tests

`apps/trace-console/test/`

- `redact.test.ts` — redaction units (credentials, IPs, paths, native IDs,
  dropped-field reporting).
- `e2e.test.ts` — real caller + receiver Gateways over loopback TCP/Noise with
  the mock adapter: one-time login, real status/peers/diagnostics, cursor-
  ordered event drain to `COMPLETED`, `CANCELLED` (cancel request vs terminal),
  `UNKNOWN` (injected disconnect), permission→deny-only `FAILED`, cross-grant
  invisibility, local-receiver `NOT-OBSERVABLE`, unreachable-Gateway honesty,
  token rotation + re-attach, and the negative matrix (401/403/404/405, Origin,
  Host, CSRF, invalid identifiers, hostile text as inert JSON, token
  confinement in every response).

## Non-goals

Approval UI (P3), cross-host global tracing, reading harness-internal
reasoning, auto-approval of anything, new Gateway RPCs (V1 observation schema
is a separate reviewed change to `packages/runtime`).
