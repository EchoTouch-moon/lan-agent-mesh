import { writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { privateDirectory } from '@lam/private-storage';
import { Gateway } from '@lam/runtime';
import { MCP_INPUTS, type McpCredential } from '@lam/mcp-contract';

const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
if (dirty && !process.argv.includes('--allow-dirty'))
  throw new Error('Commit MCP source before capturing evidence');
const root = join(tmpdir(), `LAM MCP smoke & ${randomUUID()}`),
  gateways: Gateway[] = [],
  clients: Client[] = [];
const report: {
  status: string;
  platform: string;
  node: string;
  testedSourceSha: string | null;
  sourceState: string;
  startedUtc: string;
  endedUtc?: string;
  externalModels: number;
  results: Record<string, unknown>;
  error?: string;
} = {
  status: 'running',
  platform: process.platform,
  node: process.version,
  testedSourceSha: dirty
    ? null
    : execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceState: dirty ? 'uncommitted development run' : 'clean committed source',
  startedUtc: new Date().toISOString(),
  externalModels: 0,
  results: {},
};
const rootLease = await privateDirectory(root, { create: true });
await rootLease.close();
async function connect(credential: McpCredential) {
  const file = join(root, `credential-${credential.grantId}.json`);
  await writeFile(file, JSON.stringify(credential), { mode: 0o600 });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve('packages/mcp-server/dist/cli.js'), '--credentials', file],
    stderr: 'pipe',
    maxBufferSize: 262144,
  });
  transport.stderr?.on('data', () => {});
  const client = new Client({ name: 'lam-local-mcp-smoke', version: '0.1.0' });
  clients.push(client);
  await client.connect(transport);
  return client;
}
async function tool(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  assert.notEqual(result.isError, true, `${name} was rejected`);
  const text = result.content.find((x) => x.type === 'text');
  return (result.structuredContent ??
    (text && text.type === 'text' ? JSON.parse(text.text) : {})) as Record<string, unknown>;
}
async function terminal(client: Client, id: string) {
  let cursor = 0;
  const events: Record<string, unknown>[] = [];
  for (let i = 0; i < 100; i++) {
    const result = await tool(client, 'mesh_get_task', { taskId: id, cursor });
    events.push(...(result.events as Record<string, unknown>[]));
    cursor = result.next as number;
    if (
      !['QUEUED', 'RUNNING', 'WAITING_INPUT'].includes(result.state as string) &&
      (result.events as unknown[]).length === 0
    )
      return { state: result.state, events };
    await delay(20);
  }
  throw new Error('MCP task result deadline exceeded');
}
try {
  const caller = await new Gateway({ directory: join(root, 'caller') }).start();
  gateways.push(caller);
  const executor = await new Gateway({
    directory: join(root, 'executor'),
    mock: true,
    scenario: { delayMs: 100 },
  }).start();
  gateways.push(executor);
  const pair = await caller.mesh.beginPairing(executor.mesh.addresses[0]!);
  assert.equal(executor.mesh.pendingPairings()[0]!.code, pair.code);
  await caller.mesh.confirmPairing(pair.id, pair.code);
  await executor.mesh.confirmPairing(pair.id, pair.code);
  const registry = await caller.sync(executor.mesh.id),
    agentId = registry.agents[0]!.id;
  const credential = (await caller.command('mcp-grant', {
    peers: [executor.mesh.id],
    agents: [agentId],
    workspaces: ['project-a'],
  })) as McpCredential;
  const client = await connect(credential),
    list = await client.listTools();
  assert.deepEqual(list.tools.map((t) => t.name).sort(), Object.keys(MCP_INPUTS).sort());
  report.results.toolSet = 'seven exact mesh tools; no approval or administration tool';
  const cards = await tool(client, 'mesh_list_agents');
  assert.equal((cards.agents as unknown[]).length, 1);
  const input = {
    peerId: executor.mesh.id,
    agentId,
    workspaceAlias: 'project-a',
    requestId: randomUUID(),
  };
  const session = await tool(client, 'mesh_start_session', input);
  assert.deepEqual(await tool(client, 'mesh_start_session', input), session);
  assert.equal(executor.store.list('sessions').length, 1);
  assert.equal((await tool(client, 'mesh_list_sessions')).sessions instanceof Array, true);
  report.results.sessionCreationAndRetry = 'verified';
  const args = { sessionId: session.sessionId, text: 'MCP smoke fixture', requestId: randomUUID() };
  const sent = await tool(client, 'mesh_send_message', args);
  assert.equal(sent.delivery, 'accepted');
  assert.notEqual(executor.store.task(sent.taskId as string)?.state, 'COMPLETED');
  const completed = await terminal(client, sent.taskId as string);
  assert.equal(completed.state, 'COMPLETED');
  assert.ok(
    completed.events.some((e) => e.type === 'completed' && e.text === 'mock:MCP smoke fixture'),
  );
  assert.equal((await tool(client, 'mesh_send_message', args)).taskId, sent.taskId);
  assert.equal(executor.store.count('tasks'), 1);
  report.results.remoteMockStreamAndIdempotency = 'verified';
  report.results.longTaskReturnsBeforeCompletion = 'verified';
  const delegated = await tool(client, 'mesh_delegate_task', {
    sessionId: session.sessionId,
    text: 'cancel fixture',
    requestId: randomUUID(),
  });
  assert.equal(
    (await tool(client, 'mesh_cancel_task', { taskId: delegated.taskId })).cancelRequested,
    true,
  );
  assert.equal((await terminal(client, delegated.taskId as string)).state, 'CANCELLED');
  report.results.delegationAndCancel = 'verified';
  const forbidden = await fetch(caller.url + '/command', {
    method: 'POST',
    headers: { authorization: `Bearer ${credential.token}` },
    body: JSON.stringify({ command: 'confirm', args: {} }),
  });
  assert.equal(forbidden.status, 403);
  report.results.managementBoundary = 'verified';
  await caller.command('mcp-revoke', { grantId: credential.grantId });
  assert.equal(
    (await client.callTool({ name: 'mesh_list_sessions', arguments: {} })).isError,
    true,
  );
  report.results.revocation = 'verified';
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = String(error)
    .replaceAll(root, '[PROBE_ROOT]')
    .replace(/mcp\.[a-f0-9-]{36}\.[a-f0-9]{64}/g, '[CREDENTIAL]');
  process.exitCode = 1;
} finally {
  for (const c of clients) await c.close();
  for (const g of gateways) await g.stop();
  await rm(root, { recursive: true, force: true });
  report.endedUtc = new Date().toISOString();
  const at = process.argv.indexOf('--output');
  if (at !== -1)
    await writeFile(resolve(process.argv[at + 1]!), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
