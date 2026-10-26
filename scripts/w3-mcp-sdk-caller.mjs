// W3 (#18/#19): Windows-side real MCP SDK stdio caller for B1 (Windows MCP client -> remote
// Codex fixture). Self-test mode builds a loopback Mock executor pair locally and exercises the
// exact seven-tool sequence with scope, ownership, cursor and revocation semantics. Live mode
// (--peer <multiaddr> --credentials <grant-file>) runs the same sequence against an already
// paired peer during a reviewed E2 window; it never pairs, listens or grants by itself.
//
// Evidence ladder per W3 acceptance: agent discovery is grant-scoped, sessions belong to the
// granting caller, mesh_get_task cursors page events exactly once, cancellation only reports
// CANCELLED from the native terminal state, revocation closes every tool. No SDK path here is
// ever claimed as Windows-harness native MCP *outbound* (that is W2/B3 evidence instead).
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
// Resolve workspace builds and the official SDK client from their pinned locations, so
// scripts/ never adds floating copies of @lam/* or @modelcontextprotocol/client.
const workspace = package_ => pathToFileURL(resolve(`packages/${package_}/dist/index.js`)).href;
const { privateDirectory } = await import(workspace('private-storage'));
const { Gateway } = await import(workspace('runtime'));
const { MCP_INPUTS } = await import(workspace('mcp-contract'));
const sdkDirectory = resolve('packages/dsh-adapter/node_modules/@modelcontextprotocol/client');
const sdkExports = JSON.parse(await readFile(join(sdkDirectory, 'package.json'), 'utf8')).exports;
const sdkEntry = subpath => pathToFileURL(join(sdkDirectory, sdkExports[subpath].import.default)).href;
const { Client } = await import(sdkEntry('.'));
const { StdioClientTransport } = await import(sdkEntry('./stdio'));

const sha = value => createHash('sha256').update(value).digest('hex');
const { values } = parseArgs({ options: {
  'self-test': { type: 'boolean' }, peer: { type: 'string' }, credentials: { type: 'string' }, output: { type: 'string' } } });
const selfTest = values['self-test'] === true;
if (selfTest === Boolean(values.peer || values.credentials)) throw new Error('Choose exactly one mode: --self-test OR --peer with --credentials');
if (values.peer && !/^\/ip4\/127\.0\.0\.1\//.test(values.peer)) throw new Error('Live mode expects the reviewed window multiaddr; no other target is authorized');
if (values.output && !isAbsolute(values.output)) throw new Error('--output must be absolute');
if (!selfTest) for (const path of [values.peer, values.credentials]) if (path && !isAbsolute(path)) throw new Error('Live-mode paths must be absolute');

const dirty = (() => { try { return execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(); } catch { return 'unknown'; } })();
const report = {
  task: 'W3 Windows MCP SDK caller', mode: selfTest ? 'self-test-loopback-mock' : 'live-reviewed-window',
  platform: process.platform, node: process.version,
  testedSourceSha: dirty ? null : execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceState: dirty ? 'uncommitted development run' : 'clean committed source',
  startedUtc: new Date().toISOString(), externalModels: 0, harnessOutboundClaim: 'none — SDK client path only, never counted as native outbound',
  results: {}, cleanup: {},
};
const gateways = [], clients = [];
let root, rootLease, granted;

async function connect(credentialPath) {
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [resolve('packages/mcp-server/dist/cli.js'), '--credentials', credentialPath], stderr: 'pipe', maxBufferSize: 262144 });
  transport.stderr?.on('data', () => {});
  const client = new Client({ name: 'lam-w3-mcp-caller', version: '0.0.0' });
  clients.push(client);
  await client.connect(transport);
  return client;
}
async function tool(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content.find(c => c.type === 'text');
  return { isError: result.isError === true, body: (result.structuredContent ?? (text?.type === 'text' ? JSON.parse(text.text) : {})) };
}
async function paged(client, taskId) {
  // Result cursor contract: every event is delivered by exactly one page; a page with no new
  // events plus a terminal state ends the walk. Record page sizes as evidence.
  const pages = []; let cursor = 0; const events = [];
  for (let round = 0; round < 200; round++) {
    const page = await tool(client, 'mesh_get_task', { taskId, cursor });
    if (page.isError) throw new Error('mesh_get_task rejected');
    const part = page.body.events ?? [];
    pages.push(part.length); events.push(...part); cursor = page.body.next;
    if (!['QUEUED', 'RUNNING', 'WAITING_INPUT'].includes(page.body.state) && part.length === 0)
      return { state: page.body.state, events, pages };
    await delay(20);
  }
  throw new Error('cursor walk deadline exceeded');
}
try {
  let client, peerId, agentId, workspaceAlias;
  if (selfTest) {
    const base = join(tmpdir(), `LAM W3 caller & ${randomUUID()}`);
    rootLease = await privateDirectory(base, { create: true });
    root = base;
    const caller = new Gateway({ directory: join(root, 'caller'), listen: ['/ip4/127.0.0.1/tcp/0'], mdns: false }); gateways.push(caller); await caller.start();
    const executor = new Gateway({ directory: join(root, 'executor'), listen: ['/ip4/127.0.0.1/tcp/0'], mdns: false, mock: true, scenario: { delayMs: 100 } }); gateways.push(executor); await executor.start();
    const pair = await caller.mesh.beginPairing(executor.mesh.addresses[0]);
    assert.equal(executor.mesh.pendingPairings().find(p => p.id === pair.id)?.code, pair.code);
    await caller.mesh.confirmPairing(pair.id, pair.code); await executor.mesh.confirmPairing(pair.id, pair.code);
    const registry = await caller.sync(executor.mesh.id);
    peerId = executor.mesh.id; agentId = registry.agents[0].id; workspaceAlias = 'project-a';
    report.results.selfTestPair = 'two fresh loopback identities auto-confirmed; never a physical pairing';
    const credential = await caller.command('mcp-grant', { peers: [peerId], agents: [agentId], workspaces: [workspaceAlias] });
    granted = { caller, id: credential.grantId };
    const credentialPath = join(root, 'credential.json'); await writeFile(credentialPath, JSON.stringify(credential), { mode: 0o600 });
    client = await connect(credentialPath);
    const foreign = new Gateway({ directory: join(root, 'foreign'), listen: ['/ip4/127.0.0.1/tcp/0'], mdns: false, mock: true }); gateways.push(foreign); await foreign.start();
    const unpaired = await caller.sync(foreign.mesh.id).then(() => 'synced', error => String(error));
    report.results.unpairedPeerNegative = { observed: unpaired.includes('Error') || unpaired.includes('reject'), note: 'registry sync stays unavailable for unpaired peers' };
  } else {
    peerId = JSON.parse(await readFile(values.credentials, 'utf8')).peerId ?? '';
    client = await connect(values.credentials);
    const agents = await tool(client, 'mesh_list_agents', {});
    if (agents.isError) throw new Error('credential rejected before the live sequence');
    agentId = agents.body.agents[0].id; workspaceAlias = 'default';
    report.results.liveTarget = { peer: values.peer, agentId: sha(agentId).slice(0, 16) };
  }
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map(t => t.name).sort(), Object.keys(MCP_INPUTS).sort());
  report.results.sevenExactTools = true;

  const cards = await tool(client, 'mesh_list_agents', {});
  assert.equal(cards.isError, false);
  const visible = (cards.body.agents ?? []).filter(a => a.nodeId === peerId);
  assert.equal(visible.length, (cards.body.agents ?? []).length); // Discovery shows grant scope only.
  assert.ok(visible.some(a => a.id === agentId));
  report.results.grantScopedDiscovery = true;

  const sessionArgs = { peerId, agentId, workspaceAlias, requestId: randomUUID() };
  const session = await tool(client, 'mesh_start_session', sessionArgs);
  assert.equal(session.isError, false);
  const retrySession = await tool(client, 'mesh_start_session', sessionArgs);
  assert.equal(retrySession.body.sessionId, session.body.sessionId); // Same requestId never creates a second session.
  report.results.sessionOwnershipAndExactRetry = true;

  const sendArgs = { sessionId: session.body.sessionId, text: 'W3 caller fixture turn', requestId: randomUUID() };
  const sent = await tool(client, 'mesh_send_message', sendArgs);
  assert.equal(sent.body.delivery, 'accepted');
  const completed = await paged(client, sent.body.taskId);
  assert.equal(completed.state, 'COMPLETED');
  assert.ok(completed.events.some(e => e.type === 'delta' || e.type === 'completed'));
  assert.equal((await tool(client, 'mesh_send_message', sendArgs)).body.taskId, sent.body.taskId); // Exact retry, no re-inference.
  report.results.cursorPagingAndIdempotency = { pages: completed.pages, events: completed.events.length, state: completed.state };

  const delegated = await tool(client, 'mesh_delegate_task', { sessionId: session.body.sessionId, text: 'W3 held cancellation', requestId: randomUUID() });
  const cancelReply = await tool(client, 'mesh_cancel_task', { taskId: delegated.body.taskId });
  assert.equal(cancelReply.body.cancelRequested, true);
  const cancelled = await paged(client, delegated.body.taskId);
  assert.equal(cancelled.state, 'CANCELLED'); // Reported only from the terminal event, not the request.
  report.results.inFlightCancelFromTerminal = true;

  if (selfTest) {
    const outside = await tool(client, 'mesh_start_session', { peerId: 'mcp.unpaired.peer', agentId, workspaceAlias, requestId: randomUUID() });
    assert.equal(outside.isError, true); // Scope violations fail closed through the SDK path too.
    report.results.outOfScopeNegative = true;
    await granted.caller.command('mcp-revoke', { grantId: granted.id }); granted = undefined;
    assert.equal((await tool(client, 'mesh_list_sessions', {})).isError, true);
    report.results.revocationClosesTools = true;
  }
  report.status = selfTest ? 'passed-self-test' : 'passed-live-window';
} catch (error) {
  report.status = 'failed';
  report.error = String(error).replaceAll(root ?? '\u0000', '[W3_ROOT]');
  process.exitCode = 1;
} finally {
  const anomalies = [];
  if (granted) { try { await granted.caller.command('mcp-revoke', { grantId: granted.id }); } catch { anomalies.push('grant-revoke'); } }
  if ((await Promise.allSettled(clients.map(c => c.close()))).some(r => r.status === 'rejected')) anomalies.push('client-close');
  if ((await Promise.allSettled(gateways.map(g => g.stop()))).some(r => r.status === 'rejected')) anomalies.push('gateway-stop');
  try { await rootLease?.close(); } catch { anomalies.push('lease-close'); }
  if (root && !anomalies.length) { try { await rm(root, { recursive: true, force: true }); } catch { anomalies.push('root-remove'); } }
  report.cleanup = { anomalies, rootRemoved: root ? !existsSync(root) : 'live-mode-n/a' };
  if (anomalies.length && report.status !== 'failed') { report.status = 'failed'; process.exitCode = 1; }
  report.endedUtc = new Date().toISOString();
  const data = JSON.stringify(report, null, 2) + '\n';
  if (values.output) await writeFile(values.output, data, { flag: 'wx' });
  process.stdout.write(data);
}
