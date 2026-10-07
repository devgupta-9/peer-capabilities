function Resolve-PeerDelegationRoots {
    param([string[]]$Requested = @(), [string[]]$Existing = @(), [Parameter(Mandatory)][string]$DefaultRoot)
    $candidates = if ($Requested.Count) { $Requested } elseif ($Existing.Count) { $Existing } else { @($DefaultRoot) }
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
