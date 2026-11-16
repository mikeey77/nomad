@echo off
title PROJECT NOMAD - netwerk
cd /d "%~dp0"
if not exist "tools\python\python.exe" (echo Draai eerst "Setup NOMAD.bat". & pause & exit /b)
"tools\python\python.exe" app\nomad.py --lan %*
