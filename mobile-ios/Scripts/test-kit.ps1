# Run the VEXONKit tests on Windows from any PowerShell window.
#
# Finds the Swift toolchain (installed with `winget install Swift.Toolchain`),
# loads the Visual Studio C++ build environment (for link.exe) and sets SDKROOT,
# then runs `swift test` (or any swift arguments you pass).
#
#   powershell -ExecutionPolicy Bypass -File mobile-ios\Scripts\test-kit.ps1
#   powershell -ExecutionPolicy Bypass -File mobile-ios\Scripts\test-kit.ps1 build
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$SwiftArgs)
$ErrorActionPreference = 'Stop'
if (-not $SwiftArgs) { $SwiftArgs = @('test') }

# 1. Swift toolchain + runtime + Windows SDK (newest installed version).
$swiftRoot = Join-Path $env:LOCALAPPDATA 'Programs\Swift'
$toolchain = Get-ChildItem (Join-Path $swiftRoot 'Toolchains') -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
if (-not $toolchain) { throw "Swift is not installed. Run: winget install Swift.Toolchain" }
$version = ($toolchain.Name -split '\+')[0]
$runtime = Join-Path $swiftRoot "Runtimes\$version\usr\bin"
$sdk = Join-Path $swiftRoot "Platforms\$version\Windows.platform\Developer\SDKs\Windows.sdk\"
if (-not (Test-Path $sdk)) { throw "Swift Windows SDK not found at $sdk" }

# 2. Visual Studio with the C++ x64 tools (provides link.exe).
$installer = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer'
$vswhere = Join-Path $installer 'vswhere.exe'
if (-not (Test-Path $vswhere)) { throw "Visual Studio Build Tools are not installed (C++ workload needed)." }
$vs = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vs) { throw "Visual Studio C++ x64 tools not found. Add the 'Desktop development with C++' workload." }
$vcvars = Join-Path $vs 'VC\Auxiliary\Build\vcvars64.bat'

# 3. Run inside that environment.
$package = Resolve-Path (Join-Path $PSScriptRoot '..\Packages\VEXONKit')
$swiftPath = "$($toolchain.FullName)\usr\bin;$runtime"
Write-Host "Swift $version - $vs" -ForegroundColor Cyan
cmd /c "set `"PATH=$installer;%PATH%`" && call `"$vcvars`" >nul && set `"PATH=$swiftPath;%PATH%`" && set `"SDKROOT=$sdk`" && cd /d `"$package`" && swift $($SwiftArgs -join ' ')"
exit $LASTEXITCODE
