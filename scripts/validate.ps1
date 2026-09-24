[CmdletBinding()]
param([switch]$Probe)
$ErrorActionPreference = 'Stop'
$origin = Split-Path -Parent $PSScriptRoot
$uv = Get-Command uv -ErrorAction Stop
$toolRoot = (& $uv.Source tool dir).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Could not locate uv tool environments.' }
$python = Join-Path $toolRoot 'headroom-ai\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python)) { throw 'Installed Headroom Python is unavailable. Run install.ps1; nothing will be auto-installed by validation.' }
$arguments = @((Join-Path $PSScriptRoot 'validate.py'))
if ($Probe) { $arguments += '--probe' }
& $python @arguments
exit $LASTEXITCODE
