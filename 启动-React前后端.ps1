param(
    [int]$ApiPort = 8000,
    [int]$FrontendPort = 5173,
    [switch]$NoBrowser
)
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$FrontendRoot = Join-Path $Root "frontend"
$LogDir = Join-Path $Root "logs"
$ApiPidFile = Join-Path $LogDir ".react-stack-api.pid"
$FrontendPidFile = Join-Path $LogDir ".react-stack-frontend.pid"
$ApiOutFile = Join-Path $LogDir "react-stack-api.stdout.log"
$ApiErrFile = Join-Path $LogDir "react-stack-api.stderr.log"
$FrontendOutFile = Join-Path $LogDir "react-stack-frontend.stdout.log"
$FrontendErrFile = Join-Path $LogDir "react-stack-frontend.stderr.log"

function Resolve-Python {
    $venvPython = Join-Path $Root ".venv\Scripts\python.exe"
    if (Test-Path -LiteralPath $venvPython) {
        return $venvPython
    }

    $python = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($python) {
        return $python.Source
    }

    $python = Get-Command python -ErrorAction SilentlyContinue
    if ($python) {
        return $python.Source
    }

    Write-Error "Python was not found. Create .venv or install Python first."
}

function Assert-Path {
    param([string]$Path, [string]$Message)
    if (-not (Test-Path -LiteralPath $Path)) {
        Write-Error $Message
    }
}

function Assert-PortAvailable {
    param([int]$Port, [string]$Name)
    $listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($listeners) {
        $processIds = ($listeners | Select-Object -ExpandProperty OwningProcess -Unique) -join ", "
        Write-Error "$Name port $Port is already in use by PID $processIds. Run .\停用-React前后端.ps1 first or free the port."
    }
}

function Start-Api {
    $python = Resolve-Python
    Assert-Path -Path (Join-Path $Root "server.py") -Message "server.py was not found."
    Assert-PortAvailable -Port $ApiPort -Name "Backend"

    if (Test-Path -LiteralPath $ApiPidFile) {
        Remove-Item -LiteralPath $ApiPidFile -Force
    }

    $env:SERVICE_MODE = "platform"
    $env:PORT = "$ApiPort"

    $process = Start-Process -FilePath $python `
        -ArgumentList "-u", "server.py" `
        -WorkingDirectory $Root `
        -WindowStyle Hidden `
        -RedirectStandardOutput $ApiOutFile `
        -RedirectStandardError $ApiErrFile `
        -PassThru

    $process.Id | Out-File -FilePath $ApiPidFile -Encoding utf8 -Force
    Write-Host "Backend started:  PID $($process.Id)  http://127.0.0.1:$ApiPort"
}

function Start-Frontend {
    Assert-Path -Path (Join-Path $FrontendRoot "package.json") -Message "frontend/package.json was not found."
    Assert-Path -Path (Join-Path $FrontendRoot "node_modules") -Message "frontend/node_modules was not found. Run: cd frontend; npm ci"

    $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $npm) {
        Write-Error "npm.cmd was not found. Install Node.js first."
    }

    Assert-PortAvailable -Port $FrontendPort -Name "React/Vite frontend"

    if (Test-Path -LiteralPath $FrontendPidFile) {
        Remove-Item -LiteralPath $FrontendPidFile -Force
    }

    $env:VITE_API_BASE_URL = "http://127.0.0.1:$ApiPort"
    $command = "npm run dev -- --host 127.0.0.1 --port $FrontendPort"

    $process = Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/d", "/s", "/c", $command `
        -WorkingDirectory $FrontendRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput $FrontendOutFile `
        -RedirectStandardError $FrontendErrFile `
        -PassThru

    $process.Id | Out-File -FilePath $FrontendPidFile -Encoding utf8 -Force
    Write-Host "Frontend started: PID $($process.Id)  http://127.0.0.1:$FrontendPort"
}

if (-not (Test-Path -LiteralPath $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir | Out-Null
}

Start-Api
Start-Frontend

Write-Host ""
Write-Host "React app:   http://127.0.0.1:$FrontendPort/"
Write-Host "Backend API: http://127.0.0.1:$ApiPort/api"
Write-Host "Logs:        $LogDir"

if (-not $NoBrowser) {
    Start-Process "http://127.0.0.1:$FrontendPort/"
}
