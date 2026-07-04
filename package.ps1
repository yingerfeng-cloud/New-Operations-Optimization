param(
  [string]$OutputPath = "copt-500.zip"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$OutputFullPath = if ([System.IO.Path]::IsPathRooted($OutputPath)) { $OutputPath } else { Join-Path $Root $OutputPath }

$IncludeItems = @(
  "agent_skills",
  "app",
  "data",
  "docs",
  "frontend",
  "scripts",
  "tests",
  ".gitignore",
  "OPERATION_MANUAL.md",
  "package.ps1",
  "PRD.md",
  "pytest.ini",
  "README.md",
  "requirements.txt",
  "server.py",
  "solver_adapter.py",
  "停用-Agent工作台.ps1",
  "停用-React前后端.ps1",
  "停用-运筹优化底座.ps1",
  "启动-Agent工作台.ps1",
  "启动-React前后端.ps1",
  "启动-运筹优化底座.ps1"
)

$RemovePatterns = @(
  "\\__pycache__(\\|$)",
  "\\\.pytest_cache(\\|$)",
  "\\pytest_tmp(\\|$)",
  "\\__chrome_[^\\]*_profile(\\|$)",
  "\\logs(\\|$)",
  "\\artifacts(\\|$)",
  "\\\.agents(\\|$)",
  "\\\.claude(\\|$)",
  "\\\.codex(\\|$)",
  "\\\.venv(\\|$)",
  "\\frontend\\node_modules(\\|$)",
  "\\frontend\\dist(\\|$)",
  "\\frontend\\playwright-report(\\|$)",
  "\\frontend\\test-results(\\|$)",
  "\\frontend\\\.vite(\\|$)",
  "\\frontend\\coverage(\\|$)",
  "\\frontend\\[^\\]+\.tsbuildinfo$",
  "\\frontend\\vite\.config\.(?:js|d\.ts)$",
  "\\frontend\\playwright\.config\.(?:js|d\.ts)$",
  "\\reports\\.*\.html$",
  "\\data\\runtime_store\.json$",
  "\\data\\runtime_store\.local\.json$",
  "\\data\\runtime_store_test_[^\\]*\.json$",
  "\.pyc$",
  "\.pyo$"
)

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

  Get-ChildItem -LiteralPath $Root -Directory -Recurse -Force -Filter ".pytest_cache" -ErrorAction SilentlyContinue |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
}

function Test-PackageExclude {
  param([string]$FullName)

  $relative = $FullName.Substring($Root.Length)
  foreach ($pattern in $RemovePatterns) {
    if ($relative -match $pattern) {
      return $true
    }
  }
  return $false
}

function Copy-PackageItem {
  param([string]$Item)

  $source = Join-Path $Root $Item
  if (-not (Test-Path -LiteralPath $source)) {
    return
  }

  $sourceItem = Get-Item -LiteralPath $source -Force
  if ($sourceItem.PSIsContainer) {
    Get-ChildItem -LiteralPath $sourceItem.FullName -Recurse -Force -File |
      Where-Object { -not (Test-PackageExclude $_.FullName) } |
      ForEach-Object {
        $relative = $_.FullName.Substring($Root.Length).TrimStart("\", "/")
        $destination = Join-Path $staging $relative
        $destinationDir = Split-Path -Parent $destination
        if (-not (Test-Path -LiteralPath $destinationDir)) {
          New-Item -ItemType Directory -Path $destinationDir -Force | Out-Null
        }
        Copy-Item -LiteralPath $_.FullName -Destination $destination -Force
      }
  } elseif (-not (Test-PackageExclude $sourceItem.FullName)) {
    $destination = Join-Path $staging $sourceItem.Name
    Copy-Item -LiteralPath $sourceItem.FullName -Destination $destination -Force
  }
}

Clean-Package

if (Test-Path -LiteralPath $OutputFullPath) {
  Remove-Item -LiteralPath $OutputFullPath -Force
}

$staging = Join-Path $env:TEMP ("copt-500-package-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $staging | Out-Null
try {
  foreach ($item in $IncludeItems) {
    Copy-PackageItem $item
  }

  Get-ChildItem -LiteralPath $staging -Recurse -Force |
    Where-Object {
      $relative = $_.FullName.Substring($staging.Length)
      $matched = $false
      foreach ($pattern in $RemovePatterns) {
        if ($relative -match $pattern) {
          $matched = $true
          break
        }
      }
      $matched
    } |
    Remove-Item -Recurse -Force

  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [System.IO.Compression.ZipFile]::Open($OutputFullPath, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    Get-ChildItem -LiteralPath $staging -Recurse -Force -File |
      ForEach-Object {
        $entryName = $_.FullName.Substring($staging.Length).TrimStart("\", "/") -replace "\\", "/"
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
          $zip,
          $_.FullName,
          $entryName,
          [System.IO.Compression.CompressionLevel]::Optimal
        ) | Out-Null
      }
  }
  finally {
    $zip.Dispose()
  }
}
finally {
  if (Test-Path -LiteralPath $staging) {
    Remove-Item -LiteralPath $staging -Recurse -Force
  }
}

Write-Output "Package created: $OutputFullPath"
