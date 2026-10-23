param([string]$OutputPath = (Join-Path $env:TEMP 'lam-windows-harness-inventory.json'))
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Run this script on Windows.' }
$report = [ordered]@{
  capturedAtUtc = [DateTime]::UtcNow.ToString('o')
  platform = 'win32'
  operatingSystem = [Environment]::OSVersion.VersionString
  architecture = $env:PROCESSOR_ARCHITECTURE
  scope = 'Read-only version and installation inventory. No inference, login, native session control, or GUI launch.'
  cli = @()
  applications = @()
}
foreach ($name in @('codex', 'dsh', 'zcode', 'workbuddy')) {
  $entry = Get-Command -Name ($name + '.cmd'), ($name + '.exe') -ErrorAction SilentlyContinue | Select-Object -First 1
  $item = [ordered]@{ name = $name; foundOnPath = [bool]$entry; path = $null; version = $null; status = 'unknown' }
  if ($entry) {
    $item.path = $entry.Source
    # Only the two documented CLI version flags are invoked. GUI/other launchers remain untouched.
    if ($name -in @('codex', 'dsh')) {
      try {
        $text = (& $entry.Source --version 2>&1 | Out-String).Trim()
        if ($LASTEXITCODE -eq 0) { $item.version = $text; $item.status = 'version_observed' }
        else { $item.error = 'Version command returned non-zero status.' }
      } catch { $item.error = $_.Exception.Message }
    }
  }
  $report.cli += [pscustomobject]$item
}
$registryRoots = @(
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
foreach ($registryRoot in $registryRoots) {
  $matches = Get-ItemProperty $registryRoot -ErrorAction SilentlyContinue | Where-Object {
    $_.DisplayName -match '(?i)(ZCode|WorkBuddy|DeepSeek Harness|Codex)'
  }
  foreach ($app in $matches) {
    $report.applications += [pscustomobject]@{
      name = $app.DisplayName
      version = $app.DisplayVersion
      publisher = $app.Publisher
      installLocation = $app.InstallLocation
    }
  }
}
$report.note = 'Not found on PATH or in these uninstall registry entries does not prove absence or lack of support. Portable installs may not be listed. All control capabilities remain unknown until separately tested.'
$directory = Split-Path ([System.IO.Path]::GetFullPath($OutputPath)) -Parent
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$report | ConvertTo-Json -Depth 8 | Set-Content -Path $OutputPath -Encoding UTF8
Write-Output "Report: $OutputPath"
