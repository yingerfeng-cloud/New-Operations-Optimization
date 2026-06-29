param(
    [int]$ApiPort = 8000,
    [int]$FrontendPort = 5173,
    [switch]$NoFrontend
)
$ErrorActionPreference = "Stop"

$Root          = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogDir        = Join-Path $Root "logs"
$ApiPidFile    = Join-Path $LogDir ".platform-api.pid"
$WebPidFile    = Join-Path $LogDir ".platform-frontend.pid"
$ApiLogFile    = Join-Path $LogDir "platform-api.log"
$ApiOutFile    = Join-Path $LogDir "platform-api-stdout.log"
$WebLogFile    = Join-Path $LogDir "platform-frontend.log"
$WebOutFile    = Join-Path $LogDir "platform-frontend-stdout.log"
$Python        = Join-Path $Root ".venv\Scripts\python.exe"
$FrontendRoot  = Join-Path $Root "frontend"
$PackageJson   = Join-Path $FrontendRoot "package.json"
$NodeModules   = Join-Path $FrontendRoot "node_modules"

function Test-PortAvailable {
    param([int]$Port, [string]$Name)
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($conn) {
        $pids = ($conn | Select-Object -ExpandProperty OwningProcess -Unique) -join ", "
        Write-Error "$Name port $Port is already in use (PID $pids). Run the stop script first or release the port manually."
        exit 1
    }
}

function Start-Backend {
    if (-not (Test-Path -LiteralPath $Python)) {
        Write-Error "Python virtualenv not found: $Python. Create .venv and install backend dependencies first."
        exit 1
    }

    Test-PortAvailable -Port $ApiPort -Name "FastAPI backend"
    if (Test-Path -LiteralPath $ApiPidFile) { Remove-Item -LiteralPath $ApiPidFile -Force }

    $env:SERVICE_MODE = "platform"
    $env:PORT = "$ApiPort"

    $proc = Start-Process $Python `
        -ArgumentList "-u", "server.py" `
        -WorkingDirectory $Root `
        -WindowStyle Hidden `
        -RedirectStandardOutput $ApiOutFile `
        -RedirectStandardError  $ApiLogFile `
        -PassThru

    $proc.Id | Out-File -FilePath $ApiPidFile -Encoding utf8 -Force
    Write-Host "FastAPI backend started. PID $($proc.Id)  http://127.0.0.1:$ApiPort"
    Write-Host "Backend log: $ApiLogFile"
}

function Start-Frontend {
    if (-not (Test-Path -LiteralPath $PackageJson)) {
        Write-Error "Frontend project not found: $PackageJson"
        exit 1
    }
    if (-not (Test-Path -LiteralPath $NodeModules)) {
        Write-Error "Frontend dependencies are missing. Run: cd frontend; npm install"
        exit 1
    }

    $Npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $Npm) {
        Write-Error "npm not found. Install Node.js first."
        exit 1
    }

    Test-PortAvailable -Port $FrontendPort -Name "React/Vite frontend"
    if (Test-Path -LiteralPath $WebPidFile) { Remove-Item -LiteralPath $WebPidFile -Force }

    $env:VITE_API_BASE_URL = "http://127.0.0.1:$ApiPort"

    $command = "npm run dev -- --host 127.0.0.1 --port $FrontendPort"
    $proc = Start-Process "cmd.exe" `
        -ArgumentList "/d", "/s", "/c", $command `
        -WorkingDirectory $FrontendRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput $WebOutFile `
        -RedirectStandardError  $WebLogFile `
        -PassThru

    $proc.Id | Out-File -FilePath $WebPidFile -Encoding utf8 -Force
    Write-Host "React/Vite frontend started. PID $($proc.Id)  http://127.0.0.1:$FrontendPort"
    Write-Host "Frontend log: $WebLogFile"
}

if (-not (Test-Path -LiteralPath $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir | Out-Null
}

Start-Backend
if (-not $NoFrontend) {
    Start-Frontend
}

Write-Host ""
Write-Host "URLs:"
if ($NoFrontend) {
    Write-Host "  Production/backend-hosted app: http://127.0.0.1:$ApiPort/"
} else {
    Write-Host "  Frontend dev app:             http://127.0.0.1:$FrontendPort/"
    Write-Host "  Backend API:                  http://127.0.0.1:$ApiPort/api"
}
Write-Host "  Legacy entry:                 http://127.0.0.1:$ApiPort/legacy"
