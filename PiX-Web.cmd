@echo off
title PiX Web UI 控制台
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ========================================================
echo  🛡️  PiX 全自主红队与渗透测试智能体 · Web 控制台
echo ========================================================

rem 检测端口是否已被占用
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 30141 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique" > "%temp%\pix_port_check.tmp" 2>nul
set /p PORT_PID=<"%temp%\pix_port_check.tmp"
del "%temp%\pix_port_check.tmp" 2>nul

if defined PORT_PID (
    echo [提示] 检测到 PiX 服务已在运行中 (PID: %PORT_PID%)
    echo 正在自动为你打开浏览器: http://127.0.0.1:30141
    start http://127.0.0.1:30141
    echo.
    echo --------------------------------------------------------
    echo  关闭方式：若需关闭当前服务，请双击运行 PiX-Stop.cmd
    echo --------------------------------------------------------
    echo 按任意键退出当前启动提示...
    pause >nul
    exit /b 0
)

echo [1/4] 检查并同步最新扩展与武器库...
call node scripts\install.mjs --no-patch >nul 2>&1

echo [2/4] 启动模型缓存同步器...
start "pix-sync" /min node "%~dp0scripts\models-sync.mjs" --watch

echo [3/4] 启动只读实时矩阵大屏 (30142)...
start "pix-matrix" /min node "%~dp0scripts\matrix-server.mjs"

echo [4/4] 正在拉起 Web 服务并打开浏览器...
start http://127.0.0.1:30141

echo.
echo ========================================================
echo  🟢 PiX 服务已启动！
echo  Web 控制台:   http://127.0.0.1:30141
echo  矩阵大屏:     http://127.0.0.1:30142
echo ========================================================
echo.
echo  【关闭方式提示】：
echo    1. 直接在此窗口按 [Ctrl + C] 并输入 Y 确认；
echo    2. 或者双击运行项目根目录下的 PiX-Stop.cmd；
echo    3. 或者直接关闭当前黑框窗口。
echo ========================================================
echo.

if defined PIX_WORKSPACE if exist "%PIX_WORKSPACE%" cd /d "%PIX_WORKSPACE%"
call pi-web --no-open

echo.
echo 正在执行退出清理...
node "%~dp0scripts\stop-pix.mjs"
exit /b 0
