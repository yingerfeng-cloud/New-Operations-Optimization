$ErrorActionPreference = "Stop"
$RepositoryRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$FixtureRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("optiforge-package-contract-" + [guid]::NewGuid().ToString("N"))
$RequiredFiles = @(
  ".github/workflows/ci.yml",
  ".github/workflows/e2e-real.yml",
  ".github/workflows/nightly-stability.yml",
  "frontend/package.json",
  "frontend/src/main.tsx",
  "requirements.txt",
  "server.py",
  "OPERATION_MANUAL.md",
  "docs/visual-acceptance/ui-special-iteration/README.md"
)
$Cases = @(
  @{ Name = "posix-and-finder"; Launchers = @("start.sh", "stop.sh", "启动OPTIFORGE.command", "停止OPTIFORGE.command") },
  @{ Name = "powershell"; Launchers = @("start.ps1", "stop.ps1") },
  @{ Name = "both-platforms"; Launchers = @("start.sh", "stop.sh", "start.ps1", "stop.ps1") },
  @{ Name = "missing-stop"; Launchers = @("start.sh"); Error = "complete launcher pair" },
  @{ Name = "unrelated-scripts"; Launchers = @("one.ps1", "two.ps1"); Error = "supported start/stop launcher pair" },
  @{ Name = "partial-second-platform"; Launchers = @("start.sh", "stop.sh", "start.ps1"); Error = "complete launcher pair" },
  @{ Name = "finder-without-posix"; Launchers = @("start.ps1", "stop.ps1", "启动OPTIFORGE.command"); Error = "requires start.sh and stop.sh" },
  @{ Name = "missing-required-source"; Launchers = @("start.sh", "stop.sh"); Missing = "server.py"; Error = "self-check failed before compression" }
)
New-Item -ItemType Directory -Path $FixtureRoot | Out-Null
try {
  foreach ($case in $Cases) {
    $caseRoot = Join-Path $FixtureRoot $case.Name
    New-Item -ItemType Directory -Path $caseRoot | Out-Null
    Copy-Item -LiteralPath (Join-Path $RepositoryRoot "package.ps1") -Destination $caseRoot
    $fixtureFiles = @($RequiredFiles) + @($case.Launchers) + @(
      "data/runtime_store.json", "data/runtime_store.local.json",
      "data/runtime_store.example.json", "frontend/node_modules/package/index.js",
      "frontend/dist/index.html", "frontend/test-results/trace.zip",
      "app/__pycache__/cached.pyc", "app/logs/platform.log"
    )
    foreach ($relative in $fixtureFiles) {
      if ($relative -eq $case.Missing) { continue }
      $file = Join-Path $caseRoot $relative
      New-Item -ItemType Directory -Path (Split-Path -Parent $file) -Force | Out-Null
      Set-Content -LiteralPath $file -Value "fixture:$relative" -Encoding utf8
    }
    $archivePath = Join-Path $FixtureRoot ($case.Name + ".zip")
    $failure = $null
    try {
      & (Join-Path $caseRoot "package.ps1") -OutputPath $archivePath | Out-Null
    } catch {
      $failure = $_.Exception.Message
    }
    if ($case.Error) {
      if (-not $failure -or -not $failure.Contains($case.Error)) {
        throw "Case $($case.Name) did not reject the invalid package: $failure"
      }
      if (Test-Path -LiteralPath $archivePath) {
        throw "Case $($case.Name) left a delivery archive after rejection."
      }
    } else {
      if ($failure) { throw "Case $($case.Name) failed: $failure" }
      $archive = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
      try {
        $names = @($archive.Entries | ForEach-Object { $_.FullName.Replace("\", "/") })
        foreach ($required in (@($RequiredFiles) + @($case.Launchers) + @("data/runtime_store.example.json"))) {
          if ($names -notcontains $required) { throw "Case $($case.Name) omitted $required" }
        }
        foreach ($excluded in @("runtime_store.json", "runtime_store.local.json", "node_modules/", "dist/", "test-results/", "__pycache__/", "logs/")) {
          if ($names | Where-Object { $_.Contains($excluded) }) {
            throw "Case $($case.Name) included excluded runtime/build data: $excluded"
          }
        }
      } finally {
        $archive.Dispose()
      }
    }
    $sourceRuntime = Get-Content -LiteralPath (Join-Path $caseRoot "data/runtime_store.json") -Raw
    if ($sourceRuntime.Trim() -ne "fixture:data/runtime_store.json") {
      throw "Case $($case.Name) changed source runtime data."
    }
    Write-Output "PACKAGE_CONTRACT_CASE_OK: $($case.Name)"
  }
  Write-Output "PACKAGE_CONTRACT_OK: $($Cases.Count) cases"
} finally {
  Remove-Item -LiteralPath $FixtureRoot -Recurse -Force
}
