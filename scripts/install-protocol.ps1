[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$launcherPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'start-local.ps1')).Path
$powershellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
if (-not (Test-Path -LiteralPath $powershellPath -PathType Leaf)) { throw 'Windows PowerShell is unavailable.' }
if ($launcherPath.Contains('"')) { throw 'The launcher path contains an invalid quotation mark.' }

# The protocol is only an activation signal. No URI argument is forwarded.
$command = '"' + $powershellPath + '" -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy RemoteSigned -File "' + $launcherPath + '"'
$protocolKey = 'HKCU:\Software\Classes\folio-plants'
New-Item -Path $protocolKey -Force | Out-Null
Set-Item -LiteralPath $protocolKey -Value 'URL:Folio Plants local launcher'
New-ItemProperty -LiteralPath $protocolKey -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
$commandKey = Join-Path $protocolKey 'shell\open\command'
New-Item -Path $commandKey -Force | Out-Null
Set-Item -LiteralPath $commandKey -Value $command
Write-Output 'Folio local launch is registered for the current Windows user.'
Write-Output 'Open folio-plants://start from the Pages portal, or double-click scripts\launch.cmd.'
