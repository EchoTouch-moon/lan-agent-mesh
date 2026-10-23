param(
  [string]$OutputPath = (Join-Path $env:TEMP 'lam-windows-harness-layout.json'),
  [string[]]$ApplicationRoot = @()
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Run this script on Windows.' }

# Inspect installation files only. Never execute registry commands, CLI shims,
# application binaries or scripts, and never inspect user configuration/history.
$roots = @{}
function Add-InstallRoot([string]$Path, [string]$Source) {
  if ($Path -and (Test-Path -LiteralPath $Path -PathType Container)) {
    $fullPath = [System.IO.Path]::GetFullPath($Path)
    if (-not $roots.ContainsKey($fullPath)) { $roots[$fullPath] = $Source }
  }
}
function Get-ExecutablePath([string]$Value) {
  if ($Value -match '^\s*"([^"]+\.exe)"') { return $Matches[1] }
  if ($Value -match '^\s*(.+?\.exe)(?:\s|,|$)') { return $Matches[1] }
  return $null
}
foreach ($path in $ApplicationRoot) { Add-InstallRoot $path 'explicit application root' }
$registryRoots = @(
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
foreach ($registryRoot in $registryRoots) {
  $apps = Get-ItemProperty $registryRoot -ErrorAction SilentlyContinue | Where-Object {
    $_.DisplayName -match '(?i)(ZCode|WorkBuddy|DeepSeek Harness|Codex)'
  }
  foreach ($app in $apps) {
    Add-InstallRoot $app.InstallLocation $app.DisplayName
    foreach ($value in @($app.DisplayIcon, $app.UninstallString)) {
      $exe = Get-ExecutablePath $value
      if ($exe) { Add-InstallRoot (Split-Path $exe -Parent) $app.DisplayName }
    }
  }
}
$cliRoots = @{}
foreach ($name in @('codex', 'dsh', 'zcode', 'workbuddy')) {
  $entry = Get-Command -Name ($name + '.cmd'), ($name + '.exe') -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($entry) { $cliRoots[(Split-Path $entry.Source -Parent)] = $true }
}
$report = [ordered]@{
  capturedAtUtc = [DateTime]::UtcNow.ToString('o')
  scope = 'Static installation layout only. No CLI/GUI launch, inference, login, configuration or session access.'
  installations = @()
  cliPackages = @()
}
foreach ($root in ($roots.Keys | Sort-Object)) {
  $item = [ordered]@{ root = $root; source = $roots[$root]; files = @(); resourceEntries = @() }
  # A bounded, shallow inventory; do not recurse into app data or arbitrary drives.
  foreach ($relative in @('', 'resources', 'resources\glm', 'resources\wb-guest-sdk')) {
    $directory = if ($relative) { Join-Path $root $relative } else { $root }
    if (Test-Path -LiteralPath $directory -PathType Container) {
      $children = @(Get-ChildItem -LiteralPath $directory -Force -ErrorAction SilentlyContinue | Sort-Object Name | Select-Object -First 120)
      foreach ($child in $children) {
        $item.resourceEntries += [pscustomobject]@{
          relativePath = if ($relative) { Join-Path $relative $child.Name } else { $child.Name }
          kind = if ($child.PSIsContainer) { 'directory' } else { 'file' }
        }
      }
    }
  }
  foreach ($relative in @('resources\glm\zcode.cjs', 'resources\wb-guest-sdk\wb.js', 'resources\app\package.json')) {
    $path = Join-Path $root $relative
    if (Test-Path -LiteralPath $path -PathType Leaf) {
      $file = Get-Item -LiteralPath $path
      $item.files += [pscustomobject]@{
        relativePath = $relative
        bytes = $file.Length
        sha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
      }
    }
  }
  $report.installations += [pscustomobject]$item
}
foreach ($root in ($cliRoots.Keys | Sort-Object)) {
  $scope = Join-Path $root 'node_modules\@deepseek-ai'
  if (-not (Test-Path -LiteralPath $scope -PathType Container)) { continue }
  foreach ($directory in (Get-ChildItem -LiteralPath $scope -Directory -ErrorAction SilentlyContinue | Select-Object -First 30)) {
    $manifest = Join-Path $directory.FullName 'package.json'
    if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) { continue }
    try {
      $package = Get-Content -LiteralPath $manifest -Raw -Encoding UTF8 | ConvertFrom-Json
      $report.cliPackages += [pscustomobject]@{
        name = $package.name
        version = $package.version
        root = $directory.FullName
        hasReadme = Test-Path -LiteralPath (Join-Path $directory.FullName 'README.md') -PathType Leaf
      }
    } catch {
      $report.cliPackages += [pscustomobject]@{ root = $directory.FullName; status = 'manifest_unreadable' }
    }
  }
}
$report.note = 'Missing entries do not prove absence. Paths may contain identifying information; review before sharing. File presence does not verify a control interface.'
$outputDirectory = Split-Path ([System.IO.Path]::GetFullPath($OutputPath)) -Parent
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $OutputPath -Encoding UTF8
Write-Output "Report: $OutputPath"
