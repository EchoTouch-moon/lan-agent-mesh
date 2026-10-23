import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { rpcProcess } from './rpc-probe.mjs';
const root = await mkdtemp(join(tmpdir(), 'lam-codex-'));
const command = process.env.LAM_CODEX_BIN ?? 'codex';
const report = { harness: 'codex', platform: process.platform, version: execFileSync(command, ['--version'], { encoding: 'utf8' }).trim(), modelRequests: 0, results: {} };
const rpc = rpcProcess(command, ['app-server', '--listen', 'stdio://'], { ...process.env, CODEX_HOME: root }, root);
try {
  const initialized = await rpc.call('initialize', { clientInfo: { name: 'lam-feasibility-probe', version: '0.0.0' }, capabilities: { experimentalApi: false } });
  report.results.initialize = { status: 'verified', userAgent: initialized.userAgent };
  rpc.notify('initialized');
  const started = await rpc.call('thread/start', { cwd: root, approvalPolicy: 'never', sandbox: 'read-only', experimentalRawEvents: false, persistExtendedHistory: false });
  const id = started.thread.id;
  report.results.create = { status: 'verified', returnedThreadId: typeof id === 'string' };
  try {
    const resumed = await rpc.call('thread/resume', { threadId: id });
    report.results.resume = { status: 'verified', sameThreadId: resumed.thread.id === id };
  } catch (e) { report.results.resume = { status: 'unknown', reason: e.message.replaceAll(root, '<temporary-home>').replaceAll(id, '<thread-id>') }; }
  for (const name of ['send', 'stream', 'cancel', 'permissions', 'attachExistingGui']) report.results[name] = { status: 'unknown', reason: 'Not exercised by the no-inference probe' };
} catch (e) { report.error = e.message.replaceAll(root, '<temporary-home>'); process.exitCode = 1; }
finally { await rpc.close(); await rm(root, { recursive: true, force: true }); }
console.log(JSON.stringify(report, null, 2));
