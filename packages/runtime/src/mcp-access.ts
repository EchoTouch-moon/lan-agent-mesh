import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { z, MCP_INPUTS, type McpTool } from '@lam/mcp-contract';
import { SessionSchema, type Session } from '@lam/domain';
import { MeshError, encodeEnvelope, type Envelope } from '@lam/protocol';
import type { Gateway } from './index.js';

const Id = z.string().min(1).max(128);
const GrantInput = z
  .object({
    peers: z.array(Id).min(1).max(8),
    agents: z.array(Id).min(1).max(16),
    workspaces: z
      .array(
        z
          .string()
          .min(1)
          .max(64)
          .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/),
      )
      .min(1)
      .max(16),
    lifetimeSeconds: z.number().int().min(1).max(86400).default(3600),
  })
  .strict();
interface Grant {
  id: string;
  secretHash: string;
  bootId: string;
  peers: string[];
  agents: string[];
  workspaces: string[];
  expiresAt: number;
  revoked: boolean;
}
interface OwnedSession {
  peer: string;
  session: Session;
}
interface Operation {
  fingerprint: string;
  request: Envelope;
  response?: unknown;
  ownedSession?: OwnedSession;
}
interface OwnedTask extends Operation {
  peer: string;
  sessionId: string;
  taskId: string;
  status: 'submitting' | 'accepted' | 'UNKNOWN';
}
function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
function publicSession(value: OwnedSession) {
  const { id, agentId, workspaceAlias, createdAt } = value.session;
  return {
    sessionId: id,
    peerId: value.peer,
    agentId,
    workspaceAlias,
    nativeState: 'unknown',
    createdAt,
  };
}
/** Scoped ingress only: no admin, pairing, allow-decision or arbitrary forwarding methods. */
export class McpAccess {
  private readonly bootId = randomUUID();
  private readonly rates = new Map<string, { at: number; count: number }>();
  private inFlight = 0;
  private readonly operations = new Map<
    string,
    { fingerprint: string; promise: Promise<unknown> }
  >();
  constructor(private readonly gateway: Gateway) {}
  private get store() {
    return this.gateway.store;
  }
  async create(input: unknown) {
    const scope = GrantInput.parse(input);
    if (this.store.query("SELECT id FROM messages WHERE id LIKE 'mcp/grant/%'").length >= 128)
      throw new MeshError('busy', 'MCP grant retention capacity reached');
    for (const peer of scope.peers) {
      if (!this.gateway.mesh.trusted(peer))
        throw new MeshError('permission_denied', 'Pair peer locally before creating a credential');
      await this.gateway.sync(peer);
    }
    for (const id of scope.agents) {
      const agent = this.gateway
        .remoteAgents()
        .find((a) => a.id === id && scope.peers.includes(a.nodeId));
      if (!agent || !agent.workspaceAliases.some((alias) => scope.workspaces.includes(alias)))
        throw new MeshError(
          'permission_denied',
          'Exported agent/workspace does not match requested scope',
        );
    }
    const id = randomUUID(),
      secret = randomBytes(32).toString('hex');
    const grant: Grant = {
      id,
      secretHash: digest(secret),
      bootId: this.bootId,
      peers: [...new Set(scope.peers)],
      agents: [...new Set(scope.agents)],
      workspaces: [...new Set(scope.workspaces)],
      expiresAt: Date.now() + scope.lifetimeSeconds * 1000,
      revoked: false,
    };
    if (this.store.query("SELECT id FROM messages WHERE id LIKE 'mcp/grant/%'").length >= 128)
      throw new MeshError('busy', 'MCP grant capacity reached');
    this.reserve(`mcp/grant/${id}`, grant);
    this.store.audit('mcp.grant.created', id);
    return {
      version: 1,
      gatewayNodeId: this.gateway.mesh.id,
      url: this.gateway.url,
      token: `mcp.${id}.${secret}`,
      grantId: id,
      expiresAt: new Date(grant.expiresAt).toISOString(),
    };
  }
  revoke(input: unknown) {
    const { grantId } = z.object({ grantId: z.string().uuid() }).strict().parse(input);
    const grant = this.store.get<Grant>('messages', `mcp/grant/${grantId}`);
    if (!grant) throw new MeshError('not_found', 'Grant not found');
    this.store.put('messages', `mcp/grant/${grantId}`, { ...grant, revoked: true });
    this.store.audit('mcp.grant.revoked', grantId);
    return { revoked: true };
  }
  authenticate(token: string): Grant {
    const match = /^mcp\.([a-f0-9-]{36})\.([a-f0-9]{64})$/.exec(token);
    const grant = match ? this.store.get<Grant>('messages', `mcp/grant/${match[1]}`) : undefined;
    if (
      !grant ||
      !match ||
      !timingSafeEqual(Buffer.from(digest(match[2]!)), Buffer.from(grant.secretHash))
    )
      throw new MeshError('permission_denied', 'Invalid MCP credential');
    this.live(grant);
    return grant;
  }
  private live(grant: Grant) {
    const current = this.store.get<Grant>('messages', `mcp/grant/${grant.id}`);
    if (
      !current ||
      current.bootId !== this.bootId ||
      current.revoked ||
      current.expiresAt <= Date.now()
    )
      throw new MeshError(
        'permission_denied',
        'MCP credential expired, revoked or from an earlier Gateway process',
      );
  }
  private peer(grant: Grant, peer: string) {
    this.live(grant);
    if (!grant.peers.includes(peer) || !this.gateway.mesh.trusted(peer))
      throw new MeshError('permission_denied', 'Peer outside current credential scope');
  }
  private capacity() {
    if (
      Number(this.store.query("SELECT count(*) AS n FROM messages WHERE id LIKE 'mcp/%'")[0]?.n) >=
      5000
    )
      throw new MeshError('busy', 'MCP metadata capacity reached');
  }
  private reserve(key: string, value: unknown) {
    if (!this.store.get('messages', key)) this.capacity();
    this.store.put('messages', key, value);
  }
  private key(grant: Grant, kind: string, id: string) {
    return `mcp/${kind}/${grant.id}/${id}`;
  }
  private ownedSession(grant: Grant, id: string) {
    const row = this.store.query(
      "SELECT data FROM messages WHERE id LIKE ? AND json_extract(data,'$.ownedSession.session.id')=?",
      this.key(grant, 'start', '%'),
      id,
    )[0];
    const value = row ? (JSON.parse(String(row.data)) as Operation).ownedSession : undefined;
    if (!value) throw new MeshError('not_found', 'Session not created by this credential');
    this.peer(grant, value.peer);
    if (
      !grant.agents.includes(value.session.agentId) ||
      !grant.workspaces.includes(value.session.workspaceAlias)
    )
      throw new MeshError('permission_denied', 'Session outside scope');
    return value;
  }
  private ownedTask(grant: Grant, id: string) {
    const row = this.store.query(
      "SELECT data FROM messages WHERE id LIKE ? AND json_extract(data,'$.taskId')=?",
      this.key(grant, 'task-request', '%'),
      id,
    )[0];
    const value = row ? (JSON.parse(String(row.data)) as OwnedTask) : undefined;
    if (!value) throw new MeshError('not_found', 'Task not created by this credential');
    this.ownedSession(grant, value.sessionId);
    return value;
  }
  async invoke(grant: Grant, tool: string, args: unknown): Promise<unknown> {
    this.live(grant);
    if (!Object.hasOwn(MCP_INPUTS, tool))
      throw new MeshError('unsupported', 'Tool is not exposed to MCP');
    const now = Date.now(),
      rate = this.rates.get(grant.id);
    if (this.inFlight >= 16 || (rate && now - rate.at < 60000 && rate.count >= 240))
      throw new MeshError('busy', 'MCP request limit exceeded');
    this.rates.set(grant.id, {
      at: rate && now - rate.at < 60000 ? rate.at : now,
      count: rate && now - rate.at < 60000 ? rate.count + 1 : 1,
    });
    this.inFlight++;
    try {
      const input = MCP_INPUTS[tool as McpTool].parse(args);
      const requestId = 'requestId' in input ? input.requestId : undefined;
      const key = requestId
        ? `${grant.id}/${tool === 'mesh_start_session' ? 'start' : 'task'}/${requestId}`
        : undefined;
      const fingerprint = digest(JSON.stringify({ tool, input }));
      let promise: Promise<unknown>;
      if (key && this.operations.has(key)) {
        const prior = this.operations.get(key)!;
        if (prior.fingerprint !== fingerprint)
          throw new MeshError('conflict', 'Concurrent request ID conflict');
        promise = prior.promise;
      } else {
        promise = this.dispatch(grant, tool as McpTool, input);
        if (key) {
          this.operations.set(key, { fingerprint, promise });
          void promise.then(
            () => this.operations.delete(key),
            () => this.operations.delete(key),
          );
        }
      }
      const result = await promise;
      this.live(grant);
      return result;
    } finally {
      this.inFlight--;
    }
  }
  private async dispatch(grant: Grant, tool: McpTool, args: unknown): Promise<unknown> {
    if (tool === 'mesh_list_agents') {
      const input = MCP_INPUTS.mesh_list_agents.parse(args),
        peers = input.peerId ? [input.peerId] : grant.peers;
      for (const peer of peers) this.peer(grant, peer);
      const refreshed = await Promise.allSettled(peers.map((peer) => this.gateway.sync(peer)));
      const availablePeers = peers.filter((_, i) => refreshed[i]?.status === 'fulfilled');
      const agents = this.gateway
        .remoteAgents()
        .filter((a) => availablePeers.includes(a.nodeId) && grant.agents.includes(a.id))
        .map((a) => ({
          ...a,
          workspaceAliases: a.workspaceAliases.filter((w) => grant.workspaces.includes(w)),
        }))
        .filter((a) => a.workspaceAliases.length > 0);
      return {
        agents: agents.slice(input.cursor, input.cursor + input.limit),
        next: Math.min(agents.length, input.cursor + input.limit),
        unavailablePeers: peers.filter((p) => !availablePeers.includes(p)),
      };
    }
    if (tool === 'mesh_list_sessions') {
      const input = MCP_INPUTS.mesh_list_sessions.parse(args);
      if (input.peerId) this.peer(grant, input.peerId);
      const rows = this.store.query(
        'SELECT data FROM messages WHERE id LIKE ?',
        this.key(grant, 'start', '%'),
      );
      const sessions = rows
        .map((r) => (JSON.parse(String(r.data)) as Operation).ownedSession)
        .filter((r): r is OwnedSession => Boolean(r))
        .filter(
          (r) => (!input.peerId || r.peer === input.peerId) && this.gateway.mesh.trusted(r.peer),
        )
        .map((value) => ({
          ...publicSession(value),
          available: this.gateway.mesh.connected(value.peer),
        }));
      return {
        sessions: sessions.slice(input.cursor, input.cursor + input.limit),
        next: Math.min(sessions.length, input.cursor + input.limit),
      };
    }
    if (tool === 'mesh_start_session') {
      const input = MCP_INPUTS.mesh_start_session.parse(args);
      this.peer(grant, input.peerId);
      if (!grant.agents.includes(input.agentId) || !grant.workspaces.includes(input.workspaceAlias))
        throw new MeshError('permission_denied', 'Agent/workspace outside credential scope');
      const key = this.key(grant, 'start', input.requestId),
        fingerprint = digest(JSON.stringify(input));
      let operation = this.store.get<Operation>('messages', key);
      if (operation && operation.fingerprint !== fingerprint)
        throw new MeshError('conflict', 'Request ID reused with different input');
      if (!operation) {
        this.capacity();
        await this.gateway.sync(input.peerId);
        this.peer(grant, input.peerId);
        const agent = this.gateway
          .remoteAgents()
          .find((a) => a.nodeId === input.peerId && a.id === input.agentId);
        if (
          !agent ||
          agent.capabilities.spawn !== 'supported' ||
          !agent.workspaceAliases.includes(input.workspaceAlias)
        )
          throw new MeshError('unsupported', 'Remote agent/workspace unavailable');
        const request = this.gateway.envelope(input.peerId, 'session.create', {
          agentId: input.agentId,
          workspaceAlias: input.workspaceAlias,
        });
        operation = { fingerprint, request };
        this.reserve(key, operation);
      }
      if (operation.response) return operation.response;
      const response = await this.gateway.sendEnvelope(input.peerId, operation.request);
      if (response.type !== 'session.event')
        throw new MeshError('invalid_message', 'Missing session response');
      const session = SessionSchema.parse(response.payload);
      if (
        session.nodeId !== input.peerId ||
        session.agentId !== input.agentId ||
        session.workspaceAlias !== input.workspaceAlias
      )
        throw new MeshError('permission_denied', 'Session response scope mismatch');
      const owned = { peer: input.peerId, session };
      operation.ownedSession = owned;
      operation.response = publicSession(owned);
      this.reserve(key, operation);
      return operation.response;
    }
    if (tool === 'mesh_send_message' || tool === 'mesh_delegate_task') {
      const input = MCP_INPUTS.mesh_send_message.parse(args),
        owned = this.ownedSession(grant, input.sessionId);
      const key = this.key(grant, 'task-request', input.requestId),
        fingerprint = digest(JSON.stringify({ tool, ...input }));
      let task = this.store.get<OwnedTask>('messages', key);
      if (task && task.fingerprint !== fingerprint)
        throw new MeshError('conflict', 'Request ID reused with different input');
      if (!task) {
        this.capacity();
        await this.gateway.sync(owned.peer);
        this.ownedSession(grant, input.sessionId);
        const agent = this.gateway
          .remoteAgents()
          .find((a) => a.nodeId === owned.peer && a.id === owned.session.agentId);
        if (!agent || agent.capabilities.send !== 'supported')
          throw new MeshError('unsupported', 'Remote send is unavailable');
        const request = this.gateway.envelope(
          owned.peer,
          'task.request',
          {
            sessionId: owned.session.id,
            text: input.text,
            workspaceAlias: owned.session.workspaceAlias,
            delegationDepth: 0,
          },
          randomUUID(),
          owned.session.agentId,
        );
        request.deadline = new Date(Date.now() + input.timeoutSeconds * 1000).toISOString();
        encodeEnvelope(request);
        task = {
          peer: owned.peer,
          sessionId: input.sessionId,
          taskId: request.taskId!,
          fingerprint,
          request,
          status: 'submitting',
        };
        this.reserve(key, task);
      }
      if (task.status !== 'accepted') {
        try {
          const ack = await this.gateway.sendEnvelope(task.peer, task.request);
          if (ack.type !== 'task.accepted' || ack.taskId !== task.taskId)
            throw new MeshError('invalid_message', 'Incorrect task acknowledgement');
          task.status = 'accepted';
        } catch {
          task.status = 'UNKNOWN';
        }
        this.reserve(key, task);
      }
      return {
        taskId: task.taskId,
        delivery: task.status,
        deadline: task.request.deadline,
        retry:
          'Reuse the identical tool arguments and requestId only; UNKNOWN is not permission to create a new task.',
      };
    }
    if (tool === 'mesh_get_task') {
      const input = MCP_INPUTS.mesh_get_task.parse(args),
        task = this.ownedTask(grant, input.taskId);
      try {
        const result = z
          .object({
            state: z.enum([
              'QUEUED',
              'RUNNING',
              'WAITING_INPUT',
              'COMPLETED',
              'FAILED',
              'CANCELLED',
              'UNKNOWN',
            ]),
            events: z
              .array(
                z
                  .object({
                    type: z.enum([
                      'started',
                      'delta',
                      'permission',
                      'completed',
                      'failed',
                      'cancelled',
                      'unknown',
                    ]),
                    taskId: z.literal(task.taskId),
                  })
                  .passthrough(),
              )
              .max(1),
            next: z.number().int().min(0).max(4096),
          })
          .strict()
          .parse(await this.gateway.events(task.peer, task.taskId, input.cursor));
        if (result.next !== input.cursor + result.events.length)
          throw new MeshError('invalid_message', 'Invalid event cursor');
        return { ...result, taskId: task.taskId };
      } catch {
        return {
          taskId: task.taskId,
          state: 'UNKNOWN',
          events: [],
          next: input.cursor,
          reason: 'Remote result unavailable; no automatic execution replay',
        };
      }
    }
    const input = MCP_INPUTS.mesh_cancel_task.parse(args),
      task = this.ownedTask(grant, input.taskId);
    const request = this.gateway.envelope(task.peer, 'task.cancel', {}, task.taskId);
    const ack = await this.gateway.sendEnvelope(task.peer, request);
    if (ack.type !== 'ack' || ack.payload.messageId !== request.messageId)
      throw new MeshError('invalid_message', 'Incorrect cancellation acknowledgement');
    return { taskId: task.taskId, cancelRequested: true };
  }
}
