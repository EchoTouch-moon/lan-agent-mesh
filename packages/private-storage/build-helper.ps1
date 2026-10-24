# Build public, committed native helper source once. No user paths or credentials.
$ErrorActionPreference = 'Stop'
$sourcePath = Join-Path $PSScriptRoot 'src/windows-acl.cs'
$outputPath = Join-Path $PSScriptRoot 'dist/Lam.PrivateStorage.dll'
if (Test-Path -LiteralPath $outputPath) { Remove-Item -LiteralPath $outputPath -Force }
Add-Type -TypeDefinition ([IO.File]::ReadAllText($sourcePath)) -OutputAssembly $outputPath -OutputType Library
