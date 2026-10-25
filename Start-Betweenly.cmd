@echo off
setlocal
cd /d "%~dp0"
set "betweenlyNode=node"
where node >nul 2>&1
if not errorlevel 1 goto run
set "betweenlyNode=%ProgramFiles%\nodejs\node.exe"
if exist "%betweenlyNode%" goto run
set "betweenlyNode=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%betweenlyNode%" goto run
echo Betweenly could not start: Node.js 22.18 or newer was not found.
set "betweenlyExit=1"
goto done
:run
"%betweenlyNode%" "%~dp0scripts\mvp.mjs" %*
set "betweenlyExit=%errorlevel%"
:done
echo.
if not "%betweenlyExit%"=="0" echo Logs: %~dp0.runtime\mvp\logs
if not defined BETWEENLY_NO_PAUSE pause
exit /b %betweenlyExit%
