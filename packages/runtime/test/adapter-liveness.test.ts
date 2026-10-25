import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { createMockAdapter } from '@lam/mock-adapter';
import { Gateway } from '../src/index.js';
import { Sessions } from '../src/sessions.js';
import { Store } from '@lam/storage';
import { Router } from '../src/router.js';
import type { ProbeResult } from '@lam/adapter-sdk';

const roots: string[] = [], gateways: Gateway[] = [];
afterEach(async () => { for (const g of gateways.splice(0)) await g.stop(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
it('refreshes an offline local provider out of the remote registry and refuses new work without calling its operations', async () => {
  let available = true;
  const root = mkdtempSync(join(tmpdir(), 'lam-provider-liveness-')); roots.push(root);
  const caller = new Gateway({ directory: join(root, 'caller'), listen: ['/ip4/127.0.0.1/tcp/0'], mdns: false }); gateways.push(caller); await caller.start();
  let native: ReturnType<typeof createMockAdapter> | undefined;
  const receiver = new Gateway({ directory: join(root, 'receiver'), listen: ['/ip4/127.0.0.1/tcp/0'], mdns: false,
    exportAgents: id => [`${id}/mock/restricted`, `${id}/mock/default`], adapterFactories: [async ({ nodeId }) => {
      native = createMockAdapter({ nodeId }); const original = native.probe.bind(native);
      const discover = native.discover.bind(native);
      native.discover = async () => { const [agent] = await discover(); return [{ ...agent!, id: `${nodeId}/mock/restricted`, capabilities: { ...agent!.capabilities, send: 'unsupported' } }, agent!]; };
      native.probe = vi.fn(async () => ({ ...await original(), available })); return native;
    }] }); gateways.push(receiver); await receiver.start();
  const pairing = await caller.mesh.beginPairing(receiver.mesh.addresses[0]!);
  expect(receiver.mesh.pendingPairings()[0]!.code).toBe(pairing.code);
  await caller.mesh.confirmPairing(pairing.id, pairing.code); await receiver.mesh.confirmPairing(pairing.id, pairing.code);
  const initial = await caller.sync(receiver.mesh.id), agent = initial.agents.find(a => a.id.endsWith('/default'))!;
  expect(initial.harnesses[0]?.capabilities.send).toBe('supported'); expect(initial.agents[0]?.capabilities.send).toBe('unsupported');
  const session = await caller.spawn(receiver.mesh.id, agent.id, 'project-a');
  const original = caller.envelope(receiver.mesh.id, 'task.request', { sessionId: session.id, text: 'retained result', workspaceAlias: 'project-a', delegationDepth: 0 }, randomUUID(), agent.id);
  const accepted = await caller.sendEnvelope(receiver.mesh.id, original);
  const completeBy = Date.now() + 5000;
  while (receiver.store.task(original.taskId!)?.state !== 'COMPLETED') { if (Date.now() > completeBy) throw new Error('Fixture task not complete'); await new Promise(r => setTimeout(r, 10)); }
  const send = vi.spyOn(native!, 'send'), spawn = vi.spyOn(native!, 'spawn'), resume = vi.spyOn(native!, 'resume');
  available = false;
  expect((await caller.sync(receiver.mesh.id)).agents).toEqual([]);
  expect(caller.remoteAgents()).toEqual([]);
  expect(caller.registryEvents.at(-1)?.type).toBe('capability_changed');
  expect(await caller.sendEnvelope(receiver.mesh.id, original)).toEqual(accepted);
  const freshRetry = { ...original, messageId: randomUUID() };
  expect((await caller.sendEnvelope(receiver.mesh.id, freshRetry)).type).toBe('task.accepted');
  await expect(caller.spawn(receiver.mesh.id, agent.id, 'project-a')).rejects.toMatchObject({ code: 'unsupported' });
  await expect(caller.submit(receiver.mesh.id, session, 'must not execute', randomUUID(), randomUUID())).rejects.toMatchObject({ code: 'unsupported' });
  await expect(caller.sendEnvelope(receiver.mesh.id, caller.envelope(receiver.mesh.id, 'session.resume', { sessionId: session.id }))).rejects.toMatchObject({ code: 'unsupported' });
  await expect(caller.sendEnvelope(receiver.mesh.id, caller.envelope(receiver.mesh.id, 'session.create', { agentId: agent.id, workspaceAlias: 'project-a' }))).rejects.toMatchObject({ code: 'unsupported' });
  const newTask = caller.envelope(receiver.mesh.id, 'task.request', { sessionId: session.id, text: 'must not execute', workspaceAlias: 'project-a', delegationDepth: 0 }, randomUUID(), agent.id);
  await expect(caller.sendEnvelope(receiver.mesh.id, newTask)).rejects.toMatchObject({ code: 'unsupported' });
  expect(send).not.toHaveBeenCalled(); expect(spawn).not.toHaveBeenCalled(); expect(resume).not.toHaveBeenCalled();
  expect(receiver.store.count('tasks')).toBe(1); expect(receiver.store.list('sessions')).toHaveLength(1);
  available = true;
  const restored = await caller.sync(receiver.mesh.id); expect(restored.agents).toHaveLength(2);
  expect(restored.agents.find(a => a.id.endsWith('/restricted'))?.capabilities.send).toBe('unsupported');
  expect(await caller.sendEnvelope(receiver.mesh.id, caller.envelope(receiver.mesh.id, 'session.resume', { sessionId: session.id }))).toBeDefined();
  expect(resume).toHaveBeenCalledTimes(1);
});

it('rechecks task admission after an asynchronous shared probe so a session still admits only one competing task', async () => {
  const store = new Store(':memory:'), adapter = createMockAdapter({ nodeId: 'provider-node', scenario: { delayMs: 10000 } });
  const sessions = new Sessions(store, 'provider-node', new Set(['provider-node/mock/default'])), router = new Router(store, sessions);
  try {
    await sessions.register(adapter); const session = await sessions.spawn('peer-node', 'provider-node/mock/default', 'project-a');
    const normal = await adapter.probe(); let release!: (probe: ProbeResult) => void;
    adapter.probe = vi.fn(() => new Promise<ProbeResult>(resolve => { release = resolve; }));
    const request = () => ({ version: 1, messageId: randomUUID(), correlationId: randomUUID(), idempotencyKey: randomUUID(),
      source: { nodeId: 'peer-node' }, target: { nodeId: 'provider-node', agentId: session.agentId }, type: 'task.request', taskId: randomUUID(),
      deadline: new Date(Date.now() + 30000).toISOString(), payload: { sessionId: session.id, text: 'held fixture', workspaceAlias: 'project-a', delegationDepth: 0 } });
    const pending = Promise.allSettled([router.receive('peer-node', request()), router.receive('peer-node', request())]);
    await Promise.resolve(); release(normal);
    const results = await pending;
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(r => r.status === 'rejected')).toMatchObject({ reason: { code: 'busy' } });
    expect(store.count('tasks')).toBe(1); expect(adapter.probe).toHaveBeenCalledTimes(1);
  } finally { await router.stop(); sessions.close(); store.close(); }
});

it('withdraws changed capabilities without promoting beyond discovery, and rejects malformed or changed-kind probes', async () => {
  const store = new Store(':memory:'), adapter = createMockAdapter({ nodeId: 'provider-node' });
  const original = await adapter.probe(); let probe: ProbeResult = original;
  adapter.probe = vi.fn(async () => probe);
  const discover = adapter.discover.bind(adapter);
  adapter.discover = async () => {
    const [agent] = await discover();
    return [{ ...agent!, capabilities: { ...agent!.capabilities, send: 'unsupported' as const } }, { ...agent!, id: 'provider-node/mock/sender' }];
  };
  const sessions = new Sessions(store, 'provider-node', new Set(['provider-node/mock/default', 'provider-node/mock/sender']));
  try {
    await sessions.register(adapter);
    probe = { ...original, version: 'mock/2', capabilities: { ...original.capabilities, send: 'unsupported' } };
    await sessions.refresh();
    expect(sessions.exported().every(a => a.capabilities.send === 'unsupported')).toBe(true);
    await expect(sessions.requireAvailable('provider-node/mock/sender', ['send'])).rejects.toMatchObject({ code: 'unsupported' });
    probe = { ...original, version: 'mock/3' }; await sessions.refresh();
    expect(sessions.harnesses.get('provider-node/mock')).toMatchObject({ kind: 'mock', version: 'mock/3', capabilities: { send: 'supported' } });
    expect(sessions.exported().find(a => a.id.endsWith('/default'))?.capabilities.send).toBe('unsupported');
    expect(sessions.exported().find(a => a.id.endsWith('/sender'))?.capabilities.send).toBe('supported');
    probe = { ...original, kind: 'codex' }; await sessions.refresh(); expect(sessions.exported()).toEqual([]);
    probe = { ...original, version: '' }; await sessions.refresh(); expect(sessions.exported()).toEqual([]);
    Object.defineProperty(probe, 'available', { get() { throw new Error('private diagnostic must not escape'); } });
    await expect(sessions.refresh()).resolves.toBeUndefined(); expect(sessions.exported()).toEqual([]);
    probe = original; await sessions.refresh(); expect(sessions.exported()).toHaveLength(2);
    await expect(sessions.register(adapter)).rejects.toMatchObject({ code: 'conflict' });
    const conflicting = createMockAdapter({ nodeId: 'provider-node' });
    const otherDiscovery = conflicting.discover.bind(conflicting);
    conflicting.discover = async () => (await otherDiscovery()).map(a => ({ ...a, id: 'provider-node/mock/other-provider' }));
    await expect(sessions.register(conflicting)).rejects.toMatchObject({ code: 'conflict' }); expect(sessions.exported()).toHaveLength(2);
  } finally { sessions.close(); store.close(); }
});

it.each(['task.request', 'session.create', 'session.resume'] as const)('refuses %s that expires during the async probe before native side effects', async type => {
  vi.useFakeTimers();
  const store = new Store(':memory:'), adapter = createMockAdapter({ nodeId: 'provider-node' });
  const sessions = new Sessions(store, 'provider-node', new Set(['provider-node/mock/default'])), router = new Router(store, sessions);
  try {
    await sessions.register(adapter); const session = await sessions.spawn('peer-node', 'provider-node/mock/default', 'project-a'), normal = await adapter.probe();
    const send = vi.spyOn(adapter, 'send'), spawn = vi.spyOn(adapter, 'spawn'), resume = vi.spyOn(adapter, 'resume');
    let release!: (value: ProbeResult) => void; adapter.probe = () => new Promise<ProbeResult>(resolve => { release = resolve; });
    const payload = type === 'session.create' ? { agentId: session.agentId, workspaceAlias: 'project-a' }
      : type === 'session.resume' ? { sessionId: session.id } : { sessionId: session.id, workspaceAlias: 'project-a', text: 'expired fixture', delegationDepth: 0 };
    const request = { version: 1, messageId: randomUUID(), correlationId: randomUUID(), idempotencyKey: randomUUID(),
      source: { nodeId: 'peer-node' }, target: { nodeId: 'provider-node', ...(type === 'task.request' ? { agentId: session.agentId } : {}) },
      ...(type === 'task.request' ? { taskId: randomUUID() } : {}), type, deadline: new Date(Date.now() + 500).toISOString(), payload };
    const pending = router.receive('peer-node', request).catch(error => error as unknown);
    await vi.advanceTimersByTimeAsync(600); release(normal);
    expect(await pending).toMatchObject({ code: 'deadline_exceeded' });
    expect(send).not.toHaveBeenCalled(); expect(spawn).not.toHaveBeenCalled(); expect(resume).not.toHaveBeenCalled();
    expect(store.count('tasks')).toBe(0); expect(store.list('sessions')).toHaveLength(1);
  } finally { await router.stop(); sessions.close(); store.close(); vi.useRealTimers(); }
});

it('coalesces bounded probes, keeps one hung provider slot and discards late results and results after close', async () => {
  vi.useFakeTimers();
  const store = new Store(':memory:'), adapter = createMockAdapter({ nodeId: 'provider-node' });
  const sessions = new Sessions(store, 'provider-node', new Set(['provider-node/mock/default']));
  try {
    const original = await adapter.probe(); await sessions.register(adapter);
    let release!: (value: ProbeResult) => void;
    const probe = vi.fn(() => new Promise<ProbeResult>(resolve => { release = resolve; })); adapter.probe = probe;
    const requests = Promise.all([sessions.refresh(), sessions.refresh(), sessions.refresh()]);
    await vi.advanceTimersByTimeAsync(1001); await requests;
    expect(probe).toHaveBeenCalledTimes(1); expect(sessions.exported()).toEqual([]);
    await sessions.refresh(); await sessions.refresh(); expect(probe).toHaveBeenCalledTimes(1);
    release(original); await Promise.resolve(); await Promise.resolve();
    expect(sessions.exported()).toEqual([]);
    adapter.probe = vi.fn(async () => original); await sessions.refresh(); expect(sessions.exported()).toHaveLength(1);
    adapter.probe = probe; const final = sessions.refresh(); await Promise.resolve(); await Promise.resolve();
    sessions.close(); release(original); await final;
    expect(sessions.exported()).toEqual([]);
    await expect(sessions.requireAvailable('provider-node/mock/default', ['spawn'])).rejects.toThrow();
  } finally { sessions.close(); store.close(); vi.useRealTimers(); }
});

it('bounds registration probes and never calls discover after a timed-out registration', async () => {
  vi.useFakeTimers(); const store = new Store(':memory:'), adapter = createMockAdapter({ nodeId: 'provider-node' });
  const sessions = new Sessions(store, 'provider-node', new Set(['provider-node/mock/default']));
  try {
    const discover = vi.spyOn(adapter, 'discover'); adapter.probe = () => new Promise(() => {});
    const pending = sessions.register(adapter).catch(error => error as unknown);
    await vi.advanceTimersByTimeAsync(1001);
    expect(await pending).toMatchObject({ code: 'unsupported' }); expect(discover).not.toHaveBeenCalled(); expect(sessions.exported()).toEqual([]);
  } finally { sessions.close(); store.close(); vi.useRealTimers(); }
});
