[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('Remove','Restore')][string]$Action,
    [Parameter(Mandatory)][string]$Baseline
)
$ErrorActionPreference = 'Stop'
$data = Get-Content -LiteralPath (Join-Path $Baseline 'baseline.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $data.sealed) { throw 'Cold recovery snapshot is not sealed.' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Administrator approval is required to change the existing machine policy.' }
$themeId = 'pijpfibjabpbkjfnodppeipagbhableg'
$taskName = 'CRYS74L.EdgeThemeRetention'
$setup = Get-Content -LiteralPath (Join-Path $Baseline 'setup.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$expectedScript = Join-Path $data.project 'tools\theme-retention\retain.py'
if ($setup.helperScript -ne $expectedScript -or -not (Test-Path -LiteralPath $setup.helperPython -PathType Leaf)) { throw 'Helper installation paths do not match the recovery manifest.' }
if ($Action -eq 'Remove') {
    $existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($null -ne $existingTask) { throw 'The retention task already exists; nothing was overwritten.' }
    $actionTask = New-ScheduledTaskAction -Execute $setup.helperPython -Argument ('"' + $setup.helperScript + '"')
    $triggerTask = New-ScheduledTaskTrigger -AtLogOn -User $setup.userSid
    $principalTask = New-ScheduledTaskPrincipal -UserId $setup.userSid -LogonType Interactive -RunLevel Limited
    $settingsTask = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
    Register-ScheduledTask -TaskName $taskName -Action $actionTask -Trigger $triggerTask -Principal $principalTask -Settings $settingsTask -Description 'Retains the Edge theme for one-click appearance switching without an Edge management policy.' | Out-Null
} else {
    $existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($null -ne $existingTask) {
        if ($existingTask.Actions.Execute -ne $setup.helperPython -or $existingTask.Actions.Arguments -ne ('"' + $setup.helperScript + '"')) { throw 'The task contents changed; unrelated task data was not removed.' }
        Stop-ScheduledTask -TaskName $taskName
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    }
}
foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine, $view)
    $key = $null
    try {
        $key = $base.OpenSubKey('SOFTWARE\Policies\Microsoft\Edge', $true)
        if ($null -eq $key) { throw 'The original Edge policy key no longer exists.' }
        $label = if ($view -eq [Microsoft.Win32.RegistryView]::Registry64) { 'HKLM64' } else { 'HKLM32' }
        $original = $data.policy.$label
        $current = $key.GetValue('ExtensionSettings', $null)
        if ($Action -eq 'Remove') {
            if ($null -eq $current) { continue }
            if ($current -ne $original.value) { throw 'Policy changed since backup; no value was removed.' }
            $parsed = $current | ConvertFrom-Json
            $names = @($parsed.psobject.Properties.Name)
            if ($names.Count -ne 1 -or $names[0] -ne $themeId) { throw 'The policy contains entries outside this project.' }
            $key.DeleteValue('ExtensionSettings')
            if ($null -ne $key.GetValue('ExtensionSettings', $null)) { throw 'Policy removal verification failed.' }
        } else {
            if ($null -eq $original) { throw 'The baseline does not contain the original machine theme policy.' }
            if ($null -eq $current) {
                $desired = [string]$original.value
            } else {
                $parsed = $current | ConvertFrom-Json
                $owned = ($original.value | ConvertFrom-Json).$themeId
                $parsed | Add-Member -NotePropertyName $themeId -NotePropertyValue $owned -Force
                $desired = $parsed | ConvertTo-Json -Compress -Depth 10
            }
            $key.SetValue('ExtensionSettings', $desired, [Microsoft.Win32.RegistryValueKind]::String)
            if ($key.GetValue('ExtensionSettings') -ne $desired) { throw 'Policy restoration verification failed.' }
        }
    } finally {
        if ($null -ne $key) { $key.Dispose() }
        $base.Dispose()
    }
}
@{ action = $Action; verified = $true; time = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Baseline 'policy-result.json') -Encoding UTF8
