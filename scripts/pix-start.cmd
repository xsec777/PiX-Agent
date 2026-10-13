@echo off
rem PiX Web UI one-click launcher
rem   checks Node.js / pi / pi-web -> installs if missing -> deploys extension -> starts pi-web
rem Usage: double-click, or run from repo root: scripts\pix-start.cmd
setlocal
cd /d "%~dp0.."

echo ===== PiX Web UI launcher =====

echo [1/5] Checking Node.js...
where node >nul 2>nul
if errorlevel 1 (
  echo   MISSING: Node.js 22+ is required. Install: winget install OpenJS.NodeJS.LTS
  goto :err
)
for /f "delims=" %%v in ('node -v') do echo   Node %%~v OK

echo [2/5] Checking pi / pi-web global packages...
call npm ls -g @earendil-works/pi-coding-agent --depth=0 >nul 2>nul
if errorlevel 1 (
  echo   installing pi...
  call npm install -g @earendil-works/pi-coding-agent >nul 2>&1
  if errorlevel 1 goto :err
) else echo   pi OK
call npm ls -g @agegr/pi-web --depth=0 >nul 2>nul
if errorlevel 1 (
  echo   installing pi-web...
  call npm install -g @agegr/pi-web >nul 2>&1
  if errorlevel 1 goto :err
) else echo   pi-web OK

echo [3/5] Deploying PiX extension (install.mjs)...
call node scripts\install.mjs
if errorlevel 1 goto :err

echo [4/5] Starting pi-web at http://127.0.0.1:30141
start "pix-sync" /min node "%~dp0models-sync.mjs" --watch
call pi-web --no-open

echo.
echo PiX Web UI stopped. (Ctrl+C in this window exits pi-web)
exit /b 0

:err
echo.
echo FAILED. Prerequisites: Node.js 22+, Python 3.10+ (for python tools), Npcap (for scanners).
echo   Node:      winget install OpenJS.NodeJS.LTS
echo   Python:    winget install Python.Python.3.10
echo   Npcap:     https://npcap.com/#download  (check WinPcap-compatible mode)
echo   Then run this launcher again.
pause
exit /b 1
