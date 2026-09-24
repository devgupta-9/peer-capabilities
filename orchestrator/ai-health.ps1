[CmdletBinding()]
param([switch]$Probe)
$validator = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.ai-rules\scripts\validate.ps1'
& $validator -Probe:$Probe
exit $LASTEXITCODE
