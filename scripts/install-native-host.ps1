[CmdletBinding()]
param(
    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Release',
    [switch]$Uninstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$hostName = 'com.crys74l.edge_browser_theme_toggle'
$extensionId = 'cfcjmbhncpefmmhmpakmkigljppponpm'
$nativeMessagingRoot = Join-Path $projectRoot '.native-host'
$publishDirectory = Join-Path $nativeMessagingRoot 'host'
$hostProject = Join-Path $projectRoot 'packages\native-host\EdgeBrowserThemeToggle.NativeHost.csproj'
$hostExecutable = Join-Path $publishDirectory 'EdgeBrowserThemeToggle.NativeHost.exe'
$hostManifest = Join-Path $nativeMessagingRoot "$hostName.json"
$registryPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName"
$legacyRegistryPath = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$hostName"
$PersistentBackgroundProcess = $false

if ($Uninstall) {
    foreach ($registeredPath in @($registryPath, $legacyRegistryPath)) {
        if (Test-Path -LiteralPath $registeredPath) {
            Remove-Item -LiteralPath $registeredPath -Recurse -Force
        }
    }

    foreach ($generatedPath in @($hostManifest, $nativeMessagingRoot)) {
        if (Test-Path -LiteralPath $generatedPath) {
            Remove-Item -LiteralPath $generatedPath -Recurse -Force
        }
    }

    Write-Host "Removed the current-user Native Messaging registration and generated host files for $hostName."
    exit 0
}

if (Test-Path -LiteralPath $legacyRegistryPath) {
    Remove-Item -LiteralPath $legacyRegistryPath -Recurse -Force
}

if (-not (Test-Path -LiteralPath $hostProject -PathType Leaf)) {
    throw "Native Messaging host project does not exist: $hostProject"
}

$null = Get-Command dotnet -ErrorAction Stop
New-Item -ItemType Directory -Path $publishDirectory -Force | Out-Null

dotnet publish $hostProject `
    --configuration $Configuration `
    --runtime win-x64 `
    --self-contained false `
    --output $publishDirectory `
    /p:Platform=x64

if (-not (Test-Path -LiteralPath $hostExecutable -PathType Leaf)) {
    throw "The published Native Messaging host executable was not found: $hostExecutable"
}

$manifest = [ordered]@{
    name = $hostName
    description = 'Controls the current Edge window appearance for the browser theme toggle extension.'
    path = 'host\EdgeBrowserThemeToggle.NativeHost.exe'
    type = 'stdio'
    allowed_origins = @("chrome-extension://$extensionId/")
}
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText(
    $hostManifest,
    ($manifest | ConvertTo-Json -Depth 4),
    $utf8NoBom)

New-Item -Path $registryPath -Force -Value $hostManifest | Out-Null

$registeredManifest = (Get-Item -LiteralPath $registryPath).GetValue('')
if ($registeredManifest -ne $hostManifest) {
    throw "Native Messaging registry readback mismatch: $registeredManifest"
}

Write-Host "Native Messaging host installed."
Write-Host "Host: $hostExecutable"
Write-Host "Manifest: $hostManifest"
Write-Host "Registry: $registryPath"
