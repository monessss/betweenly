$ErrorActionPreference = 'Stop'
$workspacePath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$runtimePath = Join-Path $workspacePath '.runtime/mvp'
if (-not (Test-Path -LiteralPath (Join-Path $runtimePath 'run.json'))) { Write-Output 'Betweenly MVP is not running.'; exit 0 }
[IO.File]::WriteAllText((Join-Path $runtimePath 'stop'), 'stop')
Write-Output 'Stop requested. The launcher will stop only the processes it started.'
