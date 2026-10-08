function Resolve-PeerDelegationRoots {
    param([string[]]$Requested = @(), [string[]]$Existing = @(), [string]$DefaultRoot = '')
    $candidates = if ($Requested.Count) { $Requested } elseif ($Existing.Count) { $Existing } elseif ($DefaultRoot) { @($DefaultRoot) } else { @() }
    $resolved = foreach ($candidate in $candidates) {
        if (-not [IO.Path]::IsPathFullyQualified($candidate)) { throw 'Delegation roots must be absolute project paths.' }
        $item = Get-Item -LiteralPath $candidate -ErrorAction Stop
        if (-not $item.PSIsContainer) { throw "Delegation root is not a directory: $candidate" }
        $item.FullName
    }
    return (($resolved | Sort-Object -Unique) -join [IO.Path]::PathSeparator)
}

function Resolve-AntigravitySandboxMode {
    param([string]$Requested = '', [string[]]$Existing = @())
    $modes = @(if ($Requested) { $Requested } else { $Existing | Where-Object { $_ } | Sort-Object -Unique })
    if (-not $modes.Count) { return 'required' }
    if ($modes.Count -ne 1 -or $modes[0] -notin @('required', 'permissions-only')) {
        throw 'Conflicting or invalid Antigravity sandbox modes. Select required or permissions-only explicitly.'
    }
    return $modes[0]
}

function Resolve-PeerWorkspaceMode {
    param([string]$Requested = '', [string[]]$Existing = @(), [bool]$HasExistingRoots = $false)
    $modes = @(if ($Requested) { $Requested } else { $Existing | Where-Object { $_ } | Sort-Object -Unique })
    if (-not $modes.Count) {
        if ($HasExistingRoots) { return 'STRICT_ROOTS' }
        return 'AUTO_ACTIVE'
    }
    if ($modes.Count -ne 1 -or $modes[0] -notin @('AUTO_ACTIVE', 'STRICT_ROOTS')) {
        throw 'Conflicting or invalid workspace policies. Select AUTO_ACTIVE or STRICT_ROOTS explicitly.'
    }
    return $modes[0]
}

function Get-PeerRegistrationWorkspaceMode {
    param([System.Collections.IDictionary]$Environment)
    if (-not $Environment) { return 'AUTO_ACTIVE' }
    if ($Environment.Contains('PEER_AGENTS_WORKSPACE_MODE') -and $Environment['PEER_AGENTS_WORKSPACE_MODE']) {
        return Resolve-PeerWorkspaceMode -Requested $Environment['PEER_AGENTS_WORKSPACE_MODE']
    }
    $hasRoots = $Environment.Contains('PEER_AGENTS_ALLOWED_ROOTS') -and -not [string]::IsNullOrWhiteSpace($Environment['PEER_AGENTS_ALLOWED_ROOTS'])
    return Resolve-PeerWorkspaceMode -HasExistingRoots $hasRoots
}
