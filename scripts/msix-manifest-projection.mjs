// Expects $manifest to be an XML document. Project attributes explicitly rather
// than JSON-serializing PowerShell's adapted XML nodes (which can lose them).
export const manifestProjection = `
$apps = @(
  foreach ($app in $manifest.SelectNodes("/*[local-name()='Package']/*[local-name()='Applications']/*[local-name()='Application']")) {
    $extensions = @(
      foreach ($extension in $app.SelectNodes("./*[local-name()='Extensions']/*[local-name()='Extension']")) {
        [pscustomobject]@{
          category = $extension.GetAttribute('Category')
          executable = $extension.GetAttribute('Executable')
          entryPoint = $extension.GetAttribute('EntryPoint')
          aliases = @($extension.SelectNodes(".//*[local-name()='ExecutionAlias']") | ForEach-Object { $_.GetAttribute('Alias') })
        }
      }
    )
    [pscustomobject]@{
      id = $app.GetAttribute('Id')
      executable = $app.GetAttribute('Executable')
      entryPoint = $app.GetAttribute('EntryPoint')
      extensions = $extensions
    }
  }
)
ConvertTo-Json -InputObject $apps -Compress -Depth 6
`;
