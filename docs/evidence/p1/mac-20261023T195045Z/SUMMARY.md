# Mac P1 validation

Executed source: 4714ed9e5ba835208b51ba79d994451ed1931520, committed and clean before formal smoke capture. Full pnpm check passed build/typecheck/lint and all 36 tests. See run-metadata.json for actual committed file hashes and original local report/log hashes.

- [Independent processes](process-smoke.json): real TCP/Noise/Yamux, two-sided confirmation, A→B and B→A exact Mock response, receiver process crash/restart, stable identity, UNKNOWN without re-execution and graceful exit all passed.
- [Local multicast](mdns-smoke.json): both temporary Mac peers discovered each other; only identities/endpoints advertised; no Agent exported.
- Contract/integration tests cover durable SQLite rollback/reopen/recovery, conflicting keys, unpaired/forged identity/session requests, code expiry, plaintext and oversized encrypted frames, revocation/rotation, busy sessions/cancel, lost-ACK retransmission, default deny, IPC auth, cache stale/change and startup conflicts.

These tests do not prove physical Mac↔Windows interoperability or real Harness integration. [Windows handoff](../../../P1_WINDOWS_TASKS.md) is separate and awaits the user's later execution. No real model, existing GUI, user configuration, elevated service, installer or firewall change was involved.
