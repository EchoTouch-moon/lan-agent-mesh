import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Require a native item/completed event from the exact thread/turn, never model prose.
export function nativeMcpResult(messages, threadId, turnId, tool, args) {
  const calls = messages.filter(m => m.method === 'item/completed' &&
    m.params?.threadId === threadId && m.params?.turnId === turnId && m.params?.item?.type === 'mcpToolCall');
  assert.equal(calls.length, 1, 'Expected exactly one native MCP invocation');
  const item = calls[0].params.item;
  assert.equal(item.server, 'mesh'); assert.equal(item.tool, tool);
  assert.deepEqual(item.arguments, args); assert.equal(item.error, null);
  assert.ok(['completed', 'failed'].includes(item.status));
  assert.ok(item.result, 'Native MCP result is missing');
  const text = item.result.content?.find(c => c.type === 'text')?.text;
  const data = item.result.structuredContent ?? JSON.parse(text);
  assert.ok(data && typeof data === 'object');
  return { data, evidence: { tool, nativeStatus: item.status,
    threadDigest: digest(threadId), turnDigest: digest(turnId), itemDigest: digest(item.id),
    argumentsDigest: digest(args), resultDigest: digest(item.result) } };
}
