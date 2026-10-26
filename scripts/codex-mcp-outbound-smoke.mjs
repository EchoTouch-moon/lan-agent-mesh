import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, isAbsolute } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { Gateway } from '../packages/runtime/dist/index.js';
import { CodexAdapter } from '../packages/codex-adapter/dist/index.js';
import { CodexRpc } from '../packages/codex-adapter/dist/rpc.js';
import { MCP_INPUTS } from '../packages/mcp-contract/dist/index.js';
import { nativeMcpResult, digest } from './codex-mcp-contract.mjs';

const { values } = parseArgs({ options: { receiver: { type: 'string', default: 'mock' },
  output: { type: 'string' }, 'allow-dirty': { type: 'boolean', default: false } } });
assert.equal(process.platform, 'darwin', 'Only the verified Mac Codex entry is supported');
assert.ok(['mock', 'codex'].includes(values.receiver));
const command = process.env.LAM_CODEX_BIN;
assert.ok(command && isAbsolute(command), 'Select the verified absolute LAM_CODEX_BIN');
const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
assert.ok(!dirty || values['allow-dirty'], 'Commit source before formal capture');
const root = await realpath(await mkdtemp(join(tmpdir(), 'LAM native MCP & ')));
const home = join(root, 'caller-home'), workspace = join(root, 'workspace');
await mkdir(home, { mode: 0o700 }); await mkdir(workspace, { mode: 0o700 });
const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, CODEX_HOME: home,
  XDG_CONFIG_HOME: join(home, 'xdg'), XDG_DATA_HOME: join(home, 'data'), TMPDIR: home, LANG: 'en_US.UTF-8' };
const report = { status: 'running', testedSourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceClean: !dirty, startedUtc: new Date().toISOString(), platform: process.platform, node: process.version,
  pnpm: execFileSync('pnpm', ['--version'], { encoding: 'utf8' }).trim(), receiver: values.receiver,
  inference: 'deterministic localhost Responses fixture; no external model configured',
  physicalCrossHost: 'not-tested', nativeInvocations: [], results: {}, fixtureRequests: 0 };
const messages = [], servers = [], gateways = [], ports = [];
let rpc, active, receiverMode = 'text', receiverRequests = 0, stage = 'setup';
function fixture(receiver = false) {
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.method, 'POST'); assert.equal(request.url, '/v1/responses');
      const chunks = []; let size = 0;
      for await (const chunk of request) { size += chunk.length; assert.ok(size <= 2 * 1024 * 1024); chunks.push(chunk); }
      const body = JSON.parse(Buffer.concat(chunks).toString());
      report.fixtureRequests++;
      const event = (type, value) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`);
      const id = `resp_${report.fixtureRequests}`;
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      event('response.created', { response: { id, object: 'response', status: 'in_progress', output: [] } });
      if (receiver) { receiverRequests++; if (receiverMode === 'hold') return; }
      let item;
      if (!receiver && active && !active.issued) {
        const tools = body.tools?.filter(t => t.name?.startsWith('mcp__mesh__')) ?? [];
        assert.deepEqual(tools.map(t => t.name.replace('mcp__mesh__', '')).sort(), Object.keys(MCP_INPUTS).sort());
        report.results.advertisedExactSevenTools = 'verified';
        active.issued = true;
        item = { id: `fc_${report.fixtureRequests}`, type: 'function_call', call_id: `call_${report.fixtureRequests}`,
          name: `mcp__mesh__${active.tool}`, arguments: JSON.stringify(active.args) };
      } else {
        const text = 'LAM native MCP fixture done';
        item = { id: `msg_${report.fixtureRequests}`, type: 'message', role: 'assistant', status: 'completed',
          content: [{ type: 'output_text', text, annotations: [] }] };
      }
      event('response.output_item.added', { output_index: 0, item });
      if (item.type === 'message') event('response.output_text.delta', { item_id: item.id, output_index: 0, content_index: 0, delta: item.content[0].text });
      event('response.output_item.done', { output_index: 0, item });
      event('response.completed', { response: { id, status: 'completed', output: [item],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } } });
      response.end();
    } catch { report.fixtureError = true; response.destroy(); }
  });
  servers.push(server); return server;
}
async function listen(server) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  ports.push(server.address().port); return `http://127.0.0.1:${server.address().port}/v1`;
}
async function waitUntil(predicate) {
  for (let n = 0; n < 600; n++) { if (predicate()) return; await delay(50); }
  throw new Error('bounded native observation timeout');
}
async function invoke(tool, args = {}, denied = false) {
  active = { tool, args, issued: false };
  const { turn } = await rpc.call('turn/start', { threadId,
    input: [{ type: 'text', text: `Run the deterministic ${tool} fixture.` }] });
  await waitUntil(() => messages.some(m => m.method === 'turn/completed' && m.params?.turn?.id === turn.id));
  const done = messages.find(m => m.method === 'turn/completed' && m.params?.turn?.id === turn.id);
  assert.equal(done.params.turn.status, 'completed'); assert.equal(active.issued, true);
  const { data, evidence } = nativeMcpResult(messages, threadId, turn.id, tool, args);
  report.nativeInvocations.push({ ...evidence, denied });
  if (denied) assert.equal(data.code, 'permission_denied'); else assert.equal(data.code, undefined);
  return data;
}
let threadId;
async function terminal(taskId, expected) {
  let cursor = 0; const events = [];
  for (let n = 0; n < 20; n++) {
    const batch = await invoke('mesh_get_task', { taskId, cursor });
    events.push(...batch.events); cursor = batch.next;
    if (!['QUEUED', 'RUNNING', 'WAITING_INPUT'].includes(batch.state) && batch.events.length === 0) {
      assert.equal(batch.state, expected); return events;
    }
    await delay(500);
  }
  throw new Error('bounded task observation timeout');
}
function portClosed(port) {
  return new Promise(resolve => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(1000);
    socket.once('connect', () => { socket.destroy(); resolve(false); });
    socket.once('error', error => resolve(error.code === 'ECONNREFUSED'));
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
  });
}
try {
  report.codexVersion = execFileSync(command, ['--version'], { env, cwd: home, encoding: 'utf8', timeout: 5000 }).trim();
  assert.equal(report.codexVersion, 'codex-cli 0.146.0');
  report.executableSha256 = createHash('sha256').update(await readFile(command)).digest('hex');
  report.scriptSha256 = createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex');
  const caller = await new Gateway({ directory: join(root, 'caller'), mdns: false }).start(); gateways.push(caller);
  const receiverUrl = values.receiver === 'codex' ? await listen(fixture(true)) : undefined;
  const receiver = await new Gateway({ directory: join(root, 'receiver'), mdns: false,
    ...(receiverUrl ? { exportAgents: nodeId => [`${nodeId}/codex/default`],
      adapterFactories: [({ nodeId }) => CodexAdapter.open({ nodeId, executable: command,
        home: join(root, 'receiver-home'), workspaces: { 'project-a': workspace },
        fixtureBaseUrl: receiverUrl, expectedVersion: 'codex-cli 0.146.0' })] } :
      { mock: true, scenario: { delayMs: 3000 } }),
  }).start(); gateways.push(receiver);
  for (const g of gateways) { ports.push(Number(new URL(g.url).port)); ports.push(Number(g.mesh.addresses[0].split('/').at(-1))); }
  // Same-host, owned test nodes only. Human pairing remains mandatory for physical peers.
  const pair = await caller.mesh.beginPairing(receiver.mesh.addresses[0]);
  assert.equal(receiver.mesh.pendingPairings()[0].code, pair.code);
  await caller.mesh.confirmPairing(pair.id, pair.code); await receiver.mesh.confirmPairing(pair.id, pair.code);
  const registry = await caller.sync(receiver.mesh.id), agentId = registry.agents[0].id;
  const grant = await caller.command('mcp-grant', { peers: [receiver.mesh.id], agents: [agentId], workspaces: ['project-a'] });
  const credentialFile = join(root, 'credential.json');
  await writeFile(credentialFile, JSON.stringify(grant), { mode: 0o600, flag: 'wx' });
  const url = await listen(fixture());
  const config = ['model_provider="lam_fixture"', 'model="lam-fixture"',
    'model_providers.lam_fixture.name="LAM Fixture"', `model_providers.lam_fixture.base_url=${JSON.stringify(url)}`,
    'model_providers.lam_fixture.wire_api="responses"', 'model_providers.lam_fixture.requires_openai_auth=false',
    'model_providers.lam_fixture.supports_websockets=false',
    'mcp_servers.mesh.command=' + JSON.stringify(process.execPath),
    'mcp_servers.mesh.args=' + JSON.stringify([resolve('packages/mcp-server/dist/cli.js'), '--credentials', credentialFile]),
    'mcp_servers.mesh.startup_timeout_sec=15', 'mcp_servers.mesh.tool_timeout_sec=15'];
  rpc = new CodexRpc(command, ['app-server', '--listen', 'stdio://', ...config.flatMap(c => ['-c', c])], env, home,
    message => { messages.push(message); if (message.id !== undefined && message.method) rpc.deny(message.id, message.method); },
    () => {}, 15000);
  await rpc.call('initialize', { clientInfo: { name: 'lam-native-mcp-probe', version: '0.0.0' }, capabilities: { experimentalApi: false } });
  rpc.notify('initialized');
  threadId = (await rpc.call('thread/start', { cwd: workspace, approvalPolicy: 'never', sandbox: 'read-only', persistExtendedHistory: false })).thread.id;
  stage = 'native-discovery';
  const cards = await invoke('mesh_list_agents'); assert.equal(cards.agents.length, 1); assert.equal(cards.agents[0].id, agentId);
  const empty = await invoke('mesh_list_agents', { peerId: 'outside-scope' }); assert.equal(empty.agents.length, 0);
  stage = 'scope-and-session';
  const start = { peerId: receiver.mesh.id, agentId, workspaceAlias: 'project-a', requestId: randomUUID() };
  await invoke('mesh_start_session', { ...start, workspaceAlias: 'forbidden', requestId: randomUUID() }, true);
  assert.equal(receiver.store.count('sessions'), 0);
  const session = await invoke('mesh_start_session', start);
  assert.deepEqual(await invoke('mesh_start_session', start), session); assert.equal(receiver.store.count('sessions'), 1);
  const listing = await invoke('mesh_list_sessions'); assert.equal(listing.sessions.length, 1);
  await invoke('mesh_send_message', { sessionId: randomUUID(), text: 'outside ownership', requestId: randomUUID() }, true);
  report.results.scopeAndSessionOwnership = 'verified';
  stage = 'send-stream-exact-retry';
  const input = { sessionId: session.sessionId, text: 'native MCP greeting', requestId: randomUUID() };
  const sent = await invoke('mesh_send_message', input);
  const events = await terminal(sent.taskId, 'COMPLETED');
  const expected = receiverUrl ? 'LAM native MCP fixture done' : 'mock:native MCP greeting';
  assert.equal(events.find(e => e.type === 'completed')?.text, expected);
  assert.equal(events.filter(e => e.type === 'delta').map(e => e.text).join(''), expected);
  assert.equal((await invoke('mesh_send_message', input)).taskId, sent.taskId);
  assert.equal(receiver.store.count('tasks'), 1); report.results.streamAndExactRetry = 'verified';
  stage = 'delegate-inflight-cancel'; receiverMode = 'hold'; const before = receiverRequests;
  const delegated = await invoke('mesh_delegate_task', { sessionId: session.sessionId, text: 'cancel fixture', requestId: randomUUID() });
  await waitUntil(() => receiver.store.task(delegated.taskId)?.state === 'RUNNING' && (!receiverUrl || receiverRequests > before));
  assert.equal((await invoke('mesh_cancel_task', { taskId: delegated.taskId })).cancelRequested, true);
  const cancelled = await terminal(delegated.taskId, 'CANCELLED'); assert.ok(!cancelled.some(e => e.type === 'completed'));
  report.results.inflightCancel = 'verified';
  stage = 'revocation'; await caller.command('mcp-revoke', { grantId: grant.grantId });
  await invoke('mesh_list_sessions', {}, true); report.results.revocation = 'verified';
  assert.deepEqual([...new Set(report.nativeInvocations.map(x => x.tool))].sort(), Object.keys(MCP_INPUTS).sort());
  assert.equal(report.fixtureError, undefined); report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.failureStage = stage;
  // Do not publish native diagnostics, paths, arguments, credentials or raw history.
  report.failureKind = error?.code === 'ERR_ASSERTION' ? 'assertion' : 'runtime';
  report.observedMethods = [...new Set(messages.map(m => m.method).filter(Boolean))];
  process.exitCode = 1;
} finally {
  try {
    await rpc?.close();
    if (rpc?.child.pid) assert.throws(() => process.kill(-rpc.child.pid, 0), { code: 'ESRCH' });
    for (const g of gateways.reverse()) await g.stop();
    for (const server of servers) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    assert.ok((await Promise.all(ports.map(portClosed))).every(Boolean));
    await rm(root, { recursive: true, force: true }); await assert.rejects(access(root), { code: 'ENOENT' });
    report.cleanup = { nativeProcessGroup: 'stopped', ports: 'closed', privateData: 'removed' };
  } catch { report.cleanup = 'failed'; report.status = 'failed'; process.exitCode = 1; }
  report.endedUtc = new Date().toISOString();
  report.nativeTraceDigest = digest(report.nativeInvocations);
  const output = JSON.stringify(report, null, 2) + '\n';
  if (values.output) await writeFile(resolve(values.output), output, { mode: 0o600, flag: 'wx' });
  console.log(output);
}
