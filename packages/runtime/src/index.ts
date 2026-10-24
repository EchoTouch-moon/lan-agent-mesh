import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { RegistrySchema, SessionSchema, type Session } from '@lam/domain';
import { MeshError, encodeEnvelope, decodeEnvelope, type Envelope } from '@lam/protocol';import type { HarnessAdapter } from '@lam/adapter-sdk';
import { createMockAdapter, type MockScenario } from '@lam/mock-adapter';
import { Store } from '@lam/storage';
import { Mesh } from '@lam/mesh';
import { Sessions } from './sessions.js';
import { Router } from './router.js';
import { auditDataDirectory, type AclAudit, type DataDirectoryPolicy } from './acl.js';
export { Sessions, Router };
export { MeshError };
export { auditDataDirectory, type AclAudit, type DataDirectoryPolicy };
const Peer = z.string().min(1).max(128),
  Empty = z.object({}).strict();
const Remote = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('registry') }).strict(),
  z.object({ kind: z.literal('envelope'), value: z.unknown() }).strict(),
  z
    .object({ kind: z.literal('events'), taskId: Peer, cursor: z.number().int().min(0).max(4096) })
    .strict(),
]);
export interface GatewayOptions {
  directory: string;
  listen?: string[];
  controlPort?: number;
  mdns?: boolean;
  mock?: boolean;
  scenario?: MockScenario;
  adapters?: HarnessAdapter[];
  exportAgents?: string[];
  dataDirectoryPolicy?: DataDirectoryPolicy;
}
interface RemoteRegistry {
  registry: z.infer<typeof RegistrySchema>;
  expires: number;
}
export class Gateway {
  store!: Store;
  mesh!: Mesh;
  sessions!: Sessions;
  router!: Router;
  server?: Server;
  token = '';
  url = '';
  aclAudit?: AclAudit;
  private locked = false;
  private stopping = false;
  readonly registryEvents: { type: string; peer: string; at: string }[] = [];
  private readonly remotes = new Map<string, RemoteRegistry>();
  private keepalive?: ReturnType<typeof setInterval>;
  private maintenance: Promise<void> | undefined;
  constructor(readonly options: GatewayOptions) {}
  async start() {
    mkdirSync(this.options.directory, { recursive: true, mode: 0o700 });
    this.aclAudit = await auditDataDirectory(this.options.directory);
    if (!this.aclAudit.safe && !this.options.mock && (this.options.dataDirectoryPolicy ?? 'enforce') === 'enforce')
      throw new MeshError(
        'unsafe_directory',
        `Refusing to issue or load real credentials: ${this.aclAudit.reason}. Start with --mock for isolated experiments, or move the data directory to a user-exclusive location (see docs/adr/0003-windows-data-directory-isolation.md).`,
      );
    if (!this.aclAudit.safe)
      console.error(
        `[security] data directory is not user-exclusive (${this.aclAudit.reason}); ${
          this.options.mock ? 'mock run continues' : 'policy is warn for this in-process run'
        }; do not place long-lived real credentials here`,
      );
    chmodSync(this.options.directory, 0o700);
    const lock = join(this.options.directory, 'gateway.lock');
    try {
      writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 });
      this.locked = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const pid = Number(readFileSync(lock, 'utf8'));
      if (!Number.isSafeInteger(pid) || pid < 1)
        throw new MeshError('busy', 'Invalid Gateway lock; inspect manually');
      try {
        process.kill(pid, 0);
        throw new MeshError('busy', 'Gateway data directory is already in use');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e;
      }
      unlinkSync(lock);
      writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 });
      this.locked = true;
    }
    try {
      this.store = new Store(join(this.options.directory, 'mesh.sqlite'));
      this.store.recover();
      this.mesh = new Mesh({
        directory: this.options.directory,
        store: this.store,
        ...(this.options.listen ? { listen: this.options.listen } : {}),
        mdns: this.options.mdns ?? false,
        onMessage: (peer, value) => this.receive(peer, value),
      });
      await this.mesh.start();
      const exported = new Set(this.options.exportAgents ?? []);
      const adapters = [...(this.options.adapters ?? [])];
      if (this.options.mock) {
        adapters.push(
          createMockAdapter({
            nodeId: this.mesh.id,
            ...(this.options.scenario ? { scenario: this.options.scenario } : {}),
          }),
        );
        exported.add(`${this.mesh.id}/mock/default`);
      }
      this.sessions = new Sessions(this.store, this.mesh.id, exported);
      for (const adapter of adapters) await this.sessions.register(adapter);
      this.router = new Router(this.store, this.sessions);
      this.mesh.node.addEventListener('connection:close', (event) => {
        const peer = event.detail.remotePeer.toString();
        if (!this.mesh.connected(peer)) this.invalidate(peer, 'offline');
      });
      this.token = randomBytes(32).toString('hex');
      this.server = createServer((req, res) => {
        void (async () => {
          if (req.url === '/health' && req.method === 'GET') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ status: this.stopping ? 'stopping' : 'ready' }));
            return;
          }
          const auth = Buffer.from(req.headers.authorization ?? ''),
            expected = Buffer.from(`Bearer ${this.token}`);
          if (
            req.headers.origin ||
            auth.length !== expected.length ||
            !timingSafeEqual(auth, expected)
          ) {
            res.writeHead(403).end();
            return;
          }
          if (req.url !== '/command' || req.method !== 'POST') {
            res.writeHead(404).end();
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 65536) {
              res.writeHead(413).end();
              req.destroy();
              return;
            }
            chunks.push(chunk);
          }
          const input = z
            .object({ command: z.string(), args: z.unknown().optional() })
            .strict()
            .parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          const result = await this.command(input.command, input.args ?? {});
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result ?? null));
        })().catch((error) => {
          if (!res.headersSent) res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({ code: error instanceof MeshError ? error.code : 'invalid_message' }),
          );
        });
      });
      this.server.requestTimeout = 10000;
      this.server.headersTimeout = 5000;
      this.server.listen(this.options.controlPort ?? 0, '127.0.0.1');
      await once(this.server, 'listening');
      const address = this.server.address();
      if (!address || typeof address === 'string') throw new Error('Missing control endpoint');
      this.url = `http://127.0.0.1:${address.port}`;
      writeFileSync(
        join(this.options.directory, 'control.json'),
        JSON.stringify({ url: this.url, token: this.token }),
        { mode: 0o600 },
      );
      chmodSync(join(this.options.directory, 'control.json'), 0o600);
      this.keepalive = setInterval(() => {
        if (!this.maintenance)
          this.maintenance = this.maintain()
            .catch(() => {})
            .finally(() => {
              this.maintenance = undefined;
            });
      }, 5000);
      this.keepalive.unref();
      return this;
    } catch (error) {
      await this.stop();
      throw error;
    }
  }
  private async maintain() {
    await this.mesh.reconnectTrusted();
    for (const peer of this.remotes.keys()) {
      try {
        await this.mesh.request(peer, { kind: 'envelope', value: this.envelope(peer, 'ping', {}) });
        if (!this.stopping) await this.sync(peer);
      } catch {
        this.invalidate(peer, 'offline');
      }
    }
  }
  private invalidate(peer: string, type: string) {
    const entry = this.remotes.get(peer);
    if (entry) entry.expires = 0;
    this.registryEvents.push({ type, peer, at: new Date().toISOString() });
    if (this.registryEvents.length > 100) this.registryEvents.shift();
  }
  private async receive(peer: string, value: unknown): Promise<unknown> {
    if (!this.router) throw new MeshError('busy', 'Gateway starting');
    const request = Remote.parse(value);
    if (request.kind === 'registry') return this.localRegistry();
    if (request.kind === 'events')
      return this.router.events(peer, { taskId: request.taskId, cursor: request.cursor });
    return this.router.receive(peer, request.value);
  }
  localRegistry() {
    return RegistrySchema.parse({
      node: {
        id: this.mesh.id,
        name: 'LAM Gateway',
        platform: process.platform,
        publicKeyFingerprint: this.mesh.fingerprint,
      },
      harnesses: [...new Set(this.sessions.exported().map((a) => a.harnessId))].map((id) => ({
        id,
        nodeId: this.mesh.id,
        kind: 'mock',
        version: 'mock/1',
        capabilities: this.sessions.exported().find((a) => a.harnessId === id)!.capabilities,
      })),
      agents: this.sessions.exported(),
    });
  }
  async sync(peer: string) {
    const registry = RegistrySchema.parse(await this.mesh.request(peer, { kind: 'registry' }));
    if (registry.node.id !== peer)
      throw new MeshError('permission_denied', 'Registry identity mismatch');
    const old = this.remotes.get(peer);
    if (old && JSON.stringify(old.registry) !== JSON.stringify(registry))
      this.invalidate(peer, 'capability_changed');
    this.remotes.set(peer, { registry, expires: Date.now() + 15000 });
    return registry;
  }
  remoteAgents(now = Date.now()) {
    return [...this.remotes.entries()].flatMap(([peer, entry]) => {
      if (entry.expires > 0 && entry.expires <= now) this.invalidate(peer, 'stale');
      if (!this.mesh.trusted(peer) || !this.mesh.connected(peer) || entry.expires <= now) return [];
      return entry.registry.agents.map((agent) => ({ ...agent, available: true }));
    });
  }
  envelope(
    peer: string,
    type: string,
    payload: unknown,
    taskId?: string,
    agentId?: string,
  ): Envelope {
    return decodeEnvelope(
      encodeEnvelope({
        version: 1,
        messageId: randomUUID(),
        correlationId: randomUUID(),
        idempotencyKey: randomUUID(),
        source: { nodeId: this.mesh.id },
        target: { nodeId: peer, ...(agentId ? { agentId } : {}) },
        deadline: new Date(Date.now() + 30000).toISOString(),
        type,
        payload,
        ...(taskId ? { taskId } : {}),
      }),
    );
  }
  async sendEnvelope(peer: string, value: Envelope): Promise<Envelope> {
    const checked = decodeEnvelope(encodeEnvelope(value));
    if (checked.source.nodeId !== this.mesh.id || checked.target.nodeId !== peer)
      throw new MeshError('permission_denied', 'Outbound identity mismatch');
    this.store.enqueue(checked.messageId, peer, checked);
    const reply = decodeEnvelope(
      encodeEnvelope(await this.mesh.request(peer, { kind: 'envelope', value: checked })),
    );
    if (
      reply.source.nodeId !== peer ||
      reply.target.nodeId !== this.mesh.id ||
      reply.correlationId !== checked.messageId
    )
      throw new MeshError('permission_denied', 'Response identity/correlation mismatch');
    this.store.ack(checked.messageId);
    return reply;
  }
  async spawn(peer: string, agentId: string, workspaceAlias: string): Promise<Session> {
    await this.sync(peer);
    const agent = this.remoteAgents().find((a) => a.id === agentId && a.nodeId === peer);
    if (!agent || agent.capabilities.spawn !== 'supported')
      throw new MeshError('unsupported', 'Agent not currently available for spawn');
    const response = await this.sendEnvelope(
      peer,
      this.envelope(peer, 'session.create', { agentId, workspaceAlias }),
    );
    if (response.type !== 'session.event')
      throw new MeshError('invalid_message', 'Expected session response');
    return SessionSchema.parse(response.payload);
  }
  async submit(
    peer: string,
    session: Session,
    text: string,
    key: string = randomUUID(),
    taskId: string = randomUUID(),
    deadline = new Date(Date.now() + 30000).toISOString(),
  ) {
    await this.sync(peer);
    const agent = this.remoteAgents().find((a) => a.id === session.agentId && a.nodeId === peer);
    if (!agent || agent.capabilities.send !== 'supported')
      throw new MeshError('unsupported', 'Agent not currently available for send');
    const request = this.envelope(
      peer,
      'task.request',
      { sessionId: session.id, text, workspaceAlias: session.workspaceAlias, delegationDepth: 0 },
      taskId,
      session.agentId,
    );
    request.idempotencyKey = key;
    request.deadline = deadline;
    await this.sendEnvelope(peer, request);
    return { taskId, key, deadline };
  }
  async events(peer: string, taskId: string, cursor = 0) {
    return this.mesh.request(peer, { kind: 'events', taskId, cursor });
  }
  async command(command: string, args: unknown): Promise<unknown> {
    switch (command) {
      case 'shutdown':
        Empty.parse(args);
        setImmediate(() => void this.stop());
        return { stopping: true };
      case 'diagnostics':
        Empty.parse(args);
        return {
          schemaVersion: this.store.query('PRAGMA user_version')[0]?.user_version,
          tasks: this.store.count('tasks'),
          inbox: this.store.count('inbox'),
          outbox: this.store.count('outbox'),
          pending: this.store.pending().length,
          mdns: this.options.mdns ?? false,
          approvalPolicy: 'deny-only',
          dataDirectoryAcl: this.aclAudit
            ? { safe: this.aclAudit.safe, ...(this.aclAudit.reason ? { reason: this.aclAudit.reason } : {}) }
            : null,
        };
      case 'sessions':
        Empty.parse(args);
        return this.store.list('sessions');
      case 'status':
        Empty.parse(args);
        return {
          nodeId: this.mesh.id,
          fingerprint: this.mesh.fingerprint,
          addresses: this.mesh.addresses,
          controlUrl: this.url,
        };
      case 'peers':
        Empty.parse(args);
        return this.mesh.peers();
      case 'pairings':
        Empty.parse(args);
        return this.mesh.pendingPairings();
      case 'pair': {
        const a = z
          .object({ address: z.string().max(512), expectedPeer: Peer.optional() })
          .strict()
          .parse(args);
        return this.mesh.beginPairing(a.address, a.expectedPeer);
      }
      case 'confirm': {
        const a = z
          .object({ id: z.string().uuid(), code: z.string().max(64) })
          .strict()
          .parse(args);
        return { trusted: await this.mesh.confirmPairing(a.id, a.code) };
      }
      case 'revoke': {
        const a = z.object({ peer: Peer }).strict().parse(args);
        await this.mesh.revoke(a.peer);
        this.invalidate(a.peer, 'revoked');
        return null;
      }
      case 'connect': {
        const a = z
          .object({ address: z.string().max(512), peer: Peer })
          .strict()
          .parse(args);
        await this.mesh.connect(a.address, a.peer);
        return this.sync(a.peer);
      }
      case 'outbox':
        Empty.parse(args);
        return this.store.pending();
      case 'retry': {
        const a = z.object({ messageId: z.string().uuid() }).strict().parse(args);
        const pending = this.store.pending().find((p) => p.id === a.messageId);
        if (!pending) throw new MeshError('not_found', 'Pending message not found');
        return this.sendEnvelope(pending.peer, pending.message as Envelope);
      }
      case 'registry': {
        const a = z.object({ peer: Peer }).strict().parse(args);
        return this.sync(a.peer);
      }
      case 'spawn': {
        const a = z
          .object({ peer: Peer, agentId: Peer, workspaceAlias: z.string().max(64) })
          .strict()
          .parse(args);
        return this.spawn(a.peer, a.agentId, a.workspaceAlias);
      }
      case 'resume': {
        const a = z.object({ peer: Peer, sessionId: Peer }).strict().parse(args);
        return this.sendEnvelope(
          a.peer,
          this.envelope(a.peer, 'session.resume', { sessionId: a.sessionId }),
        );
      }
      case 'send': {
        const a = z
          .object({
            peer: Peer,
            session: SessionSchema,
            text: z.string().min(1).max(32768),
            key: z.string().uuid().optional(),
            taskId: z.string().uuid().optional(),
            deadline: z.string().datetime().optional(),
          })
          .strict()
          .parse(args);
        return this.submit(a.peer, a.session, a.text, a.key, a.taskId, a.deadline);
      }
      case 'events': {
        const a = z
          .object({ peer: Peer, taskId: Peer, cursor: z.number().int().min(0).default(0) })
          .strict()
          .parse(args);
        return this.events(a.peer, a.taskId, a.cursor);
      }
      case 'cancel': {
        const a = z.object({ peer: Peer, taskId: Peer }).strict().parse(args);
        return this.sendEnvelope(a.peer, this.envelope(a.peer, 'task.cancel', {}, a.taskId));
      }
      default:
        throw new MeshError('unsupported', 'Unknown local command');
    }
  }
  async stop() {
    if (this.stopping) return;
    this.stopping = true;
    if (this.keepalive) clearInterval(this.keepalive);
    if (this.server) {
      this.server.closeAllConnections();
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    }
    if (this.router) await this.router.stop();
    if (this.mesh) await this.mesh.stop();
    if (this.maintenance) await this.maintenance;
    if (this.store) this.store.close();
    if (this.locked) {
      unlinkSync(join(this.options.directory, 'gateway.lock'));
      this.locked = false;
    }
    try {
      unlinkSync(join(this.options.directory, 'control.json'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}
