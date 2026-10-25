import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { MeshError, EnvelopeSchema, decodeEnvelope, encodeEnvelope, type Envelope } from '@lam/protocol';
import type { AdapterEvent } from '@lam/adapter-sdk';
import { Store, fingerprint, type TaskStatus } from '@lam/storage';
import { Sessions } from './sessions.js';

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new MeshError('cancelled', 'Gateway is stopping'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
async function* observed(events: AsyncIterable<AdapterEvent>, signal: AbortSignal) {
  const iterator = events[Symbol.asyncIterator]();
  try {
    while (!signal.aborted) {
      const item = await abortable(iterator.next(), signal);
      if (item.done) return;
      yield item.value;
    }
  } finally {
    void iterator.return?.().catch(() => {});
  }
}

export class Router {
  readonly running = new Map<string, Promise<void>>();
  private readonly controllers = new Map<string, AbortController>();
  constructor(
    readonly store: Store,
    readonly sessions: Sessions,
  ) {}
  private response(request: Envelope, type: string, payload: unknown): Envelope {
    return decodeEnvelope(
      encodeEnvelope({
        version: 1,
        messageId: randomUUID(),
        correlationId: request.messageId,
        source: { nodeId: this.sessions.nodeId },
        target: request.source,
        deadline: new Date(Date.now() + 30000).toISOString(),
        ...(request.taskId ? { taskId: request.taskId } : {}),
        type,
        payload,
      }),
    );
  }
  private replay(request: Envelope, peer: string, value: unknown): Envelope {
    const parsed = EnvelopeSchema.safeParse(value);
    if (!parsed.success) throw new MeshError('invalid_message', 'Cached reply does not match protocol');
    const previous = parsed.data;
    if (previous.source.nodeId !== this.sessions.nodeId || previous.target.nodeId !== peer ||
        previous.correlationId !== request.messageId || previous.taskId !== request.taskId)
      throw new MeshError('invalid_message', 'Cached reply scope mismatch');
    if (request.type === 'session.create' || request.type === 'session.resume') {
      if (previous.type !== 'session.event' || previous.payload.nodeId !== this.sessions.nodeId ||
        (request.type === 'session.create' && (previous.payload.agentId !== request.payload.agentId || previous.payload.workspaceAlias !== request.payload.workspaceAlias)) ||
        (request.type === 'session.resume' && previous.payload.id !== request.payload.sessionId))
        throw new MeshError('invalid_message', 'Cached session result scope mismatch');
    }
    // The original authenticated request is still valid. Only refresh transport fields;
    // the recorded business outcome and both durable replay ledgers remain unchanged.
    return Date.parse(previous.deadline) > Date.now() ? previous : this.response(request, previous.type, previous.payload);
  }
  async receive(peer: string, input: unknown): Promise<Envelope> {
    const request = decodeEnvelope(encodeEnvelope(input));
    if (request.source.nodeId !== peer || request.target.nodeId !== this.sessions.nodeId)
      throw new MeshError('permission_denied', 'Envelope identity mismatch');
    const cached = this.store.inbox(request.messageId, peer, request);
    if (cached) return this.replay(request, peer, cached);
    let response: Envelope;
    if (request.type === 'session.create' || request.type === 'session.resume') {
      const key = `operation/${peer}/${request.idempotencyKey}`;
      const prior = this.store.get<{ fingerprint: string; response?: Envelope }>('messages', key);
      if (prior) {
        if (prior.fingerprint !== fingerprint(request))
          throw new MeshError('conflict', 'Operation key conflict');
        if (!prior.response)
          throw new MeshError('disconnected', 'Session operation outcome unknown; do not repeat');
        return this.replay(request, peer, prior.response);
      }
      // Rejected/uncertain operations also retain a reservation; cap them before effects.
      if (Number(this.store.query("SELECT count(*) AS n FROM messages WHERE id LIKE 'operation/%'")[0]?.n) >= 1000)
        throw new MeshError('busy', 'Session operation retention capacity reached');
      // Persist an uncertain reservation BEFORE invoking any adapter side effect.
      this.store.put('messages', key, { fingerprint: fingerprint(request) });
      const session =
        request.type === 'session.create'
          ? await this.sessions.spawn(peer, request.payload.agentId, request.payload.workspaceAlias, request.deadline)
          : await this.sessions.resume(peer, request.payload.sessionId, request.deadline);
      response = this.response(request, 'session.event', session);
      this.store.put('messages', key, { fingerprint: fingerprint(request), response });
    } else if (request.type === 'task.request') {
      const prior = this.store.task(request.taskId!);
      if (!prior) {
        const binding = this.sessions.binding(request.payload.sessionId, peer);
        if (
          request.target.agentId !== binding.session.agentId ||
          request.payload.workspaceAlias !== binding.session.workspaceAlias
        )
          throw new MeshError('permission_denied', 'Task session scope mismatch');
        if (request.payload.delegationDepth > 4)
          throw new MeshError('permission_denied', 'Delegation depth exceeds Gateway budget');
        if (Date.parse(request.deadline) - Date.now() > 300000)
          throw new MeshError('invalid_message', 'Task budget exceeds five minutes');
        await this.sessions.requireAvailable(binding.session.agentId, ['send', 'watch']);
        if (Date.parse(request.deadline) <= Date.now()) throw new MeshError('deadline_exceeded', 'Task expired during admission');
        if (this.sessions.busy(binding.session.id) || this.running.size >= 16)
          throw new MeshError('busy', 'Session or Gateway busy');
      }
      const accepted = this.store.acceptTask(request.taskId!, peer, request.idempotencyKey!, {
        sessionId: request.payload.sessionId,
        text: request.payload.text,
        workspaceAlias: request.payload.workspaceAlias,
        deadline: request.deadline,
        agentId: request.target.agentId,
        depth: request.payload.delegationDepth,
      });
      if (accepted.fresh) {
        const run = this.execute(accepted.task.id, peer);
        this.running.set(accepted.task.id, run);
        void run.then(
          () => this.running.delete(accepted.task.id),
          () => this.running.delete(accepted.task.id),
        );
      }
      response = this.response(request, 'task.accepted', { state: 'QUEUED' });
    } else if (request.type === 'task.cancel') {
      const task = this.store.task(request.taskId!);
      if (!task || task.peer !== peer) throw new MeshError('not_found', 'Task not found');
      if (this.running.has(task.id)) {
        const binding = this.sessions.binding(
          (task.input as { sessionId: string }).sessionId,
          peer,
        );
        await this.sessions.adapter(binding.session.agentId).cancel(task.id);
        await this.running.get(task.id);
      }
      response = this.response(request, 'ack', { messageId: request.messageId });
    } else if (request.type === 'ping')
      response = this.response(request, 'ack', { messageId: request.messageId });
    else throw new MeshError('unsupported', 'Message not supported by this P1 Gateway');
    this.store.receipt(request.messageId, peer, request, response);
    return response;
  }
  private async execute(id: string, peer: string) {
    const task = this.store.task(id)!;
    const input = task.input as { sessionId: string; text: string; deadline: string };
    const controller = new AbortController();
    this.controllers.set(id, controller);
    try {
      const binding = this.sessions.binding(input.sessionId, peer),
        adapter = this.sessions.adapter(binding.session.agentId);
      // RUNNING is committed before send. Any crash after this point recovers UNKNOWN.
      this.store.event(id, 'RUNNING', { type: 'started', taskId: id });
      await abortable(
        adapter.send({
          sessionId: binding.adapterSessionId,
          taskId: id,
          text: input.text,
          idempotencyKey: task.key,
          deadline: input.deadline,
        }),
        controller.signal,
      );
      let terminal = false;
      for await (const event of observed(adapter.watch(id, controller.signal), controller.signal)) {
        const states: Record<AdapterEvent['type'], TaskStatus> = {
          delta: 'RUNNING',
          permission: 'WAITING_INPUT',
          completed: 'COMPLETED',
          failed: 'FAILED',
          cancelled: 'CANCELLED',
          unknown: 'UNKNOWN',
        };
        if (this.store.task(id)!.events.length >= 2048) {
          await adapter.cancel(id);
          throw new MeshError('busy', 'Event budget exceeded');
        }
        this.store.event(id, states[event.type], event);
        if (event.type === 'permission') {
          this.store.put('approvals', event.request.requestId, {
            ...event.request,
            decision: 'deny',
          });
          await adapter.answerPermission({
            ...event.request,
            decision: 'deny',
            humanId: 'gateway-default-deny',
          });
        }
        if (!['delta', 'permission'].includes(event.type)) terminal = true;
      }
      if (!terminal)
        this.store.event(id, 'UNKNOWN', {
          type: 'unknown',
          taskId: id,
          reason: 'Adapter stream ended without terminal result',
        });
    } catch {
      this.store.event(id, 'UNKNOWN', {
        type: 'unknown',
        taskId: id,
        reason: 'Adapter control failed; no automatic replay',
      });
    } finally {
      this.controllers.delete(id);
    }
  }
  events(peer: string, value: unknown) {
    const input = z
      .object({ taskId: z.string().min(1).max(128), cursor: z.number().int().min(0).max(4096) })
      .strict()
      .parse(value);
    const task = this.store.task(input.taskId);
    if (!task || task.peer !== peer) throw new MeshError('not_found', 'Task not found');
    return {
      state: task.state,
      events: task.events.slice(input.cursor, input.cursor + 1),
      next: Math.min(task.events.length, input.cursor + 1),
    };
  }
  async stop() {
    for (const controller of this.controllers.values()) controller.abort();
    const cancellation = Promise.allSettled(
      [...this.running.keys()].map(async (id) => {
        const task = this.store.task(id)!;
        const binding = this.sessions.binding(
          (task.input as { sessionId: string }).sessionId,
          task.peer,
        );
        await this.sessions.adapter(binding.session.agentId).cancel(id);
      }),
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        cancellation,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 3000);
          timer.unref();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    await Promise.allSettled(this.running.values());
  }
}
