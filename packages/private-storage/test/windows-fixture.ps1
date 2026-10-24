# TEST ONLY: changes ACLs exclusively on disposable fixtures created by the test.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
$request = [Console]::In.ReadLine() | ConvertFrom-Json
$path = [string]$request.path
$acl = Get-Acl -LiteralPath $path
$sid = [Security.Principal.SecurityIdentifier]::new('S-1-1-0')
$rights = [Security.AccessControl.FileSystemRights]::ReadAndExecute
if ($request.write) { $rights = [Security.AccessControl.FileSystemRights]::FullControl }
if ($request.inheritOnly) {
  $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, $rights, 'ContainerInherit,ObjectInherit', 'InheritOnly', 'Allow')
} else {
  $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, $rights, 'Allow')
}
$acl.AddAccessRule($rule)
Set-Acl -LiteralPath $path -AclObject $acl
