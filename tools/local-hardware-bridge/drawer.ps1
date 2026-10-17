param([Parameter(Mandatory=$true)][string]$Port)
$ErrorActionPreference='Stop'
if ($Port -notmatch '^COM([1-9]|[1-9][0-9])$') { throw 'Porta de gaveta inválida.' }
$s=New-Object System.IO.Ports.SerialPort $Port,9600,'None',8,'One'
try {
  $s.Open()
  [byte[]]$bytes=@(27,112,0,25,250)
  $s.Write($bytes,0,$bytes.Length)
} finally {if ($s.IsOpen) {$s.Close()};$s.Dispose()}
