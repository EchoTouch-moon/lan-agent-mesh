# DSH acceptance collector: committed synthetic run

Execution source: `60e6e8835469e29babc1840bab0b533200d7230d`, committed/pushed and clean before execution.
Exit 0; `passed-synthetic`; all fixture, SDK persistence, MCP stdio/encrypted-loopback, retry/cancel and
cleanup checks passed. The unmodified JSON includes source/build hashes and actual UTC timestamps;
its byte SHA-256 is recorded in `run-metadata.json`.

The shared collector made nine fixture requests, observed three genuinely held HTTP requests, selected
native-format reject_once in the synthetic ACP exchange, and removed the complete test root/parent.
The synthetic peer does not execute tools; its sandbox denial is simulated and its positive control
uses a Node file write. This is not installed Windows DSH permission evidence, a physical Mac↔Windows
run, a host network measurement, or a hard-crash experiment. No real model was configured.

Windows native execution is a separate [pinned-source task](../../../DSH_WINDOWS_ACCEPTANCE.md).
Exact-source CI reports and verdicts are linked on PR #54; no PR or issue is merged/closed by this archive.
