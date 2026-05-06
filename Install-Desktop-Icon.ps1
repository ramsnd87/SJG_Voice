#Requires -Version 5.0
# Install-Desktop-Icon.ps1
# Run ONCE to place the Glitch Studio Builder shortcut on your Desktop.
# After that, use the Desktop icon exclusively.

$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$vbsPath = Join-Path $appDir "GlitchStudio_Silent.vbs"

if (-not (Test-Path $vbsPath)) {
    Write-Host ""
    Write-Host "  ERROR: GlitchStudio_Silent.vbs not found in:" -ForegroundColor Red
    Write-Host "  $appDir" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Make sure all launcher files are present in the Glitch_Studio_Builder folder." -ForegroundColor White
    Write-Host ""
    Read-Host "  Press Enter to exit"
    exit 1
}

# Use the bundled Electron exe for the icon if available (has the app icon baked in).
# Fall back to a suitable Windows system icon.
$electronExe = Join-Path $appDir "node_modules\electron\dist\electron.exe"
if (Test-Path $electronExe) {
    $iconPath  = $electronExe
    $iconIndex = 0
} else {
    # shell32.dll index 22 = multimedia/speaker icon
    $iconPath  = "$env:SystemRoot\System32\shell32.dll"
    $iconIndex = 22
}

$desktopPath  = [System.Environment]::GetFolderPath("Desktop")
$shortcutFile = Join-Path $desktopPath "Glitch Studio Builder.lnk"

$shell    = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutFile)

$shortcut.TargetPath       = "wscript.exe"
$shortcut.Arguments        = "`"$vbsPath`""
$shortcut.WorkingDirectory = $appDir
$shortcut.Description      = "Glitch Studio Builder — Voice Cloning and Podcast Studio"
$shortcut.IconLocation     = "$iconPath,$iconIndex"
$shortcut.WindowStyle      = 1
$shortcut.Save()

[System.Runtime.InteropServices.Marshal]::ReleaseComObject($shortcut) | Out-Null
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($shell)    | Out-Null

Write-Host ""
Write-Host "  Shortcut created successfully!" -ForegroundColor Green
Write-Host "  -> $shortcutFile" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Double-click 'Glitch Studio Builder' on your Desktop to launch." -ForegroundColor White
Write-Host ""
Read-Host "  Press Enter to close"
