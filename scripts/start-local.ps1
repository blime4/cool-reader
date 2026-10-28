[CmdletBinding()]
param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$serverPath = Join-Path $projectRoot 'server.mjs'
$localUrl = 'http://127.0.0.1:4173'
$healthUrl = 'http://127.0.0.1:4173/api/health'
$launcherMutex = New-Object System.Threading.Mutex($false, 'Local\FolioPlantsLauncher')
$hasLock = $false

function Get-LocalService {
    try {
        $reply = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 2
    } catch {
        if ($_.Exception.Response) { return @{ Occupied = $true; Valid = $false } }
        $probe = New-Object System.Net.Sockets.TcpClient
        try {
            $connect = $probe.BeginConnect('127.0.0.1', 4173, $null, $null)
            $connected = $connect.AsyncWaitHandle.WaitOne(300) -and $probe.Connected
            return @{ Occupied = $connected; Valid = $false }
        } finally { $probe.Dispose() }
    }
    try { $health = $reply.Content | ConvertFrom-Json } catch { return @{ Occupied = $true; Valid = $false } }
    return @{ Occupied = $true; Valid = ($health.app -eq 'folio-plants' -and $health.ok -eq $true) }
}

try {
    try { $hasLock = $launcherMutex.WaitOne(45000) } catch [System.Threading.AbandonedMutexException] { $hasLock = $true }
    if (-not $hasLock) { throw 'Another Folio launch is still running. Please try again shortly.' }
    $service = Get-LocalService
    if (-not $service.Valid) {
        if ($service.Occupied) { throw 'Port 4173 is being used by another service. Nothing was stopped. Close that service yourself, then retry.' }
        if (-not (Test-Path -LiteralPath $serverPath -PathType Leaf)) { throw 'server.mjs is missing. Keep this launcher inside the complete Folio project.' }
        $nodeCommand = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        $nodePath = if ($nodeCommand) { $nodeCommand.Source } else { $null }
        if (-not $nodePath) {
            foreach ($possibleNode in @((Join-Path $env:ProgramFiles 'nodejs\node.exe'), (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe'))) {
                if (Test-Path -LiteralPath $possibleNode -PathType Leaf) { $nodePath = $possibleNode; break }
            }
        }
        if (-not $nodePath) { throw 'Node.js was not found. Install the current Node.js LTS from nodejs.org, then retry.' }
        $logDirectory = Join-Path $projectRoot 'work'
        New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
        $outputLog = Join-Path $logDirectory 'folio-local.out.log'
        $errorLog = Join-Path $logDirectory 'folio-local.err.log'
        $serverProcess = Start-Process -FilePath $nodePath -ArgumentList @(('"' + $serverPath + '"')) -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $outputLog -RedirectStandardError $errorLog -PassThru
        $ready = $false
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            $service = Get-LocalService
            if ($service.Valid) { $ready = $true; break }
            if ($service.Occupied) { throw 'A different service answered on port 4173. Nothing was stopped.' }
            if ($serverProcess.HasExited) { throw ('Folio could not start. Check the server log: ' + $errorLog) }
            Start-Sleep -Milliseconds 350
        }
        if (-not $ready) { throw ('Folio did not become ready. Check the server log: ' + $errorLog) }
    }
    if (-not $NoBrowser) { Start-Process -FilePath $localUrl }
    Write-Output ('Folio is ready: ' + $localUrl)
} catch {
    $message = $_.Exception.Message
    if ($NoBrowser) { Write-Error $message; exit 1 }
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($message, 'Folio - local launcher', 'OK', 'Error') | Out-Null
    exit 1
} finally {
    if ($hasLock) { $launcherMutex.ReleaseMutex() }
    $launcherMutex.Dispose()
}
