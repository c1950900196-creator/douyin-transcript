# 使用 Node.js 官方镜像
FROM node:18-slim

# 安装 Chromium 和必要的依赖
RUN apt-get update && apt-get install -y \
    chromium \
    chromium-sandbox \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libxss1 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# 设置工作目录
WORKDIR /app

# 复制 package.json
COPY package*.json ./

# 安装依赖（跳过 Chromium 下载）
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
RUN npm ci --only=production

# 复制所有文件
COPY . .

# 设置生产环境
ENV NODE_ENV=production

# 启动应用
CMD ["node", "server.js"]
