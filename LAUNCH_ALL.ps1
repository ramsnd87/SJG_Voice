#Requires -Version 5.0
# SAM Production Launcher
# Starts every service, confirms each is healthy, then opens Glitch Studio Builder.
# Nothing to configure. Just double-click LAUNCH_ALL.bat.

param()
$ErrorActionPreference = "SilentlyContinue"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# ── Paths ──────────────────────────────────────────────────────────────────────
$BASE   = "C:\Users\merin_fontvza\OneDrive\RAM LOGISTICS SOLUTIONS LLC\EnginSam"
$GLITCH = "C:\Users\merin_fontvza\OneDrive\Desktop\Glitch_Studio_Builder"

# ── Service manifest ───────────────────────────────────────────────────────────
# Critical = $true  → failure blocks launch (user sees error, nothing opens)
# Critical = $false → failure is shown but launch continues (optional service)
$SERVICES = @(
    [ordered]@{
        Name       = "TTS Voice Server"
        Port       = 8018
        HealthUrl  = "http://127.0.0.1:8018/status"
        ModelGate  = $true     # must also confirm model_loaded: true
        Dir        = "$BASE\tts-server"
        StartCmd   = 'call venv\Scripts\activate.bat && python tts_server.py >> tts_boot.log 2>&1'
        TimeoutSec = 120       # model load can take ~60s on GPU
        Critical   = $true
    },
    [ordered]@{
        Name       = "SAM Backend"
        Port       = 8017
        HealthUrl  = "http://127.0.0.1:8017/health"
        ModelGate  = $false
        Dir        = "$BASE\sam-backend"
        StartCmd   = 'if not exist .env copy .env.example .env >nul 2>&1 & node -r dotenv/config src/server.js dotenv_config_path=.env >> run.log 2>&1'
        TimeoutSec = 30
        Critical   = $false
    },
    [ordered]@{
        Name       = "Engine Server"
        Port       = 3002
        HealthUrl  = "http://127.0.0.1:3002/health"
        ModelGate  = $false
        Dir        = "$BASE\engine-server"
        StartCmd   = 'if not exist node_modules npm install >nul 2>&1 & npm start >> engine.log 2>&1'
        TimeoutSec = 30
        Critical   = $false
    }
)

# ── Colours & fonts ────────────────────────────────────────────────────────────
$C_BG    = [Drawing.Color]::FromArgb(13, 13, 20)
$C_PANEL = [Drawing.Color]::FromArgb(22, 22, 34)
$C_TEXT  = [Drawing.Color]::FromArgb(230, 230, 240)
$C_DIM   = [Drawing.Color]::FromArgb(110, 110, 140)
$C_GOLD  = [Drawing.Color]::FromArgb(255, 195, 40)
$C_GREEN = [Drawing.Color]::FromArgb(72, 210, 120)
$C_RED   = [Drawing.Color]::FromArgb(235, 65, 65)
$C_BLUE  = [Drawing.Color]::FromArgb(80, 155, 255)

$FNT_H   = New-Object Drawing.Font("Segoe UI Semibold", 12)
$FNT_B   = New-Object Drawing.Font("Segoe UI", 10)
$FNT_S   = New-Object Drawing.Font("Segoe UI", 8.5)
$FNT_DOT = New-Object Drawing.Font("Segoe UI", 16, [Drawing.FontStyle]::Bold)

# ── Build the window ───────────────────────────────────────────────────────────
$form = New-Object Windows.Forms.Form
$form.Text            = "SAM — Production Launch"
$form.ClientSize      = New-Object Drawing.Size(500, 310)
$form.StartPosition   = "CenterScreen"
$form.FormBorderStyle = "FixedSingle"
$form.MaximizeBox     = $false
$form.BackColor       = $C_BG
$form.ForeColor       = $C_TEXT
$form.TopMost         = $false

# Header
$lblHead = New-Object Windows.Forms.Label
$lblHead.Text      = "SAM — Production Launch"
$lblHead.Font      = $FNT_H
$lblHead.ForeColor = $C_TEXT
$lblHead.Location  = New-Object Drawing.Point(22, 18)
$lblHead.AutoSize  = $true
$form.Controls.Add($lblHead)

$lblSub = New-Object Windows.Forms.Label
$lblSub.Text      = "Starting services…"
$lblSub.Font      = $FNT_S
$lblSub.ForeColor = $C_DIM
$lblSub.Location  = New-Object Drawing.Point(22, 42)
$lblSub.Size      = New-Object Drawing.Size(456, 18)
$form.Controls.Add($lblSub)

# Service rows
$dots   = [System.Collections.Generic.List[Windows.Forms.Label]]::new()
$states = [System.Collections.Generic.List[Windows.Forms.Label]]::new()
$y = 74

foreach ($svc in $SERVICES) {
    $dot = New-Object Windows.Forms.Label
    $dot.Text      = "●"
    $dot.Font      = $FNT_DOT
    $dot.ForeColor = $C_DIM
    $dot.Location  = New-Object Drawing.Point(18, $y - 4)
    $dot.AutoSize  = $true
    $form.Controls.Add($dot)
    $dots.Add($dot)

    $name = New-Object Windows.Forms.Label
    $name.Text      = $svc.Name
    $name.Font      = $FNT_B
    $name.ForeColor = $C_TEXT
    $name.Location  = New-Object Drawing.Point(48, $y + 1)
    $name.AutoSize  = $true
    $form.Controls.Add($name)

    $port = New-Object Windows.Forms.Label
    $port.Text      = "port $($svc.Port)"
    $port.Font      = $FNT_S
    $port.ForeColor = $C_DIM
    $port.Location  = New-Object Drawing.Point(48, $y + 20)
    $port.AutoSize  = $true
    $form.Controls.Add($port)

    $st = New-Object Windows.Forms.Label
    $st.Text      = "Waiting…"
    $st.Font      = $FNT_S
    $st.ForeColor = $C_DIM
    $st.Size      = New-Object Drawing.Size(200, 18)
    $st.Location  = New-Object Drawing.Point(290, $y + 10)
    $st.TextAlign = [Drawing.ContentAlignment]::MiddleRight
    $form.Controls.Add($st)
    $states.Add($st)

    $y += 52
}

# Divider
$div = New-Object Windows.Forms.Label
$div.Size      = New-Object Drawing.Size(460, 1)
$div.Location  = New-Object Drawing.Point(20, $y + 6)
$div.BackColor = [Drawing.Color]::FromArgb(40, 40, 58)
$form.Controls.Add($div)

# Bottom status line
$lblStatus = New-Object Windows.Forms.Label
$lblStatus.Text      = "Initializing…"
$lblStatus.Font      = $FNT_S
$lblStatus.ForeColor = $C_DIM
$lblStatus.Location  = New-Object Drawing.Point(22, $y + 16)
$lblStatus.Size      = New-Object Drawing.Size(456, 18)
$form.Controls.Add($lblStatus)

# Progress bar
$prog = New-Object Windows.Forms.ProgressBar
$prog.Style    = [Windows.Forms.ProgressBarStyle]::Marquee
$prog.Location = New-Object Drawing.Point(20, $y + 42)
$prog.Size     = New-Object Drawing.Size(460, 12)
$prog.MarqueeAnimationSpeed = 20
$form.Controls.Add($prog)

# ── State the timer tracks ─────────────────────────────────────────────────────
$script:phase         = 0          # 0=init  1=polling  2=launch
$script:svcReady      = @($false, $false, $false)
$script:svcFailed     = @($false, $false, $false)
$script:deadlines     = @($null, $null, $null)
$script:criticalFail  = $false

# ── Helpers ────────────────────────────────────────────────────────────────────
function Set-Dot {
    param([int]$i, [Drawing.Color]$col, [string]$msg)
    $dots[$i].ForeColor  = $col
    $states[$i].ForeColor = $col
    $states[$i].Text     = $msg
}

function Stop-Port {
    param([int]$Port)
    netstat -ano 2>$null | Select-String "\s:${Port}\s" | ForEach-Object {
        $pid_ = ($_.Line.Trim() -split '\s+')[-1]
        if ($pid_ -match '^\d+$' -and [int]$pid_ -gt 4) {
            Stop-Process -Id ([int]$pid_) -Force -ErrorAction SilentlyContinue
        }
    }
}

function Get-Health {
    param([string]$Url)
    try {
        $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        return ($r.Content | ConvertFrom-Json -ErrorAction SilentlyContinue)
    } catch { return $null }
}

function Start-Service {
    param([hashtable]$Svc)
    $psi = New-Object Diagnostics.ProcessStartInfo
    $psi.FileName         = "$env:COMSPEC"
    $psi.Arguments        = "/c `"$($Svc.StartCmd)`""
    $psi.WorkingDirectory = $Svc.Dir
    $psi.UseShellExecute  = $false
    $psi.CreateNoWindow   = $true
    [Diagnostics.Process]::Start($psi) | Out-Null
}

# ── Timer (runs on UI thread — no cross-thread issues) ─────────────────────────
$timer = New-Object Windows.Forms.Timer
$timer.Interval = 1800   # poll every 1.8 s

$timer.Add_Tick({

    # ── Phase 0: kill stale ports, start all services ──────────────────────────
    if ($script:phase -eq 0) {
        $lblSub.Text    = "Clearing stale processes on all ports…"
        $lblStatus.Text = "Ports: 8018  8017  3002  8044  5193"
        @(8018, 8017, 3002, 8044, 5193) | ForEach-Object { Stop-Port -Port $_ }

        for ($i = 0; $i -lt $SERVICES.Count; $i++) {
            $svc = $SERVICES[$i]
            Set-Dot $i $C_GOLD "Starting…"
            Start-Service -Svc $svc
            $script:deadlines[$i] = (Get-Date).AddSeconds($svc.TimeoutSec)
        }

        $lblSub.Text    = "Services launching — confirming connections…"
        $lblStatus.Text = "Waiting for TTS model to load (this takes ~30–60 s)…"
        $script:phase   = 1
        return
    }

    # ── Phase 1: poll health endpoints ────────────────────────────────────────
    if ($script:phase -eq 1) {
        $allDone = $true

        for ($i = 0; $i -lt $SERVICES.Count; $i++) {
            if ($script:svcReady[$i] -or $script:svcFailed[$i]) { continue }

            $svc  = $SERVICES[$i]
            $json = Get-Health -Url $svc.HealthUrl

            if ($null -ne $json) {
                if ($svc.ModelGate) {
                    if ($json.model_loaded -eq $true) {
                        Set-Dot $i $C_GREEN "Ready  ✓"
                        $script:svcReady[$i] = $true
                    } elseif ($json.load_error) {
                        Set-Dot $i $C_RED "Model error — check tts_boot.log"
                        $script:svcFailed[$i]    = $true
                        $script:criticalFail     = $true
                    } else {
                        $msg = if ($json.loading) { "Loading model…" } else { "Waiting for model…" }
                        Set-Dot $i $C_GOLD $msg
                        $allDone = $false
                    }
                } else {
                    Set-Dot $i $C_GREEN "Ready  ✓"
                    $script:svcReady[$i] = $true
                }
            } else {
                # Not yet responding
                if ((Get-Date) -gt $script:deadlines[$i]) {
                    if ($svc.Critical) {
                        Set-Dot $i $C_RED "FAILED — not responding"
                        $script:svcFailed[$i] = $true
                        $script:criticalFail  = $true
                    } else {
                        Set-Dot $i $C_BLUE "Offline  (optional)"
                        $script:svcFailed[$i] = $true   # skip it
                    }
                } else {
                    Set-Dot $i $C_GOLD "Connecting…"
                    $allDone = $false
                }
            }
        }

        # Update bottom status to reflect TTS state
        if (-not $script:svcReady[0] -and -not $script:svcFailed[0]) {
            $elapsed = [int]((Get-Date) - ($script:deadlines[0].AddSeconds(-$SERVICES[0].TimeoutSec))).TotalSeconds
            $lblStatus.Text = "TTS model loading… ($elapsed s elapsed, up to $($SERVICES[0].TimeoutSec) s)"
        }

        # Critical failure — stop everything
        if ($script:criticalFail) {
            $timer.Stop()
            $prog.Style   = [Windows.Forms.ProgressBarStyle]::Blocks
            $prog.Value   = 0
            $lblSub.Text  = "Launch failed — a critical service did not start."
            $lblStatus.Text = "Check the log files in the EnginSam\tts-server\ folder, then try again."
            $prog.BackColor = $C_RED
            return
        }

        # All services resolved (ready or optional-offline)
        $allResolved = $true
        for ($i = 0; $i -lt $SERVICES.Count; $i++) {
            if (-not $script:svcReady[$i] -and -not $script:svcFailed[$i]) { $allResolved = $false }
        }

        if ($allResolved) { $script:phase = 2 }
        return
    }

    # ── Phase 2: everything is up — launch Glitch Studio Builder ──────────────
    if ($script:phase -eq 2) {
        $script:phase   = 3    # prevent re-entry
        $timer.Stop()

        $prog.Style     = [Windows.Forms.ProgressBarStyle]::Blocks
        $prog.Value     = 100
        $lblSub.Text    = "All systems go  —  opening Glitch Studio Builder…"
        $lblStatus.Text = "This window will close automatically."
        $form.Refresh()

        # Launch Glitch — CreateNoWindow keeps concurrently's child processes off the taskbar
        $psi = New-Object Diagnostics.ProcessStartInfo
        $psi.FileName         = "$env:COMSPEC"
        $psi.Arguments        = "/c npm run dev"
        $psi.WorkingDirectory = $GLITCH
        $psi.UseShellExecute  = $false
        $psi.CreateNoWindow   = $true
        [Diagnostics.Process]::Start($psi) | Out-Null

        Start-Sleep -Milliseconds 1400
        $form.Close()
        return
    }
})

# Start the timer when the window appears
$form.Add_Shown({ $timer.Start() })

# Run
[Windows.Forms.Application]::EnableVisualStyles()
[Windows.Forms.Application]::Run($form)
