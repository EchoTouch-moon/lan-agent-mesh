import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { rpcProcess } from './rpc-probe.mjs';
const root = await mkdtemp(join(tmpdir(), 'lam-dsh-'));
const command = process.env.LAM_DSH_BIN ?? 'dsh';
const report = { harness: 'dsh', platform: process.platform, version: execFileSync(command, ['--version'], { encoding: 'utf8' }).trim(), modelRequests: 0, results: {} };
const rpc = rpcProcess(command, ['--profile', 'acp'], { ...process.env, DSH_HOME: root }, root);
try {
  const initialized = await rpc.call('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'lam-feasibility-probe', version: '0.0.0' } });
  report.results.initialize = { status: 'verified', response: initialized };
  try {
    const created = await rpc.call('session/new', { cwd: root, mcpServers: [] });
    report.results.create = { status: 'verified', returnedSessionId: typeof created.sessionId === 'string' };
    await rpc.call('session/close', { sessionId: created.sessionId });
    report.results.close = { status: 'verified' };
    const listed = await rpc.call('session/list', { cwd: root });
    report.results.listInactive = { status: 'verified', listedOriginalSession: listed.sessions.some(session => session.sessionId === created.sessionId) };
    await rpc.call('session/resume', { sessionId: created.sessionId, cwd: root, mcpServers: [] });
    report.results.resume = { status: 'verified', acceptedOriginalSessionId: true };
    await rpc.call('session/close', { sessionId: created.sessionId });
  } catch (e) { report.results.sessionLifecycle = { status: 'unknown', reason: e.message.replaceAll(root, '<temporary-home>') }; }
  for (const name of ['send', 'stream', 'cancel', 'permissions', 'attachExistingGui']) report.results[name] = { status: 'unknown', reason: 'Not exercised by the no-inference probe' };
} catch (e) { report.error = e.message.replaceAll(root, '<temporary-home>'); process.exitCode = 1; }
finally { await rpc.close(); await rm(root, { recursive: true, force: true }); }
console.log(JSON.stringify(report, null, 2));
