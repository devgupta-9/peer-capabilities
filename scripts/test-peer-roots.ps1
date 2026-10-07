$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'peer-roots.ps1')
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$project = Join-Path $root 'peer-agents'
$preserved = Resolve-PeerDelegationRoots -Existing @($project) -DefaultRoot $root
if ($preserved -ne $project) { throw 'Existing roots were lost on reinstallation.' }
$explicit = Resolve-PeerDelegationRoots -Requested @($root, $root) -Existing @($project) -DefaultRoot $root
if ($explicit -ne $root) { throw 'Explicit roots must override and deduplicate.' }
if ((Resolve-PeerDelegationRoots -DefaultRoot $root) -ne $root) { throw 'Default project root not retained.' }
$rejected = $false
try { Resolve-PeerDelegationRoots -Requested @('relative/path') -DefaultRoot $root } catch { $rejected = $true }
if (-not $rejected) { throw 'Relative root accepted.' }
Write-Host 'PASS: delegation-root defaults, preservation, override, deduplication and validation'
if ((Resolve-AntigravitySandboxMode) -ne 'required') { throw 'Sandbox default was weakened.' }
if ((Resolve-AntigravitySandboxMode -Existing @('permissions-only', 'permissions-only')) -ne 'permissions-only') { throw 'Explicit existing sandbox mode was lost.' }
if ((Resolve-AntigravitySandboxMode -Requested 'required' -Existing @('permissions-only')) -ne 'required') { throw 'Explicit sandbox selection ignored.' }
$rejected = $false
try { Resolve-AntigravitySandboxMode -Existing @('required', 'permissions-only') } catch { $rejected = $true }
if (-not $rejected) { throw 'Conflicting sandbox modes silently accepted.' }
Write-Host 'PASS: sandbox-mode defaults, preservation, explicit override and conflicting registrations'
