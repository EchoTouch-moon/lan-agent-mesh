import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, writeFileSync, readdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Gateway } from '../packages/runtime/dist/index.js';
import { decodeEnvelope, encodeEnvelope } from '../packages/protocol/dist/index.js';
import { privateDirectory, privateFile } from '../packages/private-storage/dist/index.js';

const { values } = parseArgs({ options: {
  'self-test': { type: 'boolean' }, help: { type: 'boolean' }, role: { type: 'string' },
  data: { type: 'string' }, output: { type: 'string' }, peer: { type: 'string' }, address: { type: 'string' },
  'expected-source': { type: 'string' }, 'peer-platform': { type: 'string' },
  'wait-ms': { type: 'string' }, listen: { type: 'string' }, 'self-test-delay-ms': { type: 'string' }, 'self-test-ack-age-ms': { type: 'string' },
} });
if (values.help) {
  console.log('Build first. --self-test | --role prepare|receiver|runner --data <outside-repo private directory> --output <new private report> --expected-source <full SHA> [--peer ID --address host:port --peer-platform win32|darwin] [--listen /ip4/0.0.0.0/tcp/48731] [--wait-ms 7200000 (maximum 14400000; prepare/receiver only)]');
  process.exit(0);
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
// A refreshed transport ID/deadline may differ; every business/correlation/identity field must match.
const outcomeSha = reply => sha(JSON.stringify(Object.fromEntries(Object.entries(reply).filter(([key]) => !['messageId', 'deadline'].includes(key)))));
const repository = resolve(fileURLToPath(new globalThis.URL('..', import.meta.url)));
assert.equal(resolve(execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).replace(/\r?\n$/, '')), repository, 'Run from this repository');
assert.equal(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(), '', 'Commit and push probe source before execution');
const source = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (values['expected-source']) assert.equal(source, values['expected-source'], 'Wrong committed source');
const report = {
  kind: values['self-test'] ? 'same-host two-node self-test; never physical W3 evidence' : `operator ${values.role}; physical claim requires counterpart review`,
  testedSourceSha: source, sourceCleanBeforeStart: true, platform: process.platform, node: process.version,
  startedUtc: new Date().toISOString(), status: 'running', results: {}, cleanup: [], externalModels: 0,
  sourceSha256: {}, distSha256: {}, probeWorkingBytesSha256: sha(readFileSync(fileURLToPath(import.meta.url))),
};
for (const file of ['packages/runtime/src/index.ts', 'packages/runtime/src/router.ts', 'packages/runtime/src/sessions.ts', 'packages/mesh/src/index.ts', 'packages/storage/src/index.ts', 'packages/mock-adapter/src/index.ts'])
  report.sourceSha256[file] = sha(execFileSync('git', ['show', `${source}:${file}`]));
for (const file of ['packages/runtime/dist/index.js', 'packages/runtime/dist/router.js', 'packages/runtime/dist/sessions.js', 'packages/mesh/dist/index.js', 'packages/storage/dist/index.js', 'packages/mock-adapter/dist/index.js'])
  report.distSha256[file] = sha(readFileSync(file));
const ACK_TEXT = 'w3-fault ack fixture', CANCEL_TEXT = 'w3-fault cancel fixture';
const markerName = 'w3-fault-owned.json', owned = [], receivers = [];
let stage = 'validation', outputLease, temporaryRoot, interrupted = false;
const within = (parent, path) => { const r = relative(parent, path); return r === '' || (r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r)); };
function present(path) { try { lstatSync(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
async function loadMarker(data) {
  const lease = await privateFile(join(data, markerName));
  try { lease.assertActive(); return JSON.parse(readFileSync(join(data, markerName), 'utf8')); }
  finally { await lease.close(); }
}
async function start(data, role, listen, delayMs) {
  const adopted = role === 'runner';
  let marker;
  if (adopted) {
    marker = await loadMarker(data);
    assert.equal(marker.role, 'prepare'); assert.equal(marker.source, source);
  } else {
    assert.equal(present(data), false, 'Fresh role refuses every existing path, including symlinks');
    const lease = await privateDirectory(data, { create: true });
    try {
      lease.assertActive(); assert.deepEqual(readdirSync(data), []);
      marker = { role, source, nonce: randomUUID() };
      writeFileSync(join(data, markerName), JSON.stringify(marker), { mode: 0o600, flag: 'wx' });
    } finally { await lease.close(); }
  }
  const entry = { data, marker, role, gateway: new Gateway({ directory: data, listen: [listen], mdns: !values['self-test'], mock: true, scenario: { delayMs } }), started: false };
  const command = entry.gateway.command.bind(entry.gateway);
  entry.gateway.command = async (name, args) => {
    const result = await command(name, args); // Keep the real authenticated control handler and validation.
    if (name === 'shutdown') entry.operatorShutdownRequested = true;
    return result;
  };
  owned.push(entry);
  const g = await entry.gateway.start(); entry.started = true;
  if (adopted) assert.equal(marker.nodeId, g.mesh.id, 'Prepared identity changed');
  else {
    marker.nodeId = g.mesh.id;
    writeFileSync(join(data, markerName), JSON.stringify(marker), { mode: 0o600 });
  }
  entry.ports = [...new Set(g.mesh.addresses.map(a => Number(a.match(/\/tcp\/(\d+)/)?.[1])).filter(Boolean))];
  entry.controlPort = Number(new globalThis.URL(g.url).port);
  return entry;
}
function observe(g) {
  const deliveries = [], revocations = [], populated = new Set(), peers = new Map();
  const original = g.mesh.options.onMessage;
  g.mesh.options.onMessage = async (peer, body) => {
    const result = await original(peer, body); // Authentication and real routing remain in force.
    if (body?.kind === 'envelope' && body.value?.type === 'task.request' && [ACK_TEXT, CANCEL_TEXT].includes(body.value.payload?.text) && result?.type === 'task.accepted') {
      deliveries.push({ peerIdSha256: sha(peer), text: body.value.payload.text, taskId: body.value.taskId,
        envelopeSha256: sha(JSON.stringify(body.value)), replySha256: sha(JSON.stringify(result)), replyOutcomeSha256: outcomeSha(result), at: new Date().toISOString() });
      if (deliveries.length > 64) throw new Error('Probe receipt capacity');
      // Populate the real private-card cache while this authenticated peer is online.
      const registry = await g.sync(peer);
      peers.set(sha(peer), { nodeIdSha256: sha(peer), platform: registry.node.platform });
      if (g.remoteAgents().some(a => a.nodeId === peer)) populated.add(peer);
    }
    return result;
  };
  const revoke = g.mesh.revoke.bind(g.mesh);
  g.mesh.revoke = async peer => {
    const cachedBefore = g.remoteAgents().filter(a => a.nodeId === peer).length;
    await revoke(peer);
    const cachedAfter = g.remoteAgents().filter(a => a.nodeId === peer).length;
    await assert.rejects(g.sync(peer), error => error.code === 'permission_denied');
    revocations.push({ peerIdSha256: sha(peer), cachedBefore, cachedAfter, cacheWasPopulatedDuringRun: populated.has(peer), registryRefused: true });
  };
  const observation = { gateway: g, deliveries, revocations, peers };
  receivers.push(observation); return observation;
}
async function collect(g, peer, taskId, predicate = b => ['COMPLETED', 'CANCELLED', 'FAILED', 'UNKNOWN'].includes(b.state)) {
  const events = []; let cursor = 0;
  for (let n = 0; n < 1200; n++) {
    assert.equal(interrupted, false, 'Interrupted');
    const batch = await g.events(peer, taskId, cursor);
    events.push(...batch.events); cursor = batch.next;
    if (predicate(batch) && batch.events.length === 0) return { state: batch.state, events, cursor };
    // The real Mesh allows 240 requests/minute. Leave room for registry/keepalive traffic.
    await delay(250);
  }
  throw new Error('Bounded event wait expired');
}
async function faultCases(g, peer, address, peerPlatform, minimumAckAgeMs = 0) {
  stage = 'trusted_mock_peer';
  assert.equal(g.mesh.trusted(peer), true, 'Human pairing must precede physical runner; no auto-confirm');
  if (address) await g.mesh.connect(address, peer);
  const registry = await g.sync(peer);
  if (peerPlatform) assert.equal(registry.node.platform, peerPlatform);
  const agent = registry.agents.find(a => a.id === `${peer}/mock/default`);
  assert.ok(agent && registry.harnesses.some(h => h.id === agent.harnessId && h.kind === 'mock' && h.version === 'mock/1'), 'Only explicit remote Mock is permitted');
  report.nodeIdSha256 = sha(g.mesh.id); report.peerIdSha256 = sha(peer); report.peerPlatform = registry.node.platform;
  const session = await g.spawn(peer, agent.id, 'project-a'), taskId = randomUUID();
  const request = g.envelope(peer, 'task.request', { sessionId: session.id, text: ACK_TEXT, workspaceAlias: 'project-a', delegationDepth: 0 }, taskId, agent.id);
  request.deadline = new Date(Date.now() + 240000).toISOString();
  stage = 'discard_delivery_ack';
  const real = g.mesh.request.bind(g.mesh); let dropped = false, firstReply, discardedAt;
  g.mesh.request = async (target, body) => {
    const value = await real(target, body);
    if (!dropped && target === peer && body?.kind === 'envelope' && body.value?.messageId === request.messageId) {
      const reply = decodeEnvelope(encodeEnvelope(value));
      assert.equal(reply.type, 'task.accepted'); assert.equal(reply.source.nodeId, peer);
      assert.equal(reply.target.nodeId, g.mesh.id); assert.equal(reply.correlationId, request.messageId);
      assert.equal(reply.taskId, taskId); dropped = true; firstReply = reply; discardedAt = Date.now();
      throw new Error('W3_CONTROLLED_ACK_DISCARD');
    }
    return value;
  };
  try { await assert.rejects(g.sendEnvelope(peer, request), /W3_CONTROLLED_ACK_DISCARD/); }
  finally { g.mesh.request = real; }
  assert.equal(dropped, true);
  const pending = g.store.pending().find(p => p.id === request.messageId);
  assert.ok(pending); assert.deepEqual(pending.message, request);
  const first = await collect(g, peer, taskId);
  assert.equal(first.state, 'COMPLETED'); assert.equal(first.events.at(-1).text, `mock:${ACK_TEXT}`);
  await delay(Math.max(0, minimumAckAgeMs - (Date.now() - discardedAt)));
  stage = 'retry_original_outbox_envelope';
  const retried = await g.command('retry', { messageId: request.messageId });
  assert.equal(outcomeSha(retried), outcomeSha(firstReply));
  if (minimumAckAgeMs >= 31000) assert.notEqual(retried.messageId, firstReply.messageId, 'Expired transport reply needs a fresh identity');
  assert.equal(g.store.pending().some(p => p.id === request.messageId), false);
  assert.deepEqual(await collect(g, peer, taskId), first);
  report.results.deliveryAckDiscard = { status: 'verified', injection: 'caller API boundary after correlated real acceptance, before durable outbox ACK; no packet-loss claim',
    originalEnvelopeSha256: sha(JSON.stringify(request)), taskIdSha256: sha(taskId), outboxRetainedThenCleared: true, identicalEventsAfterRetry: true,
    minimumAckAgeMs, businessOutcomeSha256: outcomeSha(retried), transportReplyRefreshed: retried.messageId !== firstReply.messageId,
    eventTypes: first.events.map(e => e.type), events: publicEvents(first.events) };
  stage = 'in_flight_cancel';
  const secondSession = await g.spawn(peer, agent.id, 'project-a'), cancelId = randomUUID();
  await g.submit(peer, secondSession, CANCEL_TEXT, randomUUID(), cancelId, new Date(Date.now() + 240000).toISOString());
  // Require a RUNNING observation before sending cancel; late COMPLETED is a failure, never "cancelled".
  const running = await g.events(peer, cancelId, 0); assert.equal(running.state, 'RUNNING');
  assert.ok(running.events.some(e => e.type === 'started'));
  await g.sendEnvelope(peer, g.envelope(peer, 'task.cancel', {}, cancelId));
  const cancelled = await collect(g, peer, cancelId);
  assert.equal(cancelled.state, 'CANCELLED'); assert.equal(cancelled.events.at(-1).type, 'cancelled');
  assert.equal(cancelled.events.some(e => e.type === 'completed'), false);
  report.results.inFlightCancel = { status: 'verified', taskIdSha256: sha(cancelId), observedBeforeRequest: 'RUNNING', terminal: 'CANCELLED', eventTypes: cancelled.events.map(e => e.type), events: publicEvents(cancelled.events) };
  stage = 'revoke_and_cache_invalidation';
  assert.ok(g.remoteAgents().some(a => a.nodeId === peer), 'Runner cache must be populated immediately before revocation');
  await g.command('revoke', { peer });
  assert.equal(g.remoteAgents().some(a => a.nodeId === peer), false);
  await assert.rejects(g.sync(peer), error => error.code === 'permission_denied');
  report.results.runnerRevoke = { status: 'verified', registryRefused: true, cachedCardsUnavailable: true };
}
function publicEvents(events) {
  return events.map(e => ({ type: e.type, taskIdSha256: sha(e.taskId), ...(['delta', 'completed'].includes(e.type) ? { text: e.text } : {}) }));
}
function snapshot(observation) {
  const g = observation.gateway;
  // Inspect every fixed-fixture task, so an unexpected second logical execution cannot hide off-receipt.
  const tasks = g.store.query('SELECT id,state,events FROM tasks WHERE json_extract(input, ?) IN (?,?)', '$.text', ACK_TEXT, CANCEL_TEXT).map(row => {
    const events = JSON.parse(row.events);
    return { taskIdSha256: sha(row.id), state: row.state, eventTypes: events.map(e => e.type), events: publicEvents(events) };
  });
  return { nodeIdSha256: sha(g.mesh.id), peers: [...observation.peers.values()], deliveries: observation.deliveries.map(({ taskId, ...d }) => ({ ...d, taskIdSha256: sha(taskId) })), tasks, revocations: observation.revocations };
}
function receiverVerified(r) {
  if (!r) return false;
  const ack = r.deliveries.filter(d => d.text === ACK_TEXT), cancel = r.deliveries.filter(d => d.text === CANCEL_TEXT);
  if (ack.length !== 2 || cancel.length !== 1 || r.tasks.length !== 2 ||
      ack[0].taskIdSha256 !== ack[1].taskIdSha256 || ack[0].taskIdSha256 === cancel[0].taskIdSha256 ||
      ack[0].envelopeSha256 !== ack[1].envelopeSha256 || ack[0].replyOutcomeSha256 !== ack[1].replyOutcomeSha256) return false;
  const completed = r.tasks.find(t => t.taskIdSha256 === ack[0].taskIdSha256);
  const cancelled = r.tasks.find(t => t.taskIdSha256 === cancel[0].taskIdSha256);
  return completed?.state === 'COMPLETED' && JSON.stringify(completed.eventTypes) === JSON.stringify(['started', 'delta', 'delta', 'completed']) &&
    cancelled?.state === 'CANCELLED' && cancelled.eventTypes.includes('started') && cancelled.eventTypes.at(-1) === 'cancelled' &&
    !cancelled.eventTypes.includes('completed') &&
    r.revocations.some(v => v.cacheWasPopulatedDuringRun && v.cachedAfter === 0 && v.registryRefused);
}
async function waitForOperator(g, waitMs) {
  if (!g.server?.listening) return 'already_stopped';
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve('window_expired'), waitMs);
    g.server.once('close', () => {
      clearTimeout(timer);
      resolve(owned.find(entry => entry.gateway === g)?.operatorShutdownRequested ? 'control_shutdown' : 'unexpected_stop');
    });
  });
}
async function portReleased(port) {
  await new Promise((resolvePort, reject) => {
    const server = createServer(); server.once('error', reject);
    server.listen(port, '127.0.0.1', () => server.close(error => error ? reject(error) : resolvePort()));
  });
}
process.once('SIGINT', () => { interrupted = true; for (const e of owned) void e.gateway.stop().catch(() => {}); });
process.once('SIGTERM', () => { interrupted = true; for (const e of owned) void e.gateway.stop().catch(() => {}); });
try {
  if (values['self-test']) {
    for (const key of ['role', 'data', 'output', 'peer', 'address', 'peer-platform', 'listen', 'wait-ms']) assert.equal(values[key], undefined);
    temporaryRoot = mkdtempSync(join(tmpdir(), 'LAM W3 self-test & '));
    const receiverDelay = Number(values['self-test-delay-ms'] ?? 1000);
    assert.ok(Number.isInteger(receiverDelay) && receiverDelay >= 1000 && receiverDelay <= 10000);
    const minimumAckAge = Number(values['self-test-ack-age-ms'] ?? 0);
    assert.ok(Number.isInteger(minimumAckAge) && minimumAckAge >= 0 && minimumAckAge <= 60000);
    let a = await start(join(temporaryRoot, 'caller'), 'prepare', '/ip4/127.0.0.1/tcp/0', 1000);
    const b = await start(join(temporaryRoot, 'receiver'), 'self-test', '/ip4/127.0.0.1/tcp/0', receiverDelay);
    report.selfTestReceiverDelayMs = receiverDelay;
    const observer = observe(b.gateway);
    const pairing = await a.gateway.mesh.beginPairing(b.gateway.mesh.addresses[0], b.gateway.mesh.id);
    const other = b.gateway.mesh.pendingPairings().find(p => p.id === pairing.id); assert.equal(pairing.code, other.code);
    await a.gateway.mesh.confirmPairing(pairing.id, pairing.code); await b.gateway.mesh.confirmPairing(other.id, other.code);
    // Exercise the real prepare -> authenticated-command stop -> marked-directory adoption path.
    const preparedId = a.gateway.mesh.id, old = a;
    const preparedStop = waitForOperator(old.gateway, 10000);
    await old.gateway.command('shutdown', {});
    assert.equal(await preparedStop, 'control_shutdown'); await old.gateway.stop();
    for (const port of [...old.ports, old.controlPort]) await portReleased(port);
    owned.splice(owned.indexOf(old), 1); // Custody transfers to the runner, never two cleanup owners.
    a = await start(old.data, 'runner', '/ip4/127.0.0.1/tcp/0', 1000);
    assert.equal(a.gateway.mesh.id, preparedId);
    assert.equal(a.gateway.mesh.trusted(b.gateway.mesh.id), true);
    report.results.prepareRunnerAdoption = { status: 'verified', identityAndTrustPreserved: true, automaticPairingLimitedToOwnedLoopbackNodes: true };
    await faultCases(a.gateway, b.gateway.mesh.id, b.gateway.mesh.addresses[0], undefined, minimumAckAge);
    await b.gateway.command('revoke', { peer: a.gateway.mesh.id });
    const observed = snapshot(observer), ack = observed.deliveries.filter(d => d.text === ACK_TEXT);
    assert.equal(ack.length, 2); assert.equal(ack[0].envelopeSha256, ack[1].envelopeSha256); assert.equal(ack[0].replyOutcomeSha256, ack[1].replyOutcomeSha256);
    assert.equal(observed.tasks.length, 2); assert.equal(observed.tasks.filter(t => t.state === 'COMPLETED').length, 1); assert.equal(observed.tasks.filter(t => t.state === 'CANCELLED').length, 1);
    assert.equal(observed.revocations[0].cacheWasPopulatedDuringRun, true); assert.equal(observed.revocations[0].cachedAfter, 0);
    assert.equal(receiverVerified(observed), true);
    const swapped = globalThis.structuredClone(observed);
    for (const task of swapped.tasks) task.state = task.state === 'COMPLETED' ? 'CANCELLED' : 'COMPLETED';
    assert.equal(receiverVerified(swapped), false, 'Aggregate terminal counts must not allow swapped ACK/cancel task identities');
    const changedEnvelope = globalThis.structuredClone(observed);
    changedEnvelope.deliveries.filter(d => d.text === ACK_TEXT)[1].envelopeSha256 = 'changed';
    assert.equal(receiverVerified(changedEnvelope), false, 'A different envelope is not an original-envelope retry');
    const changedOutcome = globalThis.structuredClone(observed);
    changedOutcome.deliveries.filter(d => d.text === ACK_TEXT)[1].replyOutcomeSha256 = 'changed';
    assert.equal(receiverVerified(changedOutcome), false, 'Transport refresh cannot change the cached business outcome');
    const closedSnapshot = new Promise(resolveSnapshot => b.gateway.server.once('close', () => resolveSnapshot(snapshot(observer))));
    const receiverStop = waitForOperator(b.gateway, 10000);
    await b.gateway.command('shutdown', {});
    assert.equal(await receiverStop, 'control_shutdown'); await b.gateway.stop();
    assert.deepEqual(await closedSnapshot, observed);
    report.results.receiver = observed; report.results.receiverCloseSnapshot = 'verified before Store teardown'; report.status = 'passed';
  } else {
    assert.equal(values['self-test-delay-ms'], undefined);
    assert.equal(values['self-test-ack-age-ms'], undefined);
    assert.ok(['darwin', 'win32'].includes(process.platform));
    assert.ok(['prepare', 'receiver', 'runner'].includes(values.role));
    assert.equal(values['expected-source'], source, 'Physical roles require an explicit full source SHA');
    assert.ok(values.data && values.output); const data = resolve(values.data), output = resolve(values.output);
    assert.equal(within(repository, data) || within(repository, output) || within(data, output), false, 'Keep data/output outside source; report must survive data cleanup');
    assert.equal(present(output), false, 'Never overwrite a report');
    outputLease = await privateDirectory(dirname(output), { create: true, files: [basename(output)] });
    if (values.role === 'runner') assert.equal(values['wait-ms'], undefined, '--wait-ms only controls prepare/receiver readiness, not task deadlines');
    const waitMs = Number(values['wait-ms'] ?? 7200000); assert.ok(Number.isInteger(waitMs) && waitMs >= 1000 && waitMs <= 14400000);
    const listen = values.listen ?? '/ip4/0.0.0.0/tcp/48731'; assert.match(listen, /^\/ip4\/(?:127\.0\.0\.1|0\.0\.0\.0)\/tcp\/\d+$/);
    const entry = await start(data, values.role, listen, 10000), g = entry.gateway;
    report.nodeIdSha256 = sha(g.mesh.id);
    entry.output = output;
    if (values.role === 'runner') {
      assert.ok(values.peer && values.address); assert.ok(['win32', 'darwin'].includes(values['peer-platform']));
      assert.notEqual(values['peer-platform'], process.platform, 'Physical runner requires the other platform');
      await faultCases(g, values.peer, values.address, values['peer-platform']); report.status = 'passed';
    } else {
      const observer = values.role === 'receiver' ? observe(g) : undefined;
      report.operatorWindow = { waitMs, expiresUtc: new Date(Date.now() + waitMs).toISOString() };
      console.log(JSON.stringify({ phase: 'ready_for_local_human_pairing', role: values.role, nodeId: g.mesh.id, addresses: g.mesh.addresses, source, operatorWindow: report.operatorWindow }));
      stage = 'operator_window';
      // Snapshot synchronously on close, before Gateway tears down its Store.
      g.server.once('close', () => { if (observer) report.results.receiver = snapshot(observer); });
      const reason = await waitForOperator(g, waitMs);
      entry.preserve = values.role === 'prepare' && reason === 'control_shutdown' && !interrupted;
      report.stopReason = reason; report.status = entry.preserve ? 'prepared' : 'partial';
      if (observer && reason === 'control_shutdown') {
        if (receiverVerified(report.results.receiver)) report.status = 'passed';
      }
    }
  }
} catch {
  report.status = 'failed'; report.failureStage = stage; process.exitCode = 1;
} finally {
  for (const entry of owned.reverse()) {
    try {
      await entry.gateway.stop();
      if (entry.started) { for (const port of [...entry.ports, entry.controlPort]) await portReleased(port); }
      assert.equal(existsSync(join(entry.data, 'control.json')), false); assert.equal(existsSync(join(entry.data, 'gateway.lock')), false);
      if (!entry.preserve) {
        assert.equal((await loadMarker(entry.data)).nonce, entry.marker.nonce); rmSync(entry.data, { recursive: true });
      }
      report.cleanup.push({ role: entry.role, gatewayStopped: true, portsReleased: true, dataRemoved: !entry.preserve, preparedIdentityPreservedForRunner: Boolean(entry.preserve) });
    } catch { report.status = 'failed'; report.failureStage = 'cleanup'; process.exitCode = 1; }
  }
  if (temporaryRoot) { try { rmSync(temporaryRoot, { recursive: true }); } catch { report.status = 'failed'; report.failureStage = 'cleanup'; process.exitCode = 1; } }
  report.endedUtc = new Date().toISOString();
  if (values.output) {
    try { assert.ok(outputLease, 'Private report directory was not verified'); outputLease.assertActive(); writeFileSync(resolve(values.output), JSON.stringify(report, null, 2) + '\n', { mode: 0o600, flag: 'wx' }); }
    catch { report.status = 'failed'; report.failureStage = 'report_write'; process.exitCode = 1; }
  }
  await outputLease?.close();
}
console.log(JSON.stringify(report, null, 2));
