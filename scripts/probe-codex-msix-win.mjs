// Static inspection of the installed OpenAI.Codex MSIX package (Windows).
// Reads package installation metadata, the AppxManifest and program file NAMES only.
// Never reads user configuration, credentials or sessions; never launches the GUI.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { manifestProjection } from './msix-manifest-projection.mjs';
import { redactProbeText } from './probe-diagnostics.mjs';

const execFileAsync = promisify(execFile);

const report = { harness: 'codex-windows-msix', platform: process.platform, launchedApp: false, readUserConfiguration: false, findings: {}, capabilityStatus: {} };
let installRoot;

function redact(text) {
  let value = String(text);
  if (installRoot) for (const path of [pathToFileURL(installRoot).href, installRoot, installRoot.replaceAll('\\', '/')]) value = value.replaceAll(JSON.stringify(path).slice(1, -1), '[MSIX_INSTALL_ROOT]').replaceAll(path, '[MSIX_INSTALL_ROOT]');
  return redactProbeText(value, null)
    .replaceAll('C:\\Program Files\\WindowsApps', '[MSIX_PACKAGES_ROOT]')
    .replaceAll('C:/Program Files/WindowsApps', '[MSIX_PACKAGES_ROOT]');
}

async function powershell(script) {
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 60000, windowsHide: true });
  return stdout.trim();
}

try {
  const meta = await powershell("@(Get-AppxPackage -Name OpenAI.Codex) | ConvertTo-Json -Compress -Depth 3");
  const parsed = JSON.parse(meta.startsWith('[') ? meta : `[${meta}]`);
  const pkg = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!pkg) throw new Error('OpenAI.Codex package not returned by Get-AppxPackage');
  installRoot = pkg.InstallLocation;
  report.findings.package = { name: pkg.Name, version: pkg.Version, packageFamilyName: pkg.PackageFamilyName, publisher: pkg.PublisherId, architecture: pkg.Architecture, installLocation: redact(pkg.InstallLocation) };

  try {
    const manifestRaw = await powershell("$pkg = Get-AppxPackage -Name OpenAI.Codex | Select-Object -First 1; $manifest = Get-AppxPackageManifest -Package $pkg; " + manifestProjection);
    const apps = JSON.parse(manifestRaw);
    if (!Array.isArray(apps)) throw new Error('Expected an application array from the manifest projection');
    report.findings.manifestApplications = apps;
    report.findings.manifestProjectionStatus = apps.length && apps.every(app => app.id && app.executable) ? 'verified-statically' : 'incomplete';
  } catch (e) { report.findings.manifestApplications = { error: redact(e.message) }; }

  try {
    const rootDir = pkg.InstallLocation;
    const top = await readdir(rootDir, { withFileTypes: true });
    report.findings.topLevelEntries = top.map(entry => ({ name: entry.name, kind: entry.isDirectory() ? 'directory' : 'file' }));
    const exeNames = [];
    for (const entry of top) {
      if (!entry.isDirectory() && /\.(exe|cmd)$/i.test(entry.name)) exeNames.push(entry.name);
      if (entry.isDirectory() && !/^($|locales|priinfo)/i.test(entry.name)) {
        try {
          for (const child of await readdir(join(rootDir, entry.name), { withFileTypes: true })) {
            if (!child.isDirectory() && /\.(exe|cmd)$/i.test(child.name)) exeNames.push(`${entry.name}/${child.name}`);
          }
        } catch { /* ACL-restricted subdirectory; file names there are not essential */ }
      }
    }
    report.findings.executableNames = exeNames;
    report.findings.cliCandidates = exeNames.filter(name => /codex|cli|server|agent/i.test(name));
    if (exeNames.includes('app/Codex.exe')) {
      const executable = join(rootDir, 'app', 'Codex.exe');
      const digest = createHash('sha256');
      for await (const chunk of createReadStream(executable)) digest.update(chunk);
      report.findings.codexExecutableFile = { relativePath: 'app/Codex.exe', bytes: (await stat(executable)).size, sha256: digest.digest('hex') };
    }
    try {
      const versionScript = `(Get-Item -LiteralPath '${rootDir.replaceAll("'", "''")}\\app\\Codex.exe').VersionInfo | Select-Object ProductName, ProductVersion, FileVersion, FileDescription | ConvertTo-Json -Compress`;
      report.findings.codexExecutableVersion = JSON.parse(await powershell(versionScript));
    } catch (e) { report.findings.codexExecutableVersion = { error: redact(e.message) }; }
  } catch (e) { report.findings.fileListing = { error: redact(e.message), note: 'WindowsApps directory listing may be ACL-restricted for the current user' }; }

  report.conclusion = 'Static package metadata and candidate executable names only; these cannot establish a CLI or app-server contract. Nothing was launched. All control capabilities remain unknown until a supported interface is exercised.';
  for (const capability of ['create', 'resume', 'send', 'stream', 'cancel', 'permissions', 'attachExistingGui'])
    report.capabilityStatus[capability] = 'unknown';
} catch (e) {
  report.error = redact(e.message);
  process.exitCode = 1;
}
console.log(redact(JSON.stringify(report, null, 2)));
