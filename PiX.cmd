@echo off
rem PiX 终端交互模式启动器
setlocal
if defined PIX_WORKSPACE (if exist "%PIX_WORKSPACE%" cd /d "%PIX_WORKSPACE%") else (cd /d "%~dp0")
call pi
