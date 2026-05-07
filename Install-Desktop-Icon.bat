@echo off
:: Install-Desktop-Icon.bat
:: Double-click this ONCE to create the Desktop shortcut.
:: After that, use "Glitch Studio Builder" on your Desktop.

setlocal
set "SCRIPT=%~dp0Install-Desktop-Icon.ps1"

if not exist "%SCRIPT%" (
  echo ERROR: Install-Desktop-Icon.ps1 not found.
  echo Expected location: %SCRIPT%
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"
endlocal
