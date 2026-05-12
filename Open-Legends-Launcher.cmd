@echo off
setlocal

REM Always run from this script's folder.
cd /d "%~dp0"

REM Use npm.cmd to avoid PowerShell execution policy issues.
where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo.
  echo [ERROR] Node.js / npm is not installed or not in PATH.
  echo Install Node.js LTS from https://nodejs.org and try again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo First run detected. Installing dependencies...
  call npm.cmd install
  if errorlevel 1 (
    echo.
    echo [ERROR] npm install failed.
    echo.
    pause
    exit /b 1
  )
)

echo Starting Legends Launcher...
call npm.cmd start

endlocal
