# 使用 Node.js 官方镜像
FROM node:18-slim

# 安装 Chromium 依赖
RUN apt-get update && apt-get install -y \
    chromium \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# 设置工作目录
WORKDIR /app

# 设置环境变量 - 跳过 Puppeteer 内置 Chromium 下载，使用系统 Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# 复制 package.json
COPY package*.json ./

# 安装 Node.js 依赖
RUN npm install --omit=dev

# 复制源代码
COPY . .

# 创建数据目录
RUN mkdir -p data

# 设置生产环境
ENV NODE_ENV=production

# 启动应用（先用简化版测试）
CMD ["node", "server-simple.js"]
