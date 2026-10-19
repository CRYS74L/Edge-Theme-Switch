param(
  [Parameter(Mandatory=$true)][string]$SourceDirectory,
  [Parameter(Mandatory=$true)][string]$DestinationZip
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$themeRoot = (Resolve-Path -LiteralPath $SourceDirectory).Path
$themeManifest = Get-Content -LiteralPath (Join-Path $themeRoot 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$themeFiles = @('manifest.json') + @($themeManifest.theme.images.PSObject.Properties.Value | Sort-Object -Unique)
if (Test-Path -LiteralPath $DestinationZip) { throw 'Refusing to overwrite an existing archive.' }
$archive = [IO.Compression.ZipFile]::Open($DestinationZip, [IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($file in $themeFiles) {
    if ([IO.Path]::GetFileName($file) -ne $file -or ($file -ne 'manifest.json' -and [IO.Path]::GetExtension($file) -ne '.png')) {
      throw 'Theme packaging only accepts the manifest and its PNG images.'
    }
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, (Join-Path $themeRoot $file), $file) | Out-Null
  }
} finally { $archive.Dispose() }
