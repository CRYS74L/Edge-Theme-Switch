[CmdletBinding()]
param(
    [switch]$Uninstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$nativeHostName = 'com.crys74l.edge_browser_theme_toggle'
$controllerExtensionId = 'cfcjmbhncpefmmhmpakmkigljppponpm'
$nativeHostRegistrySubKey = "Software\Microsoft\Edge\NativeMessagingHosts\$nativeHostName"
$nativeHostRegistryProviderPath = "HKCU:\$nativeHostRegistrySubKey"
$legacyNativeHostRegistrySubKeys = @(
    'Software\Microsoft\Edge\NativeMessagingHosts\com.crys74l.edgethemetoggle'
)
$legacyStartupValueName = 'CRYS74L.EdgeBrowserThemeToggle'
$legacyStartupRegistrySubKey = 'Software\Microsoft\Windows\CurrentVersion\Run'
$legacyStartupRegistryProviderPath = "HKCU:\$legacyStartupRegistrySubKey"

$scriptDirectory = $PSScriptRoot
$projectRoot = [System.IO.Directory]::GetParent($scriptDirectory).FullName
$hostProject = Join-Path -Path $projectRoot -ChildPath 'packages\native-host\EdgeBrowserThemeToggle.NativeHost.csproj'
$localApplicationData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
$installationRoot = Join-Path -Path $localApplicationData -ChildPath 'CRYS74L\EdgeBrowserThemeToggle'
$runtimeDirectory = Join-Path -Path $installationRoot -ChildPath 'NativeHost'
$hostExecutable = Join-Path -Path $runtimeDirectory -ChildPath 'EdgeBrowserThemeToggle.NativeHost.exe'
$nativeHostManifestPath = Join-Path -Path $runtimeDirectory -ChildPath "$nativeHostName.json"
$legacyStartupCommand = '"' + $hostExecutable + '" --bridge-server'
$generatedRuntimeFiles = @(
    'EdgeBrowserThemeToggle.NativeHost.exe',
    'EdgeBrowserThemeToggle.NativeHost.dll',
    'EdgeBrowserThemeToggle.NativeHost.deps.json',
    'EdgeBrowserThemeToggle.NativeHost.runtimeconfig.json',
    'EdgeBrowserThemeToggle.NativeHost.pdb',
    "$nativeHostName.json",
    'com.crys74l.edgethemetoggle.json'
)

function Assert-ManagedRuntimeDirectory {
    $rootFull = [System.IO.Path]::GetFullPath($installationRoot).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    $runtimeFull = [System.IO.Path]::GetFullPath($runtimeDirectory).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    $expectedRuntime = $rootFull + [System.IO.Path]::DirectorySeparatorChar + 'NativeHost'
    if ($runtimeFull -ne $expectedRuntime) {
        throw "Refusing to manage runtime path outside the expected local installation root: $runtimeFull"
    }
}

function Ensure-DotnetUserPaths {
    if ([string]::IsNullOrWhiteSpace($env:USERPROFILE)) {
        $env:USERPROFILE = [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)
    }

    if ([string]::IsNullOrWhiteSpace($env:HOME)) {
        $env:HOME = $env:USERPROFILE
    }

    if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
        $env:LOCALAPPDATA = $localApplicationData
    }

    if ([string]::IsNullOrWhiteSpace($env:APPDATA)) {
        $env:APPDATA = [Environment]::GetFolderPath([Environment+SpecialFolder]::ApplicationData)
    }

    if ([string]::IsNullOrWhiteSpace($env:PROGRAMDATA)) {
        $env:PROGRAMDATA = [Environment]::GetFolderPath([Environment+SpecialFolder]::CommonApplicationData)
    }

    if ([string]::IsNullOrWhiteSpace($env:ALLUSERSPROFILE)) {
        $env:ALLUSERSPROFILE = $env:PROGRAMDATA
    }

    if ([string]::IsNullOrWhiteSpace($env:ProgramFiles)) {
        $env:ProgramFiles = [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)
    }

    if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable('ProgramFiles(x86)', 'Process'))) {
        [Environment]::SetEnvironmentVariable(
            'ProgramFiles(x86)',
            [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFilesX86),
            'Process')
    }

    if ([string]::IsNullOrWhiteSpace($env:CommonProgramFiles)) {
        $env:CommonProgramFiles = [Environment]::GetFolderPath([Environment+SpecialFolder]::CommonProgramFiles)
    }

    if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable('CommonProgramFiles(x86)', 'Process'))) {
        [Environment]::SetEnvironmentVariable(
            'CommonProgramFiles(x86)',
            [Environment]::GetFolderPath([Environment+SpecialFolder]::CommonProgramFilesX86),
            'Process')
    }
}

function Get-RegistryDefaultValue {
    param(
        [Parameter(Mandatory = $true)]
        [Microsoft.Win32.RegistryKey]$Key
    )

    return $Key.GetValue('', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
}

function Remove-GeneratedRuntimeFiles {
    Assert-ManagedRuntimeDirectory
    foreach ($name in $generatedRuntimeFiles) {
        $candidate = Join-Path -Path $runtimeDirectory -ChildPath $name
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            Remove-Item -LiteralPath $candidate -Force
        }
    }

    if ((Test-Path -LiteralPath $runtimeDirectory -PathType Container) -and
        -not (Get-ChildItem -LiteralPath $runtimeDirectory -Force | Select-Object -First 1)) {
        Remove-Item -LiteralPath $runtimeDirectory -Force
    }

    if ((Test-Path -LiteralPath $installationRoot -PathType Container) -and
        -not (Get-ChildItem -LiteralPath $installationRoot -Force | Select-Object -First 1)) {
        Remove-Item -LiteralPath $installationRoot -Force
    }
}

function Remove-NativeHostRegistration {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($nativeHostRegistrySubKey, $true)
    if ($null -eq $key) {
        return
    }

    try {
        $currentValue = Get-RegistryDefaultValue -Key $key
        if ($currentValue -ne $nativeHostManifestPath) {
            throw "Refusing to remove an unexpected native host registration at $nativeHostRegistryProviderPath"
        }

        if ($key.GetSubKeyNames().Count -ne 0) {
            throw "Refusing to remove a native host registration with unexpected child keys at $nativeHostRegistryProviderPath"
        }
    }
    finally {
        $key.Dispose()
    }

    [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($nativeHostRegistrySubKey, $false)
}

function Remove-LegacyNativeMessagingRegistrations {
    foreach ($subKey in $legacyNativeHostRegistrySubKeys) {
        $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($subKey, $true)
        if ($null -eq $key) {
            continue
        }

        try {
            $currentValue = Get-RegistryDefaultValue -Key $key
            if ($currentValue -ne $nativeHostManifestPath) {
                throw "Refusing to remove an unexpected legacy native host registration at HKCU:\$subKey"
            }

            if ($key.GetSubKeyNames().Count -ne 0) {
                throw "Refusing to remove a legacy native host registration with unexpected child keys at HKCU:\$subKey"
            }
        }
        finally {
            $key.Dispose()
        }

        [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($subKey, $false)
    }
}

function Remove-LegacyStartup {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($legacyStartupRegistrySubKey, $true)
    if ($null -eq $key) {
        return
    }

    try {
        $currentValue = $key.GetValue(
            $legacyStartupValueName,
            $null,
            [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        if ($null -eq $currentValue) {
            return
        }

        if ($currentValue -ne $legacyStartupCommand) {
            throw "Refusing to remove an unexpected startup value at $legacyStartupRegistryProviderPath\$legacyStartupValueName"
        }

        $key.DeleteValue($legacyStartupValueName, $false)
    }
    finally {
        $key.Dispose()
    }
}

function Write-NativeHostManifest {
    $manifest = [ordered]@{
        name = $nativeHostName
        description = 'One-shot Edge appearance toggle host.'
        path = $hostExecutable
        type = 'stdio'
        allowed_origins = @("chrome-extension://$controllerExtensionId/")
    }
    $json = $manifest | ConvertTo-Json -Depth 4
    [System.IO.File]::WriteAllText(
        $nativeHostManifestPath,
        $json + [Environment]::NewLine,
        [System.Text.UTF8Encoding]::new($false))
}

function Set-NativeHostRegistration {
    $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($nativeHostRegistrySubKey)
    try {
        $currentValue = Get-RegistryDefaultValue -Key $key
        if ($null -ne $currentValue -and $currentValue -ne $nativeHostManifestPath) {
            throw "Refusing to overwrite an unexpected native host registration at $nativeHostRegistryProviderPath"
        }

        $key.SetValue('', $nativeHostManifestPath, [Microsoft.Win32.RegistryValueKind]::String)
    }
    finally {
        $key.Dispose()
    }
}

if ($Uninstall) {
    Remove-NativeHostRegistration
    Remove-LegacyNativeMessagingRegistrations
    Remove-LegacyStartup
    Remove-GeneratedRuntimeFiles
    [pscustomobject]@{
        Uninstalled = $true
        Registration = $nativeHostRegistryProviderPath
        RuntimeDirectory = $runtimeDirectory
        PersistentBackgroundProcess = $false
    }
    exit 0
}

Assert-ManagedRuntimeDirectory
Ensure-DotnetUserPaths
if (-not (Test-Path -LiteralPath $hostProject -PathType Leaf)) {
    throw "Native Messaging host project was not found: $hostProject"
}

Remove-LegacyStartup
& dotnet publish $hostProject --configuration Release --runtime win-x64 --self-contained false --output $runtimeDirectory --nologo
if ($LASTEXITCODE -ne 0) {
    throw "dotnet publish failed with exit code $LASTEXITCODE"
}

if (-not (Test-Path -LiteralPath $hostExecutable -PathType Leaf)) {
    throw "Native Messaging host executable was not produced: $hostExecutable"
}

Write-NativeHostManifest
Remove-LegacyNativeMessagingRegistrations
Set-NativeHostRegistration

[pscustomobject]@{
    Installed = $true
    HostExecutable = $hostExecutable
    HostManifest = $nativeHostManifestPath
    Registration = $nativeHostRegistryProviderPath
    PersistentBackgroundProcess = $false
}
