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

REM A dev build only contains the native modules it was built with. If a native
REM package (e.g. expo-location) or app.config.js plugins changed since, the old
REM app fails with "Cannot find native module ..." - so rebuild it first.
echo Emulator ready. Checking the installed app build...
pushd "%PROJECT_ROOT%mobile"
call node scripts\native-build-check.js check
if errorlevel 1 (
    echo Native dependencies changed - rebuilding and installing the app. This takes a few minutes...
    call npx expo prebuild -p android --no-install
    if errorlevel 1 goto buildfail
    call npx expo run:android --no-bundler
    if errorlevel 1 goto buildfail
    call node scripts\native-build-check.js record
)
popd

echo Starting Expo dev server...
start "Vexon Metro" cmd /k "cd /d "%PROJECT_ROOT%mobile" && npx expo start --dev-client"

echo.
echo All three are starting in separate windows:
echo   - Vexon API       (server logs)
echo   - Vexon Emulator  (the phone screen)
echo   - Vexon Metro     (press "a" here once it's ready to install/launch the app)
echo.
pause
exit /b 0

:buildfail
popd
echo.
echo The Android app build failed - see the messages above. Metro was not started.
pause
exit /b 1
