[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not $IsWindows) { throw 'This bootstrap currently supports Windows only.' }
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'PowerShell 7 or newer is required.' }

$repository = 'https://github.com/devgupta-9/peer-capabilities.git'
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
    & $git.Source -C $target pull --ff-only origin main
    if ($LASTEXITCODE -ne 0) { throw 'Could not fast-forward the local configuration repository.' }
} else {
    & $git.Source clone --branch main --depth 1 $repository $target
    if ($LASTEXITCODE -ne 0) { throw 'Could not clone the configuration repository.' }
}

& (Join-Path $target 'install.ps1')
if ($LASTEXITCODE -ne 0) { throw "Installation failed with exit code $LASTEXITCODE." }
