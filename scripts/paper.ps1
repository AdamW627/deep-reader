# Windows PowerShell 5.1+ source launcher. See README.md for installation.
[CmdletBinding()]
param(
    [Parameter(Position = 0)][string]$Command = 'open',
    [ValidateRange(1, 65535)][int]$Port = 8765
)

$ErrorActionPreference = 'Stop'
$Base = "http://127.0.0.1:$Port"
$Root = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $Root '.venv\Scripts\python.exe'
$DataDir = Join-Path $Root '.data'
$Suffix = if ($Port -eq 8765) { '' } else { "-$Port" }
$PidFile = Join-Path $DataDir "server$Suffix.pid"
$LogFile = Join-Path $DataDir "server$Suffix.log"
$ErrorLog = "$LogFile.err"

function Test-Healthy {
    try {
        $health = Invoke-RestMethod -Uri "$Base/api/health" -TimeoutSec 2
        return $health.status -eq 'ok'
    } catch { return $false }
}

function Get-OwnedProcess {
    if (-not (Test-Path -LiteralPath $PidFile)) { return $null }
    try {
        $record = Get-Content -LiteralPath $PidFile -Raw | ConvertFrom-Json
        if (-not $record.id -or -not $record.started -or -not $record.path) { return $null }
        $server = Get-Process -Id ([int]$record.id) -ErrorAction Stop
        # A PID alone can be reused by an unrelated application after a restart.
        if ($server.StartTime.ToUniversalTime().Ticks.ToString() -eq $record.started -and
            $server.Path -eq $record.path -and $server.Path -eq $Python) { return $server }
    } catch { return $null }
    return $null
}

function Initialize-Logs {
    New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
    foreach ($file in @($LogFile, $ErrorLog)) {
        if (-not (Test-Path -LiteralPath $file)) {
            New-Item -ItemType File -Path $file | Out-Null
        }
    }
}

function Start-Server {
    if (Test-Healthy) { Write-Host "Already running: $Base"; return }
    if (Get-OwnedProcess) { throw "Server process is not responding. Run paper.cmd logs." }
    if (-not (Test-Path -LiteralPath $Python)) { throw 'Missing .venv. Follow the Windows source setup in README.md.' }
    Initialize-Logs
    Write-Host 'Starting server...'
    $previousEncoding = $env:PYTHONIOENCODING
    try {
        $env:PYTHONIOENCODING = 'utf-8'
        $server = Start-Process -FilePath $Python `
            -ArgumentList '-m', 'uvicorn', 'backend.app:app', '--host', '127.0.0.1', '--port', "$Port" `
            -WorkingDirectory $Root -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput $LogFile -RedirectStandardError $ErrorLog
    } finally { $env:PYTHONIOENCODING = $previousEncoding }
    @{
        id = $server.Id
        started = $server.StartTime.ToUniversalTime().Ticks.ToString()
        path = $server.Path
    } | ConvertTo-Json | Set-Content -LiteralPath $PidFile -Encoding UTF8
    foreach ($i in 1..40) {
        if ($server.HasExited) { break }
        if (Test-Healthy) { Write-Host "Started: $Base"; return }
        Start-Sleep -Milliseconds 500
        $server.Refresh()
    }
    Get-Content -LiteralPath $LogFile, $ErrorLog -Tail 20 -Encoding UTF8
    Stop-Server
    throw 'Server failed to start. See the logs above.'
}

function Stop-Server {
    $server = Get-OwnedProcess
    if ($server) {
        Stop-Process -InputObject $server -Force
        $server.WaitForExit(5000) | Out-Null
        Write-Host 'Stopped.'
    } else { Write-Host 'No service owned by this launcher. Manual services are left running.' }
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
}

switch ($Command) {
    'start'   { Start-Server }
    'open'    { Start-Server; Start-Process $Base }
    'stop'    { Stop-Server }
    'restart' { Stop-Server; Start-Server }
    'status'  {
        if (Test-Healthy) { Write-Host "Running: $Base" }
        elseif (Get-OwnedProcess) { Write-Host "Process is not responding: $Base" }
        else { Write-Host 'Not running.' }
    }
    'logs' {
        Initialize-Logs
        Write-Host 'Following stdout and stderr. Press Ctrl-C to stop.'
        Get-Content -LiteralPath $LogFile, $ErrorLog -Tail 40 -Wait -Encoding UTF8
    }
    { $_ -in '-h', '--help', 'help' } {
        Write-Host @"
paper.cmd [open|start|stop|restart|status|logs|help] [-Port 8765]

Default: start the server if needed, then open the browser.
Only processes recorded by this launcher are stopped.
Address: $Base (loopback only)
Logs: $LogFile and $ErrorLog
"@
    }
    default { throw "Unknown command: $Command. Run paper.cmd help." }
}
