[CmdletBinding()]
param(
    [switch]$DryRun,
    [switch]$SkipToolInstall,
    [switch]$SkipMcpRegistration,
    [switch]$SkipHeadroomProxy,
    [switch]$SkipAntigravitySafety,
    [switch]$GrantAntigravityInspection,
    [string[]]$DelegationRoots = @(),
    [ValidateSet('AUTO_ACTIVE', 'STRICT_ROOTS')][string]$WorkspaceAuthorizationMode,
    [ValidateSet('required', 'permissions-only')][string]$AntigravitySandboxMode
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not $IsWindows) { throw 'This installer currently supports Windows only.' }
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'PowerShell 7 or newer is required.' }

$origin = [IO.Path]::GetFullPath($PSScriptRoot)
. (Join-Path $origin 'scripts\peer-roots.ps1')
$userRoot = [Environment]::GetFolderPath('UserProfile')
$expectedOrigin = [IO.Path]::GetFullPath((Join-Path $userRoot '.ai-rules'))
$backupRoot = Join-Path $userRoot '.ai-rules-backups'
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$installBackup = Join-Path $backupRoot ('install-' + $timestamp)

if ($origin.TrimEnd('\') -ne $expectedOrigin.TrimEnd('\')) {
    throw "Install from $expectedOrigin. Use bootstrap.ps1 to clone the repository there safely."
}

function Resolve-Tool([string]$Name) {
    $command = Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $command) { throw "Required command is unavailable: $Name" }
    return $command.Source
}

function Resolve-NativeCodexExecutable {
    $applications = @(Get-Command 'codex.exe' -CommandType Application -All -ErrorAction SilentlyContinue)
    foreach ($application in $applications) {
        if (Test-Path -LiteralPath $application.Source -PathType Leaf) { return $application.Source }
    }
    $npmPackageRoot = Join-Path $env:APPDATA 'npm\node_modules\@openai\codex\node_modules\@openai'
    if (Test-Path -LiteralPath $npmPackageRoot -PathType Container) {
        $candidate = Get-ChildItem -LiteralPath $npmPackageRoot -Filter 'codex.exe' -File -Recurse -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($candidate) { return $candidate.FullName }
    }
    throw 'A native codex.exe could not be resolved. PowerShell and cmd shims cannot be launched safely by peer-agents with shell=false.'
}

function Backup-LocalConfig([string]$Path, [string]$Name) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }
    New-Item -ItemType Directory -Path $installBackup -Force | Out-Null
    Copy-Item -LiteralPath $Path -Destination (Join-Path $installBackup $Name) -Force
}

function Read-JsonHashtable([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return @{} }
    try {
        return [IO.File]::ReadAllText($Path) | ConvertFrom-Json -AsHashtable
    } catch {
        throw "Cannot safely update invalid JSON configuration: $Path"
    }
}

function Write-JsonHashtable([string]$Path, [hashtable]$Value) {
    $directory = Split-Path -Parent $Path
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    $temporary = $Path + '.peer-capabilities.tmp'
    $json = $Value | ConvertTo-Json -Depth 100
    [IO.File]::WriteAllText($temporary, $json + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Invoke-Checked {
    param([string]$Command, [string[]]$Arguments, [switch]$Quiet)
    $display = $Command + ' ' + (($Arguments | ForEach-Object {
        if ($_ -match '\s') { '"' + $_ + '"' } else { $_ }
    }) -join ' ')
    if ($DryRun) {
        Write-Host "[dry-run] $display"
        return
    }
    if ($Quiet) { & $Command @Arguments *> $null } else { & $Command @Arguments }
    if ($LASTEXITCODE -ne 0) { throw ("Command failed with exit code {0}: {1}" -f $LASTEXITCODE,$display) }
}

function Ensure-UvTool([string]$Package, [string]$Version, [string]$Requirement, [string]$LockFile, [string]$RequiredModule = '') {
    if (-not (Test-Path -LiteralPath $LockFile -PathType Leaf)) {
        throw "Dependency lock file is missing: $LockFile"
    }
    $listing = @(& $script:uvPath tool list)
    if ($LASTEXITCODE -ne 0) { throw 'Could not inspect installed uv tools.' }
    $versionMatches = $listing -match ('^' + [regex]::Escape($Package) + ' v' + [regex]::Escape($Version) + '$')
    if ($versionMatches -and $RequiredModule) {
        $toolRoot = (& $script:uvPath tool dir).Trim()
        $toolPython = Join-Path $toolRoot "$Package\Scripts\python.exe"
        if (Test-Path -LiteralPath $toolPython) {
            & $toolPython -c "import $RequiredModule" *> $null
            $versionMatches = $LASTEXITCODE -eq 0
        } else {
            $versionMatches = $false
        }
    }
    if ($versionMatches) {
        Write-Host "$Package $Version with required extras is already installed"
        return
    }
    $alreadyInstalled = $listing -match ('^' + [regex]::Escape($Package) + ' v')
    $arguments = @('tool','install')
    if ($alreadyInstalled) { $arguments += '--force' }
    $arguments += @('--with-requirements',$LockFile)
    $arguments += $Requirement
    try {
        Invoke-Checked $script:uvPath $arguments
    } catch {
        if ($alreadyInstalled) {
            throw "Could not replace $Package while its files may be in use. Close connected host sessions and run install.ps1 again."
        }
        throw
    }
}

function Set-CodexMcpOptions([string]$ConfigPath, [string]$Name, [int]$TimeoutSeconds) {
    if ($DryRun) {
        Write-Host "[dry-run] set Codex MCP $Name enabled=true and tool_timeout_sec=$TimeoutSeconds"
        return
    }
    if (-not (Test-Path -LiteralPath $ConfigPath)) { throw "Codex config was not created: $ConfigPath" }
    $text = [IO.File]::ReadAllText($ConfigPath)
    $sectionPattern = "(?ms)(^\[mcp_servers\.$([regex]::Escape($Name))\]\s*\r?\n)(.*?)(?=^\[|\z)"
    $match = [regex]::Match($text, $sectionPattern)
    if (-not $match.Success) { throw "Codex MCP section was not found after registration: $Name" }
    $body = $match.Groups[2].Value
    if ($body -match '(?m)^enabled\s*=') {
        $body = [regex]::Replace($body, '(?m)^enabled\s*=.*$', 'enabled = true')
    } else {
        $body += 'enabled = true' + [Environment]::NewLine
    }
    if ($body -match '(?m)^tool_timeout_sec\s*=') {
        $body = [regex]::Replace($body, '(?m)^tool_timeout_sec\s*=.*$', "tool_timeout_sec = $TimeoutSeconds")
    } else {
        $body += "tool_timeout_sec = $TimeoutSeconds" + [Environment]::NewLine
    }
    $updated = $text.Substring(0, $match.Index) + $match.Groups[1].Value + $body + $text.Substring($match.Index + $match.Length)
    $temporary = $ConfigPath + '.peer-capabilities.tmp'
    [IO.File]::WriteAllText($temporary, $updated, [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $ConfigPath -Force
}

function Register-CodexMcp {
    param(
        [string]$Name,
        [string]$Command,
        [string[]]$Arguments,
        [hashtable]$Environment = @{},
        [int]$TimeoutSeconds = 120
    )
    if (-not $DryRun) { & $script:codexPath mcp remove $Name *> $null }
    $add = @('mcp','add',$Name)
    foreach ($key in ($Environment.Keys | Sort-Object)) {
        $add += @('--env', "$key=$($Environment[$key])")
    }
    $add += '--'
    $add += $Command
    $add += $Arguments
    Invoke-Checked $script:codexPath $add
    Set-CodexMcpOptions (Join-Path $userRoot '.codex\config.toml') $Name $TimeoutSeconds
}

function Register-AntigravityMcp {
    param(
        [string]$Name,
        [string]$Command,
        [string[]]$Arguments,
        [hashtable]$Environment = @{}
    )
    $add = @('mcp','add')
    foreach ($key in ($Environment.Keys | Sort-Object)) {
        $add += @('--env', "$key=$($Environment[$key])")
    }
    $add += @($Name, $Command)
    $add += $Arguments
    Invoke-Checked $script:agyPath $add
    Invoke-Checked $script:agyPath @('mcp','enable',$Name)
}

function Set-AntigravitySafetySettings {
    $idePath = Join-Path $userRoot '.gemini\config\config.json'
    $cliPath = Join-Path $userRoot '.gemini\antigravity-cli\settings.json'
    if ($DryRun) {
        Write-Host '[dry-run] back up and enforce Antigravity review, Git-deny, and broad-trust safety settings'
        return
    }

    Backup-LocalConfig $idePath 'antigravity-config.json'
    Backup-LocalConfig $cliPath 'antigravity-cli-settings.json'

    $ide = Read-JsonHashtable $idePath
    if (-not $ide.ContainsKey('userSettings') -or $ide.userSettings -isnot [hashtable]) {
        $ide.userSettings = @{}
    }
    $expectations = [ordered]@{
        artifactReviewMode = 'ARTIFACT_REVIEW_MODE_ALWAYS'
        autoExecutionPolicy = 'CASCADE_COMMANDS_AUTO_EXECUTION_OFF'
        browserJsExecutionPolicy = 'BROWSER_JS_EXECUTION_POLICY_ALWAYS_ASK'
    }
    foreach ($entry in $expectations.GetEnumerator()) {
        $ide.userSettings[$entry.Key] = $entry.Value
    }
    Write-JsonHashtable $idePath $ide

    $cli = Read-JsonHashtable $cliPath
    if (-not $cli.ContainsKey('permissions') -or $cli.permissions -isnot [hashtable]) {
        $cli.permissions = @{}
    }
    $denyRule = 'command(regex:\bgit(?:\.exe)?\s+.*\b(push|pull|fetch|merge|rebase|checkout|switch|reset|restore|stash|clean|commit|add|rm|mv)\b.*)'
    $deny = @($cli.permissions['deny'] | Where-Object { $_ -is [string] })
    if ($denyRule -notin $deny) {
        $deny += $denyRule
    }
    $cli.permissions.deny = $deny
    # Windows headless command matching may require the complete command line.
    # These anchored rules authorize inspection only, never arbitrary arguments/chains.
    $readCommands = @('git status', 'git status --short', 'git status --porcelain=v1',
        'git diff', 'git diff --stat', 'git diff --name-only', 'git log -5 --oneline',
        'git branch --show-current', 'git rev-parse --show-toplevel', 'git ls-files')
    $allow = @($cli.permissions['allow'] | Where-Object { $_ -is [string] })
    foreach ($command in $(if ($GrantAntigravityInspection) { $readCommands } else { @() })) {
        # The Windows terminal backend can require a separate unsandboxed grant.
        # Scope it to the same exact inspection command, not command(*) or a CLI bypass.
        foreach ($action in @('command', 'unsandboxed')) {
            $rule = $action + '(regex:^' + $command + '$)'
            if ($rule -notin $allow) { $allow += $rule }
        }
    }
    $cli.permissions.allow = $allow

    $broadTrust = @(
        (Join-Path $env:SystemRoot 'System32').TrimEnd('\').ToLowerInvariant(),
        $userRoot.TrimEnd('\').ToLowerInvariant(),
        'd:'
    )
    $cli.trustedWorkspaces = @($cli['trustedWorkspaces'] | Where-Object {
        $_ -is [string] -and $_.TrimEnd('\').ToLowerInvariant() -notin $broadTrust
    })
    Write-JsonHashtable $cliPath $cli
}

function Test-HeadroomHealth {
    try {
        $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 4
        return $health.status -eq 'healthy'
    } catch {
        return $false
    }
}

function Install-HeadroomRouting([string]$HeadroomPath) {
    if ($SkipHeadroomProxy) { return }
    Invoke-Checked $HeadroomPath @('init','-g','--port','8787','codex')
    if ($DryRun) {
        Write-Host '[dry-run] create current-user Headroom startup shortcut and start proxy if needed'
        return
    }
    $startup = [Environment]::GetFolderPath('Startup')
    $shortcutPath = Join-Path $startup 'Headroom Codex Proxy.lnk'
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = (Get-Command powershell.exe -ErrorAction Stop).Source
    $escapedHeadroom = $HeadroomPath.Replace("'","''")
    $shortcut.Arguments = '-NoProfile -WindowStyle Hidden -Command "& ''' + $escapedHeadroom + ''' proxy --host 127.0.0.1 --port 8787 --mode cache --no-telemetry"'
    $shortcut.WorkingDirectory = $userRoot
    $shortcut.Save()
    if (-not (Test-HeadroomHealth)) {
        Start-Process -FilePath $HeadroomPath -ArgumentList @('proxy','--host','127.0.0.1','--port','8787','--mode','cache','--no-telemetry') -WorkingDirectory $userRoot -WindowStyle Hidden
        $deadline = [DateTime]::UtcNow.AddSeconds(30)
        do {
            Start-Sleep -Milliseconds 500
            if (Test-HeadroomHealth) { break }
        } while ([DateTime]::UtcNow -lt $deadline)
        if (-not (Test-HeadroomHealth)) { throw 'Headroom proxy did not become healthy on 127.0.0.1:8787.' }
    }
}

$gitPath = Resolve-Tool 'git'
$nodePath = Resolve-Tool 'node'
$npmPath = Resolve-Tool 'npm'
$uvPath = Resolve-Tool 'uv'
$codexPath = Resolve-Tool 'codex'
$codexPeerPath = Resolve-NativeCodexExecutable
$agyPath = Resolve-Tool 'agy'

$nodeVersion = (& $nodePath --version).TrimStart('v')
if ($LASTEXITCODE -ne 0 -or [int]($nodeVersion.Split('.')[0]) -lt 24) {
    throw "Node.js 24 or newer is required; found $nodeVersion"
}

Write-Host '1/7 Auditing publishable sources'
Invoke-Checked (Resolve-Tool 'pwsh') @('-NoProfile','-File',(Join-Path $origin 'scripts\secret-scan.ps1'))

if (-not $SkipToolInstall) {
    Write-Host '2/7 Installing pinned local tools'
    Push-Location (Join-Path $origin 'peer-agents')
    try {
        Invoke-Checked $npmPath @('ci','--ignore-scripts')
        Invoke-Checked $npmPath @('run','typecheck')
        Invoke-Checked $npmPath @('run','build')
        Invoke-Checked $npmPath @('test')
    } finally {
        Pop-Location
    }
    Push-Location (Join-Path $origin 'tools\jev')
    try {
        Invoke-Checked $npmPath @('ci','--omit=dev','--ignore-scripts')
    } finally {
        Pop-Location
    }
    Ensure-UvTool 'graphifyy' '0.9.63' 'graphifyy[mcp]==0.9.63' (Join-Path $origin 'tools\graphify\requirements.lock') 'mcp'
    Ensure-UvTool 'headroom-ai' '0.37.0' 'headroom-ai==0.37.0' (Join-Path $origin 'tools\headroom\requirements.lock')
} else {
    Write-Host '2/7 Skipping local tool installation by request'
}

$uvBin = (& $uvPath tool dir --bin).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Could not resolve the uv tool binary directory.' }
$graphifyPath = Join-Path $uvBin 'graphify-mcp.exe'
$headroomPath = Join-Path $uvBin 'headroom.exe'
$peerPath = Join-Path $origin 'peer-agents\dist\index.js'
$jevPath = Join-Path $origin 'tools\jev\node_modules\@jkudish\jev-mcp\dist\index.js'
foreach ($requiredPath in @($graphifyPath,$headroomPath,$peerPath,$jevPath)) {
    if (-not $DryRun -and -not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        throw "Installed entrypoint is missing: $requiredPath"
    }
}

Write-Host '3/7 Installing shared policy and orchestrator files'
$duplicateRules = Join-Path $userRoot '.gemini\config\AGENTS.md'
if (Test-Path -LiteralPath $duplicateRules) {
    if ($DryRun) {
        Write-Host "[dry-run] retire duplicate global rules: $duplicateRules"
    } else {
        New-Item -ItemType Directory -Path $installBackup -Force | Out-Null
        Move-Item -LiteralPath $duplicateRules -Destination (Join-Path $installBackup 'retired-gemini-config-AGENTS.md')
    }
}
Invoke-Checked (Resolve-Tool 'pwsh') @('-NoProfile','-File',(Join-Path $origin 'scripts\sync.ps1'),'-Apply')
if ($SkipAntigravitySafety) {
    Write-Host 'Antigravity safety policy changes were skipped by request'
} else {
    Set-AntigravitySafetySettings
}

Write-Host '4/7 Configuring Headroom routing'
Install-HeadroomRouting $headroomPath

if (-not $SkipMcpRegistration) {
    Write-Host '5/7 Registering shared MCP servers'
    # Registration must not silently lose the project policy during remove/add.
    $existingPeerRoots = @()
    $existingSandboxModes = @()
    $existingWorkspaceModes = @()
    if (-not $DelegationRoots.Count -or -not $AntigravitySandboxMode -or -not $WorkspaceAuthorizationMode) {
        $existingCodex = & $codexPath mcp get peer-agents --json 2>$null
        if ($LASTEXITCODE -eq 0 -and $existingCodex) {
            $oldPeer = ($existingCodex -join "`n") | ConvertFrom-Json -AsHashtable
            $oldEnv = if ($oldPeer.ContainsKey('transport')) { $oldPeer['transport']['env'] } else { $oldPeer['env'] }
            if ($oldEnv -and $oldEnv.ContainsKey('PEER_AGENTS_ALLOWED_ROOTS')) {
                $existingPeerRoots += $oldEnv.PEER_AGENTS_ALLOWED_ROOTS.Split([IO.Path]::PathSeparator)
            }
            if ($oldEnv -and $oldEnv.ContainsKey('PEER_AGY_SANDBOX_MODE')) { $existingSandboxModes += $oldEnv.PEER_AGY_SANDBOX_MODE }
            $existingWorkspaceModes += Get-PeerRegistrationWorkspaceMode -Environment $oldEnv
        }
        $agyConfig = Read-JsonHashtable (Join-Path $userRoot '.gemini\config\mcp_config.json')
        if ($agyConfig.ContainsKey('mcpServers') -and $agyConfig.mcpServers.ContainsKey('peer-agents')) {
            $oldEnv = $agyConfig.mcpServers['peer-agents']['env']
            if ($oldEnv -and $oldEnv.ContainsKey('PEER_AGENTS_ALLOWED_ROOTS')) {
                $existingPeerRoots += $oldEnv.PEER_AGENTS_ALLOWED_ROOTS.Split([IO.Path]::PathSeparator)
            }
            if ($oldEnv -and $oldEnv.ContainsKey('PEER_AGY_SANDBOX_MODE')) { $existingSandboxModes += $oldEnv.PEER_AGY_SANDBOX_MODE }
            $existingWorkspaceModes += Get-PeerRegistrationWorkspaceMode -Environment $oldEnv
        }
    }
    $peerRoots = Resolve-PeerDelegationRoots -Requested $DelegationRoots -Existing @($existingPeerRoots | Where-Object { $_ })
    $sandboxMode = Resolve-AntigravitySandboxMode -Requested $AntigravitySandboxMode -Existing $existingSandboxModes
    $workspaceMode = Resolve-PeerWorkspaceMode -Requested $WorkspaceAuthorizationMode -Existing $existingWorkspaceModes -HasExistingRoots ([bool]$existingPeerRoots.Count)
    Write-Host "Workspace policy mode: $workspaceMode. DelegationRoots is optional explicit scope, not a per-project installation step."
    if ($workspaceMode -eq 'STRICT_ROOTS') { Write-Host 'Existing restrictive scope retained. AUTO_ACTIVE requires an explicit policy-owner opt-in.' }
    $peerEnvironment = @{ PEER_AGY_BIN = $agyPath; PEER_CODEX_BIN = $codexPeerPath; PEER_AGENTS_ALLOWED_ROOTS = $peerRoots; PEER_AGY_SANDBOX_MODE = $sandboxMode; PEER_AGENTS_WORKSPACE_MODE = $workspaceMode }
    Register-CodexMcp -Name 'peer-agents' -Command $nodePath -Arguments @($peerPath) -Environment $peerEnvironment -TimeoutSeconds 1980
    Register-CodexMcp -Name 'graphify' -Command $graphifyPath -Arguments @() -Environment @{} -TimeoutSeconds 120
    Register-CodexMcp -Name 'headroom' -Command $headroomPath -Arguments @('mcp','serve') -Environment @{} -TimeoutSeconds 120
    Register-CodexMcp -Name 'jev' -Command $nodePath -Arguments @($jevPath) -Environment @{} -TimeoutSeconds 120
    Register-AntigravityMcp -Name 'peer-agents' -Command $nodePath -Arguments @($peerPath) -Environment $peerEnvironment
    Register-AntigravityMcp -Name 'graphify' -Command $graphifyPath -Arguments @() -Environment @{}
    Register-AntigravityMcp -Name 'headroom' -Command $headroomPath -Arguments @('mcp','serve') -Environment @{}
    Register-AntigravityMcp -Name 'jev' -Command $nodePath -Arguments @($jevPath) -Environment @{}
} else {
    Write-Host '5/7 Skipping MCP registration by request'
}

Write-Host '6/7 Verifying local configuration and fresh MCP discovery'
if (-not $DryRun -and -not $SkipMcpRegistration) {
    $validationArguments = @('-NoProfile','-File',(Join-Path $origin 'scripts\validate.ps1'),'-Probe')
    if (-not $SkipAntigravitySafety) { $validationArguments += '-StrictSecurity' }
    Invoke-Checked (Resolve-Tool 'pwsh') $validationArguments
} else {
    Write-Host '[dry-run/skip] runtime probes were not executed'
}

Write-Host '7/7 Setup complete; real Antigravity delegation remains unverified'
Write-Host 'Verify explicitly with node peer-agents/scripts/doctor-antigravity.mjs --cwd <project> --model <exact-model> --effort <effort> --verify'
$jevKeyPresent = -not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable('TYPESAFE_API_KEY','User')) -or
    -not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable('TYPESAFE_API_KEY','Process'))
[pscustomobject]@{
    installed = -not $DryRun
    origin = $origin
    peerBridge = $peerPath
    headroomProxyHealthy = if($SkipHeadroomProxy -or $DryRun){'not_tested'}else{Test-HeadroomHealth}
    jevCredentialPresent = $jevKeyPresent
    antigravitySafetyEnforced = -not ($DryRun -or $SkipAntigravitySafety)
    antigravityInspectionGrantsRequested = [bool]$GrantAntigravityInspection
    antigravityAuthentication = 'UNKNOWN'
    antigravityDelegation = 'UNVERIFIED'
    restartRequired = -not $DryRun
} | ConvertTo-Json -Compress
