param(
    [int[]]$Ports = @(8000, 5173)
)
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogDir = Join-Path $Root "logs"
$PidFiles = @(
    (Join-Path $LogDir ".react-stack-api.pid"),
    (Join-Path $LogDir ".react-stack-frontend.pid"),
    (Join-Path $LogDir ".platform-api.pid"),
    (Join-Path $LogDir ".platform-frontend.pid")
)

function Stop-ProcessTree {
    param([int]$ProcessId)

    $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $ProcessId" -ErrorAction SilentlyContinue
    foreach ($child in $children) {
        Stop-ProcessTree -ProcessId ([int]$child.ProcessId)
    }

    try {
        Stop-Process -Id $ProcessId -Force -ErrorAction Stop
        return $true
    } catch {
        return $false
    }
}

function Stop-FromPidFile {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return $false
    }

    $stopped = $false
    $raw = (Get-Content -LiteralPath $Path -Raw -ErrorAction SilentlyContinue).Trim()
    if ($raw -match '^\d+$') {
        $processId = [int]$raw
        if (Get-Process -Id $processId -ErrorAction SilentlyContinue) {
            if (Stop-ProcessTree -ProcessId $processId) {
                Write-Host "Stopped process tree PID $processId from $Path"
                $stopped = $true
            }
        }
    }

    Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
    return $stopped
}

function Stop-PortOwner {
    param([int]$Port)

    $listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if (-not $listeners) {
        return $false
    }

    $stopped = $false
    foreach ($processId in ($listeners | Select-Object -ExpandProperty OwningProcess -Unique)) {
        if ($processId -and (Get-Process -Id $processId -ErrorAction SilentlyContinue)) {
            if (Stop-ProcessTree -ProcessId ([int]$processId)) {
                Write-Host "Stopped listener on port $Port, PID $processId"
                $stopped = $true
            }
        }
    }
    return $stopped
}

$stoppedAny = $false

foreach ($pidFile in $PidFiles) {
    if (Stop-FromPidFile -Path $pidFile) {
        $stoppedAny = $true
    }
}

Start-Sleep -Milliseconds 500

foreach ($port in $Ports) {
    if (Stop-PortOwner -Port $port) {
        $stoppedAny = $true
    }
}

if ($stoppedAny) {
    Write-Host "React frontend and backend services stopped."
} else {
    Write-Host "React frontend and backend services were not running."
}
