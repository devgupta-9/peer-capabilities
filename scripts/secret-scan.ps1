[CmdletBinding()]
param([switch]$Staged, [switch]$History)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$scanArgs = @((Join-Path $PSScriptRoot 'secret-scan.mjs'))
if ($Staged) { $scanArgs += '--staged' }
if ($History) { $scanArgs += '--history' }
& node @scanArgs
if ($LASTEXITCODE -ne 0) { throw 'Publication scan failed; see categories above. Secret values are never printed.' }
