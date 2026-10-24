# TEST ONLY: changes ACLs exclusively on disposable fixtures created by the test.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
$request = [Console]::In.ReadLine() | ConvertFrom-Json
$path = [string]$request.path
if ([IO.Directory]::Exists($path)) { $acl = [IO.Directory]::GetAccessControl($path) } else { $acl = [IO.File]::GetAccessControl($path) }
if ($request.noInheritance) {
  $acl.SetAccessRuleProtection($true, $false)
  $owner = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $acl.SetAccessRule([Security.AccessControl.FileSystemAccessRule]::new($owner, 'FullControl', 'Allow'))
  [IO.Directory]::SetAccessControl($path, $acl)
  return
}
$sid = [Security.Principal.SecurityIdentifier]::new('S-1-1-0')
$rights = [Security.AccessControl.FileSystemRights]::ReadAndExecute
if ($request.write) { $rights = [Security.AccessControl.FileSystemRights]::FullControl }
if ($request.inheritOnly) {
  $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, $rights, 'ContainerInherit,ObjectInherit', 'InheritOnly', 'Allow')
} else {
  $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, $rights, 'Allow')
}
$acl.AddAccessRule($rule)
if ([IO.Directory]::Exists($path)) { [IO.Directory]::SetAccessControl($path, $acl) } else { [IO.File]::SetAccessControl($path, $acl) }
