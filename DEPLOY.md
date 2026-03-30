# 腾讯云部署指南（当前生产环境）

## 服务器信息

- 服务器：`175.24.131.130`
- 部署目录：`/www/ball-predict-deploy`
- 进程管理：`PM2`
- 进程名：`ball-predict`

## 发布步骤

### 1) 同步代码到服务器

```bash
scp -r ./* root@175.24.131.130:/www/ball-predict-deploy/
```

### 2) 安装依赖（首次或依赖变更时）

```bash
ssh root@175.24.131.130
cd /www/ball-predict-deploy
npm install --production
```

### 3) 重启服务

```bash
pm2 restart ball-predict
pm2 logs ball-predict --lines 50
```

## 线上访问地址

- 预测页面：`http://175.24.131.130:3456/predictions.html`
- 文案库页面：`http://175.24.131.130:3456/transcripts.html`
- 首页：`http://175.24.131.130:3456/`

## 常用运维命令

```bash
pm2 list
pm2 logs ball-predict
pm2 restart ball-predict
```
