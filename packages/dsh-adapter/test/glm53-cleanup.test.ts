// G-S3 (#76) synthetic regression for DSH-owned subprocess cleanup. Only self-spawned fixture
// children are ever terminated; no real DSH desktop, GUI, persisted PID or host state is touched.
// Windows-specific cases skip explicitly on POSIX and never count as Windows verification.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { DshAdapterCore, type CoreOptions, type DriverFactory } from '../src/core.js';
import { DshAcpClient, type LossReason } from '../src/index.js';
import { terminateOwnedChild } from '../src/process-tree.js';
import type { SendInput } from '@lam/adapter-sdk';

const fixture = fileURLToPath(new URL('./agent-fixture.mjs', import.meta.url));
const roots: string[] = [], clients: { close(): Promise<void> }[] = [], adapters: { close(): Promise<void> }[] = [];
afterEach(async () => {
  const closed = await Promise.allSettled([...clients.splice(0).map(c => c.close()), ...adapters.splice(0).map(a => a.close())]);
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  expect(closed.every(result => result.status === 'fulfilled')).toBe(true);
});
function tempRoot() {
  const path = realpathSync(mkdtempSync(join(tmpdir(), 'LAM GLM53 清理 & ')));
  roots.push(path);
  return path;
}
function auditOf(cwd: string): Record<string, unknown>[] {
  return readFileSync(join(cwd, 'fixture-audit.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>);
}
async function until(check: () => boolean, ms: number, what: string) {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Fixture ${what} timed out`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
function alive(pid: number) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error; }
}
async function openClient(cwd: string, mode = 'normal') {
  const text: { id: string; text: string }[] = [], lost: LossReason[] = [];
  const client = await DshAcpClient.open({ command: process.execPath, args: [fixture, mode], cwd,
    env: { SystemRoot: process.env.SystemRoot, HOME: cwd, USERPROFILE: cwd }, timeoutMs: 10000,
    onText: (id, value) => text.push({ id, text: value }), onLost: reason => lost.push(reason) });
  clients.push(client);
  return { client, text, lost };
}
function coreOptions(): CoreOptions {
  const root = tempRoot();
  const workspace = join(root, 'workspace'); mkdirSync(workspace, { mode: 0o700 });
  return { nodeId: 'glm53-cleanup-node', home: join(root, 'adapter'), workspaces: { fixture: workspace }, registration: 'glm53-synthetic-cleanup/v1' };
}
function factory(mode = 'normal'): DriverFactory {
  return ({ nativeHome, onText, onLost }) => DshAcpClient.open({ command: process.execPath, args: [fixture, mode], cwd: nativeHome,
    env: { SystemRoot: process.env.SystemRoot, HOME: nativeHome, USERPROFILE: nativeHome }, timeoutMs: 10000, onText, onLost });
}
function input(sessionId: string): SendInput {
  return { sessionId, taskId: randomUUID(), idempotencyKey: randomUUID(), text: 'greeting', deadline: new Date(Date.now() + 120000).toISOString() };
}
async function terminalEvents(adapter: { watch(taskId: string): AsyncIterable<unknown> }, taskId: string) {
  const events: unknown[] = [];
  for await (const event of adapter.watch(taskId)) events.push(event);
  return events;
}

it('cancel and close clean the owned synthetic tree including descendants, and never touch unrelated processes', async () => {
  const bystander = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  try {
    for (let round = 0; round < 2; round++) {
      const cwd = tempRoot();
      const { client } = await openClient(cwd, 'tree');
      const id = await client.createSession(cwd);
      const turn = client.prompt(id, `descendants-${round}`);
      await until(() => auditOf(cwd).some(message => 'descendant' in message), 10000, 'descendant spawn');
      client.cancel(id);
      expect(await turn).toBe('cancelled');
      await client.close();
      const descendant = auditOf(cwd).find(message => 'descendant' in message)?.descendant as number;
      expect(descendant).toBeGreaterThan(0);
      await until(() => !alive(descendant), 10000, 'descendant cleanup after close');
      expect(alive(bystander.pid!)).toBe(true); // Owned-tree cleanup never kills bystanders.
      expect(auditOf(cwd).filter(message => message.method === 'session/prompt')).toHaveLength(1);
      expect(auditOf(cwd).filter(message => message.method === 'session/cancel')).toHaveLength(1);
    }
  } finally { bystander.kill(); await new Promise(resolve => bystander.once('close', resolve)); }
});

it.skipIf(process.platform !== 'win32')('Windows: an owned self-exit stays cleanup-uncertain except for allowed version probes', async () => {
  const version = spawn(process.execPath, ['-e', 'process.exit(0)']);
  let versionObserved = false;
  const versionExit = new Promise<void>(resolve => version.once('close', () => { versionObserved = true; resolve(); }));
  await versionExit;
  await terminateOwnedChild(version, versionExit, () => versionObserved, true); // Reviewed version probe path.
  const crashed = spawn(process.execPath, ['-e', 'process.exit(9)']);
  let crashedObserved = false;
  const crashedExit = new Promise<void>(resolve => crashed.once('close', () => { crashedObserved = true; resolve(); }));
  await crashedExit;
  await expect(terminateOwnedChild(crashed, crashedExit, () => crashedObserved, false))
    .rejects.toThrow('Owned process cleanup uncertain'); // Unexpected exits are never assumed clean.
});

it.skipIf(process.platform !== 'win32')('Windows: when taskkill cannot start, cleanup reports uncertain instead of assuming success', async () => {
  const root = tempRoot();
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
  let observed = false;
  const exited = new Promise<void>(resolve => child.once('close', () => { observed = true; resolve(); }));
  try {
    vi.stubEnv('SystemRoot', join(root, 'missing-system-root'));
    await expect(terminateOwnedChild(child, exited, () => observed)).rejects.toThrow('Owned process cleanup uncertain');
  } finally { vi.unstubAllEnvs(); }
  expect(alive(child.pid!)).toBe(true); // The failure neither killed the child nor hid the outcome.
  child.kill();
  await exited;
});

it('unexpected native death keeps UNKNOWN and the adapter lock unchanged; recovery stays operator-only', async () => {
  const options = coreOptions();
  const adapter = await DshAdapterCore.open(options, factory('exit')); adapters.push(adapter);
  const session = await adapter.spawn({ agentId: adapter.agentId, workspaceAlias: 'fixture' });
  const task = input(session.id);
  await adapter.send(task);
  expect((await terminalEvents(adapter, task.taskId)).at(-1)).toMatchObject({ type: 'unknown' });
  adapters.splice(adapters.indexOf(adapter), 1); // Expected failure; afterEach must not re-close it.
  await expect(adapter.close()).rejects.toMatchObject({ code: 'internal' });
  const lock = join(options.home, 'adapter.lock');
  expect(existsSync(lock)).toBe(true);
  const held = readFileSync(lock, 'utf8');
  // The native child is verifiably gone (its unexpected exit produced the UNKNOWN above), yet
  // ownership is never re-decided from PID liveness: reopening stays refused, lock byte-for-byte.
  await expect(DshAdapterCore.open(options, factory())).rejects.toMatchObject({ code: 'internal' });
  expect(readFileSync(lock, 'utf8')).toBe(held);
  expect(auditOf(join(options.home, 'native')).filter(message => message.method === 'session/prompt')).toHaveLength(1);
  // Operator-reviewed recovery is the only unlock path. The lock is moved out before deleting:
  // on hosts where a filter driver keeps a delete-pending name briefly alive, unlink alone can
  // leave the name visible and the honest fail-closed open would rightly keep refusing.
  const removed = join(dirname(options.home), 'operator-removed.lock');
  renameSync(lock, removed);
  rmSync(removed);
  expect(existsSync(lock)).toBe(false);
  const recovered = await DshAdapterCore.open(options, factory()); adapters.push(recovered);
  await recovered.close();
  expect(existsSync(lock)).toBe(false);
});

it('healthy adapter lifecycle completes, releases its lock and stops its owned native process', async () => {
  const options = coreOptions();
  const adapter = await DshAdapterCore.open(options, factory()); adapters.push(adapter);
  const session = await adapter.spawn({ agentId: adapter.agentId, workspaceAlias: 'fixture' });
  const task = input(session.id);
  await adapter.send(task);
  expect((await terminalEvents(adapter, task.taskId)).at(-1)).toMatchObject({ type: 'completed' });
  await adapter.close();
  expect(existsSync(join(options.home, 'adapter.lock'))).toBe(false);
  expect((await adapter.probe()).available).toBe(false);
  expect(auditOf(join(options.home, 'native')).filter(message => message.method === 'session/prompt')).toHaveLength(1);
});
