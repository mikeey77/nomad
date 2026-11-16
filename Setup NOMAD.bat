@echo off
title PROJECT NOMAD - setup
cd /d "%~dp0"
if exist "tools\python\python.exe" "tools\python\python.exe" app\update.py
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0app\setup.ps1"
pause
