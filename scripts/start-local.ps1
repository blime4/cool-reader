[CmdletBinding()]
param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$serverPath = Join-Path $projectRoot 'server.mjs'
$localUrl = 'http://127.0.0.1:4173'
$healthUrl = 'http://127.0.0.1:4173/api/health'
$configPath = Join-Path $projectRoot 'config.local.json'
$logDirectory = Join-Path $projectRoot 'work'
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

function Get-ImageService([int]$Port, [string]$TokenPath) {
    $headers = @{}
    if (Test-Path -LiteralPath $TokenPath -PathType Leaf) {
        try { $headers['X-Folio-Token'] = (Get-Content -LiteralPath $TokenPath -Raw).Trim() } catch {}
    }
    try {
        $reply = Invoke-WebRequest -UseBasicParsing -Uri ("http://127.0.0.1:$Port/health") -Headers $headers -TimeoutSec 2
    } catch {
        if ($_.Exception.Response) { return @{ Occupied = $true; Owned = $false; Valid = $false } }
        $probe = New-Object System.Net.Sockets.TcpClient
        try {
            $connect = $probe.BeginConnect('127.0.0.1', $Port, $null, $null)
            $connected = $connect.AsyncWaitHandle.WaitOne(300) -and $probe.Connected
            return @{ Occupied = $connected; Owned = $false; Valid = $false }
        } finally { $probe.Dispose() }
    }
    try { $health = $reply.Content | ConvertFrom-Json } catch { return @{ Occupied = $true; Owned = $false; Valid = $false } }
    $owned = $health.app -eq 'folio-qwen-image'
    return @{ Occupied = $true; Owned = $owned; Valid = ($owned -and $health.ready -eq $true) }
}

function Start-ConfiguredImageWorker {
    if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) { return }
    try { $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json } catch { return }
    if (-not $config.imageGeneration -or $config.imageGeneration.enabled -ne $true) { return }
    $imagePort = [int]$config.imageGeneration.port
    if ($imagePort -lt 1024 -or $imagePort -gt 65535) { return }

    $modelPath = Join-Path $projectRoot 'models\Qwen-Image-2.1'
    $pythonPath = Join-Path $projectRoot '.venv-image\Scripts\python.exe'
    $workerScript = Join-Path $PSScriptRoot 'start-image-worker.ps1'
    if (-not (Test-Path -LiteralPath (Join-Path $modelPath 'model_index.json') -PathType Leaf) -or
        -not (Test-Path -LiteralPath $pythonPath -PathType Leaf) -or
        -not (Test-Path -LiteralPath $workerScript -PathType Leaf)) { return }

    New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
    $workerOutputLog = Join-Path $logDirectory 'folio-image-worker.out.log'
    $workerErrorLog = Join-Path $logDirectory 'folio-image-worker.err.log'
    $tokenPath = Join-Path (Join-Path $projectRoot 'data') 'image-worker.token'
    $imageService = Get-ImageService $imagePort $tokenPath
    if ($imageService.Valid) { return }
    if ($imageService.Occupied) {
        Add-Content -LiteralPath $workerErrorLog -Value ("[$(Get-Date -Format s)] Port $imagePort is occupied; Folio did not stop or replace that service.")
        return
    }

    try {
        $powershellPath = (Get-Process -Id $PID).Path
        $workerArguments = @(
            '-NoProfile', '-ExecutionPolicy', 'RemoteSigned', '-File', ('"' + $workerScript + '"'),
            '-PythonPath', ('"' + $pythonPath + '"'), '-ModelPath', ('"' + $modelPath + '"'), '-Port', $imagePort
        )
        $workerProcess = Start-Process -FilePath $powershellPath -ArgumentList $workerArguments -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $workerOutputLog -RedirectStandardError $workerErrorLog -PassThru
        for ($attempt = 0; $attempt -lt 40; $attempt++) {
            $imageService = Get-ImageService $imagePort $tokenPath
            if ($imageService.Valid) { return }
            if ($workerProcess.HasExited) { break }
            Start-Sleep -Milliseconds 350
        }
        Add-Content -LiteralPath $workerErrorLog -Value ("[$(Get-Date -Format s)] Folio image worker did not become ready; Node startup continues.")
    } catch {
        Add-Content -LiteralPath $workerErrorLog -Value ("[$(Get-Date -Format s)] Image worker launch failed: " + $_.Exception.Message)
    }
}

try {
    try { $hasLock = $launcherMutex.WaitOne(45000) } catch [System.Threading.AbandonedMutexException] { $hasLock = $true }
    if (-not $hasLock) { throw 'Another Folio launch is still running. Please try again shortly.' }
    try { Start-ConfiguredImageWorker } catch {
        New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
        Add-Content -LiteralPath (Join-Path $logDirectory 'folio-image-worker.err.log') -Value ("[$(Get-Date -Format s)] Image worker configuration failed: " + $_.Exception.Message)
    }
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
