@echo off
REM ============================================================
REM  Vexon: one-click Android dev launcher
REM  Double-click this file (or run it from a terminal) to start:
REM    1) the backend API        (server\  -> npm run dev)
REM    2) the Android emulator   (AVD: Vexon)
REM    3) the Expo dev server    (mobile\ -> npx expo start --dev-client)
REM  Each runs in its own window so you can see all three logs.
REM ============================================================

set PROJECT_ROOT=%~dp0
set AVD_NAME=Vexon

echo.
echo [1/3] Starting backend API...
start "Vexon API" cmd /k "cd /d "%PROJECT_ROOT%server" && npm run dev"

echo [2/3] Starting Android emulator (%AVD_NAME%)...
start "Vexon Emulator" cmd /k "emulator -avd %AVD_NAME%"

echo [3/3] Waiting for the emulator to boot before starting Metro...
:waitboot
adb wait-for-device
for /f %%s in ('adb shell getprop sys.boot_completed 2^>nul') do set BOOTED=%%s
if not "%BOOTED%"=="1" (
    timeout /t 3 >nul
    goto waitboot
)

REM Link the emulator's ports to this PC so the app can reach Metro (8081) and
REM the API (5000). An emulator restart drops these links, which leaves the app
REM stuck on a black screen, so they are re-created on every launch.
adb reverse tcp:8081 tcp:8081 >nul
adb reverse tcp:5000 tcp:5000 >nul

echo Emulator ready. Starting Expo dev server...
start "Vexon Metro" cmd /k "cd /d "%PROJECT_ROOT%mobile" && npx expo start --dev-client"

echo.
echo All three are starting in separate windows:
echo   - Vexon API       (server logs)
echo   - Vexon Emulator  (the phone screen)
echo   - Vexon Metro     (press "a" here once it's ready to install/launch the app)
echo.
pause
