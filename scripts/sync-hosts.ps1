[CmdletBinding()]
param(
    [ValidateSet('codex','antigravity-cli','antigravity-ide','claude-code','claude-desktop')][string[]]$Hosts = @('codex','antigravity-cli'),
    [string]$Origin = (Split-Path -Parent $PSScriptRoot),
    [string]$RuntimeRoot,
    [string]$HomeRoot = [Environment]::GetFolderPath('UserProfile'),
    [string]$JevEntry,
    [string]$ReaEntry,
    [ValidateSet('peer-agents','graphify','headroom','jev','rea')][string[]]$Servers = @('peer-agents','graphify','headroom','jev'),
    [hashtable]$PeerEnvironment = @{},
    [string]$CodexPeerPath,
    [string]$ExpectedDigest,
    [switch]$Apply,
    [string]$Rollback
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $IsWindows) { throw 'This host resolver currently supports Windows only; the reconciliation core is portable.' }
if (-not $RuntimeRoot) { $RuntimeRoot = Join-Path $Origin 'peer-agents' }
if (-not $JevEntry) { $JevEntry = Join-Path $Origin 'tools\jev\node_modules\@jkudish\jev-mcp\dist\index.js' }
if (-not $ReaEntry) { $ReaEntry = Join-Path $Origin 'tools\rea\node_modules\rea-agents\scripts\rea.mjs' }
$nodePath = (Get-Command node -ErrorAction Stop).Source
$entry = Join-Path $RuntimeRoot 'dist\host-configuration-cli.js'
if (-not (Test-Path -LiteralPath $entry -PathType Leaf)) { throw 'Build or install the current runtime before host setup.' }
$request = @{ action='preview'; root=$HomeRoot; targets=@() }
if ($Rollback) { $request.action='rollback'; $request.operation=$Rollback }
else {
    $manifest = Get-Content -LiteralPath (Join-Path $Origin 'integrations.json') -Raw | ConvertFrom-Json -AsHashtable
    if ($manifest.schemaVersion -ne 3) { throw 'Unsupported host manifest version.' }
    $uvBin = (& uv tool dir --bin).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Could not resolve installed local tools.' }
    if (-not $CodexPeerPath) { $CodexPeerPath = (Get-Command codex.exe -ErrorAction SilentlyContinue)?.Source }
    $tokens = @{
        '${ORIGIN}'=$Origin; '${PEER_RUNTIME}'=$RuntimeRoot; '${NODE_BIN}'=$nodePath;
        '${POWERSHELL_BIN}'=(Get-Command pwsh).Source; '${UV_BIN}'=$uvBin;
        '${AGY_BIN}'=(Get-Command agy -ErrorAction SilentlyContinue)?.Source;
        '${CODEX_PEER_BIN}'=$CodexPeerPath;
        '${JEV_ENTRY}'=$JevEntry; '${REA_ENTRY}'=$ReaEntry
    }
    function Expand-Registration($Value) {
        if ($Value -is [string]) {
            foreach ($token in $tokens.Keys) { if ($Value.Contains($token)) {
                if (-not $tokens[$token]) { throw "Missing local runtime for $token" }
                $Value = $Value.Replace($token, $tokens[$token])
            } }
            if ($Value -match '\$\{[^}]+\}') { throw 'Unknown manifest token.' }
            return $Value
        }
        if ($Value -is [System.Collections.IDictionary]) {
            $result=@{}; foreach ($key in $Value.Keys) { $result[$key]=Expand-Registration $Value[$key] }; return $result
        }
        if ($Value -is [array]) { return ,@($Value | ForEach-Object { Expand-Registration $_ }) }
        throw 'Unexpected manifest value.'
    }
    $paths = @{
        'codex'='.codex/config.toml'; 'antigravity-cli'='.gemini/config/mcp_config.json';
        'antigravity-ide'='.gemini/antigravity/mcp_config.json'; 'claude-code'='.claude.json'
    }
    if ('claude-desktop' -in $Hosts) {
        $candidates = @('AppData/Roaming/Claude/claude_desktop_config.json')
        $packages = Join-Path $HomeRoot 'AppData/Local/Packages'
        if (Test-Path -LiteralPath $packages) {
            foreach ($package in Get-ChildItem -LiteralPath $packages -Directory -Filter 'Claude_*') {
                $candidates += "AppData/Local/Packages/$($package.Name)/LocalCache/Roaming/Claude/claude_desktop_config.json"
            }
        }
        $found = @($candidates | Where-Object { Test-Path -LiteralPath (Join-Path $HomeRoot $_) -PathType Leaf })
        if ($found.Count -ne 1) { throw 'Claude Desktop config absent or ambiguous; open/configure the intended app first.' }
        $paths['claude-desktop']=$found[0]
    }
    $bindings=@{}
    foreach ($hostName in ($Hosts | Select-Object -Unique)) {
        $hostServers=@{}
        $components=@{}
        foreach ($name in $manifest.hosts[$hostName]) {
            if ($name -notin $Servers) { continue }
            $server = Expand-Registration $manifest.sharedServers[$name]
            if ($name -eq 'peer-agents' -and $PeerEnvironment.Count) { $server.envOverrides = $PeerEnvironment }
            foreach ($file in @($server.command) + @($server.args | Where-Object { [IO.Path]::IsPathFullyQualified($_) })) {
                if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing installed entrypoint for $hostName/$name" }
            }
            $hostServers[$name]=$server
            if ($name -eq 'peer-agents') { $components[$name]=@{runtimeRoot=$RuntimeRoot} }
            if ($name -eq 'jev') { $components[$name]=@{runtimeRoot=$RuntimeRoot;entry=$JevEntry} }
            if ($name -eq 'rea') { $components[$name]=@{entry=$ReaEntry} }
        }
        if ($components.Count) { $bindings[$hostName]=$components }
        $request.targets += @{ host=$hostName; relativePath=$paths[$hostName]; format=$(if($hostName -eq 'codex'){'codex-toml'}else{'mcp-json'}); servers=$hostServers }
    }
    if ($Apply) {
        if (-not $ExpectedDigest) { throw 'Preview first, then pass -Apply -ExpectedDigest <digest>.' }
        $request.action='apply'; $request.expectedDigest=$ExpectedDigest
        $request.bindings=$bindings
    }
}
$request | ConvertTo-Json -Depth 20 -Compress | & $nodePath $entry
if ($LASTEXITCODE -ne 0) { throw 'Host reconciliation failed; existing configuration details withheld.' }
