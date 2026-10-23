import type { AgentSchema, Capabilities, Capability, Session } from '@lam/domain';
import { CapabilitiesSchema, CapabilitySchema } from '@lam/domain';
import { MeshError, type PermissionDecision, type PermissionRequest } from '@lam/protocol';

export { MeshError } from '@lam/protocol';
export type { PermissionDecision, PermissionRequest } from '@lam/protocol';
export type Agent = ReturnType<typeof AgentSchema.parse>;
export interface ProbeResult { available: boolean; version: string; capabilities: Capabilities }
export interface SpawnInput { agentId: string; workspaceAlias: string }
export interface SendInput {
  sessionId: string; taskId: string; text: string; idempotencyKey: string; deadline: string;
}
export type AdapterEvent =
  | { type: 'delta'; taskId: string; text: string }
  | { type: 'permission'; taskId: string; request: PermissionRequest }
  | { type: 'completed'; taskId: string; text: string }
  | { type: 'failed'; taskId: string; code: string }
  | { type: 'cancelled'; taskId: string }
  | { type: 'unknown'; taskId: string; reason: string };
export type AdapterOperations = {
  discover: () => Promise<Agent[]>;
  spawn: (input: SpawnInput) => Promise<Session>;
  resume: (sessionId: string) => Promise<Session>;
  send: (input: SendInput) => Promise<{ taskId: string }>;
  watch: (taskId: string, signal?: AbortSignal) => AsyncIterable<AdapterEvent>;
  cancel: (taskId: string) => Promise<void>;
  // Caller must authenticate/authorize the human BEFORE invoking this hook.
  answerPermission: (decision: PermissionDecision) => Promise<void>;
};
export interface HarnessAdapter extends AdapterOperations { probe(): Promise<ProbeResult> }
export function negotiateCapabilities(local: Capabilities, remote: Capabilities): Capabilities {
  const result = { ...CapabilitiesSchema.parse(local) };
  CapabilitiesSchema.parse(remote);
  for (const key of CapabilitySchema.options)
    result[key] = local[key] === 'unsupported' || remote[key] === 'unsupported' ? 'unsupported'
      : local[key] === 'supported' && remote[key] === 'supported' ? 'supported' : 'unknown';
  return result;
}
/** All calls pass through capability checks, including streaming methods. */
export class AdapterClient implements HarnessAdapter {
  readonly #capabilities: Capabilities;
  constructor(readonly version: string, capabilities: Capabilities, private readonly operations: Partial<AdapterOperations>) {
    this.#capabilities = CapabilitiesSchema.parse(capabilities);
    for (const key of CapabilitySchema.options) if (key !== 'attachExistingGui' && this.#capabilities[key] === 'supported' && !operations[key])
      throw new MeshError('invalid_message', `Missing implementation for ${key}`);
    if (this.#capabilities.attachExistingGui === 'supported')
      throw new MeshError('unsupported', 'GUI attach requires a future explicit SDK method');
  }
  private require<K extends keyof AdapterOperations>(key: K): AdapterOperations[K] {
    if (this.#capabilities[key as Capability] !== 'supported' || !this.operations[key])
      throw new MeshError('unsupported', `${key} is not supported by this adapter`);
    return this.operations[key] as AdapterOperations[K];
  }
  async probe(): Promise<ProbeResult> { return { available: true, version: this.version, capabilities: { ...this.#capabilities } }; }
  async discover() { return this.require('discover')(); }
  async spawn(input: SpawnInput) { return this.require('spawn')(input); }
  async resume(sessionId: string) { return this.require('resume')(sessionId); }
  async send(input: SendInput) { return this.require('send')(input); }
  async *watch(taskId: string, signal?: AbortSignal) { yield* this.require('watch')(taskId, signal); }
  async cancel(taskId: string) { return this.require('cancel')(taskId); }
  async answerPermission(decision: PermissionDecision) { return this.require('answerPermission')(decision); }
}
