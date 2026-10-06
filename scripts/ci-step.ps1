param([Parameter(Mandatory)][string]$ScriptPath)
# Actions custom shell: fail on EACH native exit, not just the final command.
# Requires PowerShell 7.3+ (present on the certified hosted runners).
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion -lt [version]'7.3') { throw 'CI requires PowerShell >=7.3' }
$PSNativeCommandUseErrorActionPreference = $true
try {
    & $ScriptPath
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
} catch {
    Write-Error -ErrorRecord $_ -ErrorAction Continue
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
    exit 1
}
