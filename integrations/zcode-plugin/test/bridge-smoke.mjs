#!/usr/bin/env node
// ZPL-1 bridge smoke: local fixture gateways -> real scoped credential -> plugin bridge -> MCP client.
// Loopback only; no real models, no LAN, no user config. Negative paths fail-closed before spawn.
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

// Resolve workspace packages explicitly: this directory is not itself a workspace package.
const requireFromMcpServer = createRequire(resolve('packages/mcp-server/package.json'));
const { Client } = requireFromMcpServer('@modelcontextprotocol/client');
const { StdioClientTransport } = requireFromMcpServer('@modelcontextprotocol/client/stdio');
const { Gateway } = await import(pathToFileURL(resolve('packages/runtime/dist/index.js')));
const { privateDirectory } = await import(pathToFileURL(resolve('packages/private-storage/dist/index.js')));

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bridge = join(pluginRoot, 'bridge', 'mesh-bridge.mjs');
const pins = JSON.parse(readFileSync(join(pluginRoot, 'digests.json'), 'utf8'));
const report = {
  kind: 'zcode-plugin bridge smoke (loopback fixture gateways, real scoped credential)',
  testedSourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: pluginRoot }).trim(),
  platform: process.platform,
  node: process.version,
  startedUtc: new Date().toISOString(),
  results: {},
  externalModels: 0,
  cleanup: 'pending',
};
const roots = [];
const gateways = [];
let failed = 0;
const check = (name, ok, detail = '') => {
  report.results[name] = ok ? 'PASS' : `FAIL ${detail}`.trim();
  if (!ok) failed++;
};
try {
  const parent = process.env.LAM_SMOKE_PARENT ?? tmpdir();
  const root = join(parent, `LAM zpl1 bridge & ${randomUUID()}`);
  roots.push(root);
  const lease = await privateDirectory(root, { create: true });
  await lease.close();

  const caller = await new Gateway({ directory: join(root, 'caller') }).start();
  gateways.push(caller);
  // A short mock delay keeps tasks RUNNING long enough for a cancel to land mid-flight.
  const executor = await new Gateway({ directory: join(root, 'executor'), mock: true, scenario: { delayMs: 200 } }).start();
  gateways.push(executor);
  const pair = await caller.mesh.beginPairing(executor.mesh.addresses[0]);
  await caller.mesh.confirmPairing(pair.id, pair.code);
  await executor.mesh.confirmPairing(pair.id, pair.code);
  const registry = await caller.sync(executor.mesh.id);
  const scopeFile = join(root, 'scope.json');
  writeFileSync(scopeFile, JSON.stringify({ peers: [executor.mesh.id], agents: [registry.agents[0].id], workspaces: ['project-a'] }), { mode: 0o600 });
  const credentialFile = join(root, 'credential.json');
  try {
    // The gateway's loopback control server lives in this process; keep the event loop free (async exec), or the grant request deadlocks.
    await run(process.execPath, [resolve('apps/gateway/dist/index.js'), 'control', '--data', caller.options.directory, '--command', 'mcp-grant', '--args-file', scopeFile, '--output', credentialFile]);
  } catch (error) {
    failed++;
    report.failure = `mcp-grant: ${String(error.stderr ?? error.message).slice(0, 400)}`;
    throw new Error('grant_failed');
  }
  check('credential-issued-via-operator-cli', true);

  const connect = (args) => {
    const transport = new StdioClientTransport({ command: process.execPath, args, stderr: 'pipe' });
    const client = new Client({ name: 'zpl1-bridge-smoke', version: '0.1.0' });
    return { transport, client };
  };

  // Negative: missing lam root fails closed without spawning the MCP server.
  {
    const { transport, client } = connect([bridge, '--lam-root', join(root, 'no-such-lam'), '--credentials', credentialFile]);
    let stderr = '';
    transport.stderr?.on('data', (b) => { stderr += String(b); });
    try { await client.connect(transport); check('missing-lam-root-fails-closed', false, 'connect unexpectedly succeeded'); await client.close(); }
    catch { check('missing-lam-root-fails-closed', /LAM MCP server not built|missing/.test(stderr), stderr.trim().split('\n')[0]); }
  }

  // Negative: tampered digest refuses to run the real CLI.
  {
    const tamperedRoot = join(root, 'plugin-copy');
    cpSync(pluginRoot, tamperedRoot, { recursive: true });
    const badPins = join(tamperedRoot, 'digests.json');
    writeFileSync(badPins, JSON.stringify({ ...pins, mcpCliSha256: '0'.repeat(64) }));
    const { transport, client } = connect([join(tamperedRoot, 'bridge', 'mesh-bridge.mjs'), '--lam-root', resolve('.'), '--credentials', credentialFile]);
    let stderr = '';
    transport.stderr?.on('data', (b) => { stderr += String(b); });
    try { await client.connect(transport); check('digest-mismatch-fails-closed', false, 'connect unexpectedly succeeded'); await client.close(); }
    catch { check('digest-mismatch-fails-closed', /digest mismatch/.test(stderr), stderr.trim().split('\n')[0]); }
  }

  // Positive: the plugin bridge serves the seven mesh_* tools over the real credential,
  // and the command docs' async contract matches the actual SDK behavior.
  {
    const { transport, client } = connect([bridge, '--lam-root', resolve('.'), '--credentials', credentialFile]);
    const delay = (ms) => new Promise((accept) => setTimeout(accept, ms));
    const call = async (name, args) => {
      const result = await client.callTool({ name, arguments: args });
      return { isError: result.isError === true, ...(result.structuredContent ?? {}) };
    };
    const pollTerminal = async (taskId) => {
      let cursor = 0;
      const events = [];
      let state = 'QUEUED';
      for (let i = 0; i < 80; i++) {
        const task = await call('mesh_get_task', { taskId, cursor });
        state = task.state;
        if (task.events?.length) events.push({ cursor, type: task.events[0].type });
        if (task.next === cursor) break;
        cursor = task.next;
        await delay(450);
      }
      return { state, events, cursors: events.map((e) => e.cursor) };
    };
    try {
      await client.connect(transport);
      const tools = (await client.listTools()).tools.map((t) => t.name).sort();
      check('bridge-serves-seven-mesh-tools', tools.length === 7 && tools.every((n) => n.startsWith('mesh_')), tools.join(','));

      const agent = (await call('mesh_list_agents', {})).agents[0];
      check('mesh-list-agents-over-bridge', Boolean(agent?.id && agent?.nodeId && agent?.workspaceAliases?.length), JSON.stringify(agent).slice(0, 120));

      const startRequest = randomUUID();
      const started = await call('mesh_start_session', { peerId: agent.nodeId, agentId: agent.id, workspaceAlias: agent.workspaceAliases[0], requestId: startRequest });
      check('start-session-contract', !started.isError && typeof started.sessionId === 'string' && started.sessionId.length > 0, JSON.stringify(started).slice(0, 120));
      const restart = await call('mesh_start_session', { peerId: agent.nodeId, agentId: agent.id, workspaceAlias: agent.workspaceAliases[0], requestId: startRequest });
      check('same-requestid-start-is-idempotent', !restart.isError && restart.sessionId === started.sessionId);

      const taskRequest = randomUUID();
      const submitted = await call('mesh_delegate_task', { sessionId: started.sessionId, text: 'zpl1 contract probe', requestId: taskRequest, timeoutSeconds: 30 });
      check(
        'delegate-returns-submission-not-result',
        !submitted.isError && typeof submitted.taskId === 'string' && typeof submitted.delivery === 'string' && typeof submitted.deadline === 'string' && !('result' in submitted) && !('state' in submitted) && !('events' in submitted),
        JSON.stringify(submitted).slice(0, 160),
      );
      const resubmitted = await call('mesh_delegate_task', { sessionId: started.sessionId, text: 'zpl1 contract probe', requestId: taskRequest, timeoutSeconds: 30 });
      check('same-requestid-retry-returns-same-task', !resubmitted.isError && resubmitted.taskId === submitted.taskId);

      // Same cursor returns the same event forever — the documented pitfall mesh-watch/mesh-delegate must avoid.
      const first = await call('mesh_get_task', { taskId: submitted.taskId, cursor: 0 });
      const sameAgain = await call('mesh_get_task', { taskId: submitted.taskId, cursor: 0 });
      check('same-cursor-replays-same-event', JSON.stringify(first.events) === JSON.stringify(sameAgain.events) && first.state === sameAgain.state);

      const outcome = await pollTerminal(submitted.taskId);
      const monotonic = outcome.cursors.every((c, i) => i === 0 || c > outcome.cursors[i - 1]);
      check(
        'get-task-cursor-advances-to-terminal-drain',
        ['COMPLETED', 'FAILED', 'CANCELLED'].includes(outcome.state) && monotonic && outcome.events.some((e) => e.type === 'started') && outcome.events.some((e) => ['completed', 'failed', 'cancelled'].includes(e.type)),
        JSON.stringify(outcome).slice(0, 200),
      );

      const cancelRequest = randomUUID();
      const cancellable = await call('mesh_delegate_task', { sessionId: started.sessionId, text: 'zpl1 cancel probe', requestId: cancelRequest, timeoutSeconds: 30 });
      const cancelled = await call('mesh_cancel_task', { taskId: cancellable.taskId });
      check('cancel-returns-delivery-ack-only', !cancelled.isError && cancelled.cancelRequested === true && !('state' in cancelled) && !('terminal' in cancelled), JSON.stringify(cancelled).slice(0, 120));
      const cancelOutcome = await pollTerminal(cancellable.taskId);
      check('after-cancel-poll-to-terminal', ['CANCELLED', 'COMPLETED'].includes(cancelOutcome.state), `terminal=${cancelOutcome.state}`);
      report.cancelTerminal = cancelOutcome.state;

      await client.close();
    } catch (error) {
      check('bridge-serves-seven-mesh-tools', false, String(error).slice(0, 160));
    }
    // Owned-process discipline: after close, no bridge/cli child of this run may remain.
    {
      const marker = root.slice(0, -1);
      let residue = -1;
      for (let i = 0; i < 10 && residue !== 0; i++) {
        await delay(500);
        const { stdout } = await run(
          resolve(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
          ['-NoProfile', '-NonInteractive', '-Command', `@(Get-CimInstance Win32_Process | Where-Object { $_.Name -notlike '*powershell*' -and $_.CommandLine -like '*${marker.replace(/\\/g, '\\\\').replace(/'/g, "''")}*' }).Count`],
          { encoding: 'utf8' },
        );
        residue = Number(stdout.trim());
      }
      check('owned-bridge-children-exited-after-close', residue === 0, `residue=${residue}`);
    }
  }

  report.cleanup = 'complete';
} catch (error) {
  failed++;
  report.cleanup = 'partial';
  report.failure = report.failure ?? String(error).slice(0, 300);
} finally {
  for (const g of gateways.splice(0)) await g.stop();
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
report.endedUtc = new Date().toISOString();
report.status = failed === 0 ? 'passed' : 'failed';
console.log(JSON.stringify(report, null, 2));
process.exit(failed === 0 ? 0 : 1);
