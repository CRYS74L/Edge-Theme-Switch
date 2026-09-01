[CmdletBinding()]
param(
    [switch]$Uninstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$loopbackPort = 42761
$bridgeBaseUrl = "http://127.0.0.1:$loopbackPort"
$startupValueName = 'CRYS74L.EdgeBrowserThemeToggle'
$startupRegistrySubKey = 'Software\Microsoft\Windows\CurrentVersion\Run'
$startupRegistryProviderPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$legacyNativeHostRegistryPaths = @(
    'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.crys74l.edge_browser_theme_toggle',
    'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.crys74l.edgethemetoggle'
)

$scriptDirectory = $PSScriptRoot
$projectRoot = [System.IO.Directory]::GetParent($scriptDirectory).FullName
$hostProject = Join-Path -Path $projectRoot -ChildPath 'packages\native-host\EdgeBrowserThemeToggle.NativeHost.csproj'
$installationRoot = Join-Path -Path $env:LOCALAPPDATA -ChildPath 'CRYS74L\EdgeBrowserThemeToggle'
$runtimeDirectory = Join-Path -Path $installationRoot -ChildPath 'NativeHost'
$hostExecutable = Join-Path -Path $runtimeDirectory -ChildPath 'EdgeBrowserThemeToggle.NativeHost.exe'
$startupCommand = '"' + $hostExecutable + '" --bridge-server'
$generatedRuntimeFiles = @(
    'EdgeBrowserThemeToggle.NativeHost.exe',
    'EdgeBrowserThemeToggle.NativeHost.dll',
    'EdgeBrowserThemeToggle.NativeHost.deps.json',
    'EdgeBrowserThemeToggle.NativeHost.runtimeconfig.json',
    'EdgeBrowserThemeToggle.NativeHost.pdb',
    'com.crys74l.edge_browser_theme_toggle.json',
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

function Remove-LegacyNativeMessagingRegistrations {
    foreach ($registryPath in $legacyNativeHostRegistryPaths) {
        if (Test-Path -LiteralPath $registryPath) {
            Remove-Item -LiteralPath $registryPath -Recurse -Force
        }
    }
}

function Send-LoopbackBridgeRequest {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Request
    )

    $client = $null
    $stream = $null
    $reader = $null
    try {
        $client = [System.Net.Sockets.TcpClient]::new()
        $connect = $client.ConnectAsync('127.0.0.1', $loopbackPort)
        if (-not $connect.Wait(1000)) {
            return $null
        }

        $client.ReceiveTimeout = 1000
        $client.SendTimeout = 1000
        $stream = $client.GetStream()
        $bytes = [System.Text.Encoding]::ASCII.GetBytes($Request)
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush()
        $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::UTF8, $false, 1024, $true)
        return $reader.ReadToEnd()
    }
    catch {
        return $null
    }
    finally {
        if ($null -ne $reader) { $reader.Dispose() }
        if ($null -ne $stream) { $stream.Dispose() }
        if ($null -ne $client) { $client.Dispose() }
    }
}

function Test-LoopbackBridge {
    $response = Send-LoopbackBridgeRequest -Request "GET /health HTTP/1.1`r`nHost: 127.0.0.1:$loopbackPort`r`n`r`n"
    return $null -ne $response -and $response.Contains('"mode":"ready"')
}

function Stop-LoopbackBridge {
    if (-not (Test-LoopbackBridge)) {
        return
    }

    [void](Send-LoopbackBridgeRequest -Request "POST /shutdown HTTP/1.1`r`nHost: 127.0.0.1:$loopbackPort`r`nContent-Length: 0`r`n`r`n")
    $deadline = [DateTime]::UtcNow.AddSeconds(3)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (-not (Test-LoopbackBridge)) {
            return
        }

        Start-Sleep -Milliseconds 100
    }

    throw "The local loopback bridge did not stop cleanly."
}

function Set-BridgeStartup {
    $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($startupRegistrySubKey)
    try {
        $key.SetValue($startupValueName, $startupCommand, [Microsoft.Win32.RegistryValueKind]::String)
    }
    finally {
        $key.Dispose()
    }
}

function Remove-BridgeStartup {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($startupRegistrySubKey, $true)
    if ($null -eq $key) {
        return
    }

    try {
        $currentValue = $key.GetValue($startupValueName, $null)
        if ($null -eq $currentValue) {
            return
        }

        if ($currentValue -ne $startupCommand) {
            throw "Refusing to remove an unexpected startup value at $startupRegistryProviderPath\$startupValueName"
        }

        $key.DeleteValue($startupValueName, $false)
    }
    finally {
        $key.Dispose()
    }
}

function Start-LoopbackBridge {
    if (Test-LoopbackBridge) {
        return
    }

    $process = Start-Process -FilePath $hostExecutable -ArgumentList '--bridge-server' -WindowStyle Hidden -PassThru
    $deadline = [DateTime]::UtcNow.AddSeconds(5)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (Test-LoopbackBridge) {
            return $process
        }

        if ($process.HasExited) {
            throw "The local loopback bridge exited during startup with code $($process.ExitCode)."
        }

        Start-Sleep -Milliseconds 100
    }

    throw "The local loopback bridge did not become healthy at $bridgeBaseUrl."
}

if ($Uninstall) {
    Stop-LoopbackBridge
    Remove-BridgeStartup
    Remove-LegacyNativeMessagingRegistrations
    Remove-GeneratedRuntimeFiles
    [pscustomobject]@{
        Uninstalled = $true
        StartupValue = "$startupRegistryProviderPath\$startupValueName"
        RuntimeDirectory = $runtimeDirectory
    }
    exit 0
}

Assert-ManagedRuntimeDirectory
if (-not (Test-Path -LiteralPath $hostProject -PathType Leaf)) {
    throw "Local bridge project was not found: $hostProject"
}

Stop-LoopbackBridge
& dotnet publish $hostProject --configuration Release --runtime win-x64 --self-contained false --output $runtimeDirectory --nologo
if ($LASTEXITCODE -ne 0) {
    throw "dotnet publish failed with exit code $LASTEXITCODE"
}

if (-not (Test-Path -LiteralPath $hostExecutable -PathType Leaf)) {
    throw "Local bridge executable was not produced: $hostExecutable"
}

Remove-LegacyNativeMessagingRegistrations
Set-BridgeStartup
$startedProcess = Start-LoopbackBridge

if (-not (Test-LoopbackBridge)) {
    throw "Local bridge health verification failed at $bridgeBaseUrl."
}

[pscustomobject]@{
    Installed = $true
    HostExecutable = $hostExecutable
    StartupValue = "$startupRegistryProviderPath\$startupValueName"
    LoopbackUrl = $bridgeBaseUrl
    ProcessId = if ($null -ne $startedProcess) { $startedProcess.Id } else { $null }
}
