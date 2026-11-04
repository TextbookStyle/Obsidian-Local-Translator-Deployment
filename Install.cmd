@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install.ps1" %*
set "installer_result=%ERRORLEVEL%"
echo.
pause
exit /b %installer_result%
