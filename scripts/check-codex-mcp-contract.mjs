import assert from 'node:assert/strict';
import { nativeMcpResult, pidsInGroup } from './codex-mcp-contract.mjs';

const item = { type: 'mcpToolCall', id: 'native-item', server: 'mesh', tool: 'mesh_list_agents',
  status: 'completed', arguments: {}, error: null,
  result: { content: [{ type: 'text', text: '{"agents":[]}' }], structuredContent: { agents: [] } } };
const event = { method: 'item/completed', params: { threadId: 'thread', turnId: 'turn', item } };
const collect = events => nativeMcpResult(events, 'thread', 'turn', 'mesh_list_agents', {});
assert.deepEqual(collect([event]).data, { agents: [] });
for (const change of [
  { method: 'item/started' },
  { params: { ...event.params, threadId: 'other' } },
  { params: { ...event.params, turnId: 'other' } },
  ...[{ type: 'agentMessage' }, { type: 'dynamicToolCall' }, { server: 'fake' },
    { tool: 'mesh_get_task' }, { arguments: { peerId: 'other' } }, { result: null },
    { error: { message: 'transport failed' } }, { status: 'inProgress' }]
    .map(patch => ({ params: { ...event.params, item: { ...item, ...patch } } })),
]) assert.throws(() => collect([{ ...event, ...change }]));
assert.throws(() => collect([event, event]));
assert.throws(() => collect([{ method: 'item/completed', params: {
  ...event.params, item: { type: 'agentMessage', text: 'mesh_list_agents succeeded' },
} }]));
const denied = { ...item, status: 'failed', result: { content: [{ type: 'text', text: '{"code":"permission_denied"}' }], structuredContent: null } };
assert.equal(collect([{ ...event, params: { ...event.params, item: denied } }]).data.code, 'permission_denied');
console.log('Native MCP evidence contract: positive, denial, duplicate and forged/mismatched observations checked');

assert.deepEqual(pidsInGroup('  11 11\n 12 11\n 13 13\n', 11), [11, 12]);
assert.deepEqual(pidsInGroup('  11 11\n 12 11\n 13 13\n', 14), []);
for (const invalid of ['', 'PID PGID', '11', '11 11 trailing', '11 11\nunknown'])
  assert.throws(() => pidsInGroup(invalid, 11));
