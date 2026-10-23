import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

if (process.platform !== 'win32') throw new Error('This launcher check requires Windows.');
const root = await mkdtemp(join(tmpdir(), 'LAM probe fixture & spaces-'));
try {
  const packageRoot = join(root, 'dsh');
  await mkdir(packageRoot);
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.0.0-fixture', bin: { dsh: 'cli.cjs' } }));
  await writeFile(join(packageRoot, 'cli.cjs'), `
if (process.env.HOME !== process.env.USERPROFILE || !process.env.APPDATA.startsWith(process.env.HOME)) process.exit(2);
if (process.argv.includes('--version')) { console.log('0.0.0-fixture'); process.exit(0); }
if (process.argv.slice(2).join(' ') !== '--profile acp') process.exit(3);
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
  const message = JSON.parse(line);
  const results = {
    initialize: {}, 'session/new': {sessionId:'fixture-owned'}, 'session/close': {},
    'session/list': {sessions:[{sessionId:'fixture-owned'}]}, 'session/resume': {}
  };
  if (!(message.method in results)) process.exit(4);
  console.log(JSON.stringify({jsonrpc:'2.0', id:message.id, result:results[message.method]}));
});`);
  const layoutPath = join(root, 'layout.json');
  const reportPath = join(root, 'report.json');
  await writeFile(layoutPath, JSON.stringify({ installations: [], cliPackages: [{ name: '@deepseek-ai/dsh', version: '0.0.0-fixture', root: packageRoot }] }));
  const child = spawnSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'probe-windows-harnesses.mjs'), layoutPath, reportPath], { encoding: 'utf8', timeout: 30000 });
  assert.equal(child.status, 0, child.stderr);
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(report.probes.dsh.exitCode, 0);
  for (const name of ['initialize', 'create', 'resume', 'listInactive']) assert.equal(report.probes.dsh.result.results[name].status, 'verified');
  assert.equal(report.probes.dsh.result.modelRequests, 0);
  assert.equal(report.probes.zcode.status, 'unknown');
  console.log('Windows direct-Node launcher, isolated home, and ACP lifecycle fixture passed.');
} finally { await rm(root, { recursive: true, force: true }); }
