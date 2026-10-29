[CmdletBinding()]
param([string]$PythonPath, [int]$Port = 4174, [string]$ModelPath)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $PythonPath) { $PythonPath = Join-Path $projectRoot '.venv-image/Scripts/python.exe' }
if (-not (Test-Path -LiteralPath $PythonPath -PathType Leaf)) { throw 'Python environment missing. Follow README local image generation setup first.' }
$dataPath = Join-Path $projectRoot 'data'
New-Item -ItemType Directory -Path $dataPath -Force | Out-Null
$tokenPath = Join-Path $dataPath 'image-worker.token'
if (-not (Test-Path -LiteralPath $tokenPath)) {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    $token = [Convert]::ToBase64String($bytes)
    $stream = [System.IO.File]::Open($tokenPath, [System.IO.FileMode]::CreateNew)
    try { $raw = [System.Text.Encoding]::UTF8.GetBytes($token); $stream.Write($raw, 0, $raw.Length) } finally { $stream.Dispose() }
}
if ($ModelPath) { $env:QWEN_IMAGE_MODEL = (Resolve-Path -LiteralPath $ModelPath).Path }
# No dependency installation or model download occurs here.
& $PythonPath (Join-Path $PSScriptRoot 'qwen-image-worker.py') --port $Port --token-file $tokenPath
exit $LASTEXITCODE
