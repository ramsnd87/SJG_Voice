@echo off
setlocal
cd /d "%~dp0"

if not exist "node_modules" (
  echo [Glitch Studio Builder] First-time setup — installing npm dependencies...
  call npm install
  if errorlevel 1 (
    echo [Glitch Studio Builder] npm install failed.
    pause
    exit /b 1
  )
)

echo [Glitch Studio Builder] Starting dev session (Vite + sidecar + Electron)...
call npm run dev
endlocal
