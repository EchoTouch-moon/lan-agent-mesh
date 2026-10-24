import { z } from 'zod';
import { AgentSchema, CapabilitiesSchema, IdSchema, RegistrySchema, SessionSchema, TaskStateSchema, TimestampSchema, WorkspaceAliasSchema } from '@lam/domain';
export const MAX_MESSAGE_BYTES = 64 * 1024;
export const ErrorCodeSchema = z.enum(['invalid_json', 'invalid_message', 'unsupported_version', 'message_too_large', 'deadline_exceeded', 'unsupported', 'not_found', 'busy', 'permission_denied', 'cancelled', 'disconnected', 'conflict', 'unsafe_directory', 'internal']);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export class MeshError extends Error {
  constructor(public readonly code: ErrorCode, message: string) { super(message); this.name = 'MeshError'; }
}
export const AddressSchema = z.object({ nodeId: IdSchema, agentId: IdSchema.optional() }).strict();
export const PermissionRequestSchema = z.object({
  requestId: z.string().uuid(), nodeId: IdSchema, agentId: IdSchema, sessionId: IdSchema, taskId: IdSchema,
  operationDigest: z.string().regex(/^[a-f0-9]{64}$/), nonce: z.string().uuid(), expiresAt: TimestampSchema,
}).strict();
export type PermissionRequest = z.infer<typeof PermissionRequestSchema>;
export const PermissionDecisionSchema = PermissionRequestSchema.extend({ decision: z.enum(['allow', 'deny']), humanId: IdSchema }).strict();
export type PermissionDecision = z.infer<typeof PermissionDecisionSchema>;
const text = z.string().min(1).max(32768);
const turn = z.object({ sessionId: IdSchema, text, workspaceAlias: WorkspaceAliasSchema }).strict();
const empty = z.object({}).strict();
const payloads = {
  'peer.hello': z.object({ nodeId: IdSchema, protocolVersions: z.array(z.literal(1)).min(1).max(8) }).strict(),
  'peer.capabilities': CapabilitiesSchema,
  'registry.snapshot': RegistrySchema,
  'registry.delta': z.object({ upsert: z.array(AgentSchema).max(1024), remove: z.array(IdSchema).max(1024) }).strict(),
  'session.create': z.object({ agentId: IdSchema, workspaceAlias: WorkspaceAliasSchema }).strict(),
  'session.resume': z.object({ sessionId: IdSchema }).strict(),
  'session.message': turn, 'session.event': SessionSchema,
  'session.cancel': z.object({ sessionId: IdSchema }).strict(),
  'task.request': turn.extend({ delegationDepth: z.number().int().min(0).max(8) }),
  'task.accepted': z.object({ state: z.literal('QUEUED') }).strict(),
  'task.event': z.object({ state: TaskStateSchema, delta: text.optional() }).strict(),
  'task.result': z.object({ state: z.enum(['COMPLETED', 'FAILED', 'CANCELLED', 'UNKNOWN']), text: text.optional(), error: ErrorCodeSchema.optional() }).strict(),
  'task.cancel': empty, 'approval.request': PermissionRequestSchema, 'approval.decision': PermissionDecisionSchema,
  'approval.expired': z.object({ requestId: z.string().uuid() }).strict(),
  ack: z.object({ messageId: z.string().uuid() }).strict(),
  error: z.object({ code: ErrorCodeSchema, message: z.string().min(1).max(1024) }).strict(), ping: empty,
} as const;
export type MessageType = keyof typeof payloads;
const sideEffects = new Set<MessageType>(['session.create', 'session.resume', 'session.message', 'session.cancel', 'task.request', 'task.cancel', 'approval.decision']);
const base = {
  version: z.literal(1), messageId: z.string().uuid(), correlationId: z.string().uuid().optional(), idempotencyKey: z.string().uuid().optional(),
  source: AddressSchema, target: AddressSchema, taskId: IdSchema.optional(), deadline: TimestampSchema,
};
function message<K extends MessageType>(type: K) { return z.object({ ...base, type: z.literal(type), payload: payloads[type] }).strict(); }
export const EnvelopeSchema = z.discriminatedUnion('type', [
  message('peer.hello'), message('peer.capabilities'), message('registry.snapshot'), message('registry.delta'),
  message('session.create'), message('session.resume'), message('session.message'), message('session.event'), message('session.cancel'),
  message('task.request'), message('task.accepted'), message('task.event'), message('task.result'), message('task.cancel'),
  message('approval.request'), message('approval.decision'), message('approval.expired'), message('ack'), message('error'), message('ping'),
]).superRefine((v, ctx) => {
  if (sideEffects.has(v.type) && (!v.correlationId || !v.idempotencyKey))
    ctx.addIssue({ code: 'custom', message: 'Side effects require correlationId and idempotencyKey' });
  if ((v.type.startsWith('task.') || v.type.startsWith('approval.')) && !v.taskId)
    ctx.addIssue({ code: 'custom', message: 'Task and approval messages require taskId' });
  if ((v.type === 'approval.request' || v.type === 'approval.decision') && v.payload.taskId !== v.taskId)
    ctx.addIssue({ code: 'custom', message: 'Permission task scope mismatch' });
});
export type Envelope = z.infer<typeof EnvelopeSchema>;
export function validateEnvelope(input: unknown, now = Date.now()): Envelope {
  if (input && typeof input === 'object' && 'version' in input && input.version !== 1)
    throw new MeshError('unsupported_version', 'Only protocol version 1 is supported');
  const parsed = EnvelopeSchema.safeParse(input);
  if (!parsed.success) throw new MeshError('invalid_message', 'Message does not match protocol v1');
  if (Date.parse(parsed.data.deadline) <= now) throw new MeshError('deadline_exceeded', 'Message expired');
  return parsed.data;
}
export function encodeEnvelope(input: unknown, now = Date.now()): string {
  const encoded = JSON.stringify(validateEnvelope(input, now));
  if (Buffer.byteLength(encoded, 'utf8') > MAX_MESSAGE_BYTES) throw new MeshError('message_too_large', 'Message exceeds 64 KiB');
  return encoded;
}
export function decodeEnvelope(encoded: string | Uint8Array, now = Date.now()): Envelope {
  if (Buffer.byteLength(encoded) > MAX_MESSAGE_BYTES) throw new MeshError('message_too_large', 'Message exceeds 64 KiB');
  let input: unknown;
  try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(typeof encoded === 'string' ? Buffer.from(encoded) : encoded)); }
  catch { throw new MeshError('invalid_json', 'Expected UTF-8 JSON'); }
  return validateEnvelope(input, now);
}
