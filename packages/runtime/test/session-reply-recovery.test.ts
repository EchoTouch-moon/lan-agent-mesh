import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { createMockAdapter } from '@lam/mock-adapter';
import { Store } from '@lam/storage';
import { encodeEnvelope, decodeEnvelope, type Envelope } from '@lam/protocol';
import { Sessions } from '../src/sessions.js';
import { Router } from '../src/router.js';

function request(type: 'session.create' | 'session.resume', payload: unknown): Envelope {
  return decodeEnvelope(encodeEnvelope({ version: 1, messageId: randomUUID(), correlationId: randomUUID(), idempotencyKey: randomUUID(),
    source: { nodeId: 'peer-node' }, target: { nodeId: 'local-node' }, deadline: new Date(Date.now() + 120000).toISOString(), type, payload }));
}

it.each(['session.create', 'session.resume'] as const)('reissues %s result from the durable operation prefix after Store reopen without needing a live adapter', async type => {
  const root = mkdtempSync(join(tmpdir(), 'lam-operation-prefix-')), file = join(root, 'fixture.sqlite');
  let store = new Store(file); const native = createMockAdapter({ nodeId: 'local-node' });
  const spawn = vi.spyOn(native, 'spawn'), resume = vi.spyOn(native, 'resume');
  let sessions = new Sessions(store, 'local-node', new Set(['local-node/mock/default'])), router = new Router(store, sessions);
  let clock: { mockRestore(): void } | undefined;
  try {
    await sessions.register(native);
    const create = request('session.create', { agentId: 'local-node/mock/default', workspaceAlias: 'project-a' });
    const created = await router.receive('peer-node', create);
    if (created.type !== 'session.event') throw new Error('Expected fixture session');
    const original = type === 'session.create' ? create : request('session.resume', { sessionId: created.payload.id });
    const response = type === 'session.create' ? created : await router.receive('peer-node', original);
    const key = `operation/peer-node/${original.idempotencyKey}`, operation = store.get('messages', key);
    // Simulate only the durable prefix before receipt insertion, not an actual hardware crash.
    store.db.prepare('DELETE FROM inbox WHERE id=?').run(original.messageId);
    const inboxCount = store.count('inbox'); sessions.close(); store.close();
    store = new Store(file); sessions = new Sessions(store, 'local-node', new Set(['local-node/mock/default']));
    router = new Router(store, sessions); // Deliberately no provider registered after reopening.
    clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(response.deadline) + 1);
    expect(Date.now()).toBeLessThan(Date.parse(original.deadline));
    const retry = await router.receive('peer-node', original);
    expect(Date.parse(retry.deadline)).toBeGreaterThan(Date.now());
    expect(retry.messageId).not.toBe(response.messageId); expect(retry.correlationId).toBe(original.messageId);
    expect(decodeEnvelope(encodeEnvelope(retry)).payload).toEqual(response.payload);
    expect((await router.receive('peer-node', original)).payload).toEqual(response.payload);
    expect(spawn).toHaveBeenCalledTimes(1); expect(resume).toHaveBeenCalledTimes(type === 'session.resume' ? 1 : 0);
    expect(store.list('sessions')).toHaveLength(1); expect(store.count('inbox')).toBe(inboxCount);
    expect(store.get('messages', key)).toEqual(operation);
  } finally { clock?.mockRestore(); sessions.close(); store.close(); rmSync(root, { recursive: true, force: true }); }
});

it.each([
  ['session.create', 'operation'], ['session.resume', 'operation'],
  ['session.create', 'inbox'], ['session.resume', 'inbox'],
] as const)('validates %s %s replay scope and refuses changed/expired requests without native fallback', async (type, layer) => {
  const store = new Store(':memory:'), native = createMockAdapter({ nodeId: 'local-node' });
  const sessions = new Sessions(store, 'local-node', new Set(['local-node/mock/default'])), router = new Router(store, sessions);
  const spawn = vi.spyOn(native, 'spawn'), resume = vi.spyOn(native, 'resume');
  let clock: { mockRestore(): void } | undefined;
  try {
    await sessions.register(native);
    const creation = request('session.create', { agentId: 'local-node/mock/default', workspaceAlias: 'project-a' });
    const created = await router.receive('peer-node', creation);
    if (created.type !== 'session.event') throw new Error('Missing fixture session');
    const original = type === 'session.create' ? creation : request('session.resume', { sessionId: created.payload.id });
    const response = type === 'session.create' ? created : await router.receive('peer-node', original);
    if (response.type !== 'session.event') throw new Error('Missing fixture session result');
    const key = `operation/peer-node/${original.idempotencyKey}`;
    const operation = store.get<{ fingerprint: string; response: Envelope }>('messages', key)!;
    if (layer === 'operation') store.db.prepare('DELETE FROM inbox WHERE id=?').run(original.messageId);
    const inboxCount = store.count('inbox');
    const probe = vi.spyOn(native, 'probe');
    const save = (value: unknown) => {
      if (layer === 'inbox') store.db.prepare('UPDATE inbox SET response=? WHERE id=?').run(JSON.stringify(value), original.messageId);
      else store.put('messages', key, { ...operation, response: value });
    };
    const broken = [
      { ...response, source: { nodeId: 'foreign-node' } },
      { ...response, target: { nodeId: 'foreign-peer' } },
      { ...response, correlationId: randomUUID() }, { ...response, taskId: 'foreign-task' },
      { ...response, deadline: 'invalid' },
      { ...response, type: 'ack', payload: { messageId: original.messageId } },
      { ...response, payload: { ...response.payload, nodeId: 'foreign-node' } },
      ...(type === 'session.create' ? [
        { ...response, payload: { ...response.payload, agentId: 'local-node/mock/foreign' } },
        { ...response, payload: { ...response.payload, workspaceAlias: 'foreign' } },
      ] : [{ ...response, payload: { ...response.payload, id: 'foreign-session' } }]),
    ];
    for (const value of broken) { save(value); await expect(router.receive('peer-node', original)).rejects.toMatchObject({ code: 'invalid_message' }); }
    save(response);
    expect(await router.receive('peer-node', original)).toEqual(response); // Preserve a still-valid transport response byte-for-byte.
    const changedPayload = original.type === 'session.create' ? { ...original.payload, workspaceAlias: 'changed' } : { sessionId: 'changed-session' };
    await expect(router.receive('peer-node', { ...original, payload: changedPayload })).rejects.toMatchObject({ code: 'conflict' });
    await expect(router.receive('peer-node', { ...original, messageId: randomUUID() })).rejects.toMatchObject({ code: 'conflict' });
    await expect(router.receive('foreign-peer', original)).rejects.toMatchObject({ code: 'permission_denied' });
    if (layer === 'operation') {
      store.put('messages', key, { fingerprint: operation.fingerprint });
      await expect(router.receive('peer-node', original)).rejects.toMatchObject({ code: 'disconnected' });
      store.put('messages', key, operation);
    }
    clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(original.deadline) + 1);
    await expect(router.receive('peer-node', original)).rejects.toMatchObject({ code: 'deadline_exceeded' });
    expect(spawn).toHaveBeenCalledTimes(1); expect(resume).toHaveBeenCalledTimes(type === 'session.resume' ? 1 : 0); expect(probe).not.toHaveBeenCalled();
    expect(store.list('sessions')).toHaveLength(1); expect(store.count('inbox')).toBe(inboxCount); expect(store.get('messages', key)).toEqual(operation);
  } finally { clock?.mockRestore(); sessions.close(); store.close(); }
});
