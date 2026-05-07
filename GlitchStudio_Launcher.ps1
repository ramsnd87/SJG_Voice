#Requires -Version 5.0
# Glitch Studio Builder — Quality-Gated Launcher
# Checks every dependency before touching the app; shows GUI dialogs on failure.

$ErrorActionPreference = "SilentlyContinue"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$appDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$appName = "Glitch Studio Builder"

# ── Helpers ───────────────────────────────────────────────────────────────────

function Show-Error {
    param([string]$msg)
    [System.Windows.Forms.MessageBox]::Show(
        $msg, $appName,
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
}

function Show-Info {
    param([string]$title, [string]$msg)
    $form            = New-Object System.Windows.Forms.Form
    $form.Text       = $title
    $form.Size       = New-Object System.Drawing.Size(420, 115)
    $form.StartPosition   = "CenterScreen"
    $form.FormBorderStyle = "FixedDialog"
    $form.MaximizeBox = $false; $form.MinimizeBox = $false
    $form.TopMost    = $true

    $lbl            = New-Object System.Windows.Forms.Label
    $lbl.Text       = $msg
    $lbl.AutoSize   = $false
    $lbl.Size       = New-Object System.Drawing.Size(390, 55)
    $lbl.Location   = New-Object System.Drawing.Point(12, 14)
    $lbl.Font       = New-Object System.Drawing.Font("Segoe UI", 10)
    $form.Controls.Add($lbl)
    $form.Show()
    $form.Refresh()
    return $form
}

# ── 1. Node.js ────────────────────────────────────────────────────────────────
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Show-Error "Node.js is not installed or not in PATH.`n`nInstall Node.js v18+ from https://nodejs.org and try again."
    exit 1
}

$rawVer    = node --version 2>&1
$majorStr  = ($rawVer -replace '^v?(\d+).*','$1').Trim()
$nodeMajor = if ($majorStr -match '^\d+$') { [int]$majorStr } else { 0 }

if ($nodeMajor -lt 18) {
    Show-Error "Node.js $rawVer detected — v18 or later is required.`n`nUpdate at https://nodejs.org"
    exit 1
}

# ── 2. npm ────────────────────────────────────────────────────────────────────
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Show-Error "npm is not available.`n`nReinstall Node.js from https://nodejs.org"
    exit 1
}

# ── 3. ffmpeg (non-blocking — Clip Studio surfaces its own warning in-app) ────
# Intentionally no popup here; absence is a soft degradation, not a crash.

# ── 4. npm install (first run or missing node_modules) ────────────────────────
$nodeModulesPath = Join-Path $appDir "node_modules"

if (-not (Test-Path $nodeModulesPath)) {
    $installDialog = Show-Info $appName "First-time setup: installing dependencies...`nThis takes about 30 seconds. Please wait."

    $installProc = Start-Process "npm" `
        -ArgumentList "install" `
        -WorkingDirectory $appDir `
        -WindowStyle Hidden `
        -Wait -PassThru

    $installDialog.Close()

    if ($installProc.ExitCode -ne 0) {
        Show-Error "Dependency installation failed (npm exit code $($installProc.ExitCode)).`n`nCheck your internet connection and try again."
        exit 1
    }
}

# ── 5. Clear stale port locks (8044 = sidecar, 5193 = Vite) ──────────────────
foreach ($port in @(8044, 5193)) {
    $netLines = netstat -ano 2>$null | Select-String "\s:${port}\s"
    foreach ($line in $netLines) {
        $parts = ($line.Line.Trim() -split '\s+')
        $pidStr = $parts[-1]
        if ($pidStr -match '^\d+$' -and [int]$pidStr -gt 4) {
            Stop-Process -Id ([int]$pidStr) -Force -ErrorAction SilentlyContinue
        }
    }
}

# ── 6. Launch ─────────────────────────────────────────────────────────────────
# Run npm run dev in a hidden cmd window.
# concurrently -k kills Vite + sidecar automatically when Electron closes.
# Electron's GUI window appears normally regardless of parent console visibility.
$launchProc = Start-Process "cmd.exe" `
    -ArgumentList "/c npm run dev" `
    -WorkingDirectory $appDir `
    -WindowStyle Hidden `
    -PassThru

if (-not $launchProc -or $launchProc.Id -eq 0) {
    Show-Error "Failed to start Glitch Studio Builder.`n`nMake sure npm is installed and working, then try again."
    exit 1
}

# Launcher exits cleanly — Electron is now live.
exit 0
