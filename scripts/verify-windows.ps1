param([string]$OutputPath = (Join-Path $env:TEMP 'lam-windows-validation.log'))
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Run this script on Windows.' }
$reportDirectory = Split-Path ([System.IO.Path]::GetFullPath($OutputPath)) -Parent
New-Item -ItemType Directory -Path $reportDirectory -Force | Out-Null
Push-Location (Split-Path $PSScriptRoot -Parent)
Start-Transcript -Path $OutputPath -Force | Out-Null
$validationExitCode = 0
try {
  Write-Output 'LAN Agent Mesh - offline Windows validation'
  Write-Output ('UTC: ' + [DateTime]::UtcNow.ToString('o'))
  Write-Output ('OS: ' + [Environment]::OSVersion.VersionString)
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 22 or 24 is required. Install it and reopen the terminal.' }
  node --version
  if ($LASTEXITCODE -ne 0) { throw 'Node.js version check failed.' }
  if (-not (Get-Command pnpm.cmd -ErrorAction SilentlyContinue)) { throw 'pnpm 10.18.3 is required. Run: npm.cmd install --global pnpm@10.18.3' }
  pnpm.cmd --version
  if ($LASTEXITCODE -ne 0) { throw 'pnpm version check failed.' }
  pnpm.cmd install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { throw 'Install failed.' }
  pnpm.cmd check
  if ($LASTEXITCODE -ne 0) { throw 'Checks failed.' }
  node apps/cli/dist/index.js
  if ($LASTEXITCODE -ne 0) { throw 'Offline demo failed.' }
  Write-Output 'PASS: Windows workspace checks and offline mock demo.'
} catch {
  $validationExitCode = 1
  Write-Output ('FAIL: ' + $_.Exception.Message)
} finally {
  Stop-Transcript | Out-Null
  Pop-Location
}
Write-Output "Report: $OutputPath"
exit $validationExitCode
