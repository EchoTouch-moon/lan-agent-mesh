import { z } from 'zod';
export const IdSchema = z.string().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/);
export const TimestampSchema = z.string().datetime({ offset: true });
export const WorkspaceAliasSchema = z.string().min(1).max(64).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
export const CapabilitySchema = z.enum(['discover', 'spawn', 'resume', 'send', 'watch', 'cancel', 'answerPermission', 'attachExistingGui']);
export type Capability = z.infer<typeof CapabilitySchema>;
export const SupportSchema = z.enum(['supported', 'unsupported', 'unknown']);
export const CapabilitiesSchema = z.object({
  discover: SupportSchema, spawn: SupportSchema, resume: SupportSchema, send: SupportSchema,
  watch: SupportSchema, cancel: SupportSchema, answerPermission: SupportSchema, attachExistingGui: SupportSchema,
}).strict();
export type Capabilities = z.infer<typeof CapabilitiesSchema>;
export const NodeSchema = z.object({
  id: IdSchema, name: z.string().min(1).max(128), platform: z.enum(['darwin', 'win32', 'linux']),
  publicKeyFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export const HarnessSchema = z.object({
  id: IdSchema, nodeId: IdSchema, kind: z.enum(['codex', 'dsh', 'zcode', 'workbuddy', 'mock']),
  version: z.string().min(1).max(128), capabilities: CapabilitiesSchema,
}).strict();
export const AgentSchema = z.object({
  id: IdSchema, nodeId: IdSchema, harnessId: IdSchema, name: z.string().min(1).max(128),
  workspaceAliases: z.array(WorkspaceAliasSchema).max(64), capabilities: CapabilitiesSchema,
}).strict();
export const SessionSchema = z.object({
  id: IdSchema, nodeId: IdSchema, agentId: IdSchema, nativeSessionId: IdSchema,
  workspaceAlias: WorkspaceAliasSchema, state: z.enum(['idle', 'running', 'waiting_input', 'closed']), createdAt: TimestampSchema,
}).strict();
export type Session = z.infer<typeof SessionSchema>;
export const TaskStateSchema = z.enum(['QUEUED', 'AUTHORIZING', 'RUNNING', 'WAITING_INPUT', 'COMPLETED', 'FAILED', 'CANCELLED', 'UNKNOWN']);
export const TaskSchema = z.object({
  id: IdSchema, nodeId: IdSchema, agentId: IdSchema, sessionId: IdSchema,
  state: TaskStateSchema, deadline: TimestampSchema, delegationDepth: z.number().int().min(0).max(8),
}).strict();
export const RegistrySchema = z.object({
  node: NodeSchema, harnesses: z.array(HarnessSchema).max(128), agents: z.array(AgentSchema).max(1024),
}).strict().superRefine((v, ctx) => {
  const harnesses = new Map(v.harnesses.map(h => [h.id, h]));
  if (harnesses.size !== v.harnesses.length || new Set(v.agents.map(a => a.id)).size !== v.agents.length)
    ctx.addIssue({ code: 'custom', message: 'Duplicate registry IDs' });
  for (const h of v.harnesses) if (h.nodeId !== v.node.id) ctx.addIssue({ code: 'custom', message: 'Harness owner mismatch' });
  for (const a of v.agents) {
    const h = harnesses.get(a.harnessId);
    if (a.nodeId !== v.node.id || !h) ctx.addIssue({ code: 'custom', message: 'Agent owner or harness mismatch' });
    if (h) for (const c of CapabilitySchema.options)
      if (a.capabilities[c] === 'supported' && h.capabilities[c] !== 'supported')
        ctx.addIssue({ code: 'custom', message: 'Agent cannot exceed harness capabilities' });
  }
});
export const RegistryCacheSchema = z.object({
  registry: RegistrySchema, receivedAt: TimestampSchema, expiresAt: TimestampSchema,
}).strict().refine(v => Date.parse(v.expiresAt) > Date.parse(v.receivedAt), 'Cache expiry must follow receipt');
export function isCacheAvailable(cache: z.infer<typeof RegistryCacheSchema>, now = Date.now()): boolean {
  return now >= Date.parse(cache.receivedAt) && now < Date.parse(cache.expiresAt);
}
export const DomainGraphSchema = z.object({ registry: RegistrySchema, sessions: z.array(SessionSchema), tasks: z.array(TaskSchema) }).strict()
  .superRefine(({ registry, sessions, tasks }, ctx) => {
    if (new Set(sessions.map(s => s.id)).size !== sessions.length || new Set(tasks.map(t => t.id)).size !== tasks.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate session or task IDs' });
    for (const s of sessions) {
      const a = registry.agents.find(a => a.id === s.agentId);
      if (s.nodeId !== registry.node.id || !a || !a.workspaceAliases.includes(s.workspaceAlias))
        ctx.addIssue({ code: 'custom', message: 'Session ownership or workspace mismatch' });
    }
    for (const t of tasks) {
      const s = sessions.find(s => s.id === t.sessionId);
      if (!s || s.nodeId !== t.nodeId || s.agentId !== t.agentId) ctx.addIssue({ code: 'custom', message: 'Task ownership mismatch' });
    }
  });
