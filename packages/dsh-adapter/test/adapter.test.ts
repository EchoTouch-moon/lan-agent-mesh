import { mkdtempSync, mkdirSync, realpathSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { DshAdapterCore, type CoreOptions, type DriverFactory } from '../src/core.js';
import { DshAcpClient, openDshAdapter, type LossReason } from '../src/index.js';
import { fixtureEnvironment } from '../src/native.js';
import type { SendInput, AdapterEvent, HarnessAdapter } from '@lam/adapter-sdk';
import { Store } from '@lam/storage';
import { Gateway } from '@lam/runtime';

const roots: string[] = [], adapters: { close(): Promise<void> }[] = [], gateways: Gateway[] = [];
const fixture = fileURLToPath(new URL('./agent-fixture.mjs', import.meta.url));
afterEach(async () => {
  const closed = await Promise.allSettled(adapters.splice(0).map(a => a.close()));
  await Promise.all(gateways.splice(0).map(g => g.stop()));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  expect(closed.every(result => result.status === 'fulfilled')).toBe(true);
});
function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'LAM DSH SDK & 中文 '))); roots.push(root);
  const workspace = join(root, 'workspace'); mkdirSync(workspace, { mode: 0o700 });
  const options: CoreOptions = { nodeId: 'sdk-node', home: join(root, 'adapter'), workspaces: { fixture: workspace }, registration: 'synthetic-acp/v1' };
  return { root, options };
}
function factory(mode = 'normal'): DriverFactory {
  return ({ nativeHome, onText, onLost }) => DshAcpClient.open({ command: process.execPath, args: [fixture, mode],
    cwd: nativeHome, env: { SystemRoot: process.env.SystemRoot, HOME: nativeHome, USERPROFILE: nativeHome }, timeoutMs: 10000, onText, onLost });
}
async function open(options: CoreOptions, mode = 'normal') {
  const adapter = await DshAdapterCore.open(options, factory(mode)); adapters.push(adapter); return adapter;
}
function input(sessionId: string, text = 'greeting'): SendInput {
  return { sessionId, taskId: randomUUID(), idempotencyKey: randomUUID(), text, deadline: new Date(Date.now() + 120000).toISOString() };
}
async function events(adapter: HarnessAdapter, id: string): Promise<AdapterEvent[]> {
  const result: AdapterEvent[] = []; for await (const e of adapter.watch(id)) result.push(e); return result;
}
function messages(options: CoreOptions): Record<string, unknown>[] {
  return readFileSync(join(options.home, 'native', 'fixture-audit.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>);
}
async function started(adapter: HarnessAdapter, taskId: string) {
  const signal = AbortSignal.timeout(5000);
  for await (const e of adapter.watch(taskId, signal)) if (e.type === 'delta') return;
  throw new Error('Expected native in-flight text');
}

it('persists Gateway/native mapping, exact input retries and terminal events across owned process restart', async () => {
  const { options } = setup(); let adapter = await open(options);
  const session = await adapter.spawn({ agentId: adapter.agentId, workspaceAlias: 'fixture' });
  expect(session.id).not.toBe(session.nativeSessionId);
  const task = input(session.id); await adapter.send(task);
  const result = await events(adapter, task.taskId);
  expect(result).toEqual([{ type: 'delta', taskId: task.taskId, text: '你好🌙' }, { type: 'completed', taskId: task.taskId, text: '你好🌙' }]);
  await expect(adapter.send({ ...task })).resolves.toEqual({ taskId: task.taskId });
  for (const changed of [{ text: 'changed' }, { taskId: randomUUID() }, { deadline: new Date(Date.now() + 30000).toISOString() }])
    await expect(adapter.send({ ...task, ...changed })).rejects.toMatchObject({ code: 'conflict' });
  await expect(adapter.send({ ...task, idempotencyKey: 'other-key' })).rejects.toMatchObject({ code: 'conflict' });
  await adapter.close(); adapter = await open(options);
  await expect(adapter.send(task)).resolves.toEqual({ taskId: task.taskId });
  expect(await events(adapter, task.taskId)).toEqual(result);
  await expect(adapter.send(input(session.id))).rejects.toMatchObject({ code: 'conflict' });
  expect(await adapter.resume(session.id)).toMatchObject({ id: session.id, nativeSessionId: session.nativeSessionId });
  const next = input(session.id); await adapter.send(next); await events(adapter, next.taskId);
  expect(messages(options).filter(m => m.method === 'session/new')).toHaveLength(1);
  expect(messages(options).filter(m => m.method === 'session/prompt')).toHaveLength(2);
});

it('keeps terminal outcomes honest: default denial, incomplete turns, busy work and real in-flight cancel', async () => {
  const { options } = setup(), adapter = await open(options);
  const session = await adapter.spawn({ agentId: adapter.agentId, workspaceAlias: 'fixture' });
  const denied = input(session.id, 'permission'); await adapter.send(denied); await events(adapter, denied.taskId);
  expect(adapter.deniedNativeRequests).toBe(1);
  await expect(adapter.answerPermission()).rejects.toMatchObject({ code: 'unsupported' });
  const incomplete = input(session.id, 'incomplete'); await adapter.send(incomplete);
  expect((await events(adapter, incomplete.taskId)).at(-1)).toMatchObject({ type: 'failed', code: 'incomplete_native_turn' });
  const held = input(session.id, 'hold'); await adapter.send(held); await started(adapter, held.taskId);
  await expect(adapter.send(input(session.id))).rejects.toMatchObject({ code: 'busy' });
  await expect(adapter.resume(session.id)).rejects.toMatchObject({ code: 'busy' });
  await adapter.cancel(held.taskId);
  expect((await events(adapter, held.taskId)).at(-1)).toMatchObject({ type: 'cancelled' });
  await adapter.cancel(held.taskId); await adapter.send(held);
  expect(messages(options).filter(m => m.method === 'session/cancel')).toHaveLength(1);
});

it('makes shutdown UNKNOWN durable and blocks replay/new work on its ambiguous session after restart', async () => {
  const { options } = setup(); let adapter = await open(options);
  const session = await adapter.spawn({ agentId: adapter.agentId, workspaceAlias: 'fixture' });
  const held = input(session.id, 'hold'); await adapter.send(held); await started(adapter, held.taskId);
  await adapter.close();
  expect((await events(adapter, held.taskId)).at(-1)).toMatchObject({ type: 'unknown' });
  expect(existsSync(join(options.home, 'adapter.lock'))).toBe(false);
  adapter = await open(options);
  await expect(adapter.send(held)).resolves.toEqual({ taskId: held.taskId });
  await expect(adapter.resume(session.id)).rejects.toMatchObject({ code: 'busy' });
  await expect(adapter.send(input(session.id))).rejects.toMatchObject({ code: 'busy' });
  expect((await events(adapter, held.taskId)).at(-1)).toMatchObject({ type: 'unknown' });
  expect(messages(options).filter(m => m.method === 'session/prompt')).toHaveLength(1);
});

it('turns deadline loss into UNKNOWN, rejects expired/changed retries, and preserves the original execution count', async () => {
  const { options } = setup(), adapter = await open(options);
  const session = await adapter.spawn({ agentId: adapter.agentId, workspaceAlias: 'fixture' });
  const held = { ...input(session.id, 'hold'), deadline: new Date(Date.now() + 1500).toISOString() };
  await adapter.send(held); await started(adapter, held.taskId);
  expect((await events(adapter, held.taskId)).at(-1)).toMatchObject({ type: 'unknown' });
  await expect(adapter.send(held)).rejects.toMatchObject({ code: 'deadline_exceeded' });
  await expect(adapter.send({ ...held, deadline: new Date(Date.now() + 5000).toISOString() })).rejects.toMatchObject({ code: 'conflict' });
  expect((await adapter.probe()).available).toBe(false);
  expect(messages(options).filter(m => m.method === 'session/prompt')).toHaveLength(1);
});

it('recovers a committed in-flight prefix as UNKNOWN before reconnecting the native process', async () => {
  const { options } = setup(); let adapter = await open(options);
  const session = await adapter.spawn({ agentId: adapter.agentId, workspaceAlias: 'fixture' }), task = input(session.id);
  await adapter.send(task); const recorded = await events(adapter, task.taskId); await adapter.close();
  // Simulate the durable prefix left at abrupt process loss, not a claim of a real host crash.
  const disk = new Store(join(options.home, 'adapter.sqlite'));
  disk.db.prepare('UPDATE tasks SET state=?, events=? WHERE id=?').run('RUNNING', JSON.stringify(recorded.filter(e => e.type === 'delta')), task.taskId); disk.close();
  adapter = await open(options);
  expect((await events(adapter, task.taskId)).at(-1)).toMatchObject({ type: 'unknown' });
  await expect(adapter.send(task)).resolves.toEqual({ taskId: task.taskId });
  await expect(adapter.resume(session.id)).rejects.toMatchObject({ code: 'busy' });
  expect(messages(options).filter(m => m.method === 'session/prompt')).toHaveLength(1);
});

it('refuses unmarked, changed and active homes, private-workspace overlap, and stale locks without launching a second child', async () => {
  const { root, options } = setup();
  const unmarked = join(root, 'user-home'); mkdirSync(unmarked, { mode: 0o700 }); writeFileSync(join(unmarked, 'user-file'), 'fixture', { mode: 0o600 });
  await expect(open({ ...options, home: unmarked })).rejects.toThrow();
  expect(readFileSync(join(unmarked, 'user-file'), 'utf8')).toBe('fixture');
  await expect(open({ ...options, home: join(options.workspaces.fixture!, 'state') })).rejects.toMatchObject({ code: 'permission_denied' });
  const adapter = await open(options);
  await expect(open(options)).rejects.toThrow();
  await adapter.close();
  await expect(open({ ...options, nodeId: 'different-node' })).rejects.toThrow();
  writeFileSync(join(options.home, 'adapter.lock'), 'stale-owned-fixture', { mode: 0o600 });
  await expect(open(options)).rejects.toThrow();
  expect(readFileSync(join(options.home, 'adapter.lock'), 'utf8')).toBe('stale-owned-fixture');
});

it('retains ownership on unexpected native death and on cleanup failure, while waking UNKNOWN watchers', async () => {
  const { options } = setup(), adapter = await open(options, 'exit');
  // Expected failure is handled explicitly; afterEach must not pretend this cleanup was verified.
  adapters.splice(adapters.indexOf(adapter), 1);
  const session = await adapter.spawn({ agentId: adapter.agentId, workspaceAlias: 'fixture' }), task = input(session.id);
  await adapter.send(task); expect((await events(adapter, task.taskId)).at(-1)).toMatchObject({ type: 'unknown' });
  await expect(adapter.send(task)).resolves.toEqual({ taskId: task.taskId });
  await expect(adapter.close()).rejects.toMatchObject({ code: 'internal' });
  expect(existsSync(join(options.home, 'adapter.lock'))).toBe(true);
  await expect(open(options)).rejects.toThrow();

  const second = setup(); let lost: ((reason: LossReason) => void) | undefined;
  const failing = await DshAdapterCore.open(second.options, async context => { lost = context.onLost; return {
    createSession: async () => 'native-id', resumeSession: async () => {}, prompt: () => new Promise(() => {}),
    cancel() {}, get deniedNativeRequests() { return 0; }, close: async () => { throw new Error('cleanup failure'); },
  }; });
  // No native process is created by this failure-injection driver.
  lost!('process');
  await expect(failing.close()).rejects.toMatchObject({ code: 'internal' });
  expect(existsSync(join(second.options.home, 'adapter.lock'))).toBe(true);
  const third = setup();
  await expect(DshAdapterCore.open(third.options, async context => { context.onLost('closed'); throw new Error('Uncertain initialization cleanup'); })).rejects.toThrow();
  expect(existsSync(join(third.options.home, 'adapter.lock'))).toBe(true);
});

it('validates persisted ownership, event correlation and configured session/task capacity before native effects', async () => {
  const { options } = setup(); const adapter = await open(options);
  const session = await adapter.spawn({ agentId: adapter.agentId, workspaceAlias: 'fixture' }); await adapter.close();
  const db = new Store(join(options.home, 'adapter.sqlite'));
  for (let i = 1; i < 100; i++) db.put('sessions', `session-${i}`, { ...session, id: `session-${i}`, nativeSessionId: `native-${i}` });
  for (let i = 0; i < 1000; i++) { const task = { ...input(session.id), taskId: `task-${i}`, idempotencyKey: `key-${i}` };
    db.acceptTask(task.taskId, options.nodeId, task.idempotencyKey, task); db.event(task.taskId, 'COMPLETED', { type: 'completed', taskId: task.taskId, text: '' }); }
  db.close();
  const full = await open(options); await full.resume(session.id);
  await expect(full.spawn({ agentId: full.agentId, workspaceAlias: 'fixture' })).rejects.toMatchObject({ code: 'busy' });
  await expect(full.send(input(session.id))).rejects.toMatchObject({ code: 'busy' });
  expect(messages(options).filter(m => m.method === 'session/new')).toHaveLength(1);
  expect(messages(options).filter(m => m.method === 'session/prompt')).toHaveLength(0);
  await full.close();
  const corrupt = new Store(join(options.home, 'adapter.sqlite'));
  corrupt.db.prepare('UPDATE tasks SET events=? WHERE id=?').run(JSON.stringify([{ type: 'completed', taskId: 'foreign-task', text: '' }]), 'task-0'); corrupt.close();
  await expect(open(options)).rejects.toThrow();
  expect(existsSync(join(options.home, 'adapter.lock'))).toBe(true);
});

it('registers actual DSH metadata with Gateway and lets Gateway close the owned adapter', async () => {
  const { root, options } = setup(); let owned: DshAdapterCore | undefined;
  const gateway = new Gateway({ directory: join(root, 'gateway'), listen: ['/ip4/127.0.0.1/tcp/0'], mdns: false,
    exportAgents: nodeId => [`${nodeId}/dsh/default`], adapterFactories: [async ({ nodeId }) => {
      owned = await DshAdapterCore.open({ ...options, nodeId }, factory()); return owned;
    }] }); gateways.push(gateway); await gateway.start();
  const registry = gateway.localRegistry();
  expect(registry.harnesses).toMatchObject([{ kind: 'dsh', version: 'dsh-desktop/0.2.1-rc.2-fixture' }]);
  const caller = new Gateway({ directory: join(root, 'caller'), listen: ['/ip4/127.0.0.1/tcp/0'], mdns: false }); gateways.push(caller); await caller.start();
  // Both identities belong to this synthetic loopback test; this is never physical pairing automation.
  const pairing = await caller.mesh.beginPairing(gateway.mesh.addresses[0]!);
  const other = gateway.mesh.pendingPairings().find(p => p.id === pairing.id)!;
  expect(pairing.code).toBe(other.code); await caller.mesh.confirmPairing(pairing.id, pairing.code); await gateway.mesh.confirmPairing(other.id, other.code);
  const remote = await caller.sync(gateway.mesh.id);
  expect(remote.harnesses[0]!.kind).toBe('dsh');
  const session = await caller.spawn(gateway.mesh.id, remote.agents[0]!.id, 'fixture');
  const task = input(session.id);
  await caller.submit(gateway.mesh.id, session, task.text, task.idempotencyKey, task.taskId, task.deadline);
  async function finished(id: string) {
    const until = Date.now() + 10000, collected: (AdapterEvent | { type: 'started'; taskId: string })[] = [];
    let cursor = 0;
    for (;;) {
      const result = await caller.events(gateway.mesh.id, id, cursor) as { state: string; events: AdapterEvent[]; next: number };
      collected.push(...result.events); cursor = result.next;
      if (!['QUEUED', 'RUNNING', 'WAITING_INPUT'].includes(result.state) && !result.events.length) return { state: result.state, events: collected.filter(e => e.type !== 'started') };
      if (Date.now() > until) throw new Error('Synthetic mesh turn timed out');
      await new Promise(r => setTimeout(r, 100));
    }
  }
  expect(await finished(task.taskId)).toMatchObject({ state: 'COMPLETED', events: [{ type: 'delta', text: '你好🌙' }, { type: 'completed', text: '你好🌙' }] });
  await caller.submit(gateway.mesh.id, session, task.text, task.idempotencyKey, task.taskId, task.deadline);
  expect(gateway.store.count('tasks')).toBe(1);
  await caller.sendEnvelope(gateway.mesh.id, caller.envelope(gateway.mesh.id, 'session.resume', { sessionId: session.id }));
  const held = input(session.id, 'hold'); await caller.submit(gateway.mesh.id, session, held.text, held.idempotencyKey, held.taskId, held.deadline);
  // Wait for the native fixture to report started, rather than race a queued cancel against completion.
  const binding = gateway.sessions.binding(session.id, caller.mesh.id);
  expect(binding.session.nativeSessionId).toBe(session.nativeSessionId);
  await started(owned!, held.taskId);
  await caller.sendEnvelope(gateway.mesh.id, caller.envelope(gateway.mesh.id, 'task.cancel', {}, held.taskId));
  expect((await finished(held.taskId)).state).toBe('CANCELLED');
  expect(messages({ ...options, nodeId: gateway.mesh.id }).filter(m => m.method === 'session/prompt')).toHaveLength(2);
  await gateway.stop(); expect((await owned!.probe()).available).toBe(false);
  expect(existsSync(join(options.home, 'adapter.lock'))).toBe(false);
});

it('ends watchers with volatile UNKNOWN and retains the lock when durable event writes fail', async () => {
  const { options } = setup(), adapter = await open(options);
  adapters.splice(adapters.indexOf(adapter), 1);
  const session = await adapter.spawn({ agentId: adapter.agentId, workspaceAlias: 'fixture' });
  const task = input(session.id, 'hold');
  const store = (adapter as unknown as { store: Store }).store;
  const fault = vi.spyOn(store, 'event').mockImplementation(() => { throw new Error('Injected I/O failure'); });
  try {
    await adapter.send(task);
    expect((await events(adapter, task.taskId)).at(-1)).toMatchObject({ type: 'unknown', reason: 'Durability unavailable; operator recovery required' });
    await expect(adapter.close()).rejects.toMatchObject({ code: 'internal' });
    expect(existsSync(join(options.home, 'adapter.lock'))).toBe(true);
  } finally { fault.mockRestore(); }
  const disk = new Store(join(options.home, 'adapter.sqlite'));
  expect(disk.task(task.taskId)?.state).toBe('QUEUED'); disk.close(); // No invented successful UNKNOWN write.
});

it('does not inherit model tokens, proxies, Harness config roots or PATH into a fixture process', () => {
  const { options } = setup();
  try {
    for (const name of ['OPENAI_API_KEY', 'CODEX_HOME', 'HTTP_PROXY', 'HTTPS_PROXY', 'NODE_OPTIONS', 'DSH_CONFIG', 'PATH']) vi.stubEnv(name, 'lam-inherited-canary');
    const env = fixtureEnvironment(options.home, 'http://127.0.0.1:12345/');
    expect(env.DEEPSEEK_API_KEY).toBe('lam-local-fixture-not-a-real-key');
    for (const name of ['OPENAI_API_KEY', 'CODEX_HOME', 'HTTP_PROXY', 'HTTPS_PROXY', 'NODE_OPTIONS', 'DSH_CONFIG']) expect(env[name]).toBeUndefined();
    expect(env.PATH ?? '').not.toContain('lam-inherited-canary');
    expect(env.HOME).toBe(options.home); expect(env.DSH_HOME).toBe(options.home); expect(env.TEMP).toBe(options.home);
  } finally { vi.unstubAllEnvs(); }
});

it.skipIf(process.platform !== 'win32')('Windows facade exercises reviewed cmd quoting/version/hash/private home with a synthetic launcher only', async () => {
  const { root, options } = setup(), launcher = join(root, 'fixture & 中文.cmd');
  const content = `@echo off\r\n"${process.execPath}" "${fixture}" %*\r\n`;
  writeFileSync(launcher, content);
  const args = { nodeId: options.nodeId, home: options.home, workspaces: options.workspaces, launcher,
    launcherSha256: createHash('sha256').update(content).digest('hex'), expectedVersion: '0.2.1-rc.2' as const, fixtureBaseUrl: 'http://127.0.0.1:12345/' };
  await expect(openDshAdapter({ ...args, fixtureBaseUrl: 'https://example.com/' })).rejects.toMatchObject({ code: 'permission_denied' });
  await expect(openDshAdapter({ ...args, launcherSha256: '0'.repeat(64) })).rejects.toThrow();
  const adapter = await openDshAdapter(args); adapters.push(adapter);
  const session = await adapter.spawn({ agentId: adapter.agentId, workspaceAlias: 'fixture' }), task = input(session.id);
  await adapter.send(task); expect((await events(adapter, task.taskId)).at(-1)).toMatchObject({ type: 'completed' });
});
