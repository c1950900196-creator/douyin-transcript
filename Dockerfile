# 使用 Node.js 官方镜像
FROM node:18-slim

# 安装系统依赖
RUN apt-get update && apt-get install -y \
    chromium \
    ffmpeg \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# 安装 Whisper
RUN pip3 install openai-whisper --break-system-packages || true

# 设置工作目录
WORKDIR /app

# 复制 package.json
COPY package*.json ./

# 安装 Node.js 依赖
RUN npm install --omit=dev

# 复制源代码
COPY . .

# 设置环境变量
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production

# 暴露端口
EXPOSE 3456

# 启动应用
CMD ["node", "server.js"]
