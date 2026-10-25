# Windows DSH Adapter native acceptance task (LAM-18)

This is a **single Windows host** task. It does not open the deferred physical Mac↔Windows window,
reuse its trust/identities, attach a GUI, invoke a real model, or change host ACLs, PATH or firewall rules.
Only the desktop's previously verified bundled headless `dsh.cmd` is eligible; the standalone CLI 0.1.1 is not.
Do not install/update anything to make the task pass.

The runner combines #53's adapter and #51's late-ACK fix (and their #47/#50/#52 prerequisites).
The CLI requires both fixed ancestor commits, a clean repository and the exact reviewed execution SHA.
Use a fresh checkout of the **full SHA published in #18 after CI**, not main or an older probe source.
Keep full history (`git clone`, not a shallow checkout) so ancestry can be verified. No PR is merged by running it.

## Before native execution

1. Claim this task on #18. Record host platform, Node/pnpm versions, full execution SHA and clean-source status.
2. Install/build from that clean source with `pnpm install --frozen-lockfile`, then `pnpm build` and `pnpm typecheck`.
   Do not run with modified source; make and push a separate fix commit before rerunning if necessary.
3. Select the **previously verified installed desktop launcher** by its full canonical path. Hash only that program file
   with `Get-FileHash -Algorithm SHA256`; do not read user settings. Version 0.2.1-rc.2 and ACP agent 0.0.1 are checked again inside an isolated owned home.
4. Reuse the operator-managed exclusive parent from G2 (`C:\lam-private-parent`, if still available and unchanged).
   Native private-storage verification checks its complete lineage. If rejected, report blocked; do not widen the checker,
   change existing directory ACLs, elevate, or substitute the broad default TEMP.

PowerShell command template (replace the source/launcher from reviewed/local records; do not publish its private path):

```powershell
$source = '<reviewed full 40-character SHA from issue 18>'
$launcher = (Resolve-Path -LiteralPath $env:LAM_DSH_DESKTOP_CMD).Path
$launcherHash = (Get-FileHash -LiteralPath $launcher -Algorithm SHA256).Hash.ToLowerInvariant()
$parent = 'C:\lam-private-parent'
$output = Join-Path $parent ('dsh-adapter-native-' + (Get-Date -Format 'yyyyMMddTHHmmss') + '.json')
node packages/dsh-adapter/dist/smoke.js --expected-source $source --parent $parent --launcher $launcher --launcher-sha256 $launcherHash --output $output
$probeExit = $LASTEXITCODE
Get-FileHash -LiteralPath $output -Algorithm SHA256
```

If `LAM_DSH_DESKTOP_CMD` is not set, use the local path already established in the historical Windows evidence.
Do not discover a different product by launching arbitrary candidates. The output must be a **new absolute file
outside the repository and outside the temporary owned child directory**; it is never overwritten.
The runner uses a fresh private child named `lam-dsh-acceptance-*`, and a fresh loopback fixture endpoint.
Ctrl+C requests cleanup; let it finish (native startup calls are bounded, so this can take up to their timeout).

## What must pass

- Actual native send plus ordered streamed text exactly matches the fixed Messages SSE fixture. An identical task
  retry adds no fixture inference request, while changed input conflicts.
- Close/reopen the owned ACP process, explicitly resume the same persisted native session, and send again.
  Original completed retries still return the same task without another model request.
- For permissions, the runner's own PowerShell first writes/removes a control marker with the same Set-Content
  command template. Then a fixture tool call first encounters the native read-only sandbox denial; a second
  request asks workspace-write and the ACP client selects `reject_once`. The denied target marker must not exist.
  All four causal conditions are required, plus two fixture permission stages and advertised `pwsh`.
- Cancel only after the held HTTP inference request is observed; the original pending native prompt must return cancelled.
  Concurrent work on that session must remain busy.
- Close while a second held request is in flight, persist UNKNOWN, reopen, and retry the exact original request.
  UNKNOWN remains UNKNOWN, with no further inference; new work/resume on that session stays busy.
  This checks shutdown/restart uncertainty, **not a hardware crash or a SIGKILL recovery claim**.
- Real MCP SDK stdio process → scoped local Gateway → encrypted loopback peer → installed DSH adapter → exact
  result. Verify the seven-tool boundary, one logical task on exact retry, held delegate cancellation and revoked credentials.
  Both identities are new test-owned loopback nodes, so only they are automatically confirmed.
- Stop all owned clients/Gateways/ACP processes, close the fixture listener, remove temporary credentials/state,
  and report root removal. Keep state/locks for inspection if cleanup or initialization cannot be proved.

## Evidence and interpretation

The report includes the tested source SHA, source hashes, actual built JS/DLL hashes, launcher hash,
UTC start/end, phase and bounded sanitized observations. It contains no raw prompts/tool transcripts,
user paths, physical addresses, pairing codes, control tokens or credentials. Failed stages are retained;
do not rewrite them into success. Only `passed-windows-native-local` with complete cleanup and exit 0 qualifies
as this local native run. Even that does **not** complete #18's physical Mac MCP→Windows acceptance.

The runner sets only a fixed fake model key and the owned loopback base URL. It does not monitor all host network
traffic, so the report explicitly does not claim a measured zero external-call count. It never proxies requests.

Post source/versions, actual command exit code, report SHA-256, result summary and a PR with the unedited sanitized
JSON to #18. Do not publish the launcher/parent path. Preserve failed/blocked runs and local private data if asked
by the runner; do not delete an adapter lock to force a second process to start. No task/PR is closed or merged.

## Synthetic self-test and CI

```text
node packages/dsh-adapter/dist/smoke.js --self-test --expected-source <full-current-committed-SHA> --output <new-absolute-report-file>
```

This uses an actual spawned synthetic ACP peer, real loopback HTTP/SSE, private SQLite, encrypted Gateways and
MCP stdio. The peer simulates sandbox denial and executes no tool. Its positive control uses Node filesystem
writes instead of PowerShell, and the report must say `passed-synthetic`, `evidenceKind: synthetic`, and
`simulatedSandbox: true`. It can validate runner mechanics, never installed DSH or real permission enforcement.
Self-test can make its own exclusive parent on a safe temp lineage; Windows may need `--parent` if its TEMP is broad.
CI runs this on macOS/Windows × Node 22/24 and saves sanitized reports. Self-test refuses native launcher flags.
