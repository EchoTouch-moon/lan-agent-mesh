import { describe, expect, it } from 'vitest';
import type { AdapterEvent, PermissionDecision, SendInput } from '@lam/adapter-sdk';
import { createMockAdapter } from '../src/index.js';
async function setup(scenario = {}) {
  const adapter = createMockAdapter({ scenario });
  const [agent] = await adapter.discover();
  const session = await adapter.spawn({ agentId: agent!.id, workspaceAlias: 'project-a' });
  const input: SendInput = { sessionId: session.id, taskId: 'task-1', text: 'hello', idempotencyKey: 'key-1', deadline: new Date(Date.now() + 2000).toISOString() };
  return { adapter, agent: agent!, session, input };
}
async function collect(events: AsyncIterable<AdapterEvent>) { const result = []; for await (const event of events) result.push(event); return result; }
describe('mock adapter lifecycle', () => {
  it('streams, resumes, retains isolated sessions and serializes turns', async () => {
    const { adapter, agent, session, input } = await setup({ delayMs: 5 });
    await adapter.send(input);
    await expect(adapter.send({ ...input, taskId: 'concurrent', idempotencyKey: 'concurrent' })).rejects.toMatchObject({ code: 'busy' });
    const other = await adapter.spawn({ agentId: agent.id, workspaceAlias: 'project-a' });
    await adapter.send({ ...input, sessionId: other.id, taskId: 'task-2', idempotencyKey: 'key-2' });
    expect((await collect(adapter.watch(input.taskId))).at(-1)).toEqual({ type: 'completed', taskId: input.taskId, text: 'mock:hello' });
    expect((await collect(adapter.watch('task-2'))).at(-1)?.type).toBe('completed');
    expect((await adapter.resume(session.id)).nativeSessionId).toBe(session.nativeSessionId);
    await adapter.send({ ...input, taskId: 'task-3', idempotencyKey: 'key-3' });
    expect((await collect(adapter.watch('task-3'))).at(-1)?.type).toBe('completed');
  });
  it('deduplicates during and after execution and rejects conflicting key reuse', async () => {
    const { adapter, input } = await setup();
    const results = await Promise.all([adapter.send(input), adapter.send(input)]);
    expect(results[0]).toEqual(results[1]);
    const events = await collect(adapter.watch(input.taskId));
    await adapter.send(input);
    expect(await collect(adapter.watch(input.taskId))).toEqual(events);
    await expect(adapter.send({ ...input, text: 'changed' })).rejects.toMatchObject({ code: 'conflict' });
    await expect(adapter.send({ ...input, idempotencyKey: 'new-key' })).rejects.toMatchObject({ code: 'conflict' });
  });
  it.each(['allow', 'deny'] as const)('handles %s without approving twice or executing after denial', async decision => {
    const { adapter, input } = await setup({ permission: true }); await adapter.send(input);
    const events: AdapterEvent[] = [];
    for await (const event of adapter.watch(input.taskId)) {
      events.push(event);
      if (event.type === 'permission') {
        const answer: PermissionDecision = { ...event.request, decision, humanId: 'human-1' };
        for (const field of ['nonce', 'sessionId', 'nodeId', 'agentId', 'operationDigest', 'requestId', 'expiresAt'] as const)
          await expect(adapter.answerPermission({ ...answer, [field]: 'forged' })).rejects.toMatchObject({ code: 'permission_denied' });
        await adapter.answerPermission(answer);
        await expect(adapter.answerPermission(answer)).rejects.toMatchObject({ code: 'permission_denied' });
      }
    }
    if (decision === 'deny') { expect(events.filter(e => e.type === 'delta')).toHaveLength(0); expect(events.at(-1)).toMatchObject({ type: 'failed', code: 'permission_denied' }); }
    else expect(events.at(-1)?.type).toBe('completed');
  });
  it('times out pending permission and releases the session', async () => {
    const { adapter, session, input } = await setup({ permission: true });
    input.deadline = new Date(Date.now() + 50).toISOString(); await adapter.send(input);
    expect((await collect(adapter.watch(input.taskId))).at(-1)).toMatchObject({ type: 'failed', code: 'deadline_exceeded' });
    expect((await adapter.resume(session.id)).state).toBe('idle');
  });
  it('cancels active work and permission waits', async () => {
    for (const scenario of [{ delayMs: 100 }, { permission: true }]) {
      const { adapter, input, session } = await setup(scenario); await adapter.send(input);
      if (scenario.permission) {
        const observer = adapter.watch(input.taskId)[Symbol.asyncIterator]();
        expect((await observer.next()).value?.type).toBe('permission');
        await observer.return?.();
      }
      await adapter.cancel(input.taskId);
      expect((await collect(adapter.watch(input.taskId))).at(-1)?.type).toBe('cancelled');
      expect((await adapter.resume(session.id)).state).toBe('idle');
    }
  });
  it('reports injected failure and preserves UNKNOWN without replay on disconnect', async () => {
    for (const scenario of [{ fail: true }, { disconnectAfterChunks: 0 }]) {
      const { adapter, input } = await setup(scenario); await adapter.send(input);
      const events = await collect(adapter.watch(input.taskId));
      expect(events.at(-1)?.type).toBe(scenario.fail ? 'failed' : 'unknown');
      await adapter.send(input); expect(await collect(adapter.watch(input.taskId))).toEqual(events);
    }
  });
  it('lets watchers detach without cancelling the task', async () => {
    const { adapter, input } = await setup({ delayMs: 10 }); await adapter.send(input);
    const controller = new AbortController(); const iterator = adapter.watch(input.taskId, controller.signal)[Symbol.asyncIterator]();
    const waiting = iterator.next(); controller.abort(); expect((await waiting).done).toBe(true);
    expect((await collect(adapter.watch(input.taskId))).at(-1)?.type).toBe('completed');
  });
  it('rejects bad workspaces, expired deadlines and unknown tasks', async () => {
    const { adapter, agent, input } = await setup();
    await expect(adapter.spawn({ agentId: agent.id, workspaceAlias: '../secret' })).rejects.toMatchObject({ code: 'permission_denied' });
    await expect(adapter.send({ ...input, deadline: new Date(0).toISOString() })).rejects.toMatchObject({ code: 'deadline_exceeded' });
    await expect(adapter.cancel('missing')).rejects.toMatchObject({ code: 'not_found' });
  });
});
