import { randomUUID } from 'node:crypto';
import { WorkspaceAliasSchema, type Session } from '@lam/domain';
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
export class Sessions {
  private reservations = 0;
  readonly adapters = new Map<string, HarnessAdapter>();
  readonly agents = new Map<string, Agent>();
  constructor(
    readonly store: Store,
    readonly nodeId: string,
    readonly visible: Set<string>,
  ) {}
  async register(adapter: HarnessAdapter) {
    const probe = await adapter.probe();
    if (!probe.available) return;
    for (const discovered of await adapter.discover()) {
      const agent = {
        ...discovered,
        capabilities: negotiateCapabilities(discovered.capabilities, probe.capabilities),
      };
      if (agent.nodeId !== this.nodeId || this.adapters.has(agent.id))
        throw new MeshError('conflict', 'Agent ownership or duplicate registration');
      this.agents.set(agent.id, agent);
      this.adapters.set(agent.id, adapter);
      this.store.put('agents', agent.id, agent);
    }
  }
  exported(): Agent[] {
    return [...this.agents.values()]
      .filter((a) => this.visible.has(a.id))
      .map((a) => structuredClone(a));
  }
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
  async spawn(owner: string, agentId: string, workspaceAlias: string): Promise<Session> {
    const agent = this.agents.get(agentId);
    if (
      !agent ||
      !this.visible.has(agentId) ||
      !WorkspaceAliasSchema.safeParse(workspaceAlias).success ||
      !agent.workspaceAliases.includes(workspaceAlias)
    )
      throw new MeshError('permission_denied', 'Agent or workspace not exported');
    if (this.store.list('sessions').length + this.reservations >= 100)
      throw new MeshError('busy', 'Session capacity reached');
    this.reservations++;
    try {
      const native = await this.adapter(agentId).spawn({ agentId, workspaceAlias });
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
  async resume(owner: string, id: string): Promise<Session> {
    const binding = this.binding(id, owner);
    const native = await this.adapter(binding.session.agentId).resume(binding.adapterSessionId);
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
