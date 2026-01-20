#!/bin/bash
# 抖音视频文案提取器 - Mac启动脚本

cd "$(dirname "$0")"

echo ""
echo "🎬 正在启动抖音视频文案提取器..."
echo ""

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ 错误: 未找到 Node.js"
    echo ""
    echo "请先安装 Node.js: https://nodejs.org/"
    echo ""
    read -p "按回车键退出..."
    exit 1
fi

echo "✅ Node.js 版本: $(node -v)"
echo ""

# 启动服务器
node server.js &
SERVER_PID=$!

# 等待服务器启动
sleep 2

# 打开浏览器
echo "🌐 正在打开浏览器..."
open index.html

echo ""
echo "💡 提示: 关闭此终端窗口将停止服务"
echo ""

# 等待服务器进程
wait $SERVER_PID
