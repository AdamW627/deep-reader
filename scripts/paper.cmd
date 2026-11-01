@echo off
rem Windows entry point for the source launcher.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0paper.ps1" %*
exit /b %errorlevel%
