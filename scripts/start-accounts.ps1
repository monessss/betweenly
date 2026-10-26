param([switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$arguments = @((Join-Path $PSScriptRoot 'accounts.mjs'))
if ($SkipBuild) { $arguments += '--skip-build' }
& node @arguments
exit $LASTEXITCODE
