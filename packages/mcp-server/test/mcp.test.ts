import { writeFileSync, rmSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { privateDirectory } from '@lam/private-storage';
import { Gateway } from '@lam/runtime';
import { credential, type McpCredential } from '@lam/mcp-contract';
import { afterEach, it, expect } from 'vitest';
const roots: string[] = [],
  gateways: Gateway[] = [],
  clients: Client[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) await c.close();
  for (const g of gateways.splice(0)) await g.stop();
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});
async function setup(scenario = {}) {
  const root = join(tmpdir(), `LAM MCP & ${randomUUID()}`);
  const lease = await privateDirectory(root, { create: true });
  await lease.close();
  roots.push(root);
  const a = await new Gateway({ directory: join(root, 'caller') }).start();
  gateways.push(a);
  const b = await new Gateway({ directory: join(root, 'executor'), mock: true, scenario }).start();
  gateways.push(b);
  const pairing = await a.mesh.beginPairing(b.mesh.addresses[0]!);
  await a.mesh.confirmPairing(pairing.id, pairing.code);
  await b.mesh.confirmPairing(pairing.id, pairing.code);
  const registry = await a.sync(b.mesh.id);
  const scope = { peers: [b.mesh.id], agents: [registry.agents[0]!.id], workspaces: ['project-a'] };
  const grant = (await a.command('mcp-grant', scope)) as McpCredential;
  return { root, a, b, scope, grant, agentId: registry.agents[0]!.id };
}
async function connect(root: string, grant: McpCredential, versions?: string[]) {
  const file = join(root, `credential-${grant.grantId}.json`);
  writeFileSync(file, JSON.stringify(grant), { mode: 0o600 });
  const client = new Client(
    { name: 'lam-test-client', version: '0.1.0' },
    versions ? { supportedProtocolVersions: versions } : {},
  );
  clients.push(client);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve('packages/mcp-server/dist/cli.js'), '--credentials', file],
    stderr: 'pipe',
    maxBufferSize: 262144,
  });
  let diagnostic = '';
  transport.stderr?.on('data', (b) => {
    const text = String(b);
    if (/^Private storage rejected: [a-z_]+[\r\n]*$/.test(text)) diagnostic += text.trim();
  });
  try { await client.connect(transport); } catch { throw new Error(`MCP start failed: ${diagnostic || 'no storage reason reported'}`); }
  return client;
}
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content.find((c) => c.type === 'text');
  return {
    isError: result.isError === true,
    value: (result.structuredContent ??
      (text && text.type === 'text' ? JSON.parse(text.text) : {})) as Record<string, unknown>,
  };
}
async function finished(client: Client, id: string) {
  let cursor = 0;
  const events: Record<string, unknown>[] = [];
  for (let i = 0; i < 100; i++) {
    const result = await call(client, 'mesh_get_task', { taskId: id, cursor });
    expect(result.isError).toBe(false);
    const value = result.value;
    events.push(...(value.events as Record<string, unknown>[]));
    cursor = value.next as number;
    if (
      !['QUEUED', 'RUNNING', 'WAITING_INPUT'].includes(value.state as string) &&
      (value.events as unknown[]).length === 0
    )
      return { state: value.state, events };
    await delay(10);
  }
  throw new Error('Task did not terminate');
}
it('a real stdio MCP client calls all seven tools through the encrypted remote Mock chain', async () => {
  const { root, a, b, grant, agentId } = await setup({ delayMs: 150 });
  const client = await connect(root, grant);
  const legacy = await connect(root, grant, ['2025-06-18']);
  expect((await call(legacy, 'mesh_list_agents')).isError).toBe(false);
  const tools = await client.listTools();
  expect(tools.tools.map((t) => t.name).sort()).toEqual(
    [
      'mesh_list_agents',
      'mesh_list_sessions',
      'mesh_start_session',
      'mesh_send_message',
      'mesh_delegate_task',
      'mesh_get_task',
      'mesh_cancel_task',
    ].sort(),
  );
  expect(tools.tools.some((t) => /approve|permission|pair|grant|shutdown/.test(t.name))).toBe(
    false,
  );
  const agents = await call(client, 'mesh_list_agents');
  expect(agents.isError).toBe(false);
  expect(agents.value.agents as unknown[]).toHaveLength(1);
  const requestId = randomUUID();
  const args = { peerId: b.mesh.id, agentId, workspaceAlias: 'project-a', requestId };
  const started = await call(client, 'mesh_start_session', args);
  expect(started.isError).toBe(false);
  expect(started.value).not.toHaveProperty('nativeSessionId');
  expect(started.value.nativeState).toBe('unknown');
  expect(started.value).not.toHaveProperty('state');
  const repeated = await call(client, 'mesh_start_session', args);
  expect(repeated.value).toEqual(started.value);
  expect(b.store.list('sessions')).toHaveLength(1);
  const sessionId = started.value.sessionId as string;
  expect((await call(client, 'mesh_list_sessions')).value.sessions).toHaveLength(1);
  const sendArgs = { sessionId, text: 'MCP fixture', requestId: randomUUID() };
  const sent = await call(client, 'mesh_send_message', sendArgs);
  expect(sent.isError).toBe(false);
  expect(sent.value.delivery).toBe('accepted');
  expect(b.store.task(sent.value.taskId as string)?.state).not.toBe('COMPLETED');
  const outcome = await finished(client, sent.value.taskId as string);
  expect(outcome.state).toBe('COMPLETED');
  expect(outcome.events.some((e) => e.type === 'completed' && e.text === 'mock:MCP fixture')).toBe(
    true,
  );
  expect((await call(client, 'mesh_send_message', sendArgs)).value.taskId).toBe(sent.value.taskId);
  expect(b.store.count('tasks')).toBe(1);
  const delegated = await call(client, 'mesh_delegate_task', {
    sessionId,
    text: 'cancel me',
    requestId: randomUUID(),
  });
  expect(delegated.isError).toBe(false);
  expect(
    (await call(client, 'mesh_cancel_task', { taskId: delegated.value.taskId })).value
      .cancelRequested,
  ).toBe(true);
  expect((await finished(client, delegated.value.taskId as string)).state).toBe('CANCELLED');
  expect(a.store.pending()).toEqual([]);
});
it('credentials cannot administer Gateway, cross another credential resources or choose another task identity', async () => {
  const { root, a, b, grant, agentId, scope } = await setup();
  const another = (await a.command('mcp-grant', scope)) as McpCredential;
  const c1 = await connect(root, grant),
    c2 = await connect(root, another);
  const id = randomUUID(),
    first = await call(c1, 'mesh_start_session', {
      peerId: b.mesh.id,
      agentId,
      workspaceAlias: 'project-a',
      requestId: id,
    });
  const second = await call(c2, 'mesh_start_session', {
    peerId: b.mesh.id,
    agentId,
    workspaceAlias: 'project-a',
    requestId: id,
  });
  expect(first.value.sessionId).not.toBe(second.value.sessionId);
  expect(
    (
      await call(c2, 'mesh_send_message', {
        sessionId: first.value.sessionId,
        text: 'steal',
        requestId: randomUUID(),
      })
    ).isError,
  ).toBe(true);
  const requestId = randomUUID();
  const t1 = await call(c1, 'mesh_send_message', {
    sessionId: first.value.sessionId,
    text: 'owned one',
    requestId,
  });
  await finished(c1, t1.value.taskId as string);
  const t2 = await call(c2, 'mesh_send_message', {
    sessionId: second.value.sessionId,
    text: 'owned two',
    requestId,
  });
  expect(t1.value.taskId).not.toBe(t2.value.taskId);
  expect((await call(c2, 'mesh_get_task', { taskId: t1.value.taskId })).isError).toBe(true);
  expect((await call(c2, 'mesh_cancel_task', { taskId: t1.value.taskId })).isError).toBe(true);
  expect(
    (
      await call(c1, 'mesh_start_session', {
        peerId: b.mesh.id,
        agentId,
        workspaceAlias: 'other-project',
        requestId: randomUUID(),
      })
    ).isError,
  ).toBe(true);
  expect((await call(c1, 'mesh_list_agents', { peerId: a.mesh.id })).isError).toBe(true);
  const forbidden = await fetch(a.url + '/command', {
    method: 'POST',
    headers: { authorization: `Bearer ${grant.token}` },
    body: JSON.stringify({ command: 'confirm', args: {} }),
  });
  expect(forbidden.status).toBe(403);
  const wrongAdmin = await fetch(a.url + '/mcp/command', {
    method: 'POST',
    headers: { authorization: `Bearer ${a.token}`, 'x-lam-node': a.mesh.id },
    body: JSON.stringify({ command: 'mesh_list_agents', args: {} }),
  });
  expect(wrongAdmin.status).toBe(403);
  const selfApprove = await fetch(a.url + '/mcp/command', {
    method: 'POST',
    headers: { authorization: `Bearer ${grant.token}`, 'x-lam-node': a.mesh.id },
    body: JSON.stringify({ command: 'mcp-grant', args: scope }),
  });
  expect(selfApprove.status).toBe(400);
  await a.command('mcp-revoke', { grantId: grant.grantId });
  expect((await call(c1, 'mesh_list_sessions')).isError).toBe(true);
});
it('coalesces concurrent request retries, rejects conflicting IDs and denies approval requests', async () => {
  const { root, a, b, grant, agentId } = await setup({ permission: true });
  const client = await connect(root, grant);
  const input = {
    peerId: b.mesh.id,
    agentId,
    workspaceAlias: 'project-a',
    requestId: randomUUID(),
  };
  const results = await Promise.all([
    call(client, 'mesh_start_session', input),
    call(client, 'mesh_start_session', input),
  ]);
  expect(results[0]!.value.sessionId).toBe(results[1]!.value.sessionId);
  expect(b.store.list('sessions')).toHaveLength(1);
  const args = {
    sessionId: results[0]!.value.sessionId,
    text: 'permission path',
    requestId: randomUUID(),
  };
  const sent = await call(client, 'mesh_delegate_task', args);
  expect((await finished(client, sent.value.taskId as string)).state).toBe('FAILED');
  expect((await call(client, 'mesh_delegate_task', { ...args, text: 'different' })).isError).toBe(
    true,
  );
  expect(b.store.count('tasks')).toBe(1);
  const permission = b.store
    .task(sent.value.taskId as string)
    ?.events.find((e) => (e as { type: string }).type === 'permission') as {
    request: { requestId: string };
  };
  expect(
    b.store.get<{ decision: string }>('approvals', permission.request.requestId)?.decision,
  ).toBe('deny');
  const expired = (await a.command('mcp-grant', {
    peers: [b.mesh.id],
    agents: [agentId],
    workspaces: ['project-a'],
    lifetimeSeconds: 1,
  })) as McpCredential;
  await delay(1100);
  expect(() => a.mcp.authenticate(expired.token)).toThrowError(
    expect.objectContaining({ code: 'permission_denied' }),
  );
  expect(() => credential({ ...grant, url: 'https://example.org' })).toThrow();
});
it('preserves owned resources across MCP process restart, retries a lost ACK once, and invalidates credentials on Gateway restart', async () => {
  const { root, a, b, grant, agentId } = await setup({ delayMs: 100 });
  const client = await connect(root, grant);
  const session = await call(client, 'mesh_start_session', {
    peerId: b.mesh.id,
    agentId,
    workspaceAlias: 'project-a',
    requestId: randomUUID(),
  });
  const original = a.mesh.request.bind(a.mesh);
  let dropped = false;
  a.mesh.request = async (peer, body) => {
    const result = await original(peer, body),
      value = body as { kind: string; value?: { type: string } };
    if (!dropped && value.kind === 'envelope' && value.value?.type === 'task.request') {
      dropped = true;
      throw new Error('Injected lost ACK');
    }
    return result;
  };
  const args = {
    sessionId: session.value.sessionId,
    text: 'once despite lost ACK',
    requestId: randomUUID(),
  };
  const uncertain = await call(client, 'mesh_send_message', args);
  expect(uncertain.value.delivery).toBe('UNKNOWN');
  a.mesh.request = original;
  await client.close();
  const restartedClient = await connect(root, grant);
  expect((await call(restartedClient, 'mesh_list_sessions')).value.sessions).toHaveLength(1);
  const real = a.mesh.request.bind(a.mesh);
  a.mesh.request = async (peer, body) => {
    if ((body as { kind: string }).kind === 'events')
      return {
        state: 'COMPLETED',
        events: [{ type: 'completed', taskId: randomUUID(), text: 'forged' }],
        next: 1,
      };
    return real(peer, body);
  };
  const forged = await call(restartedClient, 'mesh_get_task', { taskId: uncertain.value.taskId });
  expect(forged.value.state).toBe('UNKNOWN');
  expect(forged.value.events).toEqual([]);
  a.mesh.request = real;
  const retry = await call(restartedClient, 'mesh_send_message', args);
  expect(retry.value.taskId).toBe(uncertain.value.taskId);
  expect(retry.value.delivery).toBe('accepted');
  expect((await finished(restartedClient, retry.value.taskId as string)).state).toBe('COMPLETED');
  expect(b.store.count('tasks')).toBe(1);
  await restartedClient.close();
  await a.stop();
  const next = await new Gateway({ directory: a.options.directory }).start();
  gateways.push(next);
  expect(next.mesh.id).toBe(grant.gatewayNodeId);
  const stale = await fetch(next.url + '/mcp/command', {
    method: 'POST',
    headers: { authorization: `Bearer ${grant.token}`, 'x-lam-node': next.mesh.id },
    body: JSON.stringify({ command: 'mesh_list_sessions', args: {} }),
  });
  expect(stale.status).toBe(403);
});
it('uses one retry namespace across send and delegate even when callers race on different sessions', async () => {
  const { root, b, grant, agentId } = await setup();
  const client = await connect(root, grant);
  const first = await call(client, 'mesh_start_session', {
    peerId: b.mesh.id,
    agentId,
    workspaceAlias: 'project-a',
    requestId: randomUUID(),
  });
  const second = await call(client, 'mesh_start_session', {
    peerId: b.mesh.id,
    agentId,
    workspaceAlias: 'project-a',
    requestId: randomUUID(),
  });
  const requestId = randomUUID();
  const raced = await Promise.all([
    call(client, 'mesh_send_message', {
      sessionId: first.value.sessionId,
      text: 'first',
      requestId,
    }),
    call(client, 'mesh_delegate_task', {
      sessionId: second.value.sessionId,
      text: 'second',
      requestId,
    }),
  ]);
  expect(raced.filter((r) => !r.isError)).toHaveLength(1);
  expect(raced.filter((r) => r.isError)).toHaveLength(1);
  expect(b.store.count('tasks')).toBe(1);
  const accepted = raced.find((r) => !r.isError)!;
  expect((await finished(client, accepted.value.taskId as string)).state).toBe('COMPLETED');
});

it('operator CLI writes a private scoped credential without printing secrets or overwriting files', async () => {
  const { root, a, scope } = await setup();
  const file = join(root, 'operator-credential.json'),
    scopeFile = join(root, 'scope.json');
  writeFileSync(scopeFile, JSON.stringify(scope), { mode: 0o600 });
  const command = [
    'apps/gateway/dist/index.js',
    'control',
    '--data',
    a.options.directory,
    '--command',
    'mcp-grant',
    '--args-file',
    scopeFile,
    '--output',
    file,
  ];
  const issued = await promisify(execFile)(process.execPath, command, { timeout: 15000 });
  const config = JSON.parse(readFileSync(file, 'utf8')) as McpCredential;
  expect(issued.stdout).not.toContain(config.token);
  expect(JSON.parse(issued.stdout).credentialFileWritten).toBe(true);
  if (process.platform !== 'win32') expect(statSync(file).mode & 0o077).toBe(0);
  await expect(
    promisify(execFile)(process.execPath, command, { timeout: 15000 }),
  ).rejects.toBeTruthy();
  expect(JSON.parse(readFileSync(file, 'utf8')).token).toBe(config.token);
  const revoked = a.store
    .query("SELECT data FROM messages WHERE id LIKE 'mcp/grant/%'")
    .map((r) => JSON.parse(String(r.data)) as { revoked: boolean });
  expect(revoked.filter((r) => r.revoked)).toHaveLength(1);
});
