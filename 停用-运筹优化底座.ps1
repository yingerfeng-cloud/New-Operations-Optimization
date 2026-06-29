param(
    [int[]]$Ports = @(8000, 5173, 8090, 8091)
)
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogDir = Join-Path $Root "logs"
$PidFiles = @(
    (Join-Path $LogDir ".platform-api.pid"),
    (Join-Path $LogDir ".platform-frontend.pid"),
    (Join-Path $LogDir ".platform.pid"),
    (Join-Path $LogDir ".agent.pid")
)

function Stop-ProcessTree {
    param([int]$Id)
    $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $Id" -ErrorAction SilentlyContinue
    foreach ($c in $children) { Stop-ProcessTree -Id $c.ProcessId }
    try { Stop-Process -Id $Id -Force -ErrorAction Stop } catch {}
}

function Stop-FromPidFile {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $false }

    $stopped = $false
    $stored = (Get-Content -LiteralPath $Path -Raw).Trim()
    if ($stored -match '^\d+$') {
        $targetPid = [int]$stored
        if (Get-Process -Id $targetPid -ErrorAction SilentlyContinue) {
            Stop-ProcessTree -Id $targetPid
            Write-Host "Stopped process tree PID $targetPid ($Path)"
            $stopped = $true
        }
    }
    Remove-Item -LiteralPath $Path -Force
    return $stopped
}

function Stop-PortOwner {
    param([int]$Port)
    $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if (-not $conns) { return $false }

    $stopped = $false
    foreach ($processId in ($conns | Select-Object -ExpandProperty OwningProcess -Unique)) {
        if ($processId -and (Get-Process -Id $processId -ErrorAction SilentlyContinue)) {
            Stop-ProcessTree -Id ([int]$processId)
            Write-Host "Stopped listener on port $Port, PID $processId"
            $stopped = $true
        }
    }
    return $stopped
}

$stoppedAny = $false

foreach ($pidFile in $PidFiles) {
    if (Stop-FromPidFile -Path $pidFile) { $stoppedAny = $true }
}

Start-Sleep -Milliseconds 500
foreach ($port in $Ports) {
    if (Stop-PortOwner -Port $port) { $stoppedAny = $true }
}

if ($stoppedAny) {
    Write-Host "Platform services stopped."
} else {
    Write-Host "Platform services were not running."
}
