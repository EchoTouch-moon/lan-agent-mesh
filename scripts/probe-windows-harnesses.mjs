import { createHash } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

if (process.platform !== 'win32') throw new Error('Run this collector on Windows.');
const here = dirname(fileURLToPath(import.meta.url));
const layoutPath = process.argv[2] ?? join(tmpdir(), 'lam-windows-harness-layout.json');
const outputPath = process.argv[3] ?? join(tmpdir(), 'lam-windows-native-probe.json');
const layout = JSON.parse((await readFile(layoutPath, 'utf8')).replace(/^\uFEFF/, ''));
const report = {
  capturedAtUtc: new Date().toISOString(), platform: process.platform, node: process.version,
  scope: 'Probe-owned temporary sessions only. ZCode uses fixed loopback inference; DSH receives no prompts. No existing GUI attachment or WorkBuddy launch.',
  probes: {},
};
function runProbe(script, extraEnv) {
  const child = spawnSync(process.execPath, [join(here, script)], {
    env: { ...process.env, ...extraEnv }, encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  let result;
  try { result = JSON.parse(child.stdout); }
  catch { result = { status: 'unknown', reason: child.error?.code ?? 'Probe did not return a complete JSON report' }; }
  return { exitCode: child.status, result };
}
try {
  const zcode = layout.installations?.find(item => /^ZCode\b/i.test(item.source));
  if (zcode) {
    const entry = join(zcode.root, 'resources', 'glm', 'zcode.cjs');
    const bytes = await readFile(entry);
    const expected = zcode.files?.find(item => item.relativePath.replaceAll('\\', '/') === 'resources/glm/zcode.cjs');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (!expected || sha256 !== expected.sha256) throw new Error('ZCode entry changed since layout collection; recollect layout before executing.');
    report.probes.zcode = { entrySha256: sha256, ...runProbe('probe-zcode-fixture.mjs', {
      LAM_ZCODE_ENTRY: entry,
      LAM_ZCODE_BUILTIN_CONFIG: join(zcode.root, 'resources', 'config', 'provider', 'zcode-builtin.json'),
    }) };
  } else report.probes.zcode = { status: 'unknown', reason: 'ZCode installation root not found in layout' };
} catch (error) { report.probes.zcode = { status: 'unknown', reason: error.message }; }
try {
  const dsh = layout.cliPackages?.find(item => item.name === '@deepseek-ai/dsh');
  if (dsh) {
    const packageRoot = await realpath(dsh.root);
    const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
    if (manifest.name !== '@deepseek-ai/dsh' || manifest.version !== dsh.version) throw new Error('DSH package changed since layout collection; recollect layout.');
    const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.dsh;
    if (!bin) throw new Error('No dsh JavaScript bin declared by this package');
    const entry = await realpath(resolve(packageRoot, bin));
    const fromPackage = relative(packageRoot, entry);
    if (fromPackage.startsWith('..') || isAbsolute(fromPackage) || !/\.(?:c?js|mjs)$/i.test(entry)) throw new Error('DSH bin is not a JavaScript entry inside its package');
    report.probes.dsh = runProbe('probe-dsh.mjs', { LAM_DSH_ENTRY: entry });
  } else report.probes.dsh = { status: 'unknown', reason: 'DSH npm package not found in layout' };
} catch (error) { report.probes.dsh = { status: 'unknown', reason: error.message }; }
report.probes.workbuddy = { status: 'unknown', reason: 'Installed guest SDK metadata is recorded separately; no supported standalone control contract established. Application was not launched.' };
report.probes.codex = { status: 'unknown', reason: 'No Windows Codex CLI entry established by supplied inventory' };
await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n');
console.log(`Report: ${outputPath}`);
console.log('Return the report even if a capability is unknown or a probe failed.');
