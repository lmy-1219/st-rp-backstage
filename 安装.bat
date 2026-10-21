@echo off
setlocal
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22.13 or newer from https://nodejs.org and Git from https://git-scm.com
  pause
  exit /b 1
)
node "%~dp0server\install.mjs" %*
set "install_result=%errorlevel%"
if not "%install_result%"=="0" echo Installation stopped. Read the message above.
pause
exit /b %install_result%
