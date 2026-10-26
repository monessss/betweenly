$ErrorActionPreference = 'Stop'
$accountRuntime = Join-Path $PSScriptRoot '../.runtime/web'
if (-not (Test-Path -LiteralPath (Join-Path $accountRuntime 'run.json'))) {
    Write-Host 'No web backend launcher registry found.'
    exit 0
}
Set-Content -LiteralPath (Join-Path $accountRuntime 'stop') -Value 'stop'
Write-Host 'Web backend stop requested. Data is preserved.'
