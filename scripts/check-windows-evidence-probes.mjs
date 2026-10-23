import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deniedWriteResult, permissionWriteCommand } from './dsh-desktop-fixture-contract.mjs';
import { manifestProjection } from './msix-manifest-projection.mjs';

const valid = { markerCreated: false, commandControlVerified: true, nativeRejection: true, initialSandboxDenialObserved: true };
assert.equal(deniedWriteResult(valid).status, 'verified');
assert.equal(deniedWriteResult({ ...valid, markerCreated: true }).status, 'failed');
for (const key of ['nativeRejection', 'commandControlVerified', 'initialSandboxDenialObserved']) assert.equal(deniedWriteResult({ ...valid, [key]: false }).status, 'unknown');
assert.equal(deniedWriteResult({ markerCreated: false }).status, 'unknown', 'An absent marker alone must not prove denial');

if (process.platform === 'win32') {
  const root = await mkdtemp(join(tmpdir(), 'LAM evidence & spaces-'));
  try {
    const marker = join(root, "marker ' & space.txt");
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', permissionWriteCommand(marker)], { encoding: 'utf8', cwd: root, timeout: 15000, windowsHide: true });
    assert.equal((await readFile(marker, 'utf8')).trim(), 'fixture');
  } finally { await rm(root, { recursive: true, force: true }); }
  function project(xml) {
    return JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[xml]$manifest = $env:LAM_TEST_MANIFEST_XML; ' + manifestProjection], {
      env: { ...process.env, LAM_TEST_MANIFEST_XML: xml }, encoding: 'utf8', timeout: 15000, windowsHide: true,
    }).trim());
  }
  const apps = project(`<Package xmlns="urn:foundation" xmlns:uap5="urn:extension"><Applications>
    <Application Id="Desktop" Executable="app\\ChatGPT.exe" EntryPoint="Windows.FullTrustApplication"/>
    <Application Id="Agent" Executable="app\\Codex.exe"><Extensions>
      <uap5:Extension Category="windows.appExecutionAlias" Executable="app\\resources\\codex.exe"><uap5:AppExecutionAlias><uap5:ExecutionAlias Alias="codex.exe"/></uap5:AppExecutionAlias></uap5:Extension>
    </Extensions></Application></Applications></Package>`);
  assert.equal(apps.length, 2);
  assert.equal(apps[0].id, 'Desktop');
  assert.equal(apps[0].executable, 'app\\ChatGPT.exe');
  assert.equal(apps[0].entryPoint, 'Windows.FullTrustApplication');
  assert.equal(apps[1].executable, 'app\\Codex.exe');
  assert.deepEqual(apps[1].extensions[0].aliases, ['codex.exe']);
  assert.equal(apps[1].extensions[0].executable, 'app\\resources\\codex.exe');
  assert.equal(project('<Package><Applications><Application Id="Only" Executable="only.exe"/></Applications></Package>').length, 1);
  assert.deepEqual(project('<Package><Applications/></Package>'), []);
  console.log('Native PowerShell write control and namespace-aware MSIX projection passed.');
}
console.log('Denied-write evidence requires a valid command, native rejection, sandbox denial and absent marker.');
