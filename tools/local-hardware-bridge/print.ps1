param([Parameter(Mandatory=$true)][string]$File,[string]$PrinterName)
$ErrorActionPreference='Stop'
if (-not (Test-Path -LiteralPath $File -PathType Leaf)) { throw 'Comprovante não encontrado.' }
$lines=[System.IO.File]::ReadAllLines($File,[System.Text.Encoding]::UTF8)
if ($PrinterName) { $lines | Out-Printer -Name $PrinterName } else { $lines | Out-Printer }
