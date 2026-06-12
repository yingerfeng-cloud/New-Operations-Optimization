param()
$ErrorActionPreference = "Stop"

$Root    = Split-Path -Parent $MyInvocation.MyCommand.Path
$PidFile = Join-Path $Root "logs\.platform.pid"
$Port    = 8090

function Stop-ProcessTree {
    param([int]$Id)
    $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $Id" -ErrorAction SilentlyContinue
    foreach ($c in $children) { Stop-ProcessTree -Id $c.ProcessId }
    try { Stop-Process -Id $Id -Force -ErrorAction Stop } catch {}
}

$stopped = $false

# 1. 通过 PID 文件停止进程树（含 uvicorn 子进程）
if (Test-Path -LiteralPath $PidFile) {
    $stored = (Get-Content -LiteralPath $PidFile -Raw).Trim()
    if ($stored -match '^\d+$') {
        $targetPid = [int]$stored
        if (Get-Process -Id $targetPid -ErrorAction SilentlyContinue) {
            Stop-ProcessTree -Id $targetPid
            Write-Host "【运筹优化底座】已停止进程树  PID $targetPid"
            $stopped = $true
        }
    }
    Remove-Item -LiteralPath $PidFile -Force
}

# 2. 兜底：清理端口上的孤儿进程
Start-Sleep -Milliseconds 300
$conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($conn) {
    $orphanPid = $conn.OwningProcess
    try { Stop-Process -Id $orphanPid -Force -ErrorAction Stop } catch {}
    Write-Host "【运筹优化底座】已清理端口 $Port 孤儿进程  PID $orphanPid"
    $stopped = $true
}

if (-not $stopped) { Write-Host "【运筹优化底座】服务未在运行" }
