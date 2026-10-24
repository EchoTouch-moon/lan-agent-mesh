/** #41 controlled host verification. No existing ACLs, profiles or firewall are changed. */
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, execFileSync } from 'node:child_process';
import { promisify, parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { Gateway } from '@lam/runtime';
import { privateDirectory, privateFile } from '@lam/private-storage';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
const { values } = parseArgs({ options: { parent: { type: 'string' }, output: { type: 'string' } } });
if (process.platform !== 'win32') throw new Error('Windows host required');
if (execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim())
  throw new Error('Commit source before capturing evidence');
const run = promisify(execFile), roots: string[] = [], gateways: Gateway[] = [];
const report = {
  kind: '#41 actual Windows private-storage gate; controlled disposable fixtures only',
  testedSourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  platform: process.platform, node: process.version, startedUtc: new Date().toISOString(),
  endedUtc: '', status: 'running', results: {} as Record<string, string>,
  externalModels: 0, cleanup: 'pending',
};
function widen(path: string) {
  execFileSync(resolve(process.env.SystemRoot!, 'System32/WindowsPowerShell/v1.0/powershell.exe'), [
    '-NoProfile', '-NonInteractive', '-File', fileURLToPath(new URL('../../private-storage/test/windows-fixture.ps1', import.meta.url)),
  ], { input: JSON.stringify({ path }) + '\n', windowsHide: true, encoding: 'utf8' });
}
try {
  // The rejection case remains testable even if the host cannot offer a safe lineage.
  const unsafe = mkdtempSync(join(tmpdir(), 'LAM ACL reject & ')); roots.push(unsafe);
  widen(unsafe);
  await assert.rejects(new Gateway({ directory: unsafe }).start());
  assert.deepEqual(readdirSync(unsafe), []);
  report.results.unsafeGatewayBeforeSecretCreation = 'verified';
  const root = join(resolve(values.parent ?? tmpdir()), `LAM private & ${randomUUID()}`);
  roots.push(root);
  try {
    const lease = await privateDirectory(root, { create: true }); await lease.close();
  } catch {
    report.status = 'blocked'; report.results.exclusiveDirectory = 'unavailable: host owner/ACL/namespace policy failed closed; select a safe local lineage explicitly';
    throw new Error('environment_blocker');
  }
  report.results.exclusiveDirectory = 'verified';
  const caller = await new Gateway({ directory: join(root, 'caller') }).start(); gateways.push(caller);
  const executor = await new Gateway({ directory: join(root, 'executor'), mock: true }).start(); gateways.push(executor);
  const pair = await caller.mesh.beginPairing(executor.mesh.addresses[0]!);
  await caller.mesh.confirmPairing(pair.id, pair.code); await executor.mesh.confirmPairing(pair.id, pair.code);
  const registry = await caller.sync(executor.mesh.id);
  const scopeFile = join(root, 'scope.json');
  writeFileSync(scopeFile, JSON.stringify({ peers: [executor.mesh.id], agents: [registry.agents[0]!.id], workspaces: ['project-a'], ttlSeconds: 60 }));
  const cli = [resolve('apps/gateway/dist/index.js'), 'control', '--data', caller.options.directory, '--command', 'mcp-grant', '--args-file', scopeFile, '--output'];
  const output = join(root, 'credential.json');
  const issued = await run(process.execPath, [...cli, output]);
  const credential = JSON.parse(readFileSync(output, 'utf8')) as { token: string; grantId: string };
  assert(!issued.stdout.includes(credential.token) && !issued.stderr.includes(credential.token));
  const lease = await privateFile(output); await lease.close();
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('packages/mcp-server/dist/cli.js'), '--credentials', output], stderr: 'pipe' });
  let stderr = ''; transport.stderr?.on('data', (b) => { stderr += String(b); });
  const client = new Client({ name: 'lam-private-storage-fixture', version: '0.1.0' });
  try { await client.connect(transport); assert.equal((await client.listTools()).tools.length, 7); } finally { await client.close(); }
  assert(!stderr.includes(credential.token));
  report.results.privateCredentialAndActualMcpStdio = 'verified';
  const badOutput = join(root, 'readable-output'); mkdirSync(badOutput); widen(badOutput);
  await assert.rejects(run(process.execPath, [...cli, join(badOutput, 'credential.json')]), (e: unknown) => {
    const error = e as { stdout?: string; stderr?: string };
    return !(String(error.stdout) + String(error.stderr)).includes('mcp.');
  });
  assert.deepEqual(readdirSync(badOutput), []);
  const grants = caller.store.query("SELECT data FROM messages WHERE id LIKE 'mcp/grant/%'").map((row) => JSON.parse(String(row.data)));
  assert.equal(grants.length, 2); assert.equal(grants.filter((g) => g.revoked).length, 1);
  report.results.unsafeOutputRefusedAndGrantRevoked = 'verified';
  const publicCredential = join(unsafe, 'fixture.json');
  // Public, nonfunctional sentinel only; no real bearer is put into the unsafe fixture.
  const publicBearer = `mcp.${randomUUID()}.${'0'.repeat(64)}`;
  writeFileSync(publicCredential, JSON.stringify({ version: 1, gatewayNodeId: 'public-fixture', url: 'http://127.0.0.1:1', token: publicBearer, grantId: randomUUID(), expiresAt: new Date(Date.now() + 60000).toISOString() }));
  await assert.rejects(run(process.execPath, [resolve('packages/mcp-server/dist/cli.js'), '--credentials', publicCredential], { timeout: 30000 }), (e: unknown) => {
    const error = e as { stdout?: string; stderr?: string; code?: number; killed?: boolean };
    return error.code === 1 && !error.killed && error.stdout === '' && !String(error.stderr).includes(publicBearer);
  });
  report.results.unsafeMcpReadRejectedBeforeParsing = 'verified';
  report.status = 'passed';
} catch {
  if (report.status !== 'blocked') report.status = 'failed';
  process.exitCode = 1;
} finally {
  try {
    for (const g of gateways.reverse()) await g.stop();
    for (const root of roots.reverse()) rmSync(root, { recursive: true, force: true });
    report.cleanup = 'verified: owned Gateways/ACL leases stopped and disposable fixtures removed';
  } catch { report.cleanup = 'failed'; report.status = 'failed'; process.exitCode = 1; }
  report.endedUtc = new Date().toISOString();
  const json = JSON.stringify(report, null, 2) + '\n';
  if (values.output) writeFileSync(resolve(values.output), json, { flag: 'wx', mode: 0o600 });
  process.stdout.write(json);
}
