import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { Gateway } from '@lam/runtime';
import { MCP_INPUTS, type McpCredential } from '@lam/mcp-contract';
import { privateDirectory } from '@lam/private-storage';
import type { AdapterEvent, SendInput } from '@lam/adapter-sdk';
import type { DshAdapterCore } from './core.js';
import { fixtureEnvironment, verifyFixturePowerShell, type FixturePowerShell } from './native.js';
import { terminateOwnedChild } from './process-tree.js';
import { FIXTURE_TEXT, permissionResult, startAcceptanceFixture, writeCommand } from './acceptance-fixture.js';

export interface AcceptanceOptions {
  root: string;
  kind: 'synthetic' | 'windows-native-local';
  signal?: AbortSignal;
  powerShell?: FixturePowerShell;
  openAdapter: (options: { nodeId: string; home: string; workspaces: Record<string, string>; baseUrl: string }) => Promise<DshAdapterCore>;
}
export interface AcceptanceReport {
  status: 'running' | 'passed-synthetic' | 'passed-windows-native-local' | 'failed';
  evidenceKind: AcceptanceOptions['kind']; platform: string; nodeVersion: string;
  startedUtc: string; endedUtc: string; stage: string;
  physicalCrossHost: 'not-run'; realModel: 'not-configured'; externalNetworkMonitoring: 'not-performed';
  results: Record<string, unknown>;
  cleanup: { complete: boolean; rootRemoved: boolean; fixtureClosed: boolean; retainedForInspection: boolean };
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

/** Execute only our fixed marker-positive-control command; never a model-supplied command. */
async function positiveControl(root: string, marker: string, kind: AcceptanceOptions['kind'], uncertain: () => void, powerShell?: FixturePowerShell) {
  const windowsRoot = process.env.SystemRoot;
  if (kind !== 'synthetic') { if (!powerShell) throw new Error('Explicit PowerShell required'); verifyFixturePowerShell(powerShell); }
  const command = kind === 'synthetic' ? process.execPath : powerShell?.executable;
  if (!command) throw new Error('Control unavailable');
  const args = kind === 'synthetic' ? ['-e', 'require("node:fs").writeFileSync(process.argv[1],"fixture")', marker]
    : ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', writeCommand(marker)];
  const child = spawn(command, args, { cwd: root, env: kind === 'synthetic' ? { SystemRoot: windowsRoot, HOME: root } : fixtureEnvironment(root, 'http://127.0.0.1:1/', powerShell),
    detached: process.platform !== 'win32', windowsHide: true, stdio: 'pipe' });
  let observed = false, termination: Promise<void> | undefined;
  const exited = new Promise<void>(resolve => child.once('close', () => { observed = true; resolve(); }));
  const terminate = () => termination ??= terminateOwnedChild(child, exited, () => observed, true);
  child.stdout.resume(); child.stderr.resume(); child.stdin.on('error', () => {});
  let succeeded = false;
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { void terminate().catch(() => {}); reject(new Error('Control timeout')); }, 15000);
      child.once('error', () => { clearTimeout(timeout); reject(new Error('Control unavailable')); });
      child.once('close', code => { clearTimeout(timeout); if (code === 0) resolve(); else reject(new Error('Control failed')); });
    });
    assert.equal(readFileSync(marker, 'utf8').trim(), 'fixture'); rmSync(marker); assert.equal(existsSync(marker), false);
    succeeded = true;
  } catch { /* Always terminate before reporting a failed control. */ }
  try { await terminate(); } catch { uncertain(); throw new Error('Control cleanup uncertain'); }
  if (!succeeded) throw new Error('Control failed');
}

/** Identical orchestration for real Windows and a named synthetic peer. No physical discovery/pairing. */
export async function runDshAcceptance(options: AcceptanceOptions): Promise<AcceptanceReport> {
  const report: AcceptanceReport = { status: 'running', evidenceKind: options.kind, platform: process.platform, nodeVersion: process.version,
    startedUtc: new Date().toISOString(), endedUtc: '', stage: 'private-storage', physicalCrossHost: 'not-run', realModel: 'not-configured',
    externalNetworkMonitoring: 'not-performed', results: {}, cleanup: { complete: false, rootRemoved: false, fixtureClosed: false, retainedForInspection: true } };
  const adapters: DshAdapterCore[] = [], gateways: Gateway[] = [], clients: Client[] = [];
  let fixture: Awaited<ReturnType<typeof startAcceptanceFixture>> | undefined;
  let lease: Awaited<ReturnType<typeof privateDirectory>> | undefined;
  let grant: { caller: Gateway; id: string } | undefined, cleanupUncertain = false;
  const deadlineSignal = () => AbortSignal.any([AbortSignal.timeout(60000), ...(options.signal ? [options.signal] : [])]);
  const check = () => options.signal?.throwIfAborted();
  try {
    check(); if (!isAbsolute(options.root) || !basename(options.root).startsWith('lam-dsh-acceptance-') || existsSync(options.root)) throw new Error('Fresh namespaced root required');
    lease = await privateDirectory(options.root, { create: true }); lease.assertActive();
    const workspace = join(options.root, 'workspace'); mkdirSync(workspace, { mode: 0o700 });
    const marker = join(workspace, 'denied-marker');
    fixture = await startAcceptanceFixture(marker);
    const base = { nodeId: 'dsh-acceptance-direct', home: join(options.root, 'direct-adapter'), workspaces: { fixture: workspace }, baseUrl: fixture.baseUrl };
    async function open() { check(); const adapter = await options.openAdapter(base); adapters.push(adapter); check(); return adapter; }
    async function collect(adapter: DshAdapterCore, id: string) {
      const events: AdapterEvent[] = [], signal = deadlineSignal();
      for await (const event of adapter.watch(id, signal)) events.push(event);
      signal.throwIfAborted(); assert.ok(events.length && events.at(-1)?.type !== 'delta'); return events;
    }
    const input = (sessionId: string, text: string): SendInput => ({ sessionId, taskId: randomUUID(), idempotencyKey: randomUUID(), text, deadline: new Date(Date.now() + 120000).toISOString() });
    const exact = (events: AdapterEvent[]) => {
      assert.equal(events.filter(e => e.type === 'delta').map(e => e.text).join(''), FIXTURE_TEXT);
      assert.deepEqual(events.at(-1), { type: 'completed', taskId: events[0]!.taskId, text: FIXTURE_TEXT });
    };
    report.stage = 'send-stream'; let adapter = await open();
    const session = await adapter.spawn({ agentId: adapter.agentId, workspaceAlias: 'fixture' });
    assert.notEqual(session.id, session.nativeSessionId);
    const first = input(session.id, 'Return the local fixed greeting.');
    await adapter.send(first); exact(await collect(adapter, first.taskId));
    const calls = fixture.snapshot().calls; assert.ok(calls > 0);
    await adapter.send(first); assert.equal(fixture.snapshot().calls, calls);
    await assert.rejects(adapter.send({ ...first, text: 'changed' }), { code: 'conflict' });
    report.results.sendStreamAndRetry = { passed: true, nativeSessionHash: hash(session.nativeSessionId), fixtureCalls: calls };

    report.stage = 'restart-resume'; await adapter.close(); adapter = await open();
    assert.equal((await adapter.resume(session.id)).nativeSessionId, session.nativeSessionId);
    await adapter.send(first); assert.equal(fixture.snapshot().calls, calls);
    const resumed = input(session.id, 'Return the fixed greeting after process restart.');
    await adapter.send(resumed); exact(await collect(adapter, resumed.taskId));
    report.results.restartResume = { passed: true, originalNativeIdentity: true, originalRetryNoInference: true };

    report.stage = 'permissions'; fixture.setMode('permission');
    await positiveControl(options.root, join(workspace, 'control-marker'), options.kind, () => { cleanupUncertain = true; }, options.powerShell);
    const rejectedBefore = adapter.rejectedOnceRequests, permission = input(session.id, 'Reject the fixture-owned write.');
    await adapter.send(permission); exact(await collect(adapter, permission.taskId));
    const permissionState = fixture.snapshot();
    const causal = { control: true, rejectedOnce: adapter.rejectedOnceRequests > rejectedBefore, sandboxDenied: permissionState.sandboxDenied, markerExists: existsSync(marker) };
    report.results.permissions = { passed: permissionResult(causal) && permissionState.permissionStages === 2 && permissionState.pwsh, ...causal,
      permissionStages: permissionState.permissionStages, pwshAdvertised: permissionState.pwsh,
      controlKind: options.kind === 'synthetic' ? 'synthetic-node-write' : 'powershell-same-command-template', simulatedSandbox: options.kind === 'synthetic' };
    assert.equal(permissionResult(causal), true); assert.equal(permissionState.permissionStages, 2); assert.equal(permissionState.pwsh, true);

    report.stage = 'in-flight-cancel'; fixture.setMode('hold');
    const heldBefore = fixture.snapshot().held, held = input(session.id, 'Wait for fixture cancellation.');
    await adapter.send(held); await fixture.waitHeld(heldBefore, deadlineSignal());
    await assert.rejects(adapter.send(input(session.id, 'Must remain busy.')), { code: 'busy' });
    await adapter.cancel(held.taskId); assert.equal((await collect(adapter, held.taskId)).at(-1)?.type, 'cancelled');
    await fixture.drainHeld(deadlineSignal()); report.results.inFlightCancel = { passed: true, heldHttpObserved: true };

    report.stage = 'shutdown-unknown';
    const beforeUnknown = fixture.snapshot().held, unknown = input(session.id, 'Wait for owned shutdown UNKNOWN.');
    await adapter.send(unknown); await fixture.waitHeld(beforeUnknown, deadlineSignal()); await adapter.close();
    assert.equal((await collect(adapter, unknown.taskId)).at(-1)?.type, 'unknown');
    await fixture.drainHeld(deadlineSignal()); const beforeRetry = fixture.snapshot().calls;
    adapter = await open(); await adapter.send(unknown);
    assert.equal((await collect(adapter, unknown.taskId)).at(-1)?.type, 'unknown');
    await assert.rejects(adapter.resume(session.id), { code: 'busy' });
    await assert.rejects(adapter.send(input(session.id, 'Must not replay.')), { code: 'busy' });
    assert.equal(fixture.snapshot().calls, beforeRetry); await adapter.close();
    report.results.shutdownUnknown = { passed: true, persistedUnknown: true, noReplay: true, hardCrash: 'not-exercised' };

    report.stage = 'mcp-start'; fixture.setMode('text');
    const caller = new Gateway({ directory: join(options.root, 'caller'), listen: ['/ip4/127.0.0.1/tcp/0'], mdns: false }); gateways.push(caller); await caller.start();
    let executorAdapter: DshAdapterCore | undefined;
    const executor = new Gateway({ directory: join(options.root, 'executor'), listen: ['/ip4/127.0.0.1/tcp/0'], mdns: false,
      exportAgents: nodeId => [`${nodeId}/dsh/default`], adapterFactories: [async ({ nodeId }) => {
        executorAdapter = await options.openAdapter({ ...base, nodeId, home: join(options.root, 'mesh-adapter') }); return executorAdapter;
      }] }); gateways.push(executor); await executor.start();
    // Only these new loopback-owned identities are confirmed automatically, never a physical pairing.
    report.stage = 'mcp-pair';
    const pair = await caller.mesh.beginPairing(executor.mesh.addresses[0]!);
    assert.equal(executor.mesh.pendingPairings().find(p => p.id === pair.id)?.code, pair.code);
    await caller.mesh.confirmPairing(pair.id, pair.code); await executor.mesh.confirmPairing(pair.id, pair.code);
    const registry = await caller.sync(executor.mesh.id); assert.equal(registry.harnesses[0]?.kind, 'dsh');
    report.stage = 'mcp-grant';
    const credential = await caller.command('mcp-grant', { peers: [executor.mesh.id], agents: [executorAdapter!.agentId], workspaces: ['fixture'] }) as McpCredential;
    grant = { caller, id: credential.grantId };
    const credentialPath = join(options.root, 'mcp-credential.json'); writeFileSync(credentialPath, JSON.stringify(credential), { mode: 0o600, flag: 'wx' });
    const env = Object.fromEntries(Object.entries({ SystemRoot: process.env.SystemRoot, HOME: options.root, USERPROFILE: options.root,
      PATH: process.env.SystemRoot ? join(process.env.SystemRoot, 'System32') : '/usr/bin:/bin' }).filter((entry): entry is [string, string] => entry[1] !== undefined));
    const transport = new StdioClientTransport({ command: process.execPath, env,
      args: [fileURLToPath(new URL('../../mcp-server/dist/cli.js', import.meta.url)), '--credentials', credentialPath], stderr: 'pipe', maxBufferSize: 262144 });
    transport.stderr?.on('data', () => {});
    report.stage = 'mcp-connect';
    const client = new Client({ name: 'lam-dsh-acceptance', version: '0.0.0' }); clients.push(client); await client.connect(transport);
    const tools = await client.listTools(); assert.deepEqual(tools.tools.map(t => t.name).sort(), Object.keys(MCP_INPUTS).sort());
    async function tool(name: string, args: Record<string, unknown> = {}) {
      check(); const result = await client.callTool({ name, arguments: args }); assert.notEqual(result.isError, true);
      const text = result.content.find(c => c.type === 'text');
      return (result.structuredContent ?? (text?.type === 'text' ? JSON.parse(text.text) : {})) as Record<string, unknown>;
    }
    async function terminal(id: string) {
      let cursor = 0; const events: Record<string, unknown>[] = [], signal = deadlineSignal();
      for (;;) {
        signal.throwIfAborted(); const result = await tool('mesh_get_task', { taskId: id, cursor });
        const part = result.events as Record<string, unknown>[]; events.push(...part); cursor = result.next as number;
        if (!['QUEUED', 'RUNNING', 'WAITING_INPUT'].includes(result.state as string) && !part.length) return { state: result.state, events };
        await new Promise(r => setTimeout(r, 100));
      }
    }
    report.stage = 'mcp-session';
    const remoteSession = await tool('mesh_start_session', { peerId: executor.mesh.id, agentId: executorAdapter!.agentId, workspaceAlias: 'fixture', requestId: randomUUID() });
    const request = { sessionId: remoteSession.sessionId, text: 'MCP fixed greeting.', requestId: randomUUID() };
    report.stage = 'mcp-send';
    const sent = await tool('mesh_send_message', request), completed = await terminal(sent.taskId as string);
    assert.equal(completed.state, 'COMPLETED'); assert.ok(completed.events.some(e => e.type === 'completed' && e.text === FIXTURE_TEXT));
    const count = fixture.snapshot().calls;
    assert.equal((await tool('mesh_send_message', request)).taskId, sent.taskId); assert.equal(fixture.snapshot().calls, count);
    assert.equal(executor.store.count('tasks'), 1);
    report.stage = 'mcp-cancel'; fixture.setMode('hold'); const heldMcpBefore = fixture.snapshot().held;
    const delegated = await tool('mesh_delegate_task', { sessionId: remoteSession.sessionId, text: 'MCP held cancellation.', requestId: randomUUID() });
    await fixture.waitHeld(heldMcpBefore, deadlineSignal());
    assert.equal((await tool('mesh_cancel_task', { taskId: delegated.taskId })).cancelRequested, true);
    assert.equal((await terminal(delegated.taskId as string)).state, 'CANCELLED'); await fixture.drainHeld(deadlineSignal());
    assert.equal(executor.store.count('tasks'), 2); report.stage = 'mcp-revoke';
    await caller.command('mcp-revoke', { grantId: credential.grantId }); grant = undefined;
    assert.equal((await client.callTool({ name: 'mesh_list_sessions', arguments: {} })).isError, true);
    report.results.mcpMesh = { passed: true, sevenTools: true, exactResult: true, exactRetryNoInference: true, inFlightCancel: true, revoked: true,
      physicalTransport: false, sameHostLoopback: true };
    report.results.fixture = fixture.snapshot(); assert.equal(fixture.snapshot().rejected, 0);
    report.status = options.kind === 'synthetic' ? 'passed-synthetic' : 'passed-windows-native-local';
  } catch { report.status = 'failed'; }
  finally {
    if (fixture) report.results.fixture = fixture.snapshot();
    if (grant) { try { await grant.caller.command('mcp-revoke', { grantId: grant.id }); } catch { cleanupUncertain = true; } }
    if ((await Promise.allSettled(clients.map(c => c.close()))).some(r => r.status === 'rejected')) cleanupUncertain = true;
    if ((await Promise.allSettled(gateways.map(g => g.stop()))).some(r => r.status === 'rejected')) cleanupUncertain = true;
    if ((await Promise.allSettled(adapters.map(a => a.close()))).some(r => r.status === 'rejected')) cleanupUncertain = true;
    if (gateways.some(g => g.server?.listening) || ['direct-adapter', 'mesh-adapter'].some(home => existsSync(join(options.root, home, 'adapter.lock')))) cleanupUncertain = true;
    try { if (fixture) await fixture.close(); report.cleanup.fixtureClosed = !fixture?.listening; } catch { cleanupUncertain = true; }
    try { await lease?.close(); } catch { cleanupUncertain = true; }
    if (!cleanupUncertain && lease) { try { rmSync(options.root, { force: true, recursive: true }); report.cleanup.rootRemoved = !existsSync(options.root); } catch { cleanupUncertain = true; } }
    report.cleanup.complete = !cleanupUncertain && report.cleanup.rootRemoved && report.cleanup.fixtureClosed;
    report.cleanup.retainedForInspection = existsSync(options.root);
    if (!report.cleanup.complete) report.status = 'failed';
    report.endedUtc = new Date().toISOString();
  }
  return report;
}
