@echo off
chcp 65001 >nul
title 抖音视频文案提取器

echo.
echo  🎬 正在启动抖音视频文案提取器...
echo.

cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo  ❌ 错误: 未找到 Node.js
    echo.
    echo  请先安装 Node.js: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do echo  ✅ Node.js 版本: %%i
echo.

start "" "%~dp0index.html"

echo  💡 提示: 关闭此窗口将停止服务
echo.

node server.js
