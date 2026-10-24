# Windows P1 validation (W1/W2)

Executed source: `d68fa6ac8eca1678745fb44813b27a1126d605a3` (branch `feat/p1-mesh-core`, PR #38 head), clean clone at a local path containing spaces, `git status` clean before every smoke run. Full `pnpm check` passed build/typecheck/lint and all 37 tests. Node v24.12.0, pnpm 10.18.3, Windows 10.0.22621 x64. See [run-metadata.json](run-metadata.json) for actual command exit codes, committed file hashes and local-original report/log hashes.

- [Independent processes](process-smoke.json): real TCP/Noise/Yamux loopback, two-sided confirmation, A→B and B→A exact Mock response, receiver process crash (hard kill) and restart with stable identity, UNKNOWN recovery without re-execution and graceful exit all passed on Windows.
- [Local multicast](mdns-smoke.json): two temporary peers discovered each other via actual mDNS multicast on local NICs; only identities/endpoints advertised; no Agent exported. Manual addressing remains an independently verified path via the explicit-address pairing exercised in the process smoke.
- [Data-directory containment and ACL](w2-isolation-acl.json): `control.json`, `identity.key` and the SQLite database (WAL/SHM active) stayed strictly inside each selected private directory; graceful `shutdown` exited 0 and released ports. Host-level ACL isolation could NOT be confirmed on this host: all checked placements (user temp, data-drive user directory, user profile) inherit entries granting other ordinary users at least read access, including `Everyone:Full` from host policy. Recorded as a constraint; nothing was modified, no elevation or firewall change.
- [W3 physical Mac↔Windows](w3-cross-host.json): **pending**. The hardware gate requires the user and both physical hosts in one coordinated window, including human comparison of the pairing code on both machines. Same-host Windows tests, W1 and W2 do not satisfy it.

Cleanup: every helper and CLI-started Gateway was stopped through its authenticated control endpoint or owned teardown; temporary directories were removed and ports released; nothing was left listening.

Result PR: this branch (see PR linked from Issue #15). Mac evidence in [mac-20261023T195045Z](../mac-20261023T195045Z/SUMMARY.md) is untouched. No real model, Harness, installer, system service, GUI, firewall rule or user configuration was involved, and no parent issue/PR was merged or closed.
