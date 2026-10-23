import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decodeEnvelope, encodeEnvelope, MAX_MESSAGE_BYTES, validateEnvelope } from '../src/index.js';
const now = Date.parse('2026-10-23T00:00:00Z');
const message = () => ({ version: 1, messageId: randomUUID(), correlationId: randomUUID(), idempotencyKey: randomUUID(), type: 'task.request', source: { nodeId: 'mac' }, target: { nodeId: 'win' }, taskId: 'task-1', deadline: new Date(now + 1000).toISOString(), payload: { sessionId: 'session-1', text: '你好', workspaceAlias: 'project-a', delegationDepth: 0 } });
describe('protocol boundaries', () => {
  it('round trips UTF-8', () => { const m = message(); expect(decodeEnvelope(Buffer.from(encodeEnvelope(m, now)), now)).toEqual(m); });
  it('classifies unsupported version, malformed JSON and expired deadlines', () => {
    expect(() => validateEnvelope({ ...message(), version: 2 }, now)).toThrowError(expect.objectContaining({ code: 'unsupported_version' }));
    expect(() => decodeEnvelope('{', now)).toThrowError(expect.objectContaining({ code: 'invalid_json' }));
    expect(() => decodeEnvelope(Uint8Array.from([0xff]), now)).toThrowError(expect.objectContaining({ code: 'invalid_json' }));
    expect(() => validateEnvelope(message(), now + 1000)).toThrowError(expect.objectContaining({ code: 'deadline_exceeded' }));
  });
  it('rejects side effects without correlation and replay keys, wrong payloads and extra fields', () => {
    for (const patch of [{ correlationId: undefined }, { idempotencyKey: undefined }, { taskId: undefined }, { payload: {} }, { extra: true }, { type: 'unknown' }])
      expect(() => validateEnvelope({ ...message(), ...patch }, now)).toThrowError(expect.objectContaining({ code: 'invalid_message' }));
  });
  it('enforces UTF-8 byte limits on both encode and decode', () => {
    const m = message(); m.payload.text = '你'.repeat(23000);
    expect(() => encodeEnvelope(m, now)).toThrowError(expect.objectContaining({ code: 'message_too_large' }));
    expect(() => decodeEnvelope(' '.repeat(MAX_MESSAGE_BYTES + 1), now)).toThrowError(expect.objectContaining({ code: 'message_too_large' }));
  });
  it('accepts control ACK without side-effect keys', () => {
    expect(validateEnvelope({ ...message(), type: 'ack', correlationId: undefined, idempotencyKey: undefined, payload: { messageId: randomUUID() } }, now).type).toBe('ack');
  });
  it('binds approval decisions to envelope task scope', () => {
    const m = { ...message(), type: 'approval.decision', payload: { requestId: randomUUID(), nodeId: 'win', agentId: 'win/mock', sessionId: 's', taskId: 'different-task', operationDigest: 'a'.repeat(64), nonce: randomUUID(), expiresAt: new Date(now + 1000).toISOString(), humanId: 'human-1', decision: 'allow' } };
    expect(() => validateEnvelope(m, now)).toThrowError(expect.objectContaining({ code: 'invalid_message' }));
  });
});
