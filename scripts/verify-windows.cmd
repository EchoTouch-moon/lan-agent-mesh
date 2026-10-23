@echo off
cd /d "%~dp0.."
powershell.exe -NoProfile -File "%~dp0verify-windows.ps1"
set "lam_validation_exit=%ERRORLEVEL%"
echo.
echo Report: %TEMP%\lam-windows-validation.log
echo Please return the report even if validation failed.
pause
exit /b %lam_validation_exit%
