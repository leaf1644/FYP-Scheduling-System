$ErrorActionPreference = 'Stop'

$DesktopRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $DesktopRoot '..')
$DesktopDist = Join-Path $DesktopRoot 'app-dist'

Push-Location $RepoRoot
try {
  npm run build | Out-Host
} finally {
  Pop-Location
}

if (Test-Path $DesktopDist) {
  Remove-Item $DesktopDist -Recurse -Force
}

Copy-Item (Join-Path $RepoRoot 'dist') $DesktopDist -Recurse

Push-Location $DesktopRoot
try {
  if (-not (Test-Path (Join-Path $DesktopRoot 'node_modules'))) {
    npm install | Out-Host
  }

  $desktopPython = Join-Path $DesktopRoot 'resources\python-runtime\python.exe'
  $desktopCpSatScript = Join-Path $DesktopRoot 'resources\server\solver_cp_sat_optimized.py'
  if (-not ((Test-Path $desktopPython) -and (Test-Path $desktopCpSatScript))) {
    Write-Host 'Desktop Python runtime not found. Preparing it first...' -ForegroundColor Yellow
    & (Join-Path $DesktopRoot 'build-solvers.ps1')
  }

  npm run dist:portable | Out-Host

  $unpackedZip = Join-Path $DesktopRoot 'release\FYP Scheduling System 0.1.0-win-unpacked.zip'
  if (Test-Path $unpackedZip) {
    Remove-Item $unpackedZip -Force
  }

  Compress-Archive -Path (Join-Path $DesktopRoot 'release\win-unpacked\*') -DestinationPath $unpackedZip
} finally {
  Pop-Location
}

Write-Host ''
Write-Host 'Portable desktop build completed.' -ForegroundColor Green
Write-Host 'Output folder:' (Join-Path $DesktopRoot 'release')
Write-Host 'Fast-start package:' (Join-Path $DesktopRoot 'release\FYP Scheduling System 0.1.0-win-unpacked.zip')