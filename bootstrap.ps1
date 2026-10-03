[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not $IsWindows) { throw 'This bootstrap currently supports Windows only.' }
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'PowerShell 7 or newer is required.' }

$repository = 'https://github.com/devgupta-9/peer-capabilities.git'
$release = 'v0.3.0'
$expectedCommit = '3bce3a436bed9ed30474b16a2b4fa078cc69a2df'
$target = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.ai-rules'
$git = Get-Command git -ErrorAction Stop

function Normalize-Remote([string]$Value) {
    return $Value.Trim().TrimEnd('/').ToLowerInvariant() -replace '\.git$',''
}

if (Test-Path -LiteralPath $target) {
    if (-not (Test-Path -LiteralPath (Join-Path $target '.git'))) {
        throw "Refusing to overwrite the existing non-Git directory: $target"
    }
    $actualRemote = (& $git.Source -C $target remote get-url origin 2>$null).Trim()
    if ($LASTEXITCODE -ne 0 -or (Normalize-Remote $actualRemote) -ne (Normalize-Remote $repository)) {
        throw "Refusing to update $target because its origin is not $repository"
    }
    if ((& $git.Source -C $target status --porcelain).Count) {
        throw "Refusing to update a dirty checkout: $target"
    }
    & $git.Source -C $target fetch --depth 1 origin "refs/tags/${release}:refs/tags/${release}"
    if ($LASTEXITCODE -ne 0) { throw "Could not fetch release $release." }
    $currentCommit = (& $git.Source -C $target rev-parse HEAD).Trim()
    $releaseCommit = (& $git.Source -C $target rev-list -n 1 $release).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $releaseCommit) { throw "Could not resolve release $release." }
    if ($releaseCommit -ne $expectedCommit) { throw 'Release tag does not match the pinned commit; refusing update.' }
    if ($currentCommit -ne $releaseCommit) {
        Write-Host "Updating peer-capabilities from $currentCommit to release $release ($releaseCommit)"
        & $git.Source -C $target diff --stat $currentCommit $releaseCommit
    }
    & $git.Source -C $target checkout --detach $release
    if ($LASTEXITCODE -ne 0) { throw "Could not check out release $release." }
} else {
    & $git.Source clone --branch $release --depth 1 $repository $target
    if ($LASTEXITCODE -ne 0) { throw 'Could not clone the configuration repository.' }
}

$resolvedCommit = (& $git.Source -C $target rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $resolvedCommit -ne $expectedCommit) { throw 'Release integrity check failed; installer was not executed.' }
& (Join-Path $target 'install.ps1')
if ($LASTEXITCODE -ne 0) { throw "Installation failed with exit code $LASTEXITCODE." }
