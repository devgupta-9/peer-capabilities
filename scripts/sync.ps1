[CmdletBinding()]
param(
    [switch]$Apply,
    [string]$Origin = (Split-Path -Parent $PSScriptRoot),
    [string]$HomeRoot = [Environment]::GetFolderPath('UserProfile'),
    [string]$BackupRoot = (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.ai-rules-backups')
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$origin = [IO.Path]::GetFullPath($Origin)
$HomeRoot = [IO.Path]::GetFullPath($HomeRoot)
$BackupRoot = [IO.Path]::GetFullPath($BackupRoot)
$statePath = Join-Path $origin 'state\deployments.json'
$previous = @{}
if (Test-Path -LiteralPath $statePath) {
    foreach ($entry in (Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json)) {
        $previous[$entry.target] = $entry.hash
    }
}
$items = [System.Collections.Generic.List[object]]::new()
function Add-Deployment([string]$Source, [string]$Target) {
    if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) { throw "Missing source: $Source" }
    $sourceHash = (Get-FileHash -LiteralPath $Source -Algorithm SHA256).Hash
    $targetHash = if (Test-Path -LiteralPath $Target -PathType Leaf) { (Get-FileHash -LiteralPath $Target -Algorithm SHA256).Hash } else { $null }
    $changed = $sourceHash -ne $targetHash
    $conflict = $changed -and $previous.ContainsKey($Target) -and $targetHash -ne $previous[$Target]
    $items.Add([pscustomobject]@{source=$Source;target=$Target;hash=$sourceHash;liveHash=$targetHash;changed=$changed;conflict=$conflict})
}
Add-Deployment (Join-Path $origin 'platforms\codex\AGENTS.md') (Join-Path $HomeRoot '.codex\AGENTS.md')
Add-Deployment (Join-Path $origin 'platforms\antigravity\GEMINI.md') (Join-Path $HomeRoot '.gemini\GEMINI.md')
foreach ($f in Get-ChildItem -LiteralPath (Join-Path $origin 'orchestrator') -File -Recurse) {
    $relative = [IO.Path]::GetRelativePath((Join-Path $origin 'orchestrator'), $f.FullName)
    Add-Deployment $f.FullName (Join-Path (Join-Path $HomeRoot '.ai-orchestrator') $relative)
}
if (Test-Path -LiteralPath (Join-Path $origin 'skills')) {
    foreach ($f in Get-ChildItem -LiteralPath (Join-Path $origin 'skills') -File -Recurse) {
        $relative = [IO.Path]::GetRelativePath((Join-Path $origin 'skills'), $f.FullName)
        foreach ($destination in @((Join-Path $HomeRoot '.codex\skills'), (Join-Path $HomeRoot '.gemini\config\skills'))) {
            Add-Deployment $f.FullName (Join-Path $destination $relative)
        }
    }
}
$targets = @($items | ForEach-Object target)
$orphans = @($previous.Keys | Where-Object { $_ -notin $targets })
$conflicts = @($items | Where-Object conflict)
$changes = @($items | Where-Object changed)
if ($orphans.Count) { throw "Managed sources were removed. Review old targets explicitly; sync will not delete them." }
if ($conflicts.Count) {
    $conflicts | ForEach-Object { Write-Warning "Live file changed independently; reconcile first: $($_.target)" }
    throw 'Refusing to overwrite live changes.'
}
if (-not $Apply) {
    [pscustomobject]@{mode='check';managedFiles=$items.Count;driftedFiles=$changes.Count;conflicts=0} | ConvertTo-Json -Compress
    $changes | ForEach-Object { Write-Output "Drift: $($_.target)" }
    if ($changes.Count) { exit 1 }
    exit 0
}
$backup = Join-Path $BackupRoot ('sync-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
if ($changes.Count) { New-Item -ItemType Directory -Path $backup | Out-Null }
foreach ($entry in $changes) {
    # Recheck both ends immediately before writing, after complete preflight.
    if ((Get-FileHash -LiteralPath $entry.source -Algorithm SHA256).Hash -ne $entry.hash) { throw "Source changed during sync: $($entry.source)" }
    $current = if (Test-Path -LiteralPath $entry.target) { (Get-FileHash -LiteralPath $entry.target -Algorithm SHA256).Hash } else { $null }
    if ($current -ne $entry.liveHash) { throw "Target changed during sync: $($entry.target)" }
    if ($current) {
        $backupName = $entry.target.Replace(':','').TrimStart('\')
        $backupFile = Join-Path $backup $backupName
        New-Item -ItemType Directory -Path (Split-Path -Parent $backupFile) -Force | Out-Null
        Copy-Item -LiteralPath $entry.target -Destination $backupFile
    }
    New-Item -ItemType Directory -Path (Split-Path -Parent $entry.target) -Force | Out-Null
    Copy-Item -LiteralPath $entry.source -Destination $entry.target -Force
    if ((Get-FileHash -LiteralPath $entry.target -Algorithm SHA256).Hash -ne $entry.hash) { throw "Verification failed: $($entry.target)" }
}
New-Item -ItemType Directory -Path (Split-Path -Parent $statePath) -Force | Out-Null
$items | Select-Object source,target,hash | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $statePath -Encoding utf8NoBOM
[pscustomobject]@{mode='apply';managedFiles=$items.Count;updatedFiles=$changes.Count;backup=if($changes.Count){$backup}else{$null}} | ConvertTo-Json -Compress
