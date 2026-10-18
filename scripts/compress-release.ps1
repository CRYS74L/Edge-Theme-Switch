param(
  [Parameter(Mandatory=$true)][string]$SourceDirectory,
  [Parameter(Mandatory=$true)][string]$DestinationZip
)
$ErrorActionPreference = 'Stop'
if (!(Test-Path -LiteralPath $SourceDirectory -PathType Container)) { throw 'Release directory does not exist.' }
if (Test-Path -LiteralPath $DestinationZip) { throw 'Refusing to overwrite an existing release archive.' }
Compress-Archive -LiteralPath $SourceDirectory -DestinationPath $DestinationZip -CompressionLevel Optimal
