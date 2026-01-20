# Railway 部署指南

## 一键部署步骤

### 1. 准备 GitHub 仓库

```bash
# 在项目目录下初始化 Git
cd 抖音文案提取器
git init
git add .
git commit -m "Initial commit"

# 创建 GitHub 仓库并推送
# 在 GitHub 上创建新仓库后执行：
git remote add origin https://github.com/你的用户名/你的仓库名.git
git branch -M main
git push -u origin main
```

### 2. 部署到 Railway

1. 访问 [Railway](https://railway.app/) 并登录
2. 点击 **New Project**
3. 选择 **Deploy from GitHub repo**
4. 选择你的仓库
5. Railway 会自动检测并构建

### 3. 配置环境变量

在 Railway 项目设置中添加以下环境变量：

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `DOUBAO_API_KEY` | `你的豆包API Key` | 豆包 AI 接口密钥 |
| `DOUBAO_MODEL_ID` | `doubao-seed-1-6-flash-250828` | 豆包模型 ID |

### 4. 获取访问地址

部署完成后，Railway 会自动分配一个域名，如：
`https://你的项目名.up.railway.app`

也可以在 Settings → Domains 中添加自定义域名。

---

## 功能说明

| 功能 | 状态 | 说明 |
|------|------|------|
| 🔐 用户登录注册 | ✅ | 完整支持 |
| ⚽ 球赛预测 | ✅ | 豆包 AI 分析 |
| 📝 文案库 | ✅ | 完整支持 |
| 👤 作者监控 | ⚠️ | 需要抖音登录态 |
| 🎤 语音转写 | ⚠️ | 需要 Whisper 模型 |

> ⚠️ 作者监控和语音转写功能在云端可能受限，建议本地使用

---

## 本地开发

```bash
# 安装依赖
npm install

# 启动服务
npm start

# 访问
open http://localhost:3456
```

---

## 常见问题

### Q: 部署后登录不上？
A: 检查环境变量是否正确设置，查看 Railway 日志排查错误。

### Q: 抖音爬取功能不工作？
A: 云端环境可能需要配置代理或使用抖音 API。建议该功能本地使用。

### Q: 语音转写失败？
A: Whisper 模型较大，首次使用需要下载。云端环境建议使用云端语音识别 API。
