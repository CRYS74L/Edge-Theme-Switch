[CmdletBinding()]
param([ValidateSet('Check', 'Install', 'Remove')][string]$Action = 'Check')

$ErrorActionPreference = 'Stop'
$project = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$helper = Join-Path $project 'tools\theme-retention\retain.py'
$configuration = Join-Path $project '.native-host\retention.json'
$taskName = 'CRYS74L.EdgeThemeRetention'
$arguments = '"' + $helper + '"'
$task = Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue

function Stop-RetentionTask {
    if ($task.State -ne 'Running') { return }
    $consolePython = Join-Path (Split-Path -Parent $task.Actions[0].Execute) 'python.exe'
    & $consolePython $helper --stop
    if ($LASTEXITCODE -ne 0) { throw 'The retention helper did not receive the stop request.' }
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        if ((Get-ScheduledTask -TaskName $taskName -TaskPath '\').State -ne 'Running') { return }
        Start-Sleep -Milliseconds 250
    }
    throw 'The retention helper is still working. Try again after it finishes.'
}

if ($Action -eq 'Remove') {
    if ($null -eq $task) { return }
    if ($task.Actions.Count -ne 1 -or $task.Actions[0].Arguments -ne $arguments) {
        throw 'The scheduled task belongs to a different installation. Remove it from that installation first.'
    }
    Stop-RetentionTask
    Unregister-ScheduledTask -TaskName $taskName -TaskPath '\' -Confirm:$false
    Write-Output 'Theme retention startup removed. Restart Edge to finish unloading it.'
    return
}

$python = Get-Command python.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1
$pythonInfo = & $python.Source -c 'import sys; print(sys.version_info.major, sys.version_info.minor, sys.maxsize); print(sys.executable)'
if ($LASTEXITCODE -ne 0) { throw 'Install 64-bit Python 3.11+ and make python.exe available on PATH.' }
$runtime = $pythonInfo[0] -split ' '
$pythonPath = $pythonInfo[1]
if ($runtime[0] -ne '3' -or [int]$runtime[1] -lt 11 -or $runtime[2] -ne '9223372036854775807') {
    throw '64-bit Python 3.11 or newer is required.'
}
$pythonw = Join-Path (Split-Path -Parent $pythonPath) 'pythonw.exe'
if (-not (Test-Path -LiteralPath $pythonw -PathType Leaf)) { throw 'pythonw.exe was not found next to Python.' }

$application = Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application'
$edge = Get-Item -LiteralPath (Join-Path $application 'msedge.exe')
$version = $edge.VersionInfo.ProductVersion
if ($version -notmatch '^\d+\.\d+\.\d+\.\d+$') { throw 'The Edge build could not be identified.' }
$dll = Join-Path $application "$version\msedge.dll"
$verified = & $pythonPath $helper --check-dll $dll
if ($LASTEXITCODE -ne 0 -or $verified -ne $version) { throw "Edge $version is not supported by this copy of the helper." }
Write-Output "Edge $version matches a supported Windows x64 build."
if ($Action -eq 'Check') { return }

if ($null -ne $task -and ($task.Actions.Count -ne 1 -or $task.Actions[0].Arguments -ne $arguments)) {
    throw 'The scheduled task belongs to a different installation. Remove it from that installation first.'
}
$dataDirectory = Split-Path -Parent $configuration
New-Item -ItemType Directory -Path $dataDirectory -Force | Out-Null
if (-not (Test-Path -LiteralPath $configuration)) {
    $data = [ordered]@{
        profile = Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data'
        theme_id = 'pijpfibjabpbkjfnodppeipagbhableg'
        state_dir = Join-Path $dataDirectory 'retention-state'
        suppress_outdated_notification = $false
    }
    $data | ConvertTo-Json | Set-Content -LiteralPath $configuration -Encoding UTF8
}

$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$start = New-ScheduledTaskAction -Execute $pythonw -Argument $arguments
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $sid
$principal = New-ScheduledTaskPrincipal -UserId $sid -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
if ($null -ne $task) { Stop-RetentionTask }
if ($null -eq $task -or $task.Actions[0].Execute -ne $pythonw) {
    Register-ScheduledTask -TaskName $taskName -TaskPath '\' -Action $start -Trigger $trigger `
        -Principal $principal -Settings $settings -Description 'Keeps the Edge Theme Switch local theme available.' -Force | Out-Null
}
Start-ScheduledTask -TaskName $taskName -TaskPath '\'
Write-Output 'Theme retention startup installed. Close and reopen Edge before checking the toolbar button.'
