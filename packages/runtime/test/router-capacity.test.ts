import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { Store } from '@lam/storage';
import { createMockAdapter } from '@lam/mock-adapter';
import { Router } from '../src/router.js';
import { Sessions } from '../src/sessions.js';

it('bounds durable session-operation reservations including denied requests while retaining exact retries', async () => {
  const store = new Store(':memory:');
  try {
    const agentId = 'node-b/mock/default';
    const sessions = new Sessions(store, 'node-b', new Set([agentId]));
    await sessions.register(createMockAdapter({ nodeId: 'node-b' }));
    const router = new Router(store, sessions);
    const request = (agent: string) => ({
      version: 1,
      messageId: randomUUID(), correlationId: randomUUID(), idempotencyKey: randomUUID(),
      source: { nodeId: 'node-a' }, target: { nodeId: 'node-b' },
      deadline: new Date(Date.now() + 300000).toISOString(),
      type: 'session.create', payload: { agentId: agent, workspaceAlias: 'project-a' },
    });
    const original = request(agentId);
    const first = await router.receive('node-a', original);
    let denied: ReturnType<typeof request> | undefined;
    for (let i = 0; i < 999; i++) {
      denied = request('node-b/mock/private');
      await expect(router.receive('node-a', denied)).rejects.toMatchObject({ code: 'permission_denied' });
    }
    const count = () => Number(store.query("SELECT count(*) AS n FROM messages WHERE id LIKE 'operation/%'")[0]?.n);
    expect(count()).toBe(1000);
    // Admission at capacity must not spawn another native session or erase retry history.
    await expect(router.receive('node-a', request(agentId))).rejects.toMatchObject({ code: 'busy' });
    expect(store.list('sessions')).toHaveLength(1);
    expect(await router.receive('node-a', original)).toEqual(first);
    await expect(router.receive('node-a', denied)).rejects.toMatchObject({ code: 'disconnected' });
    expect(count()).toBe(1000);
  } finally { store.close(); }
});
