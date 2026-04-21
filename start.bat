@echo off
title Image Tag Studio
cd /d "%~dp0"

if not exist "venv\Scripts\python.exe" (
    echo [ERROR] venv not found
    pause
    exit /b 1
)

powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" >nul 2>&1
timeout /t 1 /nobreak >nul

set PYTHONIOENCODING=utf-8

echo Starting Image Tag Studio...
echo Browser will open at http://localhost:8000
echo.

venv\Scripts\python.exe main.py

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Exited with code %errorlevel%
    pause
)
