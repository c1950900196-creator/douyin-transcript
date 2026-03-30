# 抖音视频转文字工具

> 粘贴抖音链接，一键提取视频语音内容并转为文字。支持本地离线运行，也支持云端部署。

## 功能亮点

- **一键转写** — 粘贴抖音分享链接，自动下载视频、提取音频、语音转文字
- **完全离线** — 本地版基于 OpenAI Whisper 模型，无需联网，数据不上传
- **AI 文案修复** — 集成豆包 AI，自动修正语音识别的标点、同音字、专业术语错误
- **作者监控** — 追踪指定抖音作者，自动获取新视频并转写
- **云端部署** — 支持 Railway / Docker 一键部署，团队共享使用
- **双击启动** — Mac / Windows 提供启动脚本，无需命令行操作

## 技术栈

| 模块 | 技术 |
|------|------|
| 视频抓取 | Puppeteer + Stealth 插件（绕过反爬） |
| 音频提取 | FFmpeg |
| 语音识别 | OpenAI Whisper（本地）/ 可选云端 API |
| 文案修复 | 豆包 AI（可选） |
| Web 服务 | Node.js 原生 HTTP |
| 部署 | Docker / Railway |

## 快速开始

### 本地运行

```bash
# 前置条件：安装 FFmpeg 和 Python 3
# Mac: brew install ffmpeg
# Windows: https://ffmpeg.org/download.html

# 安装依赖
npm install

# 启动本地版
npm run start:local
# 或直接双击 启动.command (Mac) / 启动.bat (Windows)
```

浏览器打开 `http://localhost:3456`，粘贴抖音链接即可使用。

### 云端部署

```bash
# Docker
docker build -t douyin-transcript .
docker run -p 3456:3456 douyin-transcript

# 或一键部署到 Railway
# 参考 railway.json 配置
```

## 使用方式

1. 在抖音 App 中，点击视频「分享」→「复制链接」
2. 将链接粘贴到输入框
3. 点击「语音转文字」
4. 等待处理完成，查看/复制转写结果

## Whisper 模型选择

| 模型 | 大小 | 速度 | 精度 | 推荐场景 |
|------|------|------|------|---------|
| tiny | ~75MB | 最快 | 较低 | 快速预览 |
| base | ~142MB | 很快 | 一般 | 日常使用 |
| small | ~466MB | 中等 | 较好 | **推荐** |
| medium | ~1.5GB | 较慢 | 很好 | 高精度需求 |
| large | ~2.9GB | 最慢 | 最高 | 专业场景 |

首次使用时模型会自动下载。

## 许可

MIT
