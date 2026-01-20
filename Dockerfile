# 使用 Node.js 官方镜像
FROM node:18-slim

# 安装 Chromium 依赖
RUN apt-get update && apt-get install -y \
    chromium \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# 设置工作目录
WORKDIR /app

# 复制 package.json
COPY package*.json ./

# 安装 Node.js 依赖
RUN npm install --omit=dev

# 复制源代码
COPY . .

# 创建数据目录
RUN mkdir -p data

# 设置环境变量
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production

# Railway 会自动设置 PORT 环境变量
# EXPOSE $PORT

# 启动应用
CMD ["node", "server.js"]
