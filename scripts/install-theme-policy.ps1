[CmdletBinding()]
param(
  [switch]$Remove,
  [string]$ExtensionId = 'pijpfibjabpbkjfnodppeipagbhableg',
  [string]$UpdateUrl
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$crxPath = Join-Path $projectRoot 'packages\theme-dark.crx'
$edgeStoreUpdateUrl = 'https://edge.microsoft.com/extensionwebstorebase/v1/crx'
$policyPath = 'HKLM:\SOFTWARE\Policies\Microsoft\Edge'
$policyValueName = 'ExtensionSettings'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this script from an elevated PowerShell window (Run as Administrator).'
}

function Get-ExistingPolicyJson {
  if (-not (Test-Path -Path $policyPath -PathType Container)) {
    return $null
  }

  $property = Get-ItemProperty -Path $policyPath -Name $policyValueName `
    -ErrorAction SilentlyContinue
  if ($null -eq $property) {
    return $null
  }

  return [string]$property.$policyValueName
}

function ConvertTo-ManagedPolicyJson {
  param([Parameter(Mandatory = $true)][string]$InstallUrl)

  $entry = [ordered]@{
    installation_mode = 'normal_installed'
    update_url = $InstallUrl
  }
  $policy = [ordered]@{}
  $policy[$ExtensionId] = $entry
  return ($policy | ConvertTo-Json -Compress)
}

function Test-IsExactManagedPolicy {
  param([Parameter(Mandatory = $true)][string]$Json)

  try {
    $parsed = $Json | ConvertFrom-Json
  }
  catch {
    return $false
  }

  $properties = @($parsed.PSObject.Properties)
  if ($properties.Count -ne 1 -or $properties[0].Name -ne $ExtensionId) {
    return $false
  }

  $entry = $properties[0].Value
  return (
    $entry.installation_mode -eq 'normal_installed' -and
    $null -ne $entry.update_url
  )
}

if ($Remove) {
  $existingJson = Get-ExistingPolicyJson
  if ($null -eq $existingJson) {
    Write-Output 'Edge ExtensionSettings policy value is already absent.'
    exit 0
  }

  if (-not (Test-IsExactManagedPolicy $existingJson)) {
    throw 'ExtensionSettings contains content not owned by this project; nothing was removed.'
  }

  Remove-ItemProperty -Path $policyPath -Name $policyValueName
  Write-Output "Removed $policyPath\$policyValueName; other Edge policies were not changed."
  exit 0
}

if ([string]::IsNullOrWhiteSpace($UpdateUrl)) {
  if (-not (Test-Path -LiteralPath $crxPath -PathType Leaf)) {
    throw "Dark theme package not found: $crxPath"
  }
  $UpdateUrl = $edgeStoreUpdateUrl
}

$parsedUpdateUrl = $null
if (-not [Uri]::TryCreate($UpdateUrl, [UriKind]::Absolute, [ref]$parsedUpdateUrl)) {
  throw "UpdateUrl is not an absolute URL: $UpdateUrl"
}
if ($parsedUpdateUrl.Scheme -notin @('file', 'http', 'https')) {
  throw "UpdateUrl must use file, http, or https: $UpdateUrl"
}

$desiredJson = ConvertTo-ManagedPolicyJson $UpdateUrl
$existingJson = Get-ExistingPolicyJson
if ($null -ne $existingJson -and -not (Test-IsExactManagedPolicy $existingJson)) {
  throw 'ExtensionSettings already contains other content; nothing was overwritten.'
}

if ($null -eq $existingJson) {
  New-Item -Path $policyPath -Force | Out-Null
  New-ItemProperty -Path $policyPath -Name $policyValueName `
    -PropertyType String -Value $desiredJson | Out-Null
}
elseif ($existingJson -ne $desiredJson) {
  Set-ItemProperty -Path $policyPath -Name $policyValueName -Value $desiredJson
}

$verifiedJson = Get-ExistingPolicyJson
if ($verifiedJson -ne $desiredJson) {
  throw 'Post-write verification failed: Edge ExtensionSettings does not match the expected value.'
}

Write-Output "Wrote $policyPath\$policyValueName."
Write-Output "Theme ID: $ExtensionId"
Write-Output 'Install mode: normal_installed (the original management.setEnabled click path remains in control).'
Write-Output "Download URL: $UpdateUrl"
Write-Output 'Reload policy at edge://policy; if the theme is not installed immediately, restart Edge once.'
