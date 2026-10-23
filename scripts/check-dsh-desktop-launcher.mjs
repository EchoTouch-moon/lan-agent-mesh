import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { windowsCmdLauncher } from './windows-cmd-launcher.mjs';

if (process.platform !== 'win32') throw new Error('This launcher check requires Windows.');
assert.throws(() => windowsCmdLauncher('C:\\bad%PATH%\\dsh.cmd', ['--version']));
const root = await mkdtemp(join(tmpdir(), 'LAM desktop & spaced path-'));
try {
  const bin = join(root, 'resources', 'runtime', 'cli', 'bin');
  await mkdir(bin, { recursive: true });
  const host = join(bin, 'fixture.cjs');
  const launcher = join(bin, 'dsh.cmd');
  const pidFile = join(root, 'owned-pid.txt');
  await writeFile(host, `
if (process.env.HOME !== process.env.USERPROFILE || !process.env.APPDATA.startsWith(process.env.HOME)) process.exit(2);
if (process.argv.includes('--version')) { console.log('0.0.0-fixture'); process.exit(0); }
if (process.argv.slice(2).join(' ') !== '--profile acp') process.exit(3);
const mode = process.env.LAM_DSH_TEST_CASE;
if (mode === 'hang') {
  require('node:fs').writeFileSync(process.env.LAM_DSH_TEST_PID_FILE, String(process.pid));
  process.stdin.on('end', () => setInterval(() => {}, 1000));
}
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
  const m = JSON.parse(line); if (m.method === 'initialized') return;
  const results = {
    initialize: {protocolVersion:1,agentInfo:{name:'fixture-acp',version:'0.0.0'}},
    'session/new': mode === 'missing-id' ? {} : {sessionId:'fixture-owned'},
    'session/close': {}, 'session/list': {sessions:[{sessionId:'fixture-owned'}]}, 'session/resume': {}
  };
  if (mode === 'missing-id') process.stderr.write(require('node:url').pathToFileURL(__filename).href + '\\n');
  console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result:results[m.method]}));
});`);
  await writeFile(launcher, `@echo off\r\n"${process.execPath}" "${host}" %*\r\n`);
  for (const mode of ['success', 'missing-id', 'hang']) {
    const child = spawnSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'probe-dsh-desktop.mjs')], {
      env: { ...process.env, LAM_DSH_DESKTOP_CMD: launcher, LAM_DSH_TEST_CASE: mode, LAM_DSH_TEST_PID_FILE: pidFile },
      encoding: 'utf8', timeout: 30000,
    });
    const report = JSON.parse(child.stdout);
    assert.equal(child.status, mode === 'missing-id' ? 1 : 0, child.stderr);
    assert.equal(report.version, '0.0.0-fixture');
    if (mode === 'missing-id') {
      assert.equal(report.results.create.status, 'unknown');
      assert.equal(report.results.resume.status, 'unknown');
      assert.match(report.diagnostics.stderrTail, /DSH_DESKTOP_INSTALL_ROOT/);
      assert.ok(!report.diagnostics.stderrTail.includes(root));
    } else {
      for (const name of ['initialize', 'create', 'close', 'listInactive', 'resume']) assert.equal(report.results[name].status, 'verified');
    }
    if (mode === 'hang') {
      const pid = Number(await readFile(pidFile, 'utf8'));
      assert.throws(() => process.kill(pid, 0), 'Probe-owned host process survived cmd wrapper cleanup');
    }
  }
  console.log('DSH cmd launcher: spaced path, literal ampersand, isolated home, missing-ID refusal, redaction and owned-process cleanup passed.');
} finally { await rm(root, { recursive: true, force: true }); }
