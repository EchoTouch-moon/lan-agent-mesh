# Repository instructions for AI coding agents

Read **in this order** before any change:
1. `docs/adr/0004-standards-first-agent-interop.md` (non-negotiable design and security boundary)
2. `docs/INTEROP_REBASELINE_2026-10-26.md` (new roadmap and task dependencies)
3. `docs/LLM_WORK_PACKETS.md` (claim/result contracts and STOP rules)
4. `docs/research/INTEROP_LANDSCAPE_2026-10-26.md` and `docs/research/INTEROP_EVALUATION.md`
5. For native work: `docs/NEXT_PHASE_2026-10-26.md`, linked #15/#17/#18/#19 Issues.

Current code baseline contains merged #63 fixture adapters. Do not assume legacy documents saying "PR not merged" are current. The core trust model is retained: local-first pairing, Noise/Yamux, private storage, native permission default deny, durable idempotency, UNKNOWN never automatically re-executes.

For A2A, implement an OPTIONAL disabled-by-default scoped bridge using a verified pinned official SDK after R0; **do not** replace internal protocols or add default public listeners. MCP official SDK v2.4.0 is already present. For external projects, verify upstream tag/commit, license, dependencies, OS, security and APIs before adoption.

Always work from clean committed source, write negative tests, run `pnpm check` and record actual SHA + exit codes + evidence level. Preserve known failures and uncertainty. No real models, existing GUI, inherited user credentials, firewall/ACL changes, privilege escalation, unapproved physical LAN windows, or automatic PR merges/Issue closure.
