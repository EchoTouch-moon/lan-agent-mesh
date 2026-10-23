// Static inspection of the installed OpenAI.Codex MSIX package (Windows).
// Reads package installation metadata, the AppxManifest and program file NAMES only.
// Never reads user configuration, credentials or sessions; never launches the GUI.
import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const report = { harness: 'codex-windows-msix', platform: process.platform, launchedApp: false, readUserConfiguration: false, findings: {}, capabilityStatus: {} };

function redact(text) {
  return String(text)
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
  report.findings.package = { name: pkg.Name, version: pkg.Version, packageFamilyName: pkg.PackageFamilyName, publisher: pkg.PublisherId, architecture: pkg.Architecture, installLocation: redact(pkg.InstallLocation) };

  try {
    const manifestRaw = await powershell("(Get-AppxPackageManifest -Package (Get-AppxPackage -Name OpenAI.Codex)).Package.Applications.Application | ConvertTo-Json -Compress -Depth 5");
    const apps = JSON.parse(manifestRaw.startsWith('[') ? manifestRaw : `[${manifestRaw}]`);
    report.findings.manifestApplications = apps.map(app => ({
      id: app.Id, executable: app.Executable,
      entryPoint: app.EntryPoint ?? null,
      aliases: (app.AppExtensions?.Extension ?? []).map(ext => ({ categoryId: ext.Category, executable: ext.Executable ?? null, name: ext.Name ?? null })),
    }));
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
  } catch (e) { report.findings.fileListing = { error: redact(e.message), note: 'WindowsApps directory listing may be ACL-restricted for the current user' }; }

  report.conclusion = 'Static package metadata only. Whether this MSIX exposes a standalone Codex CLI or app-server stdio entry is determined by the manifest applications/extensions and executable names recorded above; nothing was launched. All control capabilities remain unknown until a supported interface is exercised.';
  for (const capability of ['create', 'resume', 'send', 'stream', 'cancel', 'permissions', 'attachExistingGui'])
    report.capabilityStatus[capability] = 'unknown';
} catch (e) {
  report.error = redact(e.message);
  process.exitCode = 1;
}
console.log(JSON.stringify(report, null, 2));
