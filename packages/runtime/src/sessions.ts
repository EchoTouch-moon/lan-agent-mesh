import { randomUUID } from 'node:crypto';
import { AgentSchema, CapabilitiesSchema, HarnessSchema, WorkspaceAliasSchema, type Session, type Capability, type Capabilities } from '@lam/domain';
import { z } from 'zod';
import {
  MeshError,
  negotiateCapabilities,
  type HarnessAdapter,
  type Agent,
} from '@lam/adapter-sdk';
import { Store } from '@lam/storage';

export interface SessionBinding {
  session: Session;
  adapterSessionId: string;
  owner: string;
}
const Probe = z.object({ available: z.boolean(), version: HarnessSchema.shape.version,
  capabilities: CapabilitiesSchema, kind: HarnessSchema.shape.kind.optional() }).strict();
type ProbeValue = z.infer<typeof Probe>;
export class Sessions {
  private reservations = 0;
  readonly adapters = new Map<string, HarnessAdapter>();
  readonly agents = new Map<string, Agent>();
  readonly harnesses = new Map<string, { kind: 'codex' | 'dsh' | 'zcode' | 'workbuddy' | 'mock'; version: string; capabilities: Capabilities }>();
  private readonly originals = new Map<string, Agent>();
  private readonly online = new Set<HarnessAdapter>();
  private readonly checks = new Map<HarnessAdapter, Promise<ProbeValue | undefined>>();
  private readonly kinds = new Map<HarnessAdapter, z.infer<typeof HarnessSchema.shape.kind>>();
  private closed = false;
  constructor(
    readonly store: Store,
    readonly nodeId: string,
    readonly visible: Set<string>,
  ) {}
  private probe(adapter: HarnessAdapter): Promise<ProbeValue | undefined> {
    const current = this.checks.get(adapter); if (current) return current;
    let accept!: (value: ProbeValue | undefined) => void;
    const bounded = new Promise<ProbeValue | undefined>(resolve => { accept = resolve; });
    this.checks.set(adapter, bounded);
    let finished = false;
    const timeout = setTimeout(() => { finished = true; accept(undefined); }, 1000);
    // Keep one slot occupied after timeout until the underlying probe settles. Never start
    // unlimited replacement probes, and never publish a late result from an expired check.
    void Promise.resolve().then(() => adapter.probe()).then(value => {
      this.checks.delete(adapter); clearTimeout(timeout);
      if (finished) return;
      finished = true;
      try { accept(Probe.parse(value)); } catch { accept(undefined); }
    }, () => {
      this.checks.delete(adapter); clearTimeout(timeout);
      if (!finished) { finished = true; accept(undefined); }
    });
    return bounded;
  }
  async register(adapter: HarnessAdapter) {
    if (this.closed) throw new MeshError('unsupported', 'Session manager closed');
    if (this.kinds.has(adapter)) throw new MeshError('conflict', 'Adapter already registered');
    const probe = await this.probe(adapter);
    if (!probe) throw new MeshError('unsupported', 'Adapter probe unavailable');
    if (!probe.available) return;
    if (this.closed) throw new MeshError('unsupported', 'Session manager closed');
    const kind = probe.kind ?? 'mock';
    const discoveredAgents = (await adapter.discover()).map(agent => AgentSchema.parse(agent));
    const incoming = new Set<string>();
    for (const agent of discoveredAgents) {
      if (agent.nodeId !== this.nodeId || this.adapters.has(agent.id) || incoming.has(agent.id) ||
        [...this.agents.values()].some(a => a.harnessId === agent.harnessId && this.adapters.get(a.id) !== adapter))
        throw new MeshError('conflict', 'Agent or harness ownership/registration conflict');
      incoming.add(agent.id);
    }
    if (this.closed) throw new MeshError('unsupported', 'Session manager closed');
    this.kinds.set(adapter, kind); this.online.add(adapter);
    for (const discovered of discoveredAgents) {
      const agent = {
        ...discovered,
        capabilities: negotiateCapabilities(discovered.capabilities, probe.capabilities),
      };
      if (agent.nodeId !== this.nodeId || this.adapters.has(agent.id))
        throw new MeshError('conflict', 'Agent ownership or duplicate registration');
      this.agents.set(agent.id, agent);
      this.harnesses.set(agent.harnessId, { kind, version: probe.version, capabilities: { ...probe.capabilities } });
      this.adapters.set(agent.id, adapter);
      this.originals.set(agent.id, structuredClone(discovered));
      this.store.put('agents', agent.id, agent);
    }
  }
  exported(): Agent[] {
    return [...this.agents.values()]
      .filter((a) => !this.closed && this.visible.has(a.id) && this.online.has(this.adapters.get(a.id)!))
      .map((a) => structuredClone(a));
  }
  private async refreshOne(adapter: HarnessAdapter) {
    const probe = await this.probe(adapter);
    if (this.closed) return;
    if (!probe?.available || (probe.kind !== undefined && probe.kind !== this.kinds.get(adapter))) { this.online.delete(adapter); return; }
    for (const [id, registered] of this.adapters) if (registered === adapter) {
      const original = this.originals.get(id)!;
      this.agents.set(id, { ...structuredClone(original), capabilities: negotiateCapabilities(original.capabilities, probe.capabilities) });
      this.harnesses.set(original.harnessId, { kind: this.kinds.get(adapter)!, version: probe.version, capabilities: { ...probe.capabilities } });
    }
    this.online.add(adapter);
  }
  async refresh() {
    if (this.closed) return;
    const adapters = new Set([...this.adapters].filter(([id]) => this.visible.has(id)).map(([, adapter]) => adapter));
    await Promise.all([...adapters].map(adapter => this.refreshOne(adapter)));
  }
  async requireAvailable(id: string, capabilities: Capability[]): Promise<HarnessAdapter> {
    if (this.closed || !this.visible.has(id)) throw new MeshError('permission_denied', 'Agent not exported');
    const adapter = this.adapter(id);
    await this.refreshOne(adapter);
    const agent = this.agents.get(id);
    if (this.closed || !this.visible.has(id) || !this.online.has(adapter) || !agent || capabilities.some(c => agent.capabilities[c] !== 'supported'))
      throw new MeshError('unsupported', 'Agent not currently available for operation');
    return adapter;
  }
  close() { this.closed = true; this.online.clear(); }
  binding(id: string, owner: string): SessionBinding {
    const binding = this.store.get<SessionBinding>('sessions', id);
    if (!binding || binding.owner !== owner) throw new MeshError('not_found', 'Session not found');
    if (!this.visible.has(binding.session.agentId))
      throw new MeshError('permission_denied', 'Agent not exported');
    return binding;
  }
  adapter(id: string): HarnessAdapter {
    const adapter = this.adapters.get(id);
    if (!adapter) throw new MeshError('unsupported', 'Adapter is offline');
    return adapter;
  }
  private deadline(value?: string) {
    if (value !== undefined && (!Number.isFinite(Date.parse(value)) || Date.parse(value) <= Date.now()))
      throw new MeshError('deadline_exceeded', 'Session operation expired during admission');
  }
  async spawn(owner: string, agentId: string, workspaceAlias: string, deadline?: string): Promise<Session> {
    const agent = this.agents.get(agentId);
    if (
      !agent ||
      !this.visible.has(agentId) ||
      !WorkspaceAliasSchema.safeParse(workspaceAlias).success ||
      !agent.workspaceAliases.includes(workspaceAlias)
    )
      throw new MeshError('permission_denied', 'Agent or workspace not exported');
    const adapter = await this.requireAvailable(agentId, ['spawn']);
    this.deadline(deadline);
    if (this.store.list('sessions').length + this.reservations >= 100)
      throw new MeshError('busy', 'Session capacity reached');
    this.reservations++;
    try {
      const native = await adapter.spawn({ agentId, workspaceAlias });
      if (this.closed) throw new MeshError('unsupported', 'Session manager closed');
      const session = { ...native, id: randomUUID(), nodeId: this.nodeId, agentId };
      this.store.put('sessions', session.id, {
        session,
        adapterSessionId: native.id,
        owner,
      } satisfies SessionBinding);
      return session;
    } finally {
      this.reservations--;
    }
  }
  async resume(owner: string, id: string, deadline?: string): Promise<Session> {
    const binding = this.binding(id, owner);
    const adapter = await this.requireAvailable(binding.session.agentId, ['resume']);
    this.deadline(deadline);
    const native = await adapter.resume(binding.adapterSessionId);
    if (this.closed) throw new MeshError('unsupported', 'Session manager closed');
    if (native.nativeSessionId !== binding.session.nativeSessionId)
      throw new MeshError('conflict', 'Native session identity changed');
    binding.session.state = native.state;
    this.store.put('sessions', id, binding);
    return { ...binding.session };
  }
  busy(id: string): boolean {
    return this.store
      .query(
        "SELECT input FROM tasks WHERE state IN ('QUEUED','RUNNING','WAITING_INPUT','UNKNOWN')",
      )
      .some((r) => (JSON.parse(String(r.input)) as { sessionId: string }).sessionId === id);
  }
}
