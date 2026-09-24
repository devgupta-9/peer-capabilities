[CmdletBinding()]
param([switch]$Staged)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path -Parent $PSScriptRoot
$git = Get-Command git -ErrorAction Stop

if ($Staged) {
    $relativeFiles = @(& $git.Source -C $root diff --cached --name-only --diff-filter=ACMR)
} else {
    $relativeFiles = @(& $git.Source -C $root ls-files)
    $relativeFiles += @(& $git.Source -C $root ls-files --others --exclude-standard)
}
if ($LASTEXITCODE -ne 0) { throw 'Could not enumerate Git publication candidates.' }
$relativeFiles = @($relativeFiles | Where-Object { $_ } | Sort-Object -Unique)

$forbiddenNames = '(?i)(^|/)(\.env($|\.)|config\.toml$|mcp_config\.json$|auth\.json$|credentials?[^/]*\.json$|[^/]+\.(pem|key|pfx|p12)$)'
$patterns = [ordered]@{
    private_key = '-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----'
    github_token = 'gh[pousr]_[A-Za-z0-9_]{20,}'
    aws_access_key = 'AKIA[0-9A-Z]{16}'
    google_api_key = 'AIza[0-9A-Za-z_-]{30,}'
    slack_token = 'xox[baprs]-[A-Za-z0-9-]{10,}'
    stripe_secret = 'sk_(?:live|test)_[A-Za-z0-9]{16,}'
    jwt = 'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'
    bearer_value = '(?i)authorization\s*[:=]\s*["'']?bearer\s+[A-Za-z0-9._-]{12,}'
    assigned_secret = '(?i)(?:api[_-]?key|client[_-]?secret|password|access[_-]?token)\s*[:=]\s*["''][^"'']{12,}["'']'
    npm_token = 'npm_[A-Za-z0-9]{30,}'
}
$personalPath = '(?i)\b[A-Z]:\\Users\\(?!you\b|<user>\b)[^\\\s"'']+'
$findings = [System.Collections.Generic.List[object]]::new()

foreach ($relative in $relativeFiles) {
    $normalized = $relative.Replace('\','/')
    if ($normalized -match $forbiddenNames) {
        $findings.Add([pscustomobject]@{category='forbidden_filename';file=$normalized})
        continue
    }
    # The scanner contains its own detection expressions; scan it through review and syntax checks.
    if ($normalized -eq 'scripts/secret-scan.ps1') { continue }
    $full = [IO.Path]::GetFullPath((Join-Path $root $relative))
    if (-not $full.StartsWith([IO.Path]::GetFullPath($root), [StringComparison]::OrdinalIgnoreCase)) {
        $findings.Add([pscustomobject]@{category='path_escape';file=$normalized})
        continue
    }
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { continue }
    $bytes = [IO.File]::ReadAllBytes($full)
    if ($bytes -contains 0) { continue }
    $text = [Text.Encoding]::UTF8.GetString($bytes)
    if ([regex]::IsMatch($text,$personalPath)) {
        $findings.Add([pscustomobject]@{category='personal_absolute_path';file=$normalized})
    }
    foreach ($entry in $patterns.GetEnumerator()) {
        if ([regex]::IsMatch($text,$entry.Value)) {
            $findings.Add([pscustomobject]@{category=$entry.Key;file=$normalized})
        }
    }
}

$unique = @($findings | Sort-Object category,file -Unique)
if ($unique.Count) {
    $unique | ForEach-Object { Write-Error ("{0}: {1}" -f $_.category,$_.file) }
    [pscustomobject]@{ok=$false;filesScanned=$relativeFiles.Count;findingCount=$unique.Count} | ConvertTo-Json -Compress
    exit 1
}
[pscustomobject]@{ok=$true;filesScanned=$relativeFiles.Count;findingCount=0;scope=if($Staged){'staged'}else{'tracked-and-untracked'}} | ConvertTo-Json -Compress
