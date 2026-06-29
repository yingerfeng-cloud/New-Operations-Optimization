param(
    [int[]]$Ports = @(8000, 5173, 8090, 8091)
)
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$PlatformStop = Get-ChildItem -LiteralPath $Root -Filter "*.ps1" |
    Where-Object {
        $_.Name -notlike "*Agent*" -and
        (Get-Content -LiteralPath $_.FullName -Raw -Encoding UTF8 -ErrorAction SilentlyContinue) -match "function Stop-PortOwner"
    } |
    Select-Object -First 1 -ExpandProperty FullName

if (-not $PlatformStop) {
    Write-Error "Unable to find the platform stop script."
    exit 1
}

Write-Host "Agent Workbench is part of the unified React platform. Stopping the unified platform service."
& $PlatformStop -Ports $Ports
