@echo off
rem PiX Web UI 启动器：pi-web + 幽灵缓存同步（同窗口，Ctrl+C 一起退）
rem pi-web 升级后重跑 node "%~dp0install.mjs" 即自动补丁（推理级别菜单）
start "pix-sync" /min node "%~dp0models-sync.mjs" --watch
pi-web --no-open
