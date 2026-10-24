import { z } from 'zod';
export { z };
const Id = z.string().min(1).max(128);
const Page = {
  cursor: z.number().int().min(0).max(4096).default(0),
  limit: z.number().int().min(1).max(20).default(20),
};
const Start = z
  .object({
    peerId: Id,
    agentId: Id,
    workspaceAlias: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/),
    requestId: z.string().uuid(),
  })
  .strict();
const Send = z
  .object({
    sessionId: z.string().uuid(),
    text: z.string().min(1).max(32768),
    requestId: z.string().uuid(),
    timeoutSeconds: z.number().int().min(1).max(300).default(60),
  })
  .strict();
export const MCP_INPUTS = {
  mesh_list_agents: z.object({ peerId: Id.optional(), ...Page }).strict(),
  mesh_list_sessions: z.object({ peerId: Id.optional(), ...Page }).strict(),
  mesh_start_session: Start,
  mesh_send_message: Send,
  mesh_delegate_task: Send,
  mesh_get_task: z
    .object({ taskId: z.string().uuid(), cursor: z.number().int().min(0).max(4096).default(0) })
    .strict(),
  mesh_cancel_task: z.object({ taskId: z.string().uuid() }).strict(),
} as const;
export type McpTool = keyof typeof MCP_INPUTS;

export const CredentialSchema = z
  .object({
    version: z.literal(1),
    gatewayNodeId: Id,
    url: z.string().url(),
    token: z.string().regex(/^mcp\.[a-f0-9-]{36}\.[a-f0-9]{64}$/),
    grantId: z.string().uuid(),
    expiresAt: z.string().datetime(),
  })
  .strict();
export type McpCredential = z.infer<typeof CredentialSchema>;
export function credential(input: unknown): McpCredential {
  const parsed = CredentialSchema.parse(input),
    url = new URL(parsed.url);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error('MCP Gateway URL must be a plain loopback HTTP origin');
  if (Date.parse(parsed.expiresAt) <= Date.now()) throw new Error('MCP credential has expired');
  return parsed;
}
