param()
$ErrorActionPreference = "Stop"

$Root    = Split-Path -Parent $MyInvocation.MyCommand.Path
$PidFile = Join-Path $Root "logs\.platform.pid"
$LogFile = Join-Path $Root "logs\platform.log"
$OutFile = Join-Path $Root "logs\platform-stdout.log"
$Python  = Join-Path $Root ".venv\Scripts\python.exe"
$Port    = 8090

if (-not (Test-Path -LiteralPath $Python)) {
    Write-Error "未找到 Python 虚拟环境，请先执行: python -m venv .venv 并安装依赖"
    exit 1
}

$LogDir = Join-Path $Root "logs"
if (-not (Test-Path -LiteralPath $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir | Out-Null
}

# 端口占用检测
$conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($conn) {
    Write-Host "【运筹优化底座】端口 $Port 已被占用 (PID $($conn.OwningProcess))，请先运行停用脚本"
    exit 1
}

if (Test-Path -LiteralPath $PidFile) { Remove-Item -LiteralPath $PidFile -Force }

# 直接启动 Python，stderr（uvicorn 日志）写入 platform.log
$env:SERVICE_MODE = "platform"
$env:PORT         = "$Port"

$proc = Start-Process $Python `
    -ArgumentList "-u", "server.py" `
    -WorkingDirectory $Root `
    -WindowStyle Hidden `
    -RedirectStandardOutput $OutFile `
    -RedirectStandardError  $LogFile `
    -PassThru

$proc.Id | Out-File -FilePath $PidFile -Encoding utf8 -Force
Write-Host "【运筹优化底座】已在后台启动  PID $($proc.Id)  http://127.0.0.1:$Port"
Write-Host "日志: $LogFile"
