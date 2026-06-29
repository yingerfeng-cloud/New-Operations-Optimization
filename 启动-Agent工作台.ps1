param(
    [int]$ApiPort = 8000,
    [int]$FrontendPort = 5173,
    [switch]$NoFrontend
)
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$PlatformStart = Get-ChildItem -LiteralPath $Root -Filter "*.ps1" |
    Where-Object {
        $_.Name -notlike "*Agent*" -and
        (Get-Content -LiteralPath $_.FullName -Raw -Encoding UTF8 -ErrorAction SilentlyContinue) -match "function Start-Backend"
    } |
    Select-Object -First 1 -ExpandProperty FullName

if (-not $PlatformStart) {
    Write-Error "Unable to find the platform start script."
    exit 1
}

Write-Host "Agent Workbench is now served by the React app at /agents. Starting the unified platform service."

if ($NoFrontend) {
    & $PlatformStart -ApiPort $ApiPort -FrontendPort $FrontendPort -NoFrontend
} else {
    & $PlatformStart -ApiPort $ApiPort -FrontendPort $FrontendPort
}

Write-Host "Agent Workbench URL:"
if ($NoFrontend) {
    Write-Host "  http://127.0.0.1:$ApiPort/agents"
} else {
    Write-Host "  http://127.0.0.1:$FrontendPort/agents"
}
