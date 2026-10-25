param([switch]$NoFrontend, [switch]$SkipBuild, [switch]$NoPause)
$ErrorActionPreference = 'Stop'
$launcherExitCode = 1
try {
    $nodeApplication = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    $nodePath = if ($nodeApplication) { $nodeApplication.Source } else { Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' }
    if (-not (Test-Path -LiteralPath $nodePath)) { throw 'Node.js was not found. Install Node.js 22.18 or newer, then run this script again.' }
    $arguments = @((Join-Path $PSScriptRoot 'mvp.mjs'))
    if ($NoFrontend) { $arguments += '--no-frontend' }
    if ($SkipBuild) { $arguments += '--skip-build' }
    & $nodePath @arguments
    $launcherExitCode = $LASTEXITCODE
}
catch {
    Write-Host ('Betweenly could not start: ' + $_.Exception.Message) -ForegroundColor Red
}
if ($launcherExitCode -ne 0) {
    Write-Host ('Check logs in ' + (Join-Path $PSScriptRoot '../.runtime/mvp/logs')) -ForegroundColor Yellow
    if (-not $NoPause -and [Environment]::UserInteractive -and -not [Console]::IsInputRedirected) {
        try { $null = Read-Host 'Press Enter to close' } catch { }
    }
}
exit $launcherExitCode
