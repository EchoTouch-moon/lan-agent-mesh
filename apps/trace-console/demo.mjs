// OBS-0 V0 demo driver: two real Gateways over loopback TCP/Noise with the
// deterministic mock adapter, plus the read-only trace console. No models, no
// LAN, no credentials. Run from the worktree root after `pnpm build`:
//
//   node apps/trace-console/demo.mjs [--keep]
//
// Prints the one-time console login URL, then keeps submitting a small task
// every few seconds (complete / cancel / injected-disconnect UNKNOWN rotating)
// so the page shows live state transitions. Ctrl-C stops and cleans up.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setInterval as every, clearInterval as stopEvery } from 'node:timers';
import { setTimeout as delay } from 'node:timers/promises';
import { Gateway } from '../../packages/runtime/dist/index.js';
import { TraceConsole } from './dist/server.js';

const keep = process.argv.includes('--keep');
const roots = [];
const gateways = [];
const stopping = [];

function directory(label) {
  const dir = mkdtempSync(join(tmpdir(), `LAM demo ${label} `));
  roots.push(dir);
  return dir;
}

async function gateway(label, options) {
  const g = await new Gateway({ listen: ['/ip4/127.0.0.1/tcp/0'], mdns: false, mock: true, ...options, directory: directory(label) }).start();
  gateways.push(g);
  return g;
}

async function pair(a, b) {
  const p = await a.mesh.beginPairing(b.mesh.addresses[0]);
  const q = b.mesh.pendingPairings().find((entry) => entry.id === p.id);
  await a.mesh.confirmPairing(p.id, p.code);
  await b.mesh.confirmPairing(q.id, q.code);
}

async function sessionOn(caller, receiver) {
  const registry = await caller.sync(receiver.mesh.id);
  const creation = caller.envelope(receiver.mesh.id, 'session.create', { agentId: registry.agents[0].id, workspaceAlias: 'project-a' });
  creation.deadline = new Date(Date.now() + 120000).toISOString();
  const created = await caller.sendEnvelope(receiver.mesh.id, creation);
  if (created.type !== 'session.event') throw new Error('demo session.create failed');
  return created.payload;
}

const tasks = [];
let round = 0;

async function runRound(caller, worker, workerSession, flaky) {
  round += 1;
  if (round % 3 === 0) {
    // A task that ends UNKNOWN leaves its session permanently busy (no
    // automatic replay by design), so each flaky round opens a fresh session.
    const session = await sessionOn(caller, flaky);
    const id = (await caller.submit(flaky.mesh.id, session, `flaky round ${round} (goes dark)`)).taskId;
    tasks.push({ taskId: id, peer: flaky.mesh.id, outcome: 'UNKNOWN' });
  } else {
    const id = (await caller.submit(worker.mesh.id, workerSession, `worker round ${round}`)).taskId;
    if (round % 3 === 2) {
      await delay(700);
      await caller.command('cancel', { peer: worker.mesh.id, taskId: id });
      tasks.push({ taskId: id, peer: worker.mesh.id, outcome: 'CANCELLED' });
    } else tasks.push({ taskId: id, peer: worker.mesh.id, outcome: 'COMPLETED' });
  }
  console.log(JSON.stringify({ round, submitted: tasks[tasks.length - 1] }));
}

async function main() {
  const caller = await gateway('caller', { mock: false });
  const worker = await gateway('worker', { scenario: { chunks: ['Observing ', 'a live ', 'agent-mesh call'], delayMs: 350 } });
  const flaky = await gateway('flaky', { scenario: { disconnectAfterChunks: 0 } });
  await pair(caller, worker);
  await pair(caller, flaky);
  const workerSession = await sessionOn(caller, worker);
  const trace = await TraceConsole.start({ directory: caller.options.directory });
  stopping.push(() => trace.stop());

  console.log(JSON.stringify({
    demo: 'OBS-0 read-only trace console',
    callerNode: caller.mesh.id,
    loginUrl: trace.loginUrl,
    workerPeer: worker.mesh.id,
    flakyPeer: flaky.mesh.id,
    note: 'Open loginUrl once, paste taskIds from the rounds below. Ctrl-C stops and cleans up.',
  }, null, 2));

  const loop = every(() => {
    void runRound(caller, worker, workerSession, flaky).catch((error) => {
      console.error(`round ${round + 1} failed: ${error.message}`);
    });
  }, 4000);
  stopping.unshift(() => new Promise((resolve) => {
    stopEvery(loop);
    resolve();
  }));
  await runRound(caller, worker, workerSession, flaky).catch(() => {});
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    void (async () => {
      for (const stop of stopping) await stop().catch(() => {});
      for (const g of gateways.reverse()) await g.stop().catch(() => {});
      if (!keep) for (const root of roots.reverse()) rmSync(root, { recursive: true, force: true });
      process.exit(process.exitCode ?? 0);
    })();
  });
}
