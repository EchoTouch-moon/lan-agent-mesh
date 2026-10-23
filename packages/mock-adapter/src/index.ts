import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { IdSchema, SessionSchema, TimestampSchema, WorkspaceAliasSchema, type Capabilities, type Session } from '@lam/domain';
import { AdapterClient, MeshError, type AdapterEvent, type Agent, type PermissionRequest, type SendInput } from '@lam/adapter-sdk';

export const MOCK_CAPABILITIES: Capabilities = {
  discover: 'supported', spawn: 'supported', resume: 'supported', send: 'supported', watch: 'supported',
  cancel: 'supported', answerPermission: 'supported', attachExistingGui: 'unsupported',
};
export interface MockScenario {
  chunks?: string[]; delayMs?: number; permission?: boolean; fail?: boolean; disconnectAfterChunks?: number;
}
interface Run {
  input: SendInput; fingerprint: string; events: AdapterEvent[]; terminal: boolean;
  controller: AbortController; listeners: Set<() => void>; done: Promise<void>;
  permission?: { request: PermissionRequest; resolve: (allowed: boolean) => void };
}
export interface MockOptions {
  nodeId?: string; scenario?: MockScenario; capabilities?: Capabilities; maxSessions?: number; maxTasks?: number;
}
/** Test harness only. All state and replay records are process-local. */
export function createMockAdapter(options: MockOptions = {}): AdapterClient {
  const nodeId = IdSchema.parse(options.nodeId ?? 'mock-node');
  const agentId = `${nodeId}/mock/default`;
  IdSchema.parse(agentId);
  const capabilities = { ...(options.capabilities ?? MOCK_CAPABILITIES) };
  const sessions = new Map<string, Session>();
  const runs = new Map<string, Run>();
  const keys = new Map<string, Run>();
  const scenario = structuredClone(options.scenario ?? {});
  const agent: Agent = { id: agentId, nodeId, harnessId: `${nodeId}/mock`, name: 'Deterministic mock', workspaceAliases: ['project-a'], capabilities };
  function session(id: string): Session {
    const s = sessions.get(id);
    if (!s) throw new MeshError('not_found', 'Session not found');
    return s;
  }
  function run(id: string): Run {
    const r = runs.get(id);
    if (!r) throw new MeshError('not_found', 'Task not found');
    return r;
  }
  function emit(r: Run, event: AdapterEvent) {
    r.events.push(event);
    if (event.type !== 'delta' && event.type !== 'permission') r.terminal = true;
    for (const listener of r.listeners) listener();
  }
  function aborted(r: Run) {
    if (r.controller.signal.aborted) throw r.controller.signal.reason;
  }
  async function execute(r: Run) {
    const s = session(r.input.sessionId);
    const timer = setTimeout(() => r.controller.abort(new MeshError('deadline_exceeded', 'Task deadline exceeded')), Math.min(2 ** 31 - 1, Date.parse(r.input.deadline) - Date.now()));
    try {
      // Always defer execution so send() returns before any scenario runs.
      await delay(0, undefined, { signal: r.controller.signal });
      if (scenario.permission) {
        s.state = 'waiting_input';
        const request: PermissionRequest = {
          requestId: randomUUID(), nodeId, agentId, sessionId: s.id, taskId: r.input.taskId,
          operationDigest: createHash('sha256').update(r.input.text).digest('hex'), nonce: randomUUID(), expiresAt: r.input.deadline,
        };
        const allowed = await new Promise<boolean>((resolve, reject) => {
          r.permission = { request, resolve };
          const onAbort = () => reject(r.controller.signal.reason);
          r.controller.signal.addEventListener('abort', onAbort, { once: true });
          // Remove the listener whether the approval resolves or the task aborts.
          r.permission.resolve = value => { r.controller.signal.removeEventListener('abort', onAbort); resolve(value); };
          emit(r, { type: 'permission', taskId: r.input.taskId, request: structuredClone(request) });
        });
        delete r.permission;
        if (!allowed) throw new MeshError('permission_denied', 'Mock operation denied');
        aborted(r);
        s.state = 'running';
      }
      const chunks = scenario.chunks ?? ['mock:', r.input.text];
      for (let i = 0; i < chunks.length; i++) {
        if (scenario.disconnectAfterChunks === i) {
          emit(r, { type: 'unknown', taskId: r.input.taskId, reason: 'Injected disconnect; do not automatically replay' });
          return;
        }
        await delay(scenario.delayMs ?? 0, undefined, { signal: r.controller.signal });
        aborted(r);
        emit(r, { type: 'delta', taskId: r.input.taskId, text: chunks[i]! });
      }
      if (scenario.fail) throw new MeshError('internal', 'Injected harness failure');
      emit(r, { type: 'completed', taskId: r.input.taskId, text: chunks.join('') });
    } catch (error) {
      const reason: unknown = r.controller.signal.aborted ? r.controller.signal.reason : error;
      if (reason instanceof MeshError && reason.code === 'cancelled') emit(r, { type: 'cancelled', taskId: r.input.taskId });
      else emit(r, { type: 'failed', taskId: r.input.taskId, code: reason instanceof MeshError ? reason.code : 'internal' });
    } finally {
      clearTimeout(timer); delete r.permission; s.state = 'idle';
    }
  }
  return new AdapterClient('mock/1', capabilities, {
    async discover() { return [structuredClone(agent)]; },
    async spawn(input) {
      if (input.agentId !== agentId) throw new MeshError('not_found', 'Agent not found');
      if (!WorkspaceAliasSchema.safeParse(input.workspaceAlias).success || !agent.workspaceAliases.includes(input.workspaceAlias))
        throw new MeshError('permission_denied', 'Workspace alias is not registered');
      if (sessions.size >= (options.maxSessions ?? 100)) throw new MeshError('busy', 'Session capacity exceeded');
      const s = SessionSchema.parse({ id: randomUUID(), nodeId, agentId, nativeSessionId: randomUUID(), workspaceAlias: input.workspaceAlias, state: 'idle', createdAt: new Date().toISOString() });
      sessions.set(s.id, s); return structuredClone(s);
    },
    async resume(id) { return structuredClone(session(id)); },
    async send(input) {
      if (!IdSchema.safeParse(input.taskId).success || !IdSchema.safeParse(input.idempotencyKey).success ||
          !TimestampSchema.safeParse(input.deadline).success || typeof input.text !== 'string' || input.text.length === 0 || input.text.length > 32768)
        throw new MeshError('invalid_message', 'Invalid task input');
      const fingerprint = JSON.stringify([input.sessionId, input.taskId, input.text, input.deadline]);
      const previous = keys.get(input.idempotencyKey);
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new MeshError('conflict', 'Idempotency key reused for different input');
        return { taskId: previous.input.taskId };
      }
      const remaining = Date.parse(input.deadline) - Date.now();
      if (remaining <= 0) throw new MeshError('deadline_exceeded', 'Task expired');
      if (remaining > 2 ** 31 - 1) throw new MeshError('invalid_message', 'Mock deadline exceeds timer range');
      const s = session(input.sessionId);
      if (runs.has(input.taskId)) throw new MeshError('conflict', 'Task ID already used');
      if (s.state !== 'idle') throw new MeshError('busy', 'Session already has an active turn');
      if (runs.size >= (options.maxTasks ?? 1000)) throw new MeshError('busy', 'Task capacity exceeded');
      const r: Run = { input: { ...input }, fingerprint, events: [], terminal: false, controller: new AbortController(), listeners: new Set(), done: Promise.resolve() };
      runs.set(input.taskId, r); keys.set(input.idempotencyKey, r); s.state = 'running';
      r.done = execute(r);
      return { taskId: input.taskId };
    },
    async *watch(id, signal) {
      const r = run(id); let index = 0;
      while (!signal?.aborted) {
        while (index < r.events.length) yield structuredClone(r.events[index++]!);
        if (r.terminal) return;
        await new Promise<void>(resolve => {
          const wake = () => { r.listeners.delete(wake); signal?.removeEventListener('abort', wake); resolve(); };
          r.listeners.add(wake); signal?.addEventListener('abort', wake, { once: true });
          if (signal?.aborted) wake();
        });
      }
    },
    async cancel(id) {
      const r = run(id);
      if (!r.terminal) r.controller.abort(new MeshError('cancelled', 'Cancelled'));
      await r.done;
    },
    async answerPermission(decision) {
      const r = run(decision.taskId); const pending = r.permission;
      if (!pending || r.terminal) throw new MeshError('permission_denied', 'No pending permission');
      const request = pending.request;
      const fields = ['requestId', 'nodeId', 'agentId', 'sessionId', 'taskId', 'operationDigest', 'nonce', 'expiresAt'] as const;
      if (fields.some(key => decision[key] !== request[key]) || !IdSchema.safeParse(decision.humanId).success ||
          !['allow', 'deny'].includes(decision.decision) || Date.parse(request.expiresAt) <= Date.now())
        throw new MeshError('permission_denied', 'Permission scope, human or expiry invalid');
      delete r.permission; pending.resolve(decision.decision === 'allow');
    },
  });
}
