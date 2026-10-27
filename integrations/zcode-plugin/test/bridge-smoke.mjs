#!/usr/bin/env node
// ZPL-1 bridge smoke: local fixture gateways -> real scoped credential -> plugin bridge -> MCP client.
// Loopback only; no real models, no LAN, no user config. Negative paths fail-closed before spawn.
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

// Resolve workspace packages explicitly: this directory is not itself a workspace package.
const requireFromMcpServer = createRequire(resolve('packages/mcp-server/package.json'));
const { Client } = requireFromMcpServer('@modelcontextprotocol/client');
const { StdioClientTransport } = requireFromMcpServer('@modelcontextprotocol/client/stdio');
const { Gateway } = await import(pathToFileURL(resolve('packages/runtime/dist/index.js')));
const { privateDirectory } = await import(pathToFileURL(resolve('packages/private-storage/dist/index.js')));

const pluginRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const bridge = join(pluginRoot, 'bridge', 'mesh-bridge.mjs');
const pins = JSON.parse(readFileSync(join(pluginRoot, 'digests.json'), 'utf8'));
const report = {
  kind: 'zcode-plugin bridge smoke (loopback fixture gateways, real scoped credential)',
  testedSourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: pluginRoot }).trim(),
  platform: process.platform,
  node: process.version,
  startedUtc: new Date().toISOString(),
  results: {},
  externalModels: 0,
  cleanup: 'pending',
};
const roots = [];
const gateways = [];
let failed = 0;
const check = (name, ok, detail = '') => {
  report.results[name] = ok ? 'PASS' : `FAIL ${detail}`.trim();
  if (!ok) failed++;
};
try {
  const parent = process.env.LAM_SMOKE_PARENT ?? tmpdir();
  const root = join(parent, `LAM zpl1 bridge & ${randomUUID()}`);
  roots.push(root);
  const lease = await privateDirectory(root, { create: true });
  await lease.close();

  const caller = await new Gateway({ directory: join(root, 'caller') }).start();
  gateways.push(caller);
  const executor = await new Gateway({ directory: join(root, 'executor'), mock: true }).start();
  gateways.push(executor);
  const pair = await caller.mesh.beginPairing(executor.mesh.addresses[0]);
  await caller.mesh.confirmPairing(pair.id, pair.code);
  await executor.mesh.confirmPairing(pair.id, pair.code);
  const registry = await caller.sync(executor.mesh.id);
  const scopeFile = join(root, 'scope.json');
  writeFileSync(scopeFile, JSON.stringify({ peers: [executor.mesh.id], agents: [registry.agents[0].id], workspaces: ['project-a'] }), { mode: 0o600 });
  const credentialFile = join(root, 'credential.json');
  try {
    // The gateway's loopback control server lives in this process; keep the event loop free (async exec), or the grant request deadlocks.
    await run(process.execPath, [resolve('apps/gateway/dist/index.js'), 'control', '--data', caller.options.directory, '--command', 'mcp-grant', '--args-file', scopeFile, '--output', credentialFile]);
  } catch (error) {
    failed++;
    report.failure = `mcp-grant: ${String(error.stderr ?? error.message).slice(0, 400)}`;
    throw new Error('grant_failed');
  }
  check('credential-issued-via-operator-cli', true);

  const connect = (args) => {
    const transport = new StdioClientTransport({ command: process.execPath, args, stderr: 'pipe' });
    const client = new Client({ name: 'zpl1-bridge-smoke', version: '0.1.0' });
    return { transport, client };
  };

  // Negative: missing lam root fails closed without spawning the MCP server.
  {
    const { transport, client } = connect([bridge, '--lam-root', join(root, 'no-such-lam'), '--credentials', credentialFile]);
    let stderr = '';
    transport.stderr?.on('data', (b) => { stderr += String(b); });
    try { await client.connect(transport); check('missing-lam-root-fails-closed', false, 'connect unexpectedly succeeded'); await client.close(); }
    catch { check('missing-lam-root-fails-closed', /LAM MCP server not built|missing/.test(stderr), stderr.trim().split('\n')[0]); }
  }

  // Negative: tampered digest refuses to run the real CLI.
  {
    const tamperedRoot = join(root, 'plugin-copy');
    cpSync(pluginRoot, tamperedRoot, { recursive: true });
    const badPins = join(tamperedRoot, 'digests.json');
    writeFileSync(badPins, JSON.stringify({ ...pins, mcpCliSha256: '0'.repeat(64) }));
    const { transport, client } = connect([join(tamperedRoot, 'bridge', 'mesh-bridge.mjs'), '--lam-root', resolve('.'), '--credentials', credentialFile]);
    let stderr = '';
    transport.stderr?.on('data', (b) => { stderr += String(b); });
    try { await client.connect(transport); check('digest-mismatch-fails-closed', false, 'connect unexpectedly succeeded'); await client.close(); }
    catch { check('digest-mismatch-fails-closed', /digest mismatch/.test(stderr), stderr.trim().split('\n')[0]); }
  }

  // Positive: the plugin bridge serves the seven mesh_* tools over the real credential.
  {
    const { transport, client } = connect([bridge, '--lam-root', resolve('.'), '--credentials', credentialFile]);
    try {
      await client.connect(transport);
      const tools = (await client.listTools()).tools.map((t) => t.name).sort();
      check('bridge-serves-seven-mesh-tools', tools.length === 7 && tools.every((n) => n.startsWith('mesh_')), tools.join(','));
      const listed = await client.callTool({ name: 'mesh_list_agents', arguments: {} });
      check('mesh-list-agents-over-bridge', !listed.isError && JSON.stringify(listed.content).includes(registry.agents[0].id), JSON.stringify(listed.content).slice(0, 120));
      await client.close();
    } catch (error) {
      check('bridge-serves-seven-mesh-tools', false, String(error).slice(0, 160));
    }
  }

  report.cleanup = 'complete';
} catch (error) {
  failed++;
  report.cleanup = 'partial';
  report.failure = report.failure ?? String(error).slice(0, 300);
} finally {
  for (const g of gateways.splice(0)) await g.stop();
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
report.endedUtc = new Date().toISOString();
report.status = failed === 0 ? 'passed' : 'failed';
console.log(JSON.stringify(report, null, 2));
process.exit(failed === 0 ? 0 : 1);
