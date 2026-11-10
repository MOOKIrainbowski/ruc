@echo off
rem Double-click launcher: this PC has no "Run with PowerShell" handler for .ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-pc.ps1"
