# 抖音文案提取器 - Railway 部署问题记录

## 项目信息
- **GitHub 仓库**: https://github.com/c1950900196-creator/douyin-transcript.git
- **Railway 域名**: https://douyin-transcript-production.up.railway.app
- **项目路径**: `/Users/huhaotian/未命名文件夹/抖音文案提取器`

## 当前状态
**云端版服务器部署中** - 使用无依赖版本

最新更新：
- ✅ 创建 server-cloud.js（云端专用版本）
- ✅ 移除 Puppeteer 依赖（云端不需要）
- ✅ 简化 Dockerfile（只需 Node.js）
- ✅ 保留核心功能：用户认证、球赛预测

正在部署...

## 已解决的问题

### 1. npm install 失败 - puppeteer 下载 Chromium
**错误**: `npm 错误代码 ENOENT spawn sh`
**原因**: puppeteer 在安装时自动下载 Chromium，在 Railway 环境中失败
**解决**: 
- 设置 `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true`
- 使用系统安装的 Chromium：`PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`

### 2. 构建超时（10分钟限制）
**原因**: 
- 复制了本地 `node_modules` 文件夹
- 安装 Whisper（Python 包）耗时过长
**解决**: 
- 添加 `.dockerignore` 排除 `node_modules`、`data` 等
- 暂时移除 Whisper（语音转写功能在云端不可用）

### 3. Cannot find module 'puppeteer-extra'
**原因**: Railway 使用了缓存的旧版本，没有运行正确的启动命令
**解决**: 添加 `railway.json` 明确指定构建和启动配置

### 4. 服务器启动成功但 502
**原因**: Node.js 默认监听 `127.0.0.1`，Docker 容器需要监听 `0.0.0.0`
**解决**: 
```javascript
server.listen(PORT, '0.0.0.0', () => { ... });
```

## 当前文件结构

### package.json（无依赖版本）
```json
{
  "name": "douyin-transcript-extractor",
  "version": "2.0.0",
  "main": "server-simple.js",
  "scripts": {
    "start": "node server-simple.js"
  },
  "dependencies": {},
  "engines": {
    "node": ">=18"
  }
}
```

### Dockerfile
```dockerfile
FROM node:18-slim
WORKDIR /app
COPY . .
ENV NODE_ENV=production
CMD ["node", "server-simple.js"]
```

### railway.json
```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "Dockerfile"
  },
  "deploy": {
    "startCommand": "node server-simple.js",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

## 下一步工作

### 如果简化版成功运行：
1. 逐步添加回功能模块
2. 添加 puppeteer 依赖（需要正确配置跳过下载）
3. 添加其他依赖（puppeteer-extra, puppeteer-extra-plugin-stealth）
4. 恢复完整版 server.js

### 需要修改的完整版代码：
1. `server.js` 的 `server.listen()` 需要添加 `'0.0.0.0'` 参数
2. Chrome 路径需要包含 Linux 路径（已修改）

### 云端不可用的功能：
- **语音转写**：需要本地 Whisper 模型，建议改用 Whisper API
- **抖音登录**：需要 Puppeteer + 手动登录，云端难以实现

### 云端可用的功能：
- 用户注册/登录
- 球赛预测（豆包 API）
- 文案管理
- 准确率统计

## 环境变量（Railway Variables）
```
PORT=8080 (Railway 自动设置)
DOUBAO_API_KEY=e68d0560-b1b7-4fee-afbc-13c528c14bcd
DOUBAO_MODEL_ID=doubao-seed-1-6-flash-250828
NODE_ENV=production
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
```

## 重要文件列表
- `server-simple.js` - 简化版服务器（当前使用）
- `server.js` - 完整版服务器
- `auth.js` - 用户认证模块
- `author-monitor.js` - 作者监控模块
- `match-predictor.js` - 球赛预测模块
- `login.html` - 登录页面
- `index.html` - 主页面
- `predictions.html` - 球赛预测页面
