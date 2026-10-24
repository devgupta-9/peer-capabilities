[CmdletBinding()]
param([string]$NodePath, [string]$EntryPath, [switch]$Check)
$ErrorActionPreference = 'Stop'

# Provider-owned environment only: never serialize values into config or reports.
function Get-JevEnvironment {
    param([scriptblock]$Read = { param($Name,$Scope) [Environment]::GetEnvironmentVariable($Name,$Scope) })
    $result = @{}
    foreach ($name in @('PATH','PATHEXT','SYSTEMROOT','WINDIR','COMSPEC','TEMP','TMP','HOME','USERPROFILE','APPDATA','LOCALAPPDATA','LANG','HTTPS_PROXY','HTTP_PROXY','NO_PROXY')) {
        $value = & $Read $name 'Process'
        if ($value) { $result[$name] = $value }
    }
    foreach ($name in @('TYPESAFE_API_KEY','OPENROUTER_API_KEY','JEV_CLOUDFLARE_API_TOKEN','CLOUDFLARE_API_TOKEN','CLOUDFLARE_ACCOUNT_ID','JEV_PROVIDER','JEV_MODEL','JEV_MCP_MODEL')) {
        $value = & $Read $name 'Process'
        if (-not $value -and $IsWindows) { $value = & $Read $name 'User' }
        if ($value) { $result[$name] = $value }
    }
    return $result
}

if ($MyInvocation.InvocationName -ne '.') {
    $environment = Get-JevEnvironment
    if ($Check) {
        [pscustomobject]@{ credentialPresent = [bool]($environment.TYPESAFE_API_KEY -or $environment.OPENROUTER_API_KEY -or
            (($environment.JEV_CLOUDFLARE_API_TOKEN -or $environment.CLOUDFLARE_API_TOKEN) -and $environment.CLOUDFLARE_ACCOUNT_ID));
            authentication = 'UNVERIFIED' } | ConvertTo-Json -Compress
        exit 0
    }
    foreach ($file in @($NodePath,$EntryPath)) {
        if (-not [IO.Path]::IsPathFullyQualified($file) -or -not (Test-Path -LiteralPath $file -PathType Leaf)) { throw 'Jev launcher requires existing absolute runtime paths.' }
    }
    $info = [Diagnostics.ProcessStartInfo]::new($NodePath)
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardInput = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.ArgumentList.Add($EntryPath)
    $info.Environment.Clear()
    foreach ($key in $environment.Keys) { $info.Environment[$key] = $environment[$key] }
    $child = [Diagnostics.Process]::Start($info)
    try {
        $inputPump = [Console]::OpenStandardInput().CopyToAsync($child.StandardInput.BaseStream)
        $outputPump = $child.StandardOutput.BaseStream.CopyToAsync([Console]::OpenStandardOutput())
        $errorPump = $child.StandardError.BaseStream.CopyToAsync([Console]::OpenStandardError())
        while (-not $child.WaitForExit(100)) {
            if ($inputPump.IsCompleted) { $child.StandardInput.Close() }
        }
        [Threading.Tasks.Task]::WaitAll(@($outputPump,$errorPump))
        exit $child.ExitCode
    }
    finally { if (-not $child.HasExited) { $child.Kill($true) }; $child.Dispose() }
}
