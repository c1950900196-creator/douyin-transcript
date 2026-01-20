# 使用 Node.js 官方镜像
FROM node:18-slim

# 设置工作目录
WORKDIR /app

# 复制所有文件
COPY . .

# 设置生产环境
ENV NODE_ENV=production

# 启动应用
CMD ["node", "server-simple.js"]
