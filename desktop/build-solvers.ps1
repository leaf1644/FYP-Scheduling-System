$ErrorActionPreference = 'Stop'

$DesktopRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $DesktopRoot '..')
$ServerRoot = Join-Path $RepoRoot 'server'
$RuntimeRoot = Join-Path $DesktopRoot 'resources\python-runtime'
$PackagedServerRoot = Join-Path $DesktopRoot 'resources\server'
$DesktopVenvRoot = Join-Path $DesktopRoot '.solver-venv'

function Remove-PathIfExists {
  param(
    [string]$TargetPath
  )

  if (Test-Path $TargetPath) {
    Remove-Item $TargetPath -Recurse -Force
  }
}

function Copy-DirectoryContents {
  param(
    [string]$Source,
    [string]$Destination
  )

  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  Get-ChildItem $Source -Force | ForEach-Object {
    Copy-Item $_.FullName (Join-Path $Destination $_.Name) -Recurse -Force
  }
}

function Trim-DesktopRuntime {
  param(
    [string]$RuntimePath,
    [string]$DesktopVenvPath
  )

  $runtimeLib = Join-Path $RuntimePath 'Lib'
  $runtimeSitePackages = Join-Path $runtimeLib 'site-packages'
  $venvSitePackages = Join-Path $DesktopVenvPath 'Lib\site-packages'

  @(
    (Join-Path $RuntimePath 'Doc'),
    (Join-Path $RuntimePath 'include'),
    (Join-Path $RuntimePath 'libs'),
    (Join-Path $RuntimePath 'Scripts'),
    (Join-Path $RuntimePath 'Tools'),
    (Join-Path $RuntimePath 'tcl'),
    (Join-Path $runtimeLib 'test'),
    (Join-Path $runtimeLib 'ensurepip'),
    (Join-Path $runtimeLib 'idlelib'),
    (Join-Path $runtimeLib 'tkinter'),
    (Join-Path $runtimeLib 'turtledemo'),
    (Join-Path $runtimeLib 'venv'),
    (Join-Path $runtimeLib '__pycache__'),
    (Join-Path $runtimeLib 'site-packages')
  ) | ForEach-Object {
    Remove-PathIfExists $_
  }

  Copy-DirectoryContents -Source $venvSitePackages -Destination $runtimeSitePackages

  Get-ChildItem $RuntimePath -Recurse -Directory -Filter '__pycache__' -ErrorAction SilentlyContinue | ForEach-Object {
    Remove-Item $_.FullName -Recurse -Force
  }

  @(
    'pip',
    'pip-*.dist-info',
    'setuptools',
    'setuptools-*.dist-info',
    'pkg_resources',
    'wheel',
    'wheel-*.dist-info',
    'PyInstaller',
    'pyinstaller-*.dist-info',
    'pyinstaller_hooks_contrib-*.dist-info',
    '_pyinstaller_hooks_contrib',
    'altgraph',
    'altgraph-*.dist-info',
    'packaging',
    'packaging-*.dist-info',
    'win32ctypes',
    'pywin32_ctypes-*.dist-info'
  ) | ForEach-Object {
    Get-ChildItem $runtimeSitePackages -Filter $_ -Force -ErrorAction SilentlyContinue | ForEach-Object {
      Remove-Item $_.FullName -Recurse -Force
    }
  }
}

function Resolve-Python312Base {
  $explicit312 = $env:DESKTOP_PYTHON312_BIN
  if ($explicit312 -and (Test-Path $explicit312)) {
    return (& $explicit312 -c "import sys; print(sys.base_prefix)").Trim()
  }

  $pyLauncher = Get-Command py -ErrorAction SilentlyContinue
  if ($pyLauncher) {
    try {
      $basePrefix = (& py -3.12 -c "import sys; print(sys.base_prefix)").Trim()
      if ($basePrefix) {
        return $basePrefix
      }
    } catch {
    }
  }

  $defaultInstall = 'C:\Users\leung\AppData\Local\Programs\Python\Python312'
  if (Test-Path $defaultInstall) {
    return $defaultInstall
  }

  throw 'Python 3.12 is required for the desktop runtime build. Install Python 3.12 or set DESKTOP_PYTHON312_BIN.'
}

function Ensure-DesktopBuildVenv {
  param(
    [string]$PythonBase
  )

  $venvPython = Join-Path $DesktopVenvRoot 'Scripts\python.exe'
  if (-not (Test-Path $venvPython)) {
    $pythonExe = Join-Path $PythonBase 'python.exe'
    & $pythonExe -m venv $DesktopVenvRoot | Out-Host
  }

  & $venvPython -m pip install --upgrade pip ortools pulp pandas openpyxl | Out-Host
  return $venvPython
}

$python312Base = Resolve-Python312Base
$python312Exe = Join-Path $python312Base 'python.exe'

if (-not (Test-Path $python312Exe)) {
  throw "Python 3.12 executable not found at $python312Exe"
}

$desktopBuildPython = Ensure-DesktopBuildVenv -PythonBase $python312Base

if (Test-Path $RuntimeRoot) {
  Remove-Item $RuntimeRoot -Recurse -Force
}

if (Test-Path $PackagedServerRoot) {
  Remove-Item $PackagedServerRoot -Recurse -Force
}

Copy-DirectoryContents -Source $python312Base -Destination $RuntimeRoot
Trim-DesktopRuntime -RuntimePath $RuntimeRoot -DesktopVenvPath $DesktopVenvRoot

New-Item -ItemType Directory -Path $PackagedServerRoot -Force | Out-Null
Get-ChildItem $ServerRoot -Filter *.py | ForEach-Object {
  Copy-Item $_.FullName (Join-Path $PackagedServerRoot $_.Name)
}

Write-Host ''
Write-Host 'Prepared desktop Python runtime:' -ForegroundColor Green
Get-Item (Join-Path $RuntimeRoot 'python.exe') | Select-Object FullName, Length, LastWriteTime | Format-Table -AutoSize
Write-Host ''
Write-Host 'Packaged solver scripts:' -ForegroundColor Green
Get-ChildItem $PackagedServerRoot -Filter *.py | Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize