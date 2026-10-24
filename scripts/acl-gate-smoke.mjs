import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
if (dirty && !process.argv.includes('--allow-dirty'))
  throw new Error('Commit probe source before capturing evidence (or use --allow-dirty for development only).');
const root = await mkdtemp(join(tmpdir(), 'LAM acl gate smoke '));
const windows = process.platform === 'win32';
function icacls(args) {
  execFileSync('icacls', args, { windowsHide: true, stdio: 'pipe' });
}
function userAccount() {
  const account = `${process.env.USERDOMAIN ?? ''}\\${process.env.USERNAME ?? ''}`;
  assert.match(account, /^.+\\.+$/);
  return account;
}
async function start(name, { mock = false, unsafe = false, exclusive = false } = {}) {
  const directory = join(root, name);
  await rm(directory, { recursive: true, force: true });
  const { mkdirSync, chmodSync } = await import('node:fs');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (windows && unsafe) icacls([directory, '/grant', '*S-1-1-0:R']);
  if (windows && exclusive)
    icacls([
      directory,
      '/inheritance:r',
      '/grant',
      '*S-1-5-32-544:(OI)(CI)F',
      '/grant',
      `${userAccount()}:(OI)(CI)F`,
    ]);
  if (!windows) chmodSync(directory, unsafe ? 0o754 : 0o700);
  const child = spawn(
    process.execPath,
    ['apps/gateway/dist/index.js', 'serve', '--data', directory, ...(mock ? ['--mock'] : [])],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  );
  let stdout = '',
    stderr = '';
  child.stdout.on('data', (d) => (stdout = (stdout + d).slice(-4000)));
  child.stderr.on('data', (d) => (stderr = (stderr + d).slice(-4000)));
  const report = { directory };
  if (mock || exclusive) {
    const lines = createInterface({ input: child.stdout });
    let timer;
    report.ready = await new Promise((resolveReady, reject) => {
      timer = setTimeout(() => reject(new Error('Gateway readiness timeout')), 20000);
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
    const response = await globalThis.fetch(control.url + '/command', {
      method: 'POST',
      headers: { authorization: `Bearer ${control.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ command: 'shutdown', args: {} }),
      signal: globalThis.AbortSignal.timeout(15000),
    });
    assert.equal(response.status, 200);
  }
  const [code] = await Promise.race([once(child, 'exit'), delay(20000).then(() => {
    child.kill('SIGKILL');
    return once(child, 'exit');
  })]);
  return { ...report, exitCode: code, stdout, stderr, child };
}
const report = {
  kind: 'ACL fail-closed gate smoke on the real host (issue #41)',
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
  const refused = await start('unsafe-plain', { unsafe: true });
  assert.notEqual(refused.exitCode, 0);
  const diagnostic = JSON.parse(refused.stderr.trim().split('\n').pop() ?? '');
  assert.equal(diagnostic.error, 'unsafe_directory');
  assert.ok(diagnostic.message.length > 0);
  const { existsSync } = await import('node:fs');
  assert.equal(existsSync(join(refused.directory, 'identity.key')), false);
  assert.equal(existsSync(join(refused.directory, 'gateway.lock')), false);
  report.results.nonMockRefusedOnUnsafeDirectory = 'verified';
  report.refusalDiagnostic = { error: diagnostic.error, principalsNamed: true };
  const mockRun = await start('unsafe-mock', { mock: true, unsafe: true });
  assert.equal(mockRun.exitCode, 0);
  assert.ok(mockRun.stderr.includes('[security]'));
  assert.ok(!mockRun.stdout.includes('token'));
  assert.ok(mockRun.ready.controlUrl.startsWith('http://127.0.0.1:'));
  report.results.mockContinuesWithWarning = 'verified';
  const exclusive = await start('exclusive-plain', { exclusive: true });
  assert.equal(exclusive.exitCode, 0);
  assert.ok(!exclusive.stdout.includes('token'));
  assert.ok(!exclusive.stderr.includes('[security]'));
  report.results.nonMockAllowedOnExclusiveDirectory = 'verified';
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = String(error).replaceAll(root, '[PROBE_ROOT]');
  throw error;
} finally {
  await delay(300);
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {});
  report.endedUtc = new Date().toISOString();
  const output = process.argv.indexOf('--output');
  if (output !== -1)
    await writeFile(resolve(process.argv[output + 1]), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
