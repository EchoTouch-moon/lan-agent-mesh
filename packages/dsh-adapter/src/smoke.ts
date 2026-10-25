import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { privateDirectory } from '@lam/private-storage';
import { runDshAcceptance } from './acceptance.js';
import { DshAdapterCore } from './core.js';
import { DshAcpClient } from './client.js';
import { fixtureEnvironment, openDshAdapter } from './native.js';

const SDK_SOURCE = '354d840a0288ba04d569ce7d45391ebe0d7ef5be';
const ACK_SOURCE = '491d8f4a8604fe3f88b2eb40f9f8e41bdc51d55c';
const sha = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const inside = (parent: string, child: string) => { const r = relative(parent, child); return r === '' || (!isAbsolute(r) && r !== '..' && !r.startsWith(`..${sep}`)); };
const controller = new AbortController();
const stop = () => controller.abort();
process.on('SIGINT', stop); process.on('SIGTERM', stop);
let output: string | undefined, autoParent: string | undefined;
let preflightStage = 'arguments';
let payload: Record<string, unknown> = { status: 'blocked-preflight', physicalCrossHost: 'not-run' };
try {
  const { values } = parseArgs({ options: { 'self-test': { type: 'boolean' }, parent: { type: 'string' }, launcher: { type: 'string' },
    'launcher-sha256': { type: 'string' }, 'expected-source': { type: 'string' }, output: { type: 'string' } } });
  const synthetic = values['self-test'] === true;
  if (!values.output || !isAbsolute(values.output)) throw new Error();
  const destination = join(realpathSync(dirname(values.output)), basename(values.output));
  if (existsSync(destination)) throw new Error();
  preflightStage = 'source';
  const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 }).replace(/\r?\n$/, '');
  // Strip newline only: a repository's real directory name may end in a space.
  const repository = realpathSync(git('rev-parse', '--show-toplevel'));
  if (repository !== realpathSync(process.cwd()) || inside(repository, destination)) throw new Error();
  output = destination;
  const source = git('rev-parse', 'HEAD');
  if (!/^[a-f0-9]{40}$/.test(values['expected-source'] ?? '') || values['expected-source'] !== source || git('status', '--porcelain', '--untracked-files=all')) throw new Error();
  git('merge-base', '--is-ancestor', SDK_SOURCE, source); git('merge-base', '--is-ancestor', ACK_SOURCE, source);
  if (values.parent && !isAbsolute(values.parent)) throw new Error();
  if (synthetic && (values.launcher || values['launcher-sha256'])) throw new Error();
  if (!synthetic && (process.platform !== 'win32' || !values.parent || !values.launcher || !values['launcher-sha256'])) throw new Error();
  if (!synthetic && !/^[a-f0-9]{64}$/.test(values['launcher-sha256'] ?? '')) throw new Error();
  preflightStage = 'build-artifacts';
  const sourceFiles = git('ls-files', 'packages', 'scripts', 'pnpm-lock.yaml', 'package.json').split(/\r?\n/).filter(Boolean);
  const sourceHashes = Object.fromEntries(sourceFiles.map(file => [file, sha(readFileSync(join(repository, file)))]));
  const artifacts: Record<string, string> = {};
  for (const name of ['dsh-adapter', 'runtime', 'mesh', 'storage', 'adapter-sdk', 'domain', 'protocol', 'private-storage', 'mcp-contract', 'mcp-server', 'mock-adapter']) {
    const walk = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isSymbolicLink()) throw new Error();
        if (entry.isDirectory()) walk(path);
        else if (entry.isFile() && /\.(js|mjs|dll)$/.test(entry.name)) artifacts[relative(repository, path).split(sep).join('/')] = sha(readFileSync(path));
      }
    };
    walk(join(repository, 'packages', name, 'dist'));
  }
  payload = { testedSourceSha: source, sourceClean: true, evidenceKind: synthetic ? 'synthetic' : 'windows-native-local',
    requiredAncestors: { sdk: SDK_SOURCE, ack: ACK_SOURCE }, sourceFilesSha256: sourceHashes, builtArtifactsSha256: artifacts };
  preflightStage = 'private-parent';
  const parent = values.parent ? resolve(values.parent) : join(tmpdir(), `lam-dsh-selftest-parent-${randomUUID()}`);
  if (!values.parent) { if (existsSync(parent)) throw new Error(); autoParent = parent; }
  if (inside(repository, parent) || inside(parent, repository)) throw new Error();
  const parentLease = await privateDirectory(parent, { create: synthetic && !values.parent }); await parentLease.close();
  const canonicalParent = realpathSync(parent), name = `lam-dsh-acceptance-${new Date().toISOString().replace(/[^0-9TZ]/g, '')}-${randomUUID().slice(0, 8)}`;
  const root = join(canonicalParent, name);
  if (inside(root, output)) throw new Error();
  const peer = fileURLToPath(new URL('../../../scripts/fixtures/dsh-acceptance-agent.mjs', import.meta.url));
  payload = { ...payload, ownedDirectoryName: name,
    ...(autoParent ? { syntheticParentName: basename(autoParent) } : {}),
    ...(synthetic ? { syntheticPeerSha256: sha(readFileSync(peer)) } : { launcherSha256: values['launcher-sha256'], expectedDesktopVersion: '0.2.1-rc.2' }) };
  preflightStage = 'complete';
  const report = await runDshAcceptance({ root, kind: synthetic ? 'synthetic' : 'windows-native-local', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12 * 60 * 1000)]),
    openAdapter: ({ nodeId, home, workspaces, baseUrl }) => synthetic ? DshAdapterCore.open({ nodeId, home, workspaces,
      registration: JSON.stringify(['synthetic-acceptance', sha(readFileSync(peer)), baseUrl]) }, context => DshAcpClient.open({
        command: process.execPath, args: [peer], cwd: context.nativeHome, env: fixtureEnvironment(context.nativeHome, baseUrl), timeoutMs: 15000,
        onText: context.onText, onLost: context.onLost })) : openDshAdapter({ nodeId, home, workspaces,
          fixtureBaseUrl: baseUrl, launcher: values.launcher!, launcherSha256: values['launcher-sha256']!, expectedVersion: '0.2.1-rc.2' }) });
  payload = { ...payload, ...report };
  if (report.status !== (synthetic ? 'passed-synthetic' : 'passed-windows-native-local')) process.exitCode = 1;
  if (autoParent && report.cleanup.complete) { rmSync(autoParent, { recursive: true }); autoParent = undefined; }
} catch { payload = { ...payload, status: 'blocked-or-failed', preflightStage, error: 'Source, build, private storage, arguments or runner rejected; inspect prerequisites without weakening them' }; process.exitCode = 1; }
finally {
  try { if (autoParent && existsSync(autoParent) && readdirSync(autoParent).length === 0) rmSync(autoParent); }
  catch { payload = { ...payload, status: 'failed', automaticParentCleanup: 'uncertain' }; process.exitCode = 1; }
  if (output) {
    try {
      const data = JSON.stringify(payload, null, 2) + '\n'; writeFileSync(output, data, { flag: 'wx', mode: 0o600 });
      process.stdout.write(JSON.stringify({ status: payload.status, reportSha256: sha(data) }) + '\n');
    } catch { process.stderr.write('DSH acceptance report was not written; choose a new absolute output outside the repository.\n'); process.exitCode = 1; }
  } else { process.stderr.write('DSH acceptance requires a new absolute output and a reviewed full source SHA.\n'); process.exitCode = 1; }
  process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
}
