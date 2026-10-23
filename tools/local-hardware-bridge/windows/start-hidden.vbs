Option Explicit
Dim fso, sh, base, command
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
base = fso.GetParentFolderName(WScript.ScriptFullName)
command = Chr(34) & base & "\node.exe" & Chr(34) & " --experimental-sqlite " & Chr(34) & base & "\main.mjs" & Chr(34)
sh.Run command, 0, False
