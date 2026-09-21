@echo off
setlocal

set "PORT=8080"
set "URL=http://localhost:%PORT%/"

rem Re-invoked by the server window below to open the browser once the port answers.
if "%~1"=="--open" goto :openbrowser

title Handspace
cd /d "%~dp0"

rem --- find a Python -------------------------------------------------------
set "PY="
python -c "" >nul 2>&1 && set "PY=python"
if not defined PY py -3 -c "" >nul 2>&1 && set "PY=py -3"
if not defined PY goto :nopython

rem --- is the port already taken? ------------------------------------------
netstat -an | findstr /c:"127.0.0.1:%PORT%" | findstr /i /c:"LISTENING" >nul 2>&1
if not errorlevel 1 (
  echo.
  echo   Something is already serving on port %PORT%.
  echo   Opening the page against it instead of starting a second server.
  start "" /min "%~f0" --open
  timeout /t 3 /nobreak >nul
  exit /b 0
)

echo.
echo   Handspace
echo   =========
echo.
echo   Serving : %CD%
echo   Address : %URL%
echo.
echo   Chrome should open in a moment. Allow the camera when it asks.
echo   Leave this window open while you play - closing it stops the server.
echo.

start "" /min "%~f0" --open
%PY% -m http.server %PORT% --bind 127.0.0.1
exit /b 0

rem --------------------------------------------------------------------------
:openbrowser
rem Wait for the server to actually accept a connection, up to ~8 seconds, so
rem the browser never lands on a refused connection and needs a manual refresh.
powershell -NoProfile -Command "$i=0; while ($i -lt 40) { try { (New-Object Net.Sockets.TcpClient('127.0.0.1',%PORT%)).Close(); break } catch { Start-Sleep -Milliseconds 200; $i++ } }" >nul 2>&1

set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if exist "%CHROME%" goto :havechrome
set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if exist "%CHROME%" goto :havechrome

rem No Chrome - fall back to whatever the default browser is.
start "" "%URL%"
exit /b 0

:havechrome
start "" "%CHROME%" "%URL%"
exit /b 0

rem --------------------------------------------------------------------------
:nopython
echo.
echo   Python was not found on PATH, and the page needs a local web server
echo   because a camera will not work from a file:// address.
echo.
echo   Install it from https://www.python.org/downloads/ and tick
echo   "Add python.exe to PATH" during setup, then run this again.
echo.
pause
exit /b 1
