import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { Gateway } from '../packages/runtime/dist/index.js';
const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
if (dirty && !process.argv.includes('--allow-dirty'))
  throw new Error('Commit probe source before evidence capture.');
const directory = await mkdtemp(join(tmpdir(), 'LAM mDNS '));
let a, b;
const report = {
  kind: 'Local two-node mDNS smoke, not a cross-platform result',
  platform: process.platform,
  node: process.version,
  testedSourceSha: dirty
    ? null
    : execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  startedUtc: new Date().toISOString(),
  scope:
    'Temporary listeners advertise identity/endpoints only; no agents exported, no pairing, no model',
};
try {
  a = await new Gateway({
    directory: join(directory, 'A'),
    listen: ['/ip4/0.0.0.0/tcp/0'],
    mdns: true,
    dataDirectoryPolicy: 'warn',
  }).start();
  b = await new Gateway({
    directory: join(directory, 'B'),
    listen: ['/ip4/0.0.0.0/tcp/0'],
    mdns: true,
    dataDirectoryPolicy: 'warn',
  }).start();
  let seen = false;
  for (let i = 0; i < 250; i++) {
    if (
      a.mesh.peers().some((p) => p.peer === b.mesh.id) &&
      b.mesh.peers().some((p) => p.peer === a.mesh.id)
    ) {
      seen = true;
      break;
    }
    await delay(100);
  }
  report.discovery = seen ? 'verified' : 'unknown';
  report.privateAgentsExposed = 0;
  report.status = seen ? 'passed' : 'inconclusive';
  if (!seen)
    report.reason =
      'Multicast delivery not observed within 25 seconds; manual addressing is a separate verified path.';
} finally {
  if (a) await a.stop();
  if (b) await b.stop();
  await rm(directory, { recursive: true, force: true });
  report.endedUtc = new Date().toISOString();
  const at = process.argv.indexOf('--output');
  if (at !== -1)
    await writeFile(resolve(process.argv[at + 1]), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
