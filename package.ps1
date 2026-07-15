param(
  [string]$OutputPath = "copt-500.zip"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$OutputFullPath = if ([System.IO.Path]::IsPathRooted($OutputPath)) { $OutputPath } else { Join-Path $Root $OutputPath }

$IncludeItems = @(
  ".github",
  "agent_skills",
  "app",
  "data",
  "docs",
  "frontend",
  "scripts",
  "tests",
  ".dockerignore",
  ".env.example",
  ".gitignore",
  "Dockerfile",
  "OPERATION_MANUAL.md",
  "package.ps1",
  "PRD.md",
  "pytest.ini",
  "README.md",
  "requirements.txt",
  "server.py",
  "solver_adapter.py",
  "docker-compose.yml",
  "停用-Agent工作台.ps1",
  "停用-React前后端.ps1",
  "停用-运筹优化底座.ps1",
  "启动-Agent工作台.ps1",
  "启动-React前后端.ps1",
  "启动-运筹优化底座.ps1"
)

$RequiredPackageItems = @(
  ".github/workflows/ci.yml",
  ".github/workflows/e2e-real.yml",
  "frontend/package.json",
  "requirements.txt",
  "server.py",
  "frontend/src/main.tsx",
  "OPERATION_MANUAL.md"
)

$LauncherScripts = @(Get-ChildItem -LiteralPath $Root -File -Filter "*.ps1" |
  Where-Object { $_.Name -ne "package.ps1" })
if ($LauncherScripts.Count -lt 2) {
  throw "Package requires at least one start script and one stop script in the repository root."
}
$IncludeItems += @($LauncherScripts | ForEach-Object { $_.Name })
$RequiredPackageItems += @($LauncherScripts | ForEach-Object { $_.Name })

$RemovePatterns = @(
  "\\__pycache__(\\|$)",
  "\\\.pytest_cache(\\|$)",
  "\\pytest_tmp(\\|$)",
  "\\__chrome_[^\\]*_profile(\\|$)",
  "\\logs(\\|$)",
  "\\artifacts(\\|$)",
  "\\docker-data(\\|$)",
  "\\\.agents(\\|$)",
  "\\\.claude(\\|$)",
  "\\\.codex(\\|$)",
  "\\\.venv(\\|$)",
  "\\frontend\\node_modules(\\|$)",
  "\\frontend\\dist(\\|$)",
  "\\frontend\\playwright-report(\\|$)",
  "\\frontend\\test-results(\\|$)",
  "\\frontend\\\.vite(\\|$)",
  "\\frontend\\\.vitest(\\|$)",
  "\\frontend\\coverage(\\|$)",
  "\\frontend\\[^\\]+\.tsbuildinfo$",
  "\\frontend\\vite\.config\.(?:js|d\.ts)$",
  "\\frontend\\playwright\.config\.(?:js|d\.ts)$",
  "\\reports\\.*\.html$",
  "\\prototype\.html$",
  "\\agent_console\.html$",
  "\\static\\js\\platform-[^\\]*$",
  "\\static\\css\\platform-[^\\]*$",
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

# Source runtime data and logs are never deleted by packaging. Exclusion is
# performed only while copying into the isolated staging directory.

if (Test-Path -LiteralPath $OutputFullPath) {
  Remove-Item -LiteralPath $OutputFullPath -Force
}

$staging = Join-Path $env:TEMP ("copt-500-package-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $staging | Out-Null
try {
  foreach ($item in $IncludeItems) {
    Copy-PackageItem $item
  }

  $missingFromStaging = @($RequiredPackageItems | Where-Object {
    -not (Test-Path -LiteralPath (Join-Path $staging ($_ -replace "/", "\")))
  })
  if ($missingFromStaging.Count -gt 0) {
    throw "Package self-check failed before compression. Missing: $($missingFromStaging -join ', ')"
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
  [System.IO.Compression.ZipFile]::CreateFromDirectory(
    $staging,
    $OutputFullPath,
    [System.IO.Compression.CompressionLevel]::Optimal,
    $false
  )
}
finally {
  if (Test-Path -LiteralPath $staging) {
    Remove-Item -LiteralPath $staging -Recurse -Force
  }
}

$verificationDir = Join-Path $env:TEMP ("copt-500-package-verify-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $verificationDir | Out-Null
try {
  [System.IO.Compression.ZipFile]::ExtractToDirectory($OutputFullPath, $verificationDir)
  $separator = [System.IO.Path]::DirectorySeparatorChar.ToString()
  $missingFromArchive = @($RequiredPackageItems | Where-Object {
    $requiredRelativePath = $_.Replace("/", $separator).Replace("\", $separator)
    -not (Test-Path -LiteralPath (Join-Path $verificationDir $requiredRelativePath) -PathType Leaf)
  })
  if ($missingFromArchive.Count -gt 0) {
    Remove-Item -LiteralPath $OutputFullPath -Force -ErrorAction SilentlyContinue
    throw "Package self-check failed after compression. Missing: $($missingFromArchive -join ', ')"
  }
}
finally {
  if (Test-Path -LiteralPath $verificationDir) {
    Remove-Item -LiteralPath $verificationDir -Recurse -Force
  }
}

Write-Output "PACKAGE_SELF_CHECK_OK"
Write-Output "Package created: $OutputFullPath"
