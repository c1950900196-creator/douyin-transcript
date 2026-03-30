# 抖音文案提取器 - 本地版使用说明

## 系统状态 ✅

**本地完整版已恢复运行**

- ✅ 服务器地址: http://localhost:3456
- ✅ 用户认证: 已登录（测试用户）
- ✅ FFmpeg: 已安装
- ✅ Python 3: 已安装
- ✅ Whisper: 已安装
- ✅ Puppeteer + Chrome: 已配置

## 完整功能列表

### 1. 📝 文案提取 (index.html)
- 粘贴抖音视频链接
- 自动下载视频
- 提取音频
- 本地 Whisper 语音转文字
- 豆包 AI 文案修复（添加标点、纠错）
- 保存到文案库

### 2. 👤 作者监控 (authors.html)
- 监控指定抖音作者
- 自动抓取新视频
- 每 6 小时自动检查
- 已监控 5 个作者，抓取 355 个视频

### 3. 📚 文案库 (transcripts.html)
- 查看所有已提取的文案
- 搜索和筛选
- 导出功能

### 4. ⚽ 球赛预测 (predictions.html)
- 使用豆包 AI 预测球赛结果
- 记录预测历史
- 统计准确率

## 启动方式

```bash
cd /Users/huhaotian/未命名文件夹/抖音文案提取器
npm start
```

或者：
```bash
node server.js
```

## 技术栈

- **后端**: Node.js + HTTP 服务器
- **浏览器自动化**: Puppeteer + Chrome
- **语音识别**: OpenAI Whisper (本地运行)
- **AI 文案修复**: 豆包 API
- **视频处理**: FFmpeg

## 系统要求

1. **Node.js**: >= 18
2. **FFmpeg**: 用于视频转音频
   - Mac 安装: `brew install ffmpeg`
3. **Python 3**: 用于运行 Whisper
4. **Google Chrome**: 用于 Puppeteer 自动化
5. **磁盘空间**: 至少 3GB（Whisper 模型）

## 配置文件

- `config.json`: 模型大小配置
- `data/users.json`: 用户数据
- `data/sessions.json`: 登录会话
- `data/authors.json`: 监控的作者列表
- `data/transcripts.json`: 文案库
- `data/predictions.json`: 球赛预测记录
- `data/matches.json`: 比赛信息

## 环境变量

- `PORT`: 服务器端口（默认 3456）
- `DOUBAO_API_KEY`: 豆包 API 密钥
- `DOUBAO_MODEL_ID`: 豆包模型 ID
- `CHROME_PATH`: Chrome 浏览器路径（可选）

## 注意事项

1. **首次运行**: Whisper 会自动下载模型（约 500MB），请耐心等待
2. **模型选择**: 
   - tiny: 最快，精度最低（~75MB）
   - small: 推荐，平衡速度和精度（~466MB）
   - large: 最慢，精度最高（~2.9GB）
3. **抖音链接**: 需要完整的分享链接或分享文本
4. **网络**: 首次运行需要网络下载模型，之后可完全离线运行

## 开发说明

### 主要文件

- `server.js`: 完整版服务器（本地）
- `server-cloud.js`: 云端简化版（Railway，功能有限）
- `server-simple.js`: 最简版测试服务器
- `auth.js`: 用户认证模块
- `match-predictor.js`: 球赛预测模块
- `author-monitor.js`: 作者监控模块

### 部署相关

- `Dockerfile`: Docker 构建配置
- `railway.json`: Railway 部署配置
- `.dockerignore`: Docker 忽略文件
- `DEPLOY-ISSUES.md`: 部署问题记录

## 已知问题

### Railway 云端部署
- ❌ 完整版部署失败（502 错误）
- 原因：Puppeteer/Whisper 在云端环境不可用
- 解决方案：使用 `server-cloud.js`（仅用户认证和球赛预测）

### 本地运行
- ✅ 所有功能正常
- ✅ Whisper 模型已下载
- ✅ FFmpeg、Python、Chrome 已配置

## 当前状态

**🎉 本地完整版已恢复正常运行！**

所有功能已测试通过：
- ✅ 服务器启动成功
- ✅ Web 界面加载正常
- ✅ 系统检测通过（FFmpeg、Python、Whisper）
- ✅ 作者监控运行中（5 个作者，355 个视频）

可以开始使用了！访问 http://localhost:3456
