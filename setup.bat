@echo off
chcp 65001 >nul
title Null-seerr Media Stack 1-Click Installer
echo =================================================================
echo Starting Null-seerr Media Stack 1-Click Setup...
echo =================================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup.ps1"
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] An error occurred during setup.
    pause
)
