# Read-only ACL verification. Only absent directories may be created, with a private DACL
# supplied atomically to CreateDirectoryW. Existing ACLs are never changed.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
try {
[Console]::Out.WriteLine('{"version":1,"phase":"load"}')
[Console]::Out.Flush()
[Reflection.Assembly]::LoadFrom((Join-Path $PSScriptRoot '../dist/Lam.PrivateStorage.dll')) | Out-Null
  [Console]::Out.WriteLine('{"version":1,"phase":"request"}')
  [Console]::Out.Flush()
  $request = [Console]::In.ReadLine() | ConvertFrom-Json
  [Console]::Out.WriteLine('{"version":1,"phase":"check"}')
  [Console]::Out.Flush()
  $lease = [LamPrivateLease]::new([string]$request.directory, [bool]$request.create, [string[]]$request.files)
  try {
    [Console]::Out.WriteLine('{"version":1,"private":true}')
    [Console]::Out.Flush()
    # Pipe EOF releases handles even if Node is killed. No background service.
    $null = [Console]::In.ReadLine()
  } finally { $lease.Dispose() }
} catch {
  # Neither paths, ACLs, configuration contents nor exceptions go to stdout/stderr.
  $reason = 'verification_failed'
  $errorValue = $_.Exception
  while ($null -ne $errorValue) {
    if ($errorValue.Message -in @('unsafe_object','acl_unavailable','unsafe_owner_or_dacl','unsupported_ace','unsafe_allow_ace','cannot_lock_object','directory_create_failed','unsupported_path','invalid_file_name','missing_private_inheritance')) { $reason = $errorValue.Message }
    $errorValue = $errorValue.InnerException
  }
  [Console]::Out.WriteLine('{"version":1,"private":false,"reason":"' + $reason + '"}')
  exit 1
}
