#!/usr/bin/env node
// LHI-3 (#82): Codex <-> ZCode dual-gateway same-host E2E runner.
//
// Modes:
//   --self-test   Phase B+D only: two in-process Gateways on loopback libp2p (Noise+Yamux,
//                 explicit isolated TEST pairing — never peer=self), a scoped MCP grant, and
//                 the OFFICIAL MCP SDK client driving the seven mesh_* tools through the real
//                 mcp-server stdio bridge. This is the L0/SDK-synthetic transport/policy
//                 baseline: it is NOT a native harness caller and never claims to be.
//                 Deterministic, no native binaries, no external network; CI-safe.
//   --native      additionally attempts Phase C2 (ZCode native caller -> Codex native
//                 receiver) under the existing authorizations; any unmet precondition
//                 records BLOCKED instead of guessing. Phase C1 (Codex caller -> ZCode
//                 receiver) stays BLOCKED until PR #92 passes independent re-review.
//
// Every phase is bounded; the report ends with a hard assertion gate (exit 1 on any miss).
import { createServer, request as httpRequestRaw } from 'node:http';

/** Minimal loopback JSON POST used for direct ingress-layer negative checks. */
function httpRequest(url, extraHeaders, body) {
  const target = /^http:\/\/127\.0\.0\.1:(\d+)(\/.*)$/.exec(url);
  if (!target) return Promise.reject(new Error('non-loopback URL refused'));
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const outgoing = httpRequestRaw({
      hostname: '127.0.0.1', port: Number(target[1]), path: target[2], method: 'POST',
      headers: { ...extraHeaders, 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
    }, response => {
      let data = '';
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body: data }));
    });
    outgoing.on('error', reject);
    outgoing.setTimeout(10000, () => outgoing.destroy(new Error('http timeout')));
    outgoing.end(payload);
  });
}
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const requireFromMcpServer = createRequire(join(repoRoot, 'packages/mcp-server/package.json'));
const { Client } = requireFromMcpServer('@modelcontextprotocol/client');
const { StdioClientTransport } = requireFromMcpServer('@modelcontextprotocol/client/stdio');
const { Gateway } = await import(join(repoRoot, 'packages/runtime/dist/index.js'));

const MODE_SELF_TEST = process.argv.includes('--self-test');
const MODE_NATIVE = process.argv.includes('--native');
const native = MODE_NATIVE && !MODE_SELF_TEST;
const report = {
  mode: MODE_SELF_TEST ? 'self-test' : native ? 'native' : 'self-test-equivalent',
  platform: process.platform, node: process.version,
  startedAt: new Date().toISOString(),
  phases: {}, negatives: {}, assertions: [], fixtureRequests: 0, externalModelRequests: 0,
};
const root = realpathSync(mkdtempSync(join(tmpdir(), 'lam-lhi3-dual-')));
const gate = (name, pass, detail) => report.assertions.push({ name, pass: pass === true, detail });
const waitUntil = async (predicate, label, budgetMs = 30000) => {
  const deadline = Date.now() + budgetMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error(`${label} timed out after ${budgetMs}ms`);
    await new Promise(r => setTimeout(r, 100));
  }
};

async function startGateway(name, options) {
  const gateway = new Gateway(options);
  await gateway.start();
  return gateway;
}

/** Two loopback gateways with an explicit isolated TEST pairing (both sides confirm the code). */
async function startPair() {
  const receiver = await startGateway('B', {
    directory: join(root, 'gateway-b'),
    mdns: false, mock: true, scenario: { chunks: ['p1-', 'p2'], delayMs: 900 },
  });
  const caller = await startGateway('A', { directory: join(root, 'gateway-a'), mdns: false });
  const address = receiver.mesh.addresses.find(a => a.includes('127.0.0.1')) ?? receiver.mesh.addresses[0];
  const pairing = await caller.command('pair', { address });
  const theirs = (await receiver.command('pairings', {})).find(p => p.id === pairing.id);
  if (!theirs) throw new Error('Receiver never saw the pairing');
  await receiver.command('confirm', { id: pairing.id, code: pairing.code });
  await caller.command('confirm', { id: pairing.id, code: pairing.code });
  await waitUntil(() => caller.mesh.connected(receiver.mesh.id) && receiver.mesh.connected(caller.mesh.id), 'mesh connectivity');
  return { caller, receiver };
}

/** A real MCP SDK client reaching the caller gateway through the stdio mcp-server bridge. */
async function mcpClientFor(caller, credential) {
  const file = join(root, `credential-${credential.grantId}.json`);
  writeFileSync(file, JSON.stringify(credential), { mode: 0o600 });
  chmodSync(file, 0o600);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(repoRoot, 'packages/mcp-server/dist/cli.js'), '--credentials', file],
    stderr: 'pipe', maxBufferSize: 262144,
  });
  transport.stderr?.on('data', chunk => { try { appendFileSync(join(root, 'bridge-stderr.log'), chunk); } catch { /* diagnosis only */ } });
  const client = new Client({ name: 'lam-lhi3-e2e', version: '0.0.0' });
  await client.connect(transport);
  return { client, transport, async close() { await client.close().catch(() => {}); } };
}

async function createGrant(caller, receiver, overrides = {}) {
  return caller.command('mcp-grant', {
    peers: [receiver.mesh.id],
    agents: [`${receiver.mesh.id}/mock/default`],
    workspaces: ['project-a'],
    lifetimeSeconds: 3600,
    ...overrides,
  });
}

async function callTool(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(`mesh tool ${name} returned isError: ${JSON.stringify(result.content ?? []).slice(0, 200)}`);
  return result.structuredContent ?? result.content?.[0]?.text ?? result;
}

let caller, receiver, mcp;
try {
  // ---------- Phase B: L0/SDK-synthetic full-chain baseline ----------
  ({ caller, receiver } = await startPair());
  const peerId = receiver.mesh.id, agentId = `${peerId}/mock/default`;
  const credential = await createGrant(caller, receiver);
  report.phases.pairing = { peerId: peerId.slice(0, 12) + '…', grantCreated: true, controlUrlOrigin: (/^http:\/\/[^/]+/.exec(caller.url) ?? [''])[0] };

  mcp = await mcpClientFor(caller, credential);
  const listed = await callTool(mcp.client, 'mesh_list_agents', { peerId });
  const listJson = JSON.parse(JSON.stringify(listed));
  const visibleAgents = (listJson.agents ?? []).map(a => a.id);
  report.phases.listAgents = { visibleAgents };
  gate('B-list-agents-scoped', visibleAgents.includes(agentId) && visibleAgents.every(id => id === agentId), JSON.stringify(visibleAgents));

  const requestId = randomUUID();
  const session = await callTool(mcp.client, 'mesh_start_session', { peerId, agentId, workspaceAlias: 'project-a', requestId });
  const sessionJson = JSON.parse(JSON.stringify(session));
  const sessionId = sessionJson.sessionId;
  report.phases.startSession = { sessionId: sessionId?.slice(0, 12) + '…' };
  gate('B-start-session-owned', typeof sessionId === 'string' && sessionJson.peerId === peerId && sessionJson.agentId === agentId);

  const sessionRetry = await callTool(mcp.client, 'mesh_start_session', { peerId, agentId, workspaceAlias: 'project-a', requestId });
  gate('B-start-session-idempotent', JSON.parse(JSON.stringify(sessionRetry)).sessionId === sessionId);

  // Two consecutive turns on one session, cursor-polled to completion.
  const turn = async (text) => {
    const rid = randomUUID();
    const submitted = await callTool(mcp.client, 'mesh_send_message', { sessionId, text, requestId: rid, timeoutSeconds: 30 });
    const taskJson = JSON.parse(JSON.stringify(submitted));
    let cursor = 0, state, events = [];
    const progression = [];
    await waitUntil(async () => {
      const polled = JSON.parse(JSON.stringify(await callTool(mcp.client, 'mesh_get_task', { taskId: taskJson.taskId, cursor })));
      progression.push({ state: polled.state, reason: polled.reason?.slice(0, 60), events: (polled.events ?? []).length });
      state = polled.state; events.push(...(polled.events ?? [])); cursor = polled.next;
      return ['COMPLETED', 'FAILED', 'CANCELLED', 'UNKNOWN'].includes(state);
    }, `turn ${text} completion`, 45000);
    report.phases.debugTurns ??= []; report.phases.debugTurns.push({ text, progression });
    return { taskId: taskJson.taskId, delivery: taskJson.delivery, state, cursor, text: events.map(e => e.text ?? '').join('') };
  };
  const first = await turn('first');
  const second = await turn('second');
  report.phases.twoTurns = { first: { state: first.state, text: first.text }, second: { state: second.state, text: second.text } };
  gate('B-first-turn-completed', first.state === 'COMPLETED' && first.text === 'p1-p2', JSON.stringify(first));
  gate('B-second-turn-completed', second.state === 'COMPLETED' && second.text === 'p1-p2' && second.taskId !== first.taskId, JSON.stringify(second));

  // ---------- Phase D: fail-closed negatives (synthetic) ----------
  const rejects = async (label, run) => {
    try { await run(); report.negatives[label] = { rejected: false }; }
    catch (error) { report.negatives[label] = { rejected: true, code: error?.code ?? String(error?.message ?? error).slice(0, 90) }; }
  };
  await rejects('unpaired-peer-grant', () => createGrant(caller, receiver, { peers: ['unpaired-peer-xyz'] }));
  await rejects('agent-outside-scope', () => callTool(mcp.client, 'mesh_start_session', { peerId, agentId: `${peerId}/mock/other`, workspaceAlias: 'project-a', requestId: randomUUID() }));
  await rejects('workspace-outside-scope', () => callTool(mcp.client, 'mesh_start_session', { peerId, agentId, workspaceAlias: 'project-b', requestId: randomUUID() }));
  const revocable = await createGrant(caller, receiver);
  await caller.command('mcp-revoke', { grantId: revocable.grantId });
  const revokedMcp = await mcpClientFor(caller, revocable);
  try {
    await callTool(revokedMcp.client, 'mesh_list_agents', { peerId });
    report.negatives['revoked-grant'] = { rejected: false };
  } catch { report.negatives['revoked-grant'] = { rejected: true }; }
  await revokedMcp.close();
  const shortLived = await createGrant(caller, receiver, { lifetimeSeconds: 1 });
  await new Promise(r => setTimeout(r, 1300));
  // Expiry is enforced at BOTH layers: the bridge CLI refuses to start on an expired
  // credential file, and the Gateway HTTP ingress independently rejects the stale token.
  try {
    const expiredMcp = await mcpClientFor(caller, shortLived);
    await callTool(expiredMcp.client, 'mesh_list_agents', { peerId });
    await expiredMcp.close();
    report.negatives['expired-grant'] = { rejected: false, layer: 'bridge-start' };
  } catch (error) {
    report.negatives['expired-grant'] = { rejected: true, layer: 'bridge-start', detail: String(error?.message ?? error).slice(0, 60) };
  }
  const expiredHttp = await httpRequest(`${caller.url}/mcp/command`, {
    authorization: `Bearer ${shortLived.token}`, 'x-lam-node': caller.mesh.id,
  }, { command: 'mesh_list_agents', args: { peerId } }).catch(error => ({ status: 0, code: String(error?.message ?? 'error').slice(0, 40) }));
  report.negatives['expired-grant-http'] = { rejected: expiredHttp.status === 403, status: expiredHttp.status || expiredHttp.code };

  const ridReuse = randomUUID();
  await callTool(mcp.client, 'mesh_send_message', { sessionId, text: 'idempotent', requestId: ridReuse, timeoutSeconds: 30 });
  await rejects('request-id-conflict', () => callTool(mcp.client, 'mesh_send_message', { sessionId, text: 'CHANGED', requestId: ridReuse, timeoutSeconds: 30 }));
  const retryReply = JSON.parse(JSON.stringify(await callTool(mcp.client, 'mesh_send_message', { sessionId, text: 'idempotent', requestId: ridReuse, timeoutSeconds: 30 })));
  const diagnostics = await receiver.command('diagnostics', {});
  report.negatives['exact-retry-once'] = { taskId: retryReply.taskId, receiverTasks: diagnostics.tasks };
  gate('D-exact-retry-once', retryReply.delivery === 'accepted', JSON.stringify(retryReply));
  // The mock serializes one turn per session: drain the idempotent turn to a terminal state
  // before submitting the cancel target, so it is actually ADMITTED (a busy-rejected send
  // surfaces as delivery UNKNOWN and can never be cancelled — correct semantics, bad test
  // ordering). This drain is itself part of the exactly-once evidence.
  await waitUntil(async () => {
    const polled = JSON.parse(JSON.stringify(await callTool(mcp.client, 'mesh_get_task', { taskId: retryReply.taskId, cursor: 0 })));
    return polled.state === 'COMPLETED';
  }, 'idempotent turn completion', 45000);
  const tasksAfterDrain = await receiver.command('diagnostics', {});
  gate('D-exact-retry-single-execution', tasksAfterDrain.tasks === diagnostics.tasks, `tasks ${diagnostics.tasks} -> ${tasksAfterDrain.tasks} (exact retry must not add a second task)`);

  // Cancel while the mock turn is inside its first delay gap.
  const cancelRid = randomUUID();
  const cancelSubmit = JSON.parse(JSON.stringify(await callTool(mcp.client, 'mesh_send_message', { sessionId, text: 'cancel-me', requestId: cancelRid, timeoutSeconds: 30 })));
  await callTool(mcp.client, 'mesh_cancel_task', { taskId: cancelSubmit.taskId });
  let cancelState;
  await waitUntil(async () => {
    const polled = JSON.parse(JSON.stringify(await callTool(mcp.client, 'mesh_get_task', { taskId: cancelSubmit.taskId, cursor: 0 })));
    cancelState = polled.state;
    return cancelState === 'CANCELLED';
  }, 'cancelled terminal', 45000);
  gate('D-cancel-in-flight-terminal', cancelState === 'CANCELLED', String(cancelState));

  // Receiver loss mid-turn -> UNKNOWN, no auto replay across receiver restart + exact retry.
  const lossRid = randomUUID();
  const lossSubmit = JSON.parse(JSON.stringify(await callTool(mcp.client, 'mesh_send_message', { sessionId, text: 'lose-me', requestId: lossRid, timeoutSeconds: 30 })));
  await receiver.stop();
  const lossPolled = JSON.parse(JSON.stringify(await callTool(mcp.client, 'mesh_get_task', { taskId: lossSubmit.taskId, cursor: 0 })));
  receiver = await startGateway('B', { directory: join(root, 'gateway-b'), mdns: false, mock: true, scenario: { chunks: ['p1-', 'p2'], delayMs: 900 } });
  await waitUntil(() => caller.mesh.connected(receiver.mesh.id), 'receiver reconnect', 30000);
  const afterRestart = JSON.parse(JSON.stringify(await callTool(mcp.client, 'mesh_get_task', { taskId: lossSubmit.taskId, cursor: 0 })));
  const lossRetry = JSON.parse(JSON.stringify(await callTool(mcp.client, 'mesh_send_message', { sessionId, text: 'lose-me', requestId: lossRid, timeoutSeconds: 30 })));
  const postDiagnostics = await receiver.command('diagnostics', {});
  report.negatives['receiver-loss-unknown'] = { offline: lossPolled.state, afterRestart: afterRestart.state, retryTaskId: lossRetry.taskId, retryDelivery: lossRetry.delivery, receiverTasksAfter: postDiagnostics.tasks };
  gate('D-unknown-no-replay', lossPolled.state === 'UNKNOWN' && afterRestart.state === 'UNKNOWN' && lossRetry.taskId === lossSubmit.taskId, JSON.stringify(report.negatives['receiver-loss-unknown']));

  // Caller gateway restart invalidates the grant token (bootId binding).
  await caller.stop();
  caller = await startGateway('A', { directory: join(root, 'gateway-a'), mdns: false });
  try {
    await callTool(mcp.client, 'mesh_list_agents', { peerId });
    report.negatives['stale-grant-after-caller-restart'] = { rejected: false };
  } catch { report.negatives['stale-grant-after-caller-restart'] = { rejected: true }; }

  // ---------- Phase C gates ----------
  report.phases.phaseC = {
    C1_codex_to_zcode: { status: 'BLOCKED', reason: 'PR #92 (ZcodeAdapter) has fixes pushed but no independent re-review yet; packet gate forbids receiver-native until reviewed' },
    C2_zcode_to_codex: native ? { status: 'PENDING' } : { status: 'NOT-RUN', reason: 'self-test mode; native requires --native and the C2 preconditions' },
  };
  if (native) {
    const nativeResult = await runPhaseC2(report, root).catch(error => ({ status: 'BLOCKED', reason: String(error?.message ?? error).slice(0, 300) }));
    report.phases.phaseC.C2_zcode_to_codex = nativeResult;
  }
  report.stage = 'complete';
} catch (error) {
  report.error = String(error?.message ?? error).replaceAll(root, '<disposable-root>');
  process.exitCode = 1;
} finally {
  await mcp?.close().catch(() => {});
  await caller?.stop().catch(() => {});
  await receiver?.stop().catch(() => {});
  report.cleanup = {};
  for (const [label, dir] of [['caller-home', join(root, 'gateway-a')], ['receiver-home', join(root, 'gateway-b')]]) {
    try { statSync(dir); report.cleanup[`${label}-lock-released`] = !existsSync(join(dir, 'gateway.lock')); }
    catch { report.cleanup[`${label}-removed-early`] = true; }
  }
  const failed = report.error || report.assertions.some(g => !g.pass);
  if (failed) report.keptForDiagnosis = root; // failure keeps the disposable root for inspection
  else {
    rmSync(root, { recursive: true, force: true });
    try { statSync(root); report.cleanup.disposableRootRemoved = false; }
    catch (error) { report.cleanup.disposableRootRemoved = error.code === 'ENOENT'; }
  }
  const n = report.negatives;
  gate('N-unpaired-peer-grant', n['unpaired-peer-grant']?.rejected === true);
  gate('N-agent-outside-scope', n['agent-outside-scope']?.rejected === true);
  gate('N-workspace-outside-scope', n['workspace-outside-scope']?.rejected === true);
  gate('N-revoked-grant', n['revoked-grant']?.rejected === true);
  gate('N-expired-grant', n['expired-grant']?.rejected === true);
  gate('N-expired-grant-http', n['expired-grant-http']?.rejected === true, JSON.stringify(n['expired-grant-http']));
  gate('N-request-id-conflict', n['request-id-conflict']?.rejected === true);
  gate('N-stale-grant-after-restart', n['stale-grant-after-caller-restart']?.rejected === true);
  gate('no-external-models-accounted', report.externalModelRequests === 0, 'accounting invariant: only loopback fixtures, if any');
  gate('cleanup-verified', report.cleanup.disposableRootRemoved === true, JSON.stringify(report.cleanup));
  report.finishedAt = new Date().toISOString();
  report.verdict = report.assertions.every(g => g.pass) && !report.error ? 'PASS' : 'FAIL';
  if (report.verdict === 'FAIL') process.exitCode = 1;
}
console.log(JSON.stringify(report, null, 2));
// All evidence and cleanup verification are captured above; some library handle (libp2p/MCP
// child reaping) can outlive the report, so exit explicitly instead of idling the process.
process.exit(process.exitCode ?? 0);

/** Phase C2: ZCode native MCP caller -> Gateway A -> CodexAdapter receiver on Gateway B.
 *  Drives the INSTALLED ZCode app-server exactly like the merged #90 probe (rpcProcess),
 *  but its MCP server is the Gateway bridge; the fixture model performs a real agent loop:
 *  mesh_list_agents -> mesh_start_session -> mesh_send_message -> mesh_get_task polling. */
async function runPhaseC2(report, root) {
  const { copyFileSync } = await import('node:fs');
  const { rpcProcess } = await import(join(repoRoot, 'scripts/rpc-probe.mjs'));
  const { CodexAdapter } = await import(join(repoRoot, 'packages/codex-adapter/dist/index.js'));
  const entry = process.env.LAM_ZCODE_ENTRY ?? '/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs';
  const builtinConfig = process.env.LAM_ZCODE_BUILTIN_CONFIG ?? resolve(dirname(entry), '../config/provider/zcode-builtin.json');
  const codex = process.env.CODEX ?? (await execFileAsync('which', ['codex'])).stdout.trim();
  if (!isAbsolute(codex)) return { status: 'BLOCKED', reason: 'codex executable not resolvable to an absolute path (fail closed)' };
  const entrySha = createHash('sha256').update(readFileSync(entry)).digest('hex');
  const codexVersion = (await execFileAsync(codex, ['--version'])).stdout.trim();
  if (codexVersion !== 'codex-cli 0.146.0')
    return { status: 'BLOCKED', reason: `codex version ${codexVersion} != pinned codex-cli 0.146.0 (fail closed)` };
  const observed = [];
  const note = value => observed.push(value);
  // Loopback /v1 inference for the ZCode caller; a tiny agent loop keyed on tool history.
  const zcodeFixture = createServer(async (request, response) => {
    if (request.method !== 'POST' || !request.url?.endsWith('/chat/completions')) { response.writeHead(404).end(); return; }
    let raw = ''; for await (const chunk of request) raw += chunk;
    let body; try { body = JSON.parse(raw); } catch { response.writeHead(400).end(); return; }
    report.fixtureRequests++;
    const messages = body.messages ?? [];
    const text = JSON.stringify(messages);
    const toolNames = (body.tools ?? []).map(t => t.function?.name).filter(Boolean);
    const findTool = re => toolNames.find(n => re.test(n));
    const toolCall = (name, args) => {
      note({ step: name, args: JSON.stringify(args).slice(0, 260) });
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const delta = (value, finish = null) => response.write(`data: ${JSON.stringify({ id: 'chatcmpl-lhi3', object: 'chat.completion.chunk', created: 0, model: 'lam-fixture', choices: [{ index: 0, delta: value, finish_reason: finish }] })}\n\n`);
      delta({ role: 'assistant' });
      delta({ tool_calls: [{ index: 0, id: `call_${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
      delta({}, 'tool_calls'); response.end('data: [DONE]\n\n');
    };
    const finishText = value => {
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const delta = (value2, finish = null) => response.write(`data: ${JSON.stringify({ id: 'chatcmpl-lhi3', object: 'chat.completion.chunk', created: 0, model: 'lam-fixture', choices: [{ index: 0, delta: value2, finish_reason: finish }] })}\n\n`);
      delta({ role: 'assistant' }); delta({ content: value }); delta({}, 'stop'); response.end('data: [DONE]\n\n');
    };
    const sawToolResult = /"role":"tool"/.test(text) || /tool_result/.test(text);
    const hasSession = /"sessionId"/.test(text) && /mesh_start_session/.test(text);
    const hasTask = /"taskId"/.test(text) && /mesh_send_message/.test(text);
    const completed = /LHI3 RECEIVER DONE/.test(text);
    if (!sawToolResult) {
      const tool = findTool(/mesh_list_agents/);
      if (tool) return toolCall(tool, {});
      return finishText('LHI3 tool not advertised');
    }
    if (!hasSession) {
      const tool = findTool(/mesh_start_session/);
      // The history is stringified (inner quotes escaped), so match ids WITHOUT quote anchors.
      const peer = /\b(12D3KooW[A-Za-z0-9]+)\b/.exec(text)?.[1] ?? '';
      const agent = /(12D3KooW[A-Za-z0-9]+\/codex\/default)/.exec(text)?.[1] ?? '';
      if (agent && !observed.some(n => n.listEvidence)) {
        const at = text.lastIndexOf('mesh_list_agents');
        note({ listEvidence: text.slice(Math.max(0, at - 40), at + 420) });
      }
      const attempts = observed.filter(n => n.step?.includes('start_session')).length;
      if (attempts >= 3) {
        const at = text.lastIndexOf('mesh_start_session');
        note({ startFailureSample: text.slice(Math.max(0, at - 60), at + 700) });
        return finishText('LHI3 start_session failed repeatedly; see notes');
      }
      if (tool && agent) return toolCall(tool, { peerId: peer || agent.split('/')[0], agentId: agent, workspaceAlias: 'fixture', requestId: randomUUID() });
      return finishText('LHI3 agent not visible in list result');
    }
    if (!hasTask) {
      const tool = findTool(/mesh_send_message/);
      const sessionId = /sessionId[^0-9a-f]{0,5}([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/.exec(text)?.[1];
      if (tool && sessionId) return toolCall(tool, { sessionId, text: 'LHI3 receiver ping', requestId: randomUUID(), timeoutSeconds: 90 });
      return finishText('LHI3 session id missing');
    }
    if (!completed) {
      const tool = findTool(/mesh_get_task/);
      const taskId = /taskId[^0-9a-f]{0,5}([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/.exec(text)?.[1];
      if (tool && taskId) return toolCall(tool, { taskId, cursor: 0 });
      return finishText('LHI3 task id missing');
    }
    note({ step: 'final' });
    return finishText('LHI3 NATIVE OK');
  });
  await new Promise(r => zcodeFixture.listen(0, '127.0.0.1', r));
  // Loopback /v1 inference for the Codex receiver (responses wire API, fixed output).
  const codexFixture = createServer(async (request, response) => {
    if (request.method !== 'POST' || !request.url?.endsWith('/responses')) { response.writeHead(404).end(); return; }
    for await (const _chunk of request) { void _chunk; /* drain */ }
    report.fixtureRequests++;
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const send = (event, data) => response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    send('response.created', { type: 'response.created', response: { id: 'resp_lhi3' } });
    send('response.output_item.added', { type: 'response.output_item.added', output_index: 0, item: { id: 'item_0', type: 'message' } });
    send('response.output_text.delta', { type: 'response.output_text.delta', item_id: 'item_0', output_index: 0, content_index: 0, delta: 'LHI3 RECEIVER DONE' });
    send('response.output_text.done', { type: 'response.output_text.done', item_id: 'item_0', output_index: 0, content_index: 0, text: 'LHI3 RECEIVER DONE' });
    send('response.output_item.done', { type: 'response.output_item.done', output_index: 0, item: { id: 'item_0', type: 'message' } });
    send('response.completed', { type: 'response.completed', response: { id: 'resp_lhi3' } });
    response.end();
  });
  await new Promise(r => codexFixture.listen(0, '127.0.0.1', r));
  let caller, receiver, rpc;
  try {
    const codexHome = join(root, 'codex-adapter-home'), codexWorkspace = join(root, 'codex-workspace');
    mkdirSync(codexWorkspace, { mode: 0o700 });
    receiver = new Gateway({
      directory: join(root, 'gateway-b2'), mdns: false,
      // Factory-registered agents are not auto-exported (only the mock agent is); expose the
      // Codex receiver agent explicitly through the public exportAgents option.
      exportAgents: nodeId => [`${nodeId}/codex/default`],
      adapterFactories: [async ({ nodeId }) => CodexAdapter.open({
        nodeId, executable: codex, home: codexHome, workspaces: { fixture: codexWorkspace },
        fixtureBaseUrl: `http://127.0.0.1:${codexFixture.address().port}/v1`, expectedVersion: 'codex-cli 0.146.0',
      })],
    });
    await receiver.start();
    caller = new Gateway({ directory: join(root, 'gateway-a2'), mdns: false });
    await caller.start();
    const address = receiver.mesh.addresses.find(a => a.includes('127.0.0.1')) ?? receiver.mesh.addresses[0];
    const pairing = await caller.command('pair', { address });
    const theirs = (await receiver.command('pairings', {})).find(p => p.id === pairing.id);
    if (!theirs) throw new Error('C2 receiver never saw the pairing');
    await receiver.command('confirm', { id: pairing.id, code: pairing.code });
    await caller.command('confirm', { id: pairing.id, code: pairing.code });
    await waitUntil(() => caller.mesh.connected(receiver.mesh.id), 'C2 mesh connectivity');
    const peerId = receiver.mesh.id, agentId = `${peerId}/codex/default`;
    const credential = await caller.command('mcp-grant', { peers: [peerId], agents: [agentId], workspaces: ['fixture'], lifetimeSeconds: 3600 });
    const credentialFile = join(root, `credential-c2-${credential.grantId}.json`);
    writeFileSync(credentialFile, JSON.stringify(credential), { mode: 0o600 }); chmodSync(credentialFile, 0o600);
    // ZCode native caller under an isolated home; the ONLY MCP server is the Gateway bridge.
    const zcodeHome = join(root, 'zcode-caller-home');
    const env = {
      PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: zcodeHome, TMPDIR: zcodeHome, LANG: 'en_US.UTF-8',
      XDG_CONFIG_HOME: zcodeHome, XDG_DATA_HOME: zcodeHome, ZCODE_DATA_BASE_DIR: zcodeHome,
      ZCODE_STORAGE_DIR: join(zcodeHome, 'storage'), ZCODE_SESSION_DB_PATH: join(zcodeHome, 'sessions.sqlite'),
      ZCODE_LOG_DIR: join(zcodeHome, 'logs'),
      ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: join(zcodeHome, 'builtin.json'),
      ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: join(zcodeHome, 'personal.json'),
    };
    mkdirSync(join(zcodeHome, '.zcode', 'cli'), { recursive: true });
    copyFileSync(builtinConfig, join(zcodeHome, 'builtin.json'));
    writeFileSync(join(zcodeHome, 'personal.json'), JSON.stringify({ schemaVersion: 1, config: {
      providerConfigRules: { providerRules: [{ providerId: 'lam-fixture', providerName: 'LAM Fixture', config: {
        group: 'standard-personal', access: { type: 'api-key', apiKey: 'lam-local-fixture-not-a-real-key' },
        api: { type: 'openai-chat-completions', baseUrl: `http://127.0.0.1:${zcodeFixture.address().port}/v1` }, personalModelIds: ['lam-fixture'],
      } }] }, modelConfigRules: { providerModelRules: [], manualProviderModelRules: [] },
      defaultModelSelection: { providerId: 'lam-fixture', modelId: 'lam-fixture', options: { reasoningLevel: 'disabled' } },
    } }), { mode: 0o600 });
    writeFileSync(join(zcodeHome, '.zcode', 'cli', 'config.json'), JSON.stringify({
      features: { mcp: true, subagent: false, memory: false, skill: false },
      plugins: { enabled: false }, hooks: { enabled: false },
      mcp: { servers: { 'lam-mesh': { type: 'stdio', command: process.execPath, args: [join(repoRoot, 'packages/mcp-server/dist/cli.js'), '--credentials', credentialFile], enabled: true, timeoutMs: 30000 } } },
    }));
    const zcodeEvents = [];
    rpc = rpcProcess(process.execPath, [entry, 'app-server', '--cwd', zcodeHome], env, zcodeHome, { jsonrpc: false, captureDiagnostics: true, onMessage: message => {
      zcodeEvents.push(message);
      if (message.method === 'interaction/requestPermission' && 'id' in message) {
        rpc.reply(message.id, { decision: 'deny', reason: 'LHI3 default deny' });
        note({ permissionDenied: true });
      }
      if (message.method === 'session/requestRuntimePreferences' && 'id' in message)
        rpc.reply(message.id, { nativeSearchEnhancementsEnabled: false, toolSearchMode: 'off', subagentRuntimeConfigEnabled: false, memoryEnabled: false, askUserQuestionAutoResolutionEnabled: false, modelContextBudgetStrategy: 'preflight-v1' });
    } });
    await rpc.call('runtime/capabilities', {});
    const sessionId = `sess_${randomUUID()}`;
    await rpc.call('session/create', { sessionId, workspace: { workspacePath: zcodeHome, workspaceKey: zcodeHome }, model: { providerId: 'lam-fixture', modelId: 'lam-fixture', options: { reasoningLevel: 'disabled' } }, persistence: 'immediate', mode: 'plan', titleGenerationEnabled: false }, { timeoutMs: 60000 });
    await rpc.call('session/subscribe', { sessionId, deliveryKind: 'desktop-continuous' });
    const inputId = randomUUID();
    await rpc.call('session/send', { sessionId, inputId, modelSelection: { providerId: 'lam-fixture', modelId: 'lam-fixture', options: { reasoningLevel: 'disabled' } }, content: 'LHI3_CALL_LIST_AGENTS then complete the agent loop.' });
    let outcome;
    try {
      outcome = await new Promise((resolve, reject) => {
        const deadline = Date.now() + 180000;
        const tick = () => {
          const done = zcodeEvents.find(m => m.method === 'session/event' && ['turn.completed', 'turn.failed'].includes(m.params?.type) && m.params.payload?.inputId === inputId);
          if (done) return resolve(done.params);
          if (Date.now() > deadline) return reject(new Error('C2 turn timed out after 180s'));
          setTimeout(tick, 200);
        };
        tick();
      });
    } catch (error) {
      // Keep the evidence (fixture step trace) instead of losing it to the outer catch.
      return { status: 'PARTIAL', reason: String(error?.message ?? error), entry: { cli: '0.17.0', sha256: entrySha.slice(0, 16) + '…' }, codexVersion, chain: { steps: 'incomplete' }, notes: observed };
    }
    const finalText = zcodeEvents.filter(m => m.method === 'session/event' && m.params?.type === 'model.streaming' && m.params.payload?.kind === 'text_delta' && m.params.payload).map(m => m.params.payload.delta).join('');
    const receiverDiagnostics = await receiver.command('diagnostics', {});
    const grantAudits = caller.store.query("SELECT kind FROM audit_events ORDER BY id").map(r => String(r.kind));
    // Two chains, rated separately per the packet: the read-only native chain (ZCode native
    // MCP tool call through the bridge and both gateways to the CodexAdapter registry) versus
    // the task-execution chain (start_session/send_message), which ZCode plan mode refuses
    // for non-read-only tools and build mode would gate behind a native permission allow that
    // the packet explicitly does not grant overnight.
    // The read-only chain is proven by progression itself: the model's mesh_list_agents call
    // returned real registry data (the fixture could only extract the codex agent id from that
    // tool result) and the turn completed. rawHistory (visible text only) cannot show this.
    const readOnlyChainVerified = observed.some(n => n.step?.includes('mesh_list_agents'))
      && observed.some(n => n.step?.includes('mesh_start_session') && String(n.args ?? '').includes('/codex/default'))
      && observed.some(n => n.listEvidence)
      && outcome.payload.resultType === 'success';
    const executionChain = finalText.includes('LHI3 NATIVE OK')
      ? { status: 'VERIFIED' }
      : { status: 'BLOCKED_NEEDS_USER_AUTH', reason: 'plan mode refuses non-read-only MCP tools ("Plan mode only allows read-only, non-destructive tools"); build mode would require a native permission allow, which the overnight packet does not grant (no #65-style auto-approve for ZCode)' };
    return {
      status: executionChain.status === 'VERIFIED' && readOnlyChainVerified ? 'PASS' : 'PARTIAL',
      entry: { cli: '0.17.0', sha256: entrySha.slice(0, 16) + '…' }, codexVersion,
      chain: {
        readOnlyNativeChain: readOnlyChainVerified ? 'VERIFIED (ZCode native mesh_list_agents -> bridge -> gateway pair -> CodexAdapter registry; agent id + capabilities returned to the ZCode model context)' : 'NOT-VERIFIED',
        executionChain,
        turnResult: outcome.type, finalText,
        receiverTasks: receiverDiagnostics.tasks,
        grantAudit: grantAudits.filter(k => k.startsWith('mcp.')),
      },
      notes: observed.slice(0, 40),
    };
  } finally {
    await rpc?.close().catch(() => {});
    await caller?.stop().catch(() => {});
    await receiver?.stop().catch(() => {});
    zcodeFixture.closeAllConnections(); await new Promise(r => zcodeFixture.close(r));
    codexFixture.closeAllConnections(); await new Promise(r => codexFixture.close(r));
  }
}
