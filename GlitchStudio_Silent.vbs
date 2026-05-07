' GlitchStudio_Silent.vbs
' Runs GlitchStudio_Launcher.ps1 with no console window visible.
' This is the target of the Desktop shortcut.

Dim fso, shell, scriptDir, psScript

Set fso   = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
psScript  = scriptDir & "\GlitchStudio_Launcher.ps1"

If Not fso.FileExists(psScript) Then
    MsgBox "Launcher file not found:" & vbCrLf & psScript & vbCrLf & vbCrLf & _
           "Make sure GlitchStudio_Launcher.ps1 is in the same folder as this file.", _
           16, "Glitch Studio Builder"
    WScript.Quit 1
End If

' WindowStyle 0 = hidden; bWaitOnReturn = False (fire and forget)
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ _
    & psScript & """", 0, False

Set shell = Nothing
Set fso   = Nothing
