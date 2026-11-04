@echo off
rem PiX 终端交互模式启动器 (默认工作区: E:\AProjs\Pi\Demo)
setlocal
if exist "E:\AProjs\Pi\Demo" (cd /d "E:\AProjs\Pi\Demo") else (cd /d "%~dp0")
call pi
