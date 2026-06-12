param(
  [string]$OutputPath = "copt-500.zip"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$OutputFullPath = if ([System.IO.Path]::IsPathRooted($OutputPath)) { $OutputPath } else { Join-Path $Root $OutputPath }

function Clean-Package {
  $runtimeStore = Join-Path $Root "data\runtime_store.json"
  if (Test-Path -LiteralPath $runtimeStore) {
    Remove-Item -LiteralPath $runtimeStore -Force
  }
  $localRuntimeStore = Join-Path $Root "data\runtime_store.local.json"
  if (Test-Path -LiteralPath $localRuntimeStore) {
    Remove-Item -LiteralPath $localRuntimeStore -Force
  }

  Get-ChildItem -LiteralPath (Join-Path $Root "logs") -Filter "*.log" -File -ErrorAction SilentlyContinue |
    Remove-Item -Force -ErrorAction SilentlyContinue

  Get-ChildItem -LiteralPath (Join-Path $Root "reports") -Filter "*.html" -File -ErrorAction SilentlyContinue |
    Remove-Item -Force -ErrorAction SilentlyContinue

  $reportsDir = Join-Path $Root "reports"
  if (-not (Test-Path -LiteralPath $reportsDir)) {
    New-Item -ItemType Directory -Path $reportsDir | Out-Null
  }
  $gitkeep = Join-Path $reportsDir ".gitkeep"
  if (-not (Test-Path -LiteralPath $gitkeep)) {
    New-Item -ItemType File -Path $gitkeep | Out-Null
  }

  Get-ChildItem -LiteralPath $Root -Directory -Recurse -Force -Filter "__pycache__" -ErrorAction SilentlyContinue |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
}

Clean-Package

if (Test-Path -LiteralPath $OutputFullPath) {
  Remove-Item -LiteralPath $OutputFullPath -Force
}

$staging = Join-Path $env:TEMP ("copt-500-package-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $staging | Out-Null
try {
  Get-ChildItem -LiteralPath $Root -Force |
    Where-Object {
      $_.Name -notin @(".git", ".venv", ".pytest_cache", "pytest_tmp", "__chrome_frontend_profile", [System.IO.Path]::GetFileName($OutputFullPath))
    } |
    Copy-Item -Destination $staging -Recurse -Force

  Get-ChildItem -LiteralPath $staging -Recurse -Force |
    Where-Object {
      $_.FullName -match "\\__pycache__(\\|$)" -or
      $_.FullName -match "\\logs\\.*\.log$" -or
      $_.FullName -match "\\reports\\.*\.html$" -or
      $_.FullName -match "\\data\\runtime_store\.json$" -or
      $_.FullName -match "\\data\\runtime_store\.local\.json$"
    } |
    Remove-Item -Recurse -Force

  Compress-Archive -Path (Join-Path $staging "*") -DestinationPath $OutputFullPath -Force
}
finally {
  if (Test-Path -LiteralPath $staging) {
    Remove-Item -LiteralPath $staging -Recurse -Force
  }
}

Write-Output "Package created: $OutputFullPath"
