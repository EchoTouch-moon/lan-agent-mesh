# Read-only ACL verification. Only absent directories may be created, with a private DACL
# supplied atomically to CreateDirectoryW. Existing ACLs are never changed.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
try {
[Console]::Out.WriteLine('{"version":1,"phase":"compile"}')
[Console]::Out.Flush()
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;

public sealed class LamPrivateLease : IDisposable {
  [StructLayout(LayoutKind.Sequential)] struct SA { public int length; public IntPtr descriptor; public int inherit; }
  [StructLayout(LayoutKind.Sequential)] struct Info {
    public uint attributes; public System.Runtime.InteropServices.ComTypes.FILETIME creation, access, write;
    public uint volume, sizeHigh, sizeLow, links, indexHigh, indexLow;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern SafeFileHandle CreateFileW(string path, uint access, uint share, IntPtr sa, uint disposition, uint flags, IntPtr template);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool CreateDirectoryW(string path, ref SA sa);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern uint GetDriveTypeW(string root);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle h, out Info info);
  [DllImport("advapi32.dll")] static extern uint GetSecurityInfo(SafeFileHandle handle, int type, uint flags, out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
  [DllImport("advapi32.dll")] static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr memory);
  readonly List<SafeFileHandle> handles = new List<SafeFileHandle>();
  readonly string user = WindowsIdentity.GetCurrent().User.Value;
  const string admins = "S-1-5-32-544", system = "S-1-5-18";
  const string installer = "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464";
  bool Trusted(string sid, bool ancestor) { return sid == user || sid == admins || sid == system || (ancestor && sid == installer); }
  void Verify(SafeFileHandle handle, bool ancestor, bool directory) {
    Info info;
    if (!GetFileInformationByHandle(handle, out info) || (info.attributes & 0x400) != 0 || ((info.attributes & 0x10) != 0) != directory || (!directory && info.links != 1)) throw new Exception("unsafe_object");
    IntPtr owner, group, dacl, sacl, sd;
    if (GetSecurityInfo(handle, 1, 5, out owner, out group, out dacl, out sacl, out sd) != 0) throw new Exception("acl_unavailable");
    try {
      var bytes = new byte[GetSecurityDescriptorLength(sd)]; Marshal.Copy(sd, bytes, 0, bytes.Length);
      var acl = new RawSecurityDescriptor(bytes, 0);
      if (acl.Owner == null || !Trusted(acl.Owner.Value, ancestor) || acl.DiscretionaryAcl == null || acl.DiscretionaryAcl.Count == 0) throw new Exception("unsafe_owner_or_dacl");
      foreach (GenericAce generic in acl.DiscretionaryAcl) {
        var ace = generic as CommonAce;
        if (ace == null || ace.IsCallback || (ace.AceQualifier != AceQualifier.AccessAllowed && ace.AceQualifier != AceQualifier.AccessDenied)) throw new Exception("unsupported_ace");
        if (ace.AceQualifier == AceQualifier.AccessDenied) continue;
        if (ancestor && (ace.AceFlags & AceFlags.InheritOnly) != 0) continue;
        // Conservative: do not try to cancel broad allow ACEs with group deny ACEs.
        // Parent namespaces must not be removable/reowned/repermissioned by others.
        uint mask = unchecked((uint)ace.AccessMask);
        uint dangerous = 0x10000000u | 0x40000000u | 0x00010000u | 0x00040000u | 0x00080000u | 0x40u | 0x100u | 0x10u;
        if (!Trusted(ace.SecurityIdentifier.Value, ancestor) && (!ancestor || (mask & dangerous) != 0)) throw new Exception("unsafe_allow_ace");
      }
    } finally { LocalFree(sd); }
  }
  SafeFileHandle Open(string path, bool ancestor, bool directory) {
    // Share READ/WRITE but never DELETE. Existing delete handles also make this fail.
    // Retain directory handles until the owning Node process releases this lease.
    // Include READ_DATA/LIST_DIRECTORY: metadata-only opens do not enforce share access.
    var h = CreateFileW(path, 0x20081, 3, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero);
    if (h.IsInvalid) { h.Dispose(); throw new Exception("cannot_lock_object"); }
    try { Verify(h, ancestor, directory); return h; } catch { h.Dispose(); throw; }
  }
  void CreatePrivate(string path) {
    var sd = new RawSecurityDescriptor("O:" + user + "G:" + user + "D:P(A;OICI;FA;;;" + user + ")(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)");
    var bytes = new byte[sd.BinaryLength]; sd.GetBinaryForm(bytes, 0);
    IntPtr ptr = Marshal.AllocHGlobal(bytes.Length);
    try {
      Marshal.Copy(bytes, 0, ptr, bytes.Length);
      var sa = new SA { length = Marshal.SizeOf(typeof(SA)), descriptor = ptr, inherit = 0 };
      if (!CreateDirectoryW(path, ref sa)) throw new Exception("directory_create_failed");
    } finally { Marshal.FreeHGlobal(ptr); }
  }
  public LamPrivateLease(string directory, bool create, string[] files) {
    try {
      string full = Path.GetFullPath(directory), root = Path.GetPathRoot(full);
      // No UNC, devices, ADS, relative paths or alternate namespaces.
      if (full.TrimEnd('\\').Length <= 2 || full.Length > 240 || root.Length != 3 || root[1] != ':' || !Char.IsLetter(root[0]) || full.IndexOf(':', 2) >= 0 || full.IndexOf('/') >= 0) throw new Exception("unsupported_path");
      if (GetDriveTypeW(root) != 3) throw new Exception("unsupported_path");
      foreach (string component in full.Substring(root.Length).Split('\\')) if (component.EndsWith(".") || component.EndsWith(" ")) throw new Exception("unsupported_path");
      var paths = new List<string>(); string next = full.TrimEnd('\\');
      while (next.Length > root.Length) { paths.Insert(0, next); next = Path.GetDirectoryName(next); }
      paths.Insert(0, root);
      for (int i = 0; i < paths.Count; i++) {
        bool final = i == paths.Count - 1;
        if (!Directory.Exists(paths[i]) && create && i > 0) CreatePrivate(paths[i]);
        handles.Add(Open(paths[i], !final, true));
      }
      foreach (string name in files ?? new string[0]) {
        if (Path.GetFileName(name) != name || name.IndexOf(':') >= 0) throw new Exception("invalid_file_name");
        string file = Path.Combine(full, name);
        // File.Exists follows links and can hide dangling links: enumerate by name instead.
        if (Directory.GetFileSystemEntries(full, name).Length != 0) using (var h = Open(file, false, false)) { }
      }
    } catch { Dispose(); throw; }
  }
  public void Dispose() { for (int i = handles.Count - 1; i >= 0; i--) handles[i].Dispose(); handles.Clear(); }
}
'@
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
    if ($errorValue.Message -in @('unsafe_object','acl_unavailable','unsafe_owner_or_dacl','unsupported_ace','unsafe_allow_ace','cannot_lock_object','directory_create_failed','unsupported_path','invalid_file_name')) { $reason = $errorValue.Message }
    $errorValue = $errorValue.InnerException
  }
  [Console]::Out.WriteLine('{"version":1,"private":false,"reason":"' + $reason + '"}')
  exit 1
}
