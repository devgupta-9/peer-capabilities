$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'peer-roots.ps1')
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$project = Join-Path $root 'peer-agents'
$preserved = Resolve-PeerDelegationRoots -Existing @($project) -DefaultRoot $root
if ($preserved -ne $project) { throw 'Existing roots were lost on reinstallation.' }
$explicit = Resolve-PeerDelegationRoots -Requested @($root, $root) -Existing @($project) -DefaultRoot $root
if ($explicit -ne $root) { throw 'Explicit roots must override and deduplicate.' }
if ((Resolve-PeerDelegationRoots -DefaultRoot $root) -ne $root) { throw 'Default project root not retained.' }
if ((Resolve-PeerDelegationRoots) -ne '') { throw 'Fresh installation must not implicitly enroll the installer origin.' }
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
if ((Resolve-PeerWorkspaceMode) -ne 'AUTO_ACTIVE') { throw 'Fresh installation must support active workspaces.' }
if ((Resolve-PeerWorkspaceMode -HasExistingRoots $true) -ne 'STRICT_ROOTS') { throw 'Ambiguous legacy roots must remain restrictive.' }
if ((Resolve-PeerWorkspaceMode -Requested 'AUTO_ACTIVE' -HasExistingRoots $true) -ne 'AUTO_ACTIVE') { throw 'Explicit migration ignored.' }
if ((Resolve-PeerWorkspaceMode -Existing @('STRICT_ROOTS')) -ne 'STRICT_ROOTS') { throw 'Explicit strict policy lost.' }
$rejected = $false
try { Resolve-PeerWorkspaceMode -Existing @('AUTO_ACTIVE','STRICT_ROOTS') } catch { $rejected = $true }
if (-not $rejected) { throw 'Conflicting workspace policies broadened silently.' }
Write-Host 'PASS: workspace mode defaults and conservative migration'
$legacy = Get-PeerRegistrationWorkspaceMode -Environment @{ PEER_AGENTS_ALLOWED_ROOTS = $project }
$auto = Get-PeerRegistrationWorkspaceMode -Environment @{ PEER_AGENTS_WORKSPACE_MODE = 'AUTO_ACTIVE'; PEER_AGENTS_ALLOWED_ROOTS = $root }
$rejected = $false
try { Resolve-PeerWorkspaceMode -Existing @($legacy,$auto) } catch { $rejected = $true }
if (-not $rejected) { throw 'Mixed legacy strict and explicit auto registrations silently broadened.' }
if ((Resolve-PeerWorkspaceMode -Requested 'AUTO_ACTIVE' -Existing @($legacy,$auto)) -ne 'AUTO_ACTIVE') { throw 'Explicit owner migration did not resolve conflict.' }
