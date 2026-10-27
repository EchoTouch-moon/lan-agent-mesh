#!/usr/bin/env node
// Thin stdio wrapper: verifies the pinned LAM MCP server digest, then execs it.
// Fail-closed: any missing/mismatched input exits 1 without spawning anything.
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fail = (reason) => {
  process.stderr.write(`lam-mesh bridge: ${reason}\n`);
  process.exit(1);
};

function arg(name) {
  const i = process.argv.indexOf(name);
  if (i === -1 || i + 1 >= process.argv.length) fail(`missing ${name}`);
  return process.argv[i + 1];
}
const lamRoot = arg('--lam-root');
const credentials = arg('--credentials');
if (!isAbsolute(lamRoot)) fail('--lam-root must be absolute');
if (!isAbsolute(credentials)) fail('--credentials must be absolute');

const cli = join(lamRoot, 'packages', 'mcp-server', 'dist', 'cli.js');
if (!existsSync(cli) || !statSync(cli).isFile()) fail(`LAM MCP server not built: ${cli} is missing (run pnpm build in the LAM checkout)`);
if (!existsSync(credentials) || !statSync(credentials).isFile()) fail('credential file not found');

let pins;
try {
  pins = JSON.parse(readFileSync(join(pluginRoot, 'digests.json'), 'utf8'));
} catch {
  fail('digests.json unreadable; the plugin install is corrupt');
}
const actual = await new Promise((accept, reject) => {
  const hash = createHash('sha256');
  createReadStream(cli).on('data', (c) => hash.update(c)).on('error', reject).on('end', () => accept(hash.digest('hex')));
}).catch(() => fail(`cannot hash ${cli}`));
if (actual !== pins.mcpCliSha256)
  fail(`LAM MCP server digest mismatch: expected ${pins.mcpCliSha256} (testedSourceSha ${pins.testedSourceSha}), found ${actual}. Update the LAM checkout or the plugin together.`);

const child = spawn(process.execPath, [cli, '--credentials', credentials], { stdio: ['pipe', 'pipe', 'inherit'] });
// The bridge supervises exactly one child it spawned itself; nothing else is ever signalled.
let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stdin.unpipe(child.stdin);
  child.stdout.unpipe(process.stdout);
  if (!child.stdin.destroyed) child.stdin.end();
  // Grace period for the child's own SIGINT/SIGTERM handling, then force-terminate our child only.
  const guard = setTimeout(() => child.kill('SIGKILL'), 2000);
  child.once('exit', () => clearTimeout(guard));
};
const ignorePipeError = (error) => { if (error?.code !== 'EPIPE') throw error; };
process.stdin.on('error', ignorePipeError);
process.stdout.on('error', ignorePipeError);
child.stdin.on('error', ignorePipeError);
child.stdout.on('error', ignorePipeError);
// Host closed stdin (or died): forward EOF to the MCP server instead of leaving it parented to a dead wrapper.
process.stdin.on('end', shutdown);
process.stdin.on('close', shutdown);
process.stdin.pipe(child.stdin);
child.stdout.pipe(process.stdout);
process.once('SIGINT', () => { child.kill('SIGINT'); shutdown(); });
process.once('SIGTERM', () => { child.kill('SIGTERM'); shutdown(); });
child.on('exit', (code) => {
  shutdown();
  process.exitCode = code ?? 1;
});
child.on('error', (error) => {
  shutdown();
  fail(`failed to start the LAM MCP server: ${error.code ?? error.message}`);
});
