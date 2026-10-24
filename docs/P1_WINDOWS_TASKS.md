# P1 Windows work pack (deferred by the user)

The user asked to complete Mac-local work first and handle Windows after waking. Do not start this pack automatically. These are validation/integration tasks, not permission to install real Harnesses, change firewall rules, run as administrator or touch existing user configuration. No real model or GUI is needed.

## Claim and source

Read Issue #15 and its latest PR link before claiming. Clone/fetch the P1 PR branch `feat/p1-mesh-core`; record the actual full SHA and clean `git status`. All required scripts must already be committed before running. If changes are needed, commit them first and record the new SHA. Do not overwrite prior evidence. Use `docs/evidence/p1/windows/<run-id>/` for sanitized results, open an independent PR against the P1 implementation branch, and link the result to #15. Do not merge/close parent issues. Original reports remain local with SHA-256 recorded in metadata.

## W1 — Windows runtime and deterministic local sockets

Use a non-shared current-user directory, Node 22.13+ or 24 and pinned pnpm 10.18.3. No native compiler/addon or external SQLite install is required. In a clean clone, including a path with spaces:

```powershell
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm check
node scripts/p1-process-smoke.mjs --output "$env:TEMP/lam-p1-process-win.json"
```

Record every command exit code, actual source SHA, OS/Node/pnpm versions, 36+ test results and the process report. The report's `testedSourceSha` must equal the executed source and `sourceState` must be clean committed source. An uncommitted exploratory run is not final evidence. The helper owns all child processes/temporary directories and cleans them. It does not kill process names or unrelated processes. Check process-level pairing, both directions, identity continuity, crash recovery without replay and graceful exit; failures are valid evidence and must not be manually edited to pass.

## W2 — discovery, isolation and filesystem behavior

```powershell
node scripts/p1-mdns-smoke.mjs --output "$env:TEMP/lam-p1-mdns-win.json"
```

This briefly enables two temporary LAN listeners and multicast announcements carrying only peer identity/endpoints, with zero exported agents. An inconclusive multicast result is not a success: record VPN/NIC/firewall constraints without changing them. Keep manual addressing as an independently tested fallback. Confirm control.json and identity.key stay inside the private test directory and its ACL does not grant other ordinary users access; do not include token/key contents or machine paths in reports. Verify Node SQLite WAL opens/reopens and process-kill stale-lock recovery through W1. Do not grant ACLs or elevate on failure.

## W3 — actual Mac↔Windows integration (requires the user and both hosts)

This is the LAM-15 hardware gate. Same-host Windows/macOS CI cannot satisfy it. Coordinate one short test window with the user; do not leave a Mac Gateway listening while waiting overnight. On each machine create a fresh private test data directory and start:

```text
node apps/gateway/dist/index.js serve --data <test-directory> --listen /ip4/0.0.0.0/tcp/48731 --mdns --mock
```

Use an available port if occupied; do not stop another process. If multicast is blocked, exchange the selected machine's LAN `host:port` and expected peer ID. Never send control.json or tokens to the other host. Inspect local authenticated state via:

```text
node apps/gateway/dist/index.js control --data <test-directory> --command status
```

For commands with JSON arguments, write an owned UTF-8 JSON file and use `--args-file <file>` to avoid PowerShell 5 native quoting problems. The local CLI reads only the explicitly selected file and that Gateway's own control.json. Commands:

1. On caller: `pair`, args `{ "address": "<other-host>:48731", "expectedPeer": "<peer-id>" }`.
2. On other host: `pairings`. Compare the full displayed code independently on both machines, then run `confirm` locally on each, args `{ "id": "<pair-session>", "code": "<compared-code>" }`. Merely receiving a peer's message is not human confirmation.
3. `registry`, args `{ "peer": "<peer-id>" }`. `spawn`, args `{ "peer":"...", "agentId":"<exported-agent-id>", "workspaceAlias":"project-a" }`.
4. Save the returned session object. `send`, args `{ "peer":"...", "session":<session-object>, "text":"cross-host fixture" }`. Poll `events` with taskId/cursor until the terminal state and remaining events are read. Expect COMPLETED and exact `mock:cross-host fixture` text. Repeat with caller/receiver reversed.
5. Repeat original task using the original key, taskId and deadline, or use durable `outbox`/`retry` for an unacknowledged original envelope. Confirm receiver diagnostics has one logical task. Do not create a new key to claim idempotency.
6. Resume the same session within the running Mock process; ensure original nativeSessionId. For receiver process restart, Mock native state is intentionally gone: persisted mapping remains, resume must fail instead of silently spawning a new context. Pending execution recovers UNKNOWN and is not rerun.
7. `revoke`, args `{ "peer":"..." }`; verify registry/task requests are rejected and cached cards are unavailable. Wrong peer ID and pre-pair requests must fail. Never test approvals by granting allow.
8. `shutdown` on each local control endpoint; verify exit and port release. No test listener is left behind.

Capture sanitized paired-peer/version/source identifiers, observed direction, result/state, per-step exit code and timestamps. Preserve the original local report's hash without publishing private IPs, user paths, tokens or keys. Failure/unknown must identify which host/step and whether the manual route was also tried. Do not upgrade dependencies or weaken trust/replay checks to force a pass.

## Returned deliverables

- run-metadata.json: full execution SHA, script SHA-256, versions, times, exit codes, evidence filenames and local-original hashes.
- W1 and W2 reports; W3 report separately marked pending if both physical hosts were not available.
- SUMMARY.md: tested versus unknown/pending, limitations, cleanup and PR link.

The Mac P1 PR can be reviewed without W3, but #8/#9/#15 cross-platform/hardware acceptance remains pending until the corresponding evidence exists. Do not call the whole P1 phase accepted on the basis of same-host tests.
