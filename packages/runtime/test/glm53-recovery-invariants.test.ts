// GLM-5.3 G-R1 (#75): crash-consistency and UNKNOWN/cancel regression at the Router boundary.
// Deterministic bounded sequences; the scripted adapter is a test-only fixture with no timers,
// so "crash" is modeled as closing/reopening the Store and dropping in-memory router state.
// Side-effect counting (native send dispatches) is the exactly-once positive control.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import type { Session } from '@lam/domain';
import { MOCK_CAPABILITIES, createMockAdapter } from '@lam/mock-adapter';
import type { AdapterEvent, HarnessAdapter, SendInput } from '@lam/adapter-sdk';
import { Store } from '@lam/storage';
import { Sessions } from '../src/sessions.js';
import { Router } from '../src/router.js';

const NODE = 'provider-node', PEER = 'peer-node', AGENT_ID = `${NODE}/mock/default`;
const VISIBLE = new Set([AGENT_ID]);

interface ScriptedRun {
  events: AdapterEvent[];
  listeners: Set<() => void>;
  terminal: boolean;
}
/** Test-only fixture: no timers, cancel behavior and probe availability are scriptable. */
class ScriptedAdapter implements HarnessAdapter {
  readonly sendCalls: SendInput[] = [];
  readonly cancelCalls: string[] = [];
  probeAvailable = true;
  rejectSend = false;
  ignoreCancel = false;
  private readonly runs = new Map<string, ScriptedRun>();
  private readonly sessions = new Map<string, Session>();
  private seq = 0;
  async probe() {
    return { available: this.probeAvailable, version: 'scripted/1', capabilities: { ...MOCK_CAPABILITIES } };
  }
  async discover() {
    return [{
      id: AGENT_ID, nodeId: NODE, harnessId: `${NODE}/mock`, name: 'Scripted fixture',
      workspaceAliases: ['project-a'], capabilities: { ...MOCK_CAPABILITIES },
    }];
  }
  async spawn() {
    const session: Session = {
      id: `scripted-session-${++this.seq}`, nodeId: NODE, agentId: AGENT_ID, nativeSessionId: randomUUID(),
      workspaceAlias: 'project-a', state: 'idle', createdAt: new Date().toISOString(),
    };
    this.sessions.set(session.id, session);
    return { ...session };
  }
  async resume(id: string) {
    const session = this.sessions.get(id);
    if (!session) throw new Error('scripted session not found');
    return { ...session };
  }
  async send(input: SendInput) {
    this.sendCalls.push({ ...input });
    if (this.rejectSend) throw new Error('scripted dispatch failure');
    this.runs.set(input.taskId, { events: [], listeners: new Set(), terminal: false });
    return { taskId: input.taskId };
  }
  emit(taskId: string, event: AdapterEvent) {
    const run = this.runs.get(taskId);
    if (!run) return;
    run.events.push(event);
    if (event.type !== 'delta' && event.type !== 'permission') run.terminal = true;
    for (const listener of run.listeners) listener();
  }
  async *watch(taskId: string, signal?: AbortSignal) {
    const run = this.runs.get(taskId);
    if (!run) throw new Error('scripted task not found');
    let index = 0;
    while (!signal?.aborted) {
      while (index < run.events.length) yield structuredClone(run.events[index++]!);
      if (run.terminal) return;
      await new Promise<void>((resolve) => {
        const wake = () => { run.listeners.delete(wake); signal?.removeEventListener('abort', wake); resolve(); };
        run.listeners.add(wake);
        signal?.addEventListener('abort', wake, { once: true });
        if (signal?.aborted) wake();
      });
    }
  }
  async cancel(taskId: string) {
    this.cancelCalls.push(taskId);
    if (!this.ignoreCancel) this.emit(taskId, { type: 'cancelled', taskId });
  }
  async answerPermission() { throw new Error('scripted adapter has no permission flow'); }
}

let counter = 0;
function taskEnvelope(session: Session, overrides: {
  taskId?: string; key?: string; messageId?: string; text?: string; deadline?: string; peer?: string;
} = {}) {
  return {
    version: 1 as const,
    messageId: overrides.messageId ?? randomUUID(),
    correlationId: randomUUID(),
    idempotencyKey: overrides.key ?? randomUUID(),
    source: { nodeId: overrides.peer ?? PEER },
    target: { nodeId: NODE, agentId: session.agentId },
    taskId: overrides.taskId ?? `glm53-task-${++counter}`,
    type: 'task.request' as const,
    deadline: overrides.deadline ?? new Date(Date.now() + 120000).toISOString(),
    payload: {
      sessionId: session.id,
      text: overrides.text ?? 'glm53 fixture payload',
      workspaceAlias: session.workspaceAlias,
      delegationDepth: 0,
    },
  };
}
function cancelEnvelope(taskId: string, peer = PEER) {
  return {
    version: 1 as const, messageId: randomUUID(), correlationId: randomUUID(), idempotencyKey: randomUUID(),
    source: { nodeId: peer }, target: { nodeId: NODE }, taskId, type: 'task.cancel' as const,
    deadline: new Date(Date.now() + 30000).toISOString(), payload: {},
  };
}
async function until(predicate: () => boolean, message: string, budgetMs = 3000) {
  const deadline = Date.now() + budgetMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
const state = (store: Store, id: string) => store.task(id)?.state;
const lastEvent = (store: Store, id: string) =>
  (store.task(id)?.events.at(-1) as { type: string } | undefined)?.type;

it('dispatches a native task exactly once across duplicate redelivery, changed requests and foreign peers', async () => {
  const store = new Store(':memory:');
  const adapter = createMockAdapter({ nodeId: NODE });
  const sessions = new Sessions(store, NODE, VISIBLE);
  const router = new Router(store, sessions);
  const send = vi.spyOn(adapter, 'send');
  try {
    await sessions.register(adapter);
    const session = await sessions.spawn(PEER, AGENT_ID, 'project-a');
    const request = taskEnvelope(session, { key: randomUUID() });
    const first = await router.receive(PEER, request);
    expect(first.type).toBe('task.accepted');
    await until(() => state(store, request.taskId) === 'COMPLETED', 'fixture task not completed');
    expect(await router.receive(PEER, request)).toEqual(first);
    await expect(router.receive(PEER, taskEnvelope(session, {
      taskId: request.taskId, key: randomUUID(), messageId: randomUUID(), text: 'changed body',
    }))).rejects.toMatchObject({ code: 'conflict' });
    await expect(router.receive(PEER, taskEnvelope(session, {
      taskId: request.taskId, key: randomUUID(), messageId: randomUUID(),
      deadline: new Date(Date.now() + 60000).toISOString(),
    }))).rejects.toMatchObject({ code: 'conflict' });
    await expect(router.receive(PEER, taskEnvelope(session, {
      messageId: request.messageId, text: 'changed body',
    }))).rejects.toMatchObject({ code: 'conflict' });
    await expect(router.receive('foreign-peer', request)).rejects.toMatchObject({ code: 'permission_denied' });
    await expect(router.receive('foreign-peer', taskEnvelope(session, {
      taskId: request.taskId, key: randomUUID(), peer: 'foreign-peer',
    }))).rejects.toMatchObject({ code: 'conflict' });
    await expect(router.receive('foreign-peer', cancelEnvelope(request.taskId, 'foreign-peer')))
      .rejects.toMatchObject({ code: 'not_found' });
    expect(() => router.events('foreign-peer', { taskId: request.taskId, cursor: 0 })).toThrowError(
      expect.objectContaining({ code: 'not_found' }),
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(store.count('tasks')).toBe(1);
    expect(state(store, request.taskId)).toBe('COMPLETED');
  } finally {
    await router.stop();
    sessions.close();
    store.close();
  }
});

it('re-derives the admission reply after a crash lost the inbox receipt, without a second native dispatch', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lam-glm53-receipt-')), file = join(root, 'state.sqlite');
  const adapter = createMockAdapter({ nodeId: NODE });
  const send = vi.spyOn(adapter, 'send');
  let store = new Store(file);
  let sessions = new Sessions(store, NODE, VISIBLE);
  let router = new Router(store, sessions);
  try {
    await sessions.register(adapter);
    const session = await sessions.spawn(PEER, AGENT_ID, 'project-a');
    const request = taskEnvelope(session, { key: randomUUID() });
    const first = await router.receive(PEER, request);
    expect(first.type).toBe('task.accepted');
    await until(() => state(store, request.taskId) === 'COMPLETED', 'fixture task not completed');
    const events = store.task(request.taskId)!.events.length;
    // Crash point: the task ledger and its terminal result committed, the inbox receipt did not.
    store.db.prepare('DELETE FROM inbox WHERE id=?').run(request.messageId);
    sessions.close();
    store.close();
    store = new Store(file);
    sessions = new Sessions(store, NODE, VISIBLE);
    router = new Router(store, sessions); // No adapter registered after the restart.
    const retried = await router.receive(PEER, request);
    expect(retried.type).toBe('task.accepted');
    expect(retried.correlationId).toBe(request.messageId);
    expect(state(store, request.taskId)).toBe('COMPLETED');
    expect(store.task(request.taskId)!.events).toHaveLength(events);
    expect(store.count('tasks')).toBe(1);
    expect(await router.receive(PEER, request)).toEqual(retried);
    expect(send).toHaveBeenCalledTimes(1);
  } finally {
    sessions.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

it('refreshes only transport fields when the cached reply expired but the original request is still valid', async () => {
  const store = new Store(':memory:');
  const adapter = createMockAdapter({ nodeId: NODE });
  const sessions = new Sessions(store, NODE, VISIBLE);
  const router = new Router(store, sessions);
  const send = vi.spyOn(adapter, 'send');
  let clock: { mockRestore(): void } | undefined;
  try {
    await sessions.register(adapter);
    const session = await sessions.spawn(PEER, AGENT_ID, 'project-a');
    const request = taskEnvelope(session);
    const first = await router.receive(PEER, request);
    await until(() => state(store, request.taskId) === 'COMPLETED', 'fixture task not completed');
    clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(first.deadline) + 1000);
    expect(Date.now()).toBeLessThan(Date.parse(request.deadline));
    const refreshed = await router.receive(PEER, request);
    expect(refreshed.type).toBe('task.accepted');
    expect(refreshed.messageId).not.toBe(first.messageId);
    expect(refreshed.correlationId).toBe(request.messageId);
    expect(Date.parse(refreshed.deadline)).toBeGreaterThan(Date.now());
    expect(refreshed.payload).toEqual(first.payload);
    expect(send).toHaveBeenCalledTimes(1);
    expect(state(store, request.taskId)).toBe('COMPLETED');
  } finally {
    clock?.mockRestore();
    await router.stop();
    sessions.close();
    store.close();
  }
});

it('restarts an in-flight task into UNKNOWN, never replays it and keeps the session conservatively locked', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lam-glm53-unknown-')), file = join(root, 'state.sqlite');
  const scripted = new ScriptedAdapter();
  let store = new Store(file);
  let sessions = new Sessions(store, NODE, VISIBLE);
  let router = new Router(store, sessions);
  try {
    await sessions.register(scripted);
    const session = await sessions.spawn(PEER, AGENT_ID, 'project-a');
    const request = taskEnvelope(session, { key: randomUUID() });
    const first = await router.receive(PEER, request);
    expect(first.type).toBe('task.accepted');
    await until(() => state(store, request.taskId) === 'RUNNING', 'fixture task not running');
    // Crash point: ledger says RUNNING, the native outcome is unwitnessed.
    sessions.close();
    store.close();
    store = new Store(file);
    const recovered = store.recover();
    expect(recovered).toEqual([request.taskId]);
    expect(state(store, request.taskId)).toBe('UNKNOWN');
    expect(lastEvent(store, request.taskId)).toBe('unknown');
    sessions = new Sessions(store, NODE, VISIBLE);
    router = new Router(store, sessions);
    const restarted = new ScriptedAdapter();
    await sessions.register(restarted);
    // Duplicate of the original envelope: replay the recorded outcome, never re-execute.
    expect(await router.receive(PEER, request)).toEqual(first);
    // Conflicting parameters under the already-bound key are rejected as a conflict: the
    // envelope reuses the original task id, so admission reaches the ledger's (peer, key)
    // fingerprint check without passing the session-busy gate.
    await expect(router.receive(PEER, taskEnvelope(session, {
      taskId: request.taskId, key: request.idempotencyKey, messageId: randomUUID(), text: 'changed body',
    }))).rejects.toMatchObject({ code: 'conflict' });
    // A new task id under the same key must not create a second logical task. NOTE (observed
    // behavior, kept as-is for this test-only change): while the session is held by an UNKNOWN
    // task, the router's session-busy admission gate runs before the ledger's (peer, key)
    // conflict check, so this refusal surfaces as `busy` rather than `conflict`. Exactly-once
    // holds either way; the shadowed conflict diagnostic is reported as a suspected finding
    // for a separate fix proposal and must not be patched inside this test-only PR.
    await expect(router.receive(PEER, taskEnvelope(session, {
      key: request.idempotencyKey, messageId: randomUUID(),
    }))).rejects.toMatchObject({ code: 'busy' });
    // UNKNOWN conservatively holds the session: new logical work is refused as busy.
    await expect(router.receive(PEER, taskEnvelope(session))).rejects.toMatchObject({ code: 'busy' });
    expect(restarted.sendCalls).toHaveLength(0);
    expect(restarted.cancelCalls).toHaveLength(0);
    expect(store.count('tasks')).toBe(1);
    expect(state(store, request.taskId)).toBe('UNKNOWN');
    expect(router.events(PEER, { taskId: request.taskId, cursor: 0 }).state).toBe('UNKNOWN');
  } finally {
    sessions.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

it('keeps a completed task completed when cancellation arrives after the terminal event', async () => {
  const store = new Store(':memory:');
  const adapter = createMockAdapter({ nodeId: NODE });
  const sessions = new Sessions(store, NODE, VISIBLE);
  const router = new Router(store, sessions);
  const cancel = vi.spyOn(adapter, 'cancel');
  try {
    await sessions.register(adapter);
    const session = await sessions.spawn(PEER, AGENT_ID, 'project-a');
    const request = taskEnvelope(session);
    await router.receive(PEER, request);
    await until(() => !router.running.has(request.taskId), 'fixture task still running');
    expect(state(store, request.taskId)).toBe('COMPLETED');
    const response = await router.receive(PEER, cancelEnvelope(request.taskId));
    expect(response.type).toBe('ack');
    expect(cancel).not.toHaveBeenCalled();
    expect(state(store, request.taskId)).toBe('COMPLETED');
    expect(lastEvent(store, request.taskId)).toBe('completed');
  } finally {
    await router.stop();
    sessions.close();
    store.close();
  }
});

it('reaches CANCELLED through the adapter when cancellation is honored mid-run', async () => {
  const store = new Store(':memory:');
  const adapter = createMockAdapter({ nodeId: NODE, scenario: { chunks: ['a', 'b'], delayMs: 40 } });
  const sessions = new Sessions(store, NODE, VISIBLE);
  const router = new Router(store, sessions);
  const cancel = vi.spyOn(adapter, 'cancel');
  try {
    await sessions.register(adapter);
    const session = await sessions.spawn(PEER, AGENT_ID, 'project-a');
    const request = taskEnvelope(session);
    await router.receive(PEER, request);
    await until(() => state(store, request.taskId) === 'RUNNING', 'fixture task not running');
    const response = await router.receive(PEER, cancelEnvelope(request.taskId));
    expect(response.type).toBe('ack');
    expect(cancel).toHaveBeenCalled();
    await until(() => state(store, request.taskId) === 'CANCELLED', 'fixture task not cancelled');
    expect(lastEvent(store, request.taskId)).toBe('cancelled');
  } finally {
    await router.stop();
    sessions.close();
    store.close();
  }
});

it('never reports CANCELLED while the native run ignores the cancellation request', async () => {
  const store = new Store(':memory:');
  const scripted = new ScriptedAdapter();
  scripted.ignoreCancel = true;
  const sessions = new Sessions(store, NODE, VISIBLE);
  const router = new Router(store, sessions);
  try {
    await sessions.register(scripted);
    const session = await sessions.spawn(PEER, AGENT_ID, 'project-a');
    const request = taskEnvelope(session);
    await router.receive(PEER, request);
    await until(() => state(store, request.taskId) === 'RUNNING', 'fixture task not running');
    const cancellation = router.receive(PEER, cancelEnvelope(request.taskId));
    const outcome = await Promise.race([
      cancellation.then(() => 'settled' as const),
      new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 250)),
    ]);
    expect(outcome).toBe('pending');
    expect(scripted.cancelCalls).toContain(request.taskId);
    expect(state(store, request.taskId)).toBe('RUNNING');
    scripted.emit(request.taskId, { type: 'completed', taskId: request.taskId, text: 'late native result' });
    expect((await cancellation).type).toBe('ack');
    await until(() => !router.running.has(request.taskId), 'fixture task still running');
    expect(state(store, request.taskId)).toBe('COMPLETED');
    expect(lastEvent(store, request.taskId)).toBe('completed');
  } finally {
    await router.stop();
    sessions.close();
    store.close();
  }
});

it('keeps exactly-once dispatch when inbox retention is full: admission is refused, the task still progresses', async () => {
  const store = new Store(':memory:');
  const scripted = new ScriptedAdapter();
  const sessions = new Sessions(store, NODE, VISIBLE);
  const router = new Router(store, sessions);
  try {
    await sessions.register(scripted);
    const session = await sessions.spawn(PEER, AGENT_ID, 'project-a');
    store.transaction(() => {
      const row = store.db.prepare('INSERT INTO inbox VALUES (?,?,?,?)');
      for (let i = 0; i < 10000; i++) row.run(`fill-${i}`, PEER, 'fingerprint', '"retained"');
    });
    const request = taskEnvelope(session);
    await expect(router.receive(PEER, request)).rejects.toMatchObject({ code: 'busy' });
    await until(() => state(store, request.taskId) === 'RUNNING', 'fixture task not running');
    await expect(router.receive(PEER, request)).rejects.toMatchObject({ code: 'busy' });
    expect(scripted.sendCalls).toHaveLength(1);
    expect(store.count('tasks')).toBe(1);
    scripted.emit(request.taskId, { type: 'completed', taskId: request.taskId, text: 'completed under pressure' });
    await until(() => state(store, request.taskId) === 'COMPLETED', 'fixture task not completed');
    expect(router.events(PEER, { taskId: request.taskId, cursor: 0 }).state).toBe('COMPLETED');
  } finally {
    await router.stop();
    sessions.close();
    store.close();
  }
});

it('bounds a chatty adapter to the durable event budget and ends UNKNOWN, not unbounded', async () => {
  const store = new Store(':memory:');
  const scripted = new ScriptedAdapter();
  const originalSend = scripted.send.bind(scripted);
  scripted.send = async (input: SendInput) => {
    const result = await originalSend(input);
    for (let i = 0; i < 3000; i++)
      scripted.emit(input.taskId, { type: 'delta', taskId: input.taskId, text: `noise-${i}` });
    return result;
  };
  const sessions = new Sessions(store, NODE, VISIBLE);
  const router = new Router(store, sessions);
  try {
    await sessions.register(scripted);
    const session = await sessions.spawn(PEER, AGENT_ID, 'project-a');
    const request = taskEnvelope(session);
    await router.receive(PEER, request);
    await until(() => state(store, request.taskId) === 'UNKNOWN', 'fixture task not bounded to UNKNOWN');
    const task = store.task(request.taskId)!;
    expect(task.events.length).toBeLessThanOrEqual(2049);
    expect(task.events.at(-1)).toMatchObject({ type: 'unknown' });
    expect(scripted.cancelCalls).toContain(request.taskId);
  } finally {
    await router.stop();
    sessions.close();
    store.close();
  }
});

it('refuses admission while the adapter probe is offline and recovers when it returns; dispatch failure ends UNKNOWN', async () => {
  const store = new Store(':memory:');
  const scripted = new ScriptedAdapter();
  const sessions = new Sessions(store, NODE, VISIBLE);
  const router = new Router(store, sessions);
  try {
    await sessions.register(scripted);
    const session = await sessions.spawn(PEER, AGENT_ID, 'project-a');
    scripted.probeAvailable = false;
    const offline = taskEnvelope(session, { key: randomUUID() });
    await expect(router.receive(PEER, offline)).rejects.toMatchObject({ code: 'unsupported' });
    expect(store.count('tasks')).toBe(0);
    expect(scripted.sendCalls).toHaveLength(0);
    scripted.probeAvailable = true;
    const admitted = await router.receive(PEER, offline);
    expect(admitted.type).toBe('task.accepted');
    await until(() => state(store, offline.taskId) === 'RUNNING', 'fixture task not running');
    scripted.emit(offline.taskId, { type: 'completed', taskId: offline.taskId, text: 'back online' });
    await until(() => state(store, offline.taskId) === 'COMPLETED', 'fixture task not completed');
    scripted.rejectSend = true;
    const failing = taskEnvelope(session, { key: randomUUID() });
    const accepted = await router.receive(PEER, failing);
    expect(accepted.type).toBe('task.accepted');
    await until(() => state(store, failing.taskId) === 'UNKNOWN', 'dispatch failure not recorded as UNKNOWN');
    expect(scripted.sendCalls.map((c) => c.taskId)).toEqual([offline.taskId, failing.taskId]);
    expect(await router.receive(PEER, failing)).toEqual(accepted);
    expect(scripted.sendCalls).toHaveLength(2);
  } finally {
    await router.stop();
    sessions.close();
    store.close();
  }
});
