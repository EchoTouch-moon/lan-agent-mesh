import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { Gateway } from '../src/index.js';
import { rotateIdentity } from '@lam/mesh';
const roots: string[] = [],
  gateways: Gateway[] = [];
async function gateway(scenario = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'LAM peer & '));
  roots.push(directory);
  const g = await new Gateway({ directory, mock: true, scenario }).start();
  gateways.push(g);
  return g;
}
afterEach(async () => {
  for (const g of gateways.splice(0)) await g.stop();
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});
async function pair(a: Gateway, b: Gateway) {
  const p = await a.mesh.beginPairing(b.mesh.addresses[0]!);
  const q = b.mesh.pendingPairings().find((q) => q.id === p.id)!;
  expect(p.code).toBe(q.code);
  await a.mesh.confirmPairing(p.id, p.code);
  expect(a.mesh.trusted(b.mesh.id)).toBe(false);
  await b.mesh.confirmPairing(q.id, q.code);
  expect(a.mesh.trusted(b.mesh.id)).toBe(true);
}
async function finish(a: Gateway, b: Gateway, id: string) {
  let cursor = 0;
  const events: unknown[] = [];
  for (let i = 0; i < 300; i++) {
    const r = (await a.events(b.mesh.id, id, cursor)) as {
      state: string;
      events: unknown[];
      next: number;
    };
    events.push(...r.events);
    cursor = r.next;
    if (!['QUEUED', 'RUNNING', 'WAITING_INPUT'].includes(r.state) && r.events.length === 0)
      return { state: r.state, events };
    await delay(5);
  }
  throw new Error('Task timeout');
}
it('recovers an original outbox retry after its cached ACK expires without repeating the task', async () => {
  const a = await gateway(), b = await gateway();
  await pair(a, b);
  const registry = await a.sync(b.mesh.id);
  const creation = a.envelope(b.mesh.id, 'session.create', { agentId: registry.agents[0]!.id, workspaceAlias: 'project-a' });
  creation.deadline = new Date(Date.now() + 120000).toISOString();
  const created = await a.sendEnvelope(b.mesh.id, creation);
  if (created.type !== 'session.event') throw new Error('Missing session response');
  const session = created.payload;
  const request = a.envelope(b.mesh.id, 'task.request', {
    sessionId: session.id, text: 'late ACK fixture', workspaceAlias: 'project-a', delegationDepth: 0,
  }, randomUUID(), session.agentId);
  request.deadline = new Date(Date.now() + 120000).toISOString();
  const real = a.mesh.request.bind(a.mesh);
  a.mesh.request = async (peer, body) => {
    const response = await real(peer, body);
    if ((body as { value?: { messageId?: string } }).value?.messageId === request.messageId)
      throw new Error('Controlled ACK discard');
    return response;
  };
  try { await expect(a.sendEnvelope(b.mesh.id, request)).rejects.toThrow('Controlled ACK discard'); }
  finally { a.mesh.request = real; }
  expect((await finish(a, b, request.taskId!)).state).toBe('COMPLETED');
  const originalEvents = structuredClone(b.store.task(request.taskId!)!.events);
  const cached = b.store.inbox(request.messageId, a.mesh.id, request) as { messageId: string; deadline: string; payload: unknown };
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Math.max(Date.parse(cached.deadline), Date.parse(created.deadline)) + 1);
  try {
    expect(Date.now()).toBeLessThan(Date.parse(request.deadline));
    const response = await a.command('retry', { messageId: request.messageId }) as { messageId: string; correlationId: string; deadline: string; payload: unknown };
    expect(response.payload).toEqual(cached.payload);
    expect(response.messageId).not.toBe(cached.messageId);
    expect(response.correlationId).toBe(request.messageId);
    expect(Date.parse(response.deadline)).toBeGreaterThan(Date.now());
    expect(a.store.pending()).toEqual([]);
    expect(b.store.count('tasks')).toBe(1);
    expect(b.store.task(request.taskId!)!.events).toEqual(originalEvents);
    expect(b.store.inbox(request.messageId, a.mesh.id, request)).toEqual(cached);
    const sessionRetry = await a.sendEnvelope(b.mesh.id, creation);
    expect(sessionRetry.type).toBe('session.event');
    expect(sessionRetry.payload).toEqual(created.payload);
    expect(sessionRetry.messageId).not.toBe(created.messageId);
    expect(b.store.list('sessions')).toHaveLength(1);
    try {
      for (const broken of [{ ...cached, deadline: 'invalid' }, { ...cached, correlationId: randomUUID() }]) {
        b.store.db.prepare('UPDATE inbox SET response=? WHERE id=?').run(JSON.stringify(broken), request.messageId);
        await expect(a.mesh.request(b.mesh.id, { kind: 'envelope', value: request })).rejects.toMatchObject({ code: 'invalid_message' });
      }
    } finally {
      b.store.db.prepare('UPDATE inbox SET response=? WHERE id=?').run(JSON.stringify(cached), request.messageId);
    }
    await expect(a.mesh.request(b.mesh.id, { kind: 'envelope', value: {
      ...request, payload: { ...request.payload, text: 'changed cached request' },
    } })).rejects.toMatchObject({ code: 'conflict' });
    clock.mockReturnValue(Date.parse(request.deadline) + 1);
    await expect(a.sendEnvelope(b.mesh.id, request)).rejects.toMatchObject({ code: 'deadline_exceeded' });
    expect(b.store.count('tasks')).toBe(1);
    expect(b.store.task(request.taskId!)!.events).toEqual(originalEvents);
  } finally { clock.mockRestore(); }
});
describe('real two-peer TCP/Noise/Yamux Gateway', () => {
  it('denies unpaired/private access, pairs on both sides, executes both directions and rejects replay conflicts', async () => {
    const a = await gateway(),
      b = await gateway();
    const p = await a.mesh.beginPairing(b.mesh.addresses[0]!);
    await expect(a.mesh.rpc(b.mesh.id, 'mesh', { kind: 'registry' })).rejects.toMatchObject({
      code: 'permission_denied',
    });
    await expect(a.mesh.confirmPairing(p.id, 'wrong')).rejects.toMatchObject({
      code: 'permission_denied',
    });
    await a.mesh.confirmPairing(p.id, p.code);
    const q = b.mesh.pendingPairings()[0]!;
    await b.mesh.confirmPairing(q.id, q.code);
    for (const [caller, receiver] of [
      [a, b],
      [b, a],
    ] as const) {
      const registry = await caller.sync(receiver.mesh.id);
      expect(registry.agents).toHaveLength(1);
      const s = await caller.spawn(receiver.mesh.id, registry.agents[0]!.id, 'project-a');
      const key = randomUUID(),
        id = randomUUID(),
        deadline = new Date(Date.now() + 10000).toISOString();
      await caller.submit(receiver.mesh.id, s, 'hello', key, id, deadline);
      expect((await finish(caller, receiver, id)).state).toBe('COMPLETED');
      await caller.submit(receiver.mesh.id, s, 'hello', key, id, deadline);
      expect(receiver.store.count('tasks')).toBe(1);
      await expect(
        caller.submit(receiver.mesh.id, s, 'changed', key, id, deadline),
      ).rejects.toMatchObject({ code: 'conflict' });
    }
    await a.mesh.revoke(b.mesh.id);
    expect(a.remoteAgents()).toEqual([]);
    await b.mesh.connect(a.mesh.addresses[0]!, a.mesh.id);
    await expect(b.mesh.rpc(a.mesh.id, 'mesh', { kind: 'registry' })).rejects.toMatchObject({
      code: 'permission_denied',
    });
  });
  it('preserves UNKNOWN across Gateway restart without replaying and keeps native mapping', async () => {
    const a = await gateway(),
      b = await gateway({ disconnectAfterChunks: 0 });
    await pair(a, b);
    const r = await a.sync(b.mesh.id),
      s = await a.spawn(b.mesh.id, r.agents[0]!.id, 'project-a');
    const key = randomUUID(),
      id = randomUUID(),
      deadline = new Date(Date.now() + 10000).toISOString();
    await a.submit(b.mesh.id, s, 'uncertain', key, id, deadline);
    expect((await finish(a, b, id)).state).toBe('UNKNOWN');
    const original = b.mesh.id,
      identity = b.mesh.fingerprint,
      directory = b.options.directory;
    await b.stop();
    const restarted = await new Gateway({ directory, mock: true }).start();
    gateways.push(restarted);
    expect(restarted.mesh.id).toBe(original);
    expect(restarted.mesh.fingerprint).toBe(identity);
    expect(restarted.store.list('sessions')).toHaveLength(1);
    await a.mesh.connect(restarted.mesh.addresses[0]!, original);
    await a.submit(original, s, 'uncertain', key, id, deadline);
    expect(restarted.store.count('tasks')).toBe(1);
    expect(restarted.store.task(id)?.state).toBe('UNKNOWN');
    await expect(
      a.sendEnvelope(original, a.envelope(original, 'session.resume', { sessionId: s.id })),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
  it('serializes native sessions, cancels in-flight work, defaults permissions to deny, and authenticates loopback IPC', async () => {
    const a = await gateway(),
      // Keep the in-flight turn open under slow CI scheduling; cancel aborts this wait.
      b = await gateway({ delayMs: 10000 });
    await pair(a, b);
    const r = await a.sync(b.mesh.id),
      s = await a.spawn(b.mesh.id, r.agents[0]!.id, 'project-a');
    const { taskId } = await a.submit(b.mesh.id, s, 'slow');
    await expect(a.submit(b.mesh.id, s, 'concurrent')).rejects.toMatchObject({ code: 'busy' });
    await a.sendEnvelope(b.mesh.id, a.envelope(b.mesh.id, 'task.cancel', {}, taskId));
    expect((await finish(a, b, taskId)).state).toBe('CANCELLED');
    const unauthorized = await fetch(a.url + '/command', {
      method: 'POST',
      body: JSON.stringify({ command: 'status' }),
    });
    expect(unauthorized.status).toBe(403);
    const status = await fetch(a.url + '/command', {
      method: 'POST',
      headers: { authorization: `Bearer ${a.token}` },
      body: JSON.stringify({ command: 'status' }),
    });
    expect(status.status).toBe(200);
    const c = await gateway({ permission: true });
    await pair(a, c);
    const cr = await a.sync(c.mesh.id),
      cs = await a.spawn(c.mesh.id, cr.agents[0]!.id, 'project-a');
    const task = await a.submit(c.mesh.id, cs, 'approval');
    expect((await finish(a, c, task.taskId)).state).toBe('FAILED');
  });
});
it('retries a lost delivery ACK using durable outbox without executing twice, and rejects forged task/session ownership', async () => {
  const a = await gateway(),
    b = await gateway(),
    c = await gateway();
  await pair(a, b);
  await pair(c, b);
  const registry = await a.sync(b.mesh.id),
    session = await a.spawn(b.mesh.id, registry.agents[0]!.id, 'project-a');
  const request = a.envelope(
    b.mesh.id,
    'task.request',
    { sessionId: session.id, text: 'once', workspaceAlias: 'project-a', delegationDepth: 0 },
    randomUUID(),
    session.agentId,
  );
  const original = a.mesh.request.bind(a.mesh);
  let dropped = false;
  a.mesh.request = async (peer, body) => {
    const result = await original(peer, body);
    if (!dropped) {
      dropped = true;
      throw new Error('Injected lost ACK after durable remote acceptance');
    }
    return result;
  };
  await expect(a.sendEnvelope(b.mesh.id, request)).rejects.toThrow('Injected lost ACK');
  a.mesh.request = original;
  expect(a.store.pending()).toHaveLength(1);
  await a.command('retry', { messageId: request.messageId });
  expect(a.store.pending()).toEqual([]);
  expect((await finish(a, b, request.taskId!)).state).toBe('COMPLETED');
  expect(b.store.count('tasks')).toBe(1);
  await expect(
    c.sendEnvelope(b.mesh.id, c.envelope(b.mesh.id, 'session.resume', { sessionId: session.id })),
  ).rejects.toMatchObject({ code: 'not_found' });
  const forged = a.envelope(
    b.mesh.id,
    'task.request',
    { sessionId: session.id, text: 'bad', workspaceAlias: 'project-a', delegationDepth: 5 },
    randomUUID(),
    session.agentId,
  );
  await expect(a.sendEnvelope(b.mesh.id, forged)).rejects.toMatchObject({
    code: 'permission_denied',
  });
  forged.source.nodeId = c.mesh.id;
  await expect(
    a.mesh.rpc(b.mesh.id, 'mesh', { kind: 'envelope', value: forged }),
  ).rejects.toMatchObject({ code: 'permission_denied' });
  await b.stop();
  await expect.poll(() => a.remoteAgents(), { timeout: 3000 }).toEqual([]);
});
it('fails port/data-directory conflicts cleanly and never binds a public control address', async () => {
  const a = await gateway();
  expect((a.server!.address() as { address: string }).address).toBe('127.0.0.1');
  await expect(new Gateway({ directory: a.options.directory }).start()).rejects.toMatchObject({
    code: 'busy',
  });
  const root = mkdtempSync(join(tmpdir(), 'lam-conflict '));
  roots.push(root);
  const port = (a.server!.address() as { port: number }).port;
  await expect(new Gateway({ directory: root, controlPort: port }).start()).rejects.toMatchObject({
    code: 'EADDRINUSE',
  });
  const retry = await new Gateway({ directory: root }).start();
  gateways.push(retry);
});

it('rotates keys only offline, revokes prior trust and requires new pairing', async () => {
  const a = await gateway(),
    b = await gateway();
  await pair(a, b);
  await expect(rotateIdentity(b.options.directory)).rejects.toMatchObject({ code: 'busy' });
  const old = b.mesh.id;
  await b.stop();
  const rotated = await rotateIdentity(b.options.directory);
  expect(rotated.previousPeer).toBe(old);
  expect(rotated.peer).not.toBe(old);
  const next = await new Gateway({ directory: b.options.directory, mock: true }).start();
  gateways.push(next);
  expect(next.mesh.trusted(a.mesh.id)).toBe(false);
  await expect(a.mesh.connect(next.mesh.addresses[0]!, old)).rejects.toMatchObject({
    code: 'permission_denied',
  });
  await pair(a, next);
  expect(next.mesh.trusted(a.mesh.id)).toBe(true);
});

it('expires remote cards, reports capability changes, and resumes an adapter that outlives Gateway restart', async () => {
  const a = await gateway(),
    b = await gateway();
  await pair(a, b);
  const registry = await a.sync(b.mesh.id),
    agent = registry.agents[0]!,
    session = await a.spawn(b.mesh.id, agent.id, 'project-a');
  expect(a.remoteAgents(Date.now() + 16000)).toEqual([]);
  expect(a.registryEvents.at(-1)?.type).toBe('stale');
  await a.sync(b.mesh.id);
  b.sessions.visible.delete(agent.id);
  await a.sync(b.mesh.id);
  expect(a.remoteAgents()).toEqual([]);
  expect(a.registryEvents.at(-1)?.type).toBe('capability_changed');
  b.sessions.visible.add(agent.id);
  const adapter = b.sessions.adapter(agent.id);
  await b.stop();
  const next = await new Gateway({
    directory: b.options.directory,
    adapters: [adapter],
    exportAgents: [agent.id],
  }).start();
  gateways.push(next);
  await a.mesh.connect(next.mesh.addresses[0]!, next.mesh.id);
  const resumed = await a.sendEnvelope(
    next.mesh.id,
    a.envelope(next.mesh.id, 'session.resume', { sessionId: session.id }),
  );
  expect(resumed.type).toBe('session.event');
  if (resumed.type === 'session.event')
    expect(resumed.payload.nativeSessionId).toBe(session.nativeSessionId);
});

it('automatically reconnects a known fixed endpoint with the same identity and refreshes private cards', async () => {
  const a = await gateway(),
    b = await gateway();
  await pair(a, b);
  await a.sync(b.mesh.id);
  const listen = b.mesh.addresses[0]!.split('/p2p/')[0]!;
  const originalId = b.mesh.id;
  await b.stop();
  await expect.poll(() => a.remoteAgents(), { timeout: 3000 }).toEqual([]);
  const next = await new Gateway({
    directory: b.options.directory,
    listen: [listen],
    mock: true,
  }).start();
  gateways.push(next);
  expect(next.mesh.id).toBe(originalId);
  // No manual connect or sync call: exercise the running maintenance timer.
  await expect.poll(() => a.remoteAgents().length, { timeout: 10000, interval: 100 }).toBe(1);
  expect(a.remoteAgents()[0]!.nodeId).toBe(originalId);
});
