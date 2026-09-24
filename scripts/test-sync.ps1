[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$origin = Split-Path -Parent $PSScriptRoot
$sandbox = Join-Path ([IO.Path]::GetTempPath()) ('ai-rules-sync-test-' + [guid]::NewGuid().ToString('N'))
$source = Join-Path $sandbox 'origin'
$live = Join-Path $sandbox 'live'
$backups = Join-Path $sandbox 'backups'
New-Item -ItemType Directory -Path $source,$live,$backups -Force | Out-Null
foreach ($name in @('platforms','orchestrator')) {
    Copy-Item -LiteralPath (Join-Path $origin $name) -Destination $source -Recurse
}
New-Item -ItemType Directory -Path (Join-Path $source 'skills') -Force | Out-Null
$fixtureSkill = Join-Path $source 'skills\fixture-skill'
New-Item -ItemType Directory -Path $fixtureSkill -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $fixtureSkill 'SKILL.md'), "---`nname: fixture-skill`ndescription: Sync test fixture.`n---`n")
$script = Join-Path $PSScriptRoot 'sync.ps1'
function Invoke-Sync([bool]$Apply, [int]$ExpectedExit) {
    $invokeArgs = @('-NoProfile','-File',$script,'-Origin',$source,'-HomeRoot',$live,'-BackupRoot',$backups)
    if ($Apply) { $invokeArgs += '-Apply' }
    $result = & pwsh @invokeArgs 2>&1
    if ($LASTEXITCODE -ne $ExpectedExit) { throw "Unexpected sync exit code $LASTEXITCODE, expected $ExpectedExit" }
    return $result
}
# Missing targets are drift, then deployment is idempotent.
$null = Invoke-Sync $false 1
$null = Invoke-Sync $true 0
$null = Invoke-Sync $false 0
$null = Invoke-Sync $true 0
# Independent edits must survive an attempted apply.
$liveAgent = Join-Path $live '.codex\AGENTS.md'
[IO.File]::AppendAllText($liveAgent, [Environment]::NewLine + 'Independent user edit' + [Environment]::NewLine)
$before = (Get-FileHash -LiteralPath $liveAgent).Hash
$null = Invoke-Sync $true 1
if ((Get-FileHash -LiteralPath $liveAgent).Hash -ne $before) { throw 'Sync overwrote an independent edit.' }
# Reconcile, then source changes deploy with a recoverable backup.
$sourceAgent = Join-Path $source 'platforms\codex\AGENTS.md'
Copy-Item -LiteralPath $sourceAgent -Destination $liveAgent -Force
$oldHash = (Get-FileHash -LiteralPath $liveAgent).Hash
[IO.File]::AppendAllText($sourceAgent, [Environment]::NewLine + 'Reviewed source update' + [Environment]::NewLine)
$null = Invoke-Sync $true 0
$null = Invoke-Sync $false 0
$backupFound = @(Get-ChildItem -LiteralPath $backups -File -Recurse | Where-Object {(Get-FileHash -LiteralPath $_.FullName).Hash -eq $oldHash}).Count -gt 0
if (-not $backupFound) { throw 'Prior live content was not backed up.' }
[pscustomobject]@{ok=$true;checks=@('missing-target drift','apply','idempotence','conflict refusal','preserved live edit','source update','backup recovery');isolatedTestDirectory=$sandbox} | ConvertTo-Json -Compress
