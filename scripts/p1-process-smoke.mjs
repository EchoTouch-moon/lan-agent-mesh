import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
if (dirty && !process.argv.includes('--allow-dirty'))
  throw new Error(
    'Commit probe source before capturing evidence (or use --allow-dirty for development only).',
  );
const root = await mkdtemp(join(tmpdir(), 'LAM process smoke & '));
const children = new Set();
async function start(name, delayMs = 0) {
  const directory = join(root, name),
    child = spawn(
      process.execPath,
      [
        'apps/gateway/dist/index.js',
        'serve',
        '--data',
        directory,
        '--mock',
        '--mock-delay-ms',
        String(delayMs),
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
    );
  children.add(child);
  let stderr = '';
  child.stderr.on('data', (data) => {
    stderr = (stderr + data).slice(-2000);
  });
  const lines = createInterface({ input: child.stdout });
  let timer;
  const ready = await new Promise((resolveReady, reject) => {
    timer = setTimeout(() => reject(new Error('Gateway readiness timeout')), 15000);
    child.once('exit', (code) => reject(new Error(`Gateway exited ${code}: ${stderr}`)));
    lines.on('line', (line) => {
      try {
        const value = JSON.parse(line);
        if (value.ready) resolveReady(value);
      } catch {
        /* Ignore non-JSON startup text. */
      }
    });
  }).finally(() => {
    clearTimeout(timer);
    lines.close();
  });
  const control = JSON.parse(await readFile(join(directory, 'control.json'), 'utf8'));
  return { directory, child, ready, control };
}
async function call(g, command, args = {}) {
  const response = await globalThis.fetch(g.control.url + '/command', {
    method: 'POST',
    headers: { authorization: `Bearer ${g.control.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ command, args }),
    signal: globalThis.AbortSignal.timeout(15000),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`${command}: ${JSON.stringify(body)}`);
  return body;
}
async function stop(g, crash = false) {
  const exited = once(g.child, 'exit');
  if (crash) g.child.kill('SIGKILL');
  else await call(g, 'shutdown');
  await exited;
  children.delete(g.child);
}
async function task(g, peer, id) {
  let cursor = 0;
  const events = [];
  for (let i = 0; i < 400; i++) {
    const batch = await call(g, 'events', { peer, taskId: id, cursor });
    events.push(...batch.events);
    cursor = batch.next;
    if (!['QUEUED', 'RUNNING', 'WAITING_INPUT'].includes(batch.state) && batch.events.length === 0)
      return { state: batch.state, events };
    await delay(10);
  }
  throw new Error('Task timeout');
}
const report = {
  kind: 'P1 two independent Gateway processes, real encrypted loopback transport',
  platform: process.platform,
  node: process.version,
  testedSourceSha: dirty
    ? null
    : execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceState: dirty ? 'uncommitted development run' : 'clean committed source',
  startedUtc: new Date().toISOString(),
  results: {},
  externalModels: 0,
};
try {
  const a = await start('peer A'),
    b = await start('peer B', 250);
  const pairing = await call(a, 'pair', {
    address: b.ready.addresses[0],
    expectedPeer: b.ready.nodeId,
  });
  const pending = (await call(b, 'pairings')).find((p) => p.id === pairing.id);
  assert.equal(pairing.code, pending.code);
  await call(a, 'confirm', { id: pairing.id, code: pairing.code });
  assert.equal((await call(b, 'confirm', { id: pending.id, code: pending.code })).trusted, true);
  report.results.pairing = 'verified';
  for (const [caller, receiver, label] of [
    [a, b, 'A-to-B'],
    [b, a, 'B-to-A'],
  ]) {
    const registry = await call(caller, 'registry', { peer: receiver.ready.nodeId });
    const session = await call(caller, 'spawn', {
      peer: receiver.ready.nodeId,
      agentId: registry.agents[0].id,
      workspaceAlias: 'project-a',
    });
    const sent = await call(caller, 'send', {
      peer: receiver.ready.nodeId,
      session,
      text: 'process fixture',
    });
    const outcome = await task(caller, receiver.ready.nodeId, sent.taskId);
    assert.equal(outcome.state, 'COMPLETED');
    assert.ok(
      outcome.events.some((e) => e.type === 'completed' && e.text === 'mock:process fixture'),
    );
    report.results[label] = 'verified';
  }
  const registry = await call(a, 'registry', { peer: b.ready.nodeId });
  const session = await call(a, 'spawn', {
    peer: b.ready.nodeId,
    agentId: registry.agents[0].id,
    workspaceAlias: 'project-a',
  });
  const id = randomUUID(),
    key = randomUUID(),
    deadline = new Date(Date.now() + 30000).toISOString();
  await call(a, 'send', {
    peer: b.ready.nodeId,
    session,
    text: 'crash fixture',
    taskId: id,
    key,
    deadline,
  });
  await stop(b, true);
  const restarted = await start('peer B');
  assert.equal(restarted.ready.nodeId, b.ready.nodeId);
  await call(a, 'connect', { address: restarted.ready.addresses[0], peer: b.ready.nodeId });
  const recovered = await task(a, b.ready.nodeId, id);
  assert.equal(recovered.state, 'UNKNOWN');
  await call(a, 'send', {
    peer: b.ready.nodeId,
    session,
    text: 'crash fixture',
    taskId: id,
    key,
    deadline,
  });
  assert.equal((await task(a, b.ready.nodeId, id)).state, 'UNKNOWN');
  report.results.crashRecoveryWithoutReplay = 'verified';
  report.results.identityContinuity = 'verified';
  await stop(a);
  await stop(restarted);
  report.results.gracefulExit = 'verified';
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = String(error).replaceAll(root, '[PROBE_ROOT]');
  throw error;
} finally {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await once(child, 'exit').catch(() => {});
    }
  }
  await rm(root, { recursive: true, force: true });
  report.endedUtc = new Date().toISOString();
  const output = process.argv.indexOf('--output');
  if (output !== -1)
    await writeFile(resolve(process.argv[output + 1]), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
