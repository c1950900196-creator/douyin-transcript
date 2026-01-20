/**
 * 抖音文案提取器 - 云端版
 * 功能：用户认证、球赛预测、数据管理
 * 不包含：Puppeteer、Whisper（云端不可用）
 */

console.log('🚀 正在启动云端服务器...');
console.log('📦 加载依赖模块...');

const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');
const path = require('path');

console.log('✅ Node.js 核心模块加载完成');

// 比赛预测模块
console.log('📥 加载 match-predictor.js...');
const matchPredictor = require('./match-predictor');
console.log('✅ match-predictor.js 加载成功');

// 用户认证模块
console.log('📥 加载 auth.js...');
const auth = require('./auth');
console.log('✅ auth.js 加载成功');

// 豆包 AI 配置
const DOUBAO_CONFIG = {
    enabled: true,
    apiKey: process.env.DOUBAO_API_KEY || 'e68d0560-b1b7-4fee-afbc-13c528c14bcd',
    modelId: process.env.DOUBAO_MODEL_ID || 'doubao-seed-1-6-flash-250828',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    systemPrompt: `你是一个专业的足球比赛预测助手...`
};

const PORT = process.env.PORT || 3456;

console.log(`🔧 配置信息:`);
console.log(`   - PORT: ${PORT}`);
console.log(`   - NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
console.log(`   - DOUBAO_API_KEY: ${DOUBAO_CONFIG.apiKey ? '已设置' : '未设置'}`);
console.log('');

// MIME类型映射
const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

// CORS 头
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8'
};

// 创建HTTP服务器
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    const query = parsedUrl.query;
    
    // 处理OPTIONS请求
    if (req.method === 'OPTIONS') {
        res.writeHead(200, corsHeaders);
        res.end();
        return;
    }
    
    // API测试
    if (pathname === '/api/test') {
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify({
            success: true,
            message: '云端服务器运行正常！',
            version: '2.0-cloud',
            port: PORT,
            env: process.env.NODE_ENV,
            features: {
                auth: true,
                predictions: true,
                puppeteer: false,
                whisper: false
            }
        }));
        return;
    }
    
    // 用户注册
    if (pathname === '/api/register' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                const result = await auth.register(data.username, data.password);
                res.writeHead(200, corsHeaders);
                res.end(JSON.stringify(result));
            } catch (e) {
                res.writeHead(500, corsHeaders);
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
        });
        return;
    }
    
    // 用户登录
    if (pathname === '/api/login' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                const result = await auth.login(data.username, data.password);
                res.writeHead(200, corsHeaders);
                res.end(JSON.stringify(result));
            } catch (e) {
                res.writeHead(500, corsHeaders);
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
        });
        return;
    }
    
    // 球赛预测相关API
    if (pathname.startsWith('/api/predictions') || pathname.startsWith('/api/matches')) {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
            try {
                let result;
                const data = body ? JSON.parse(body) : {};
                const token = req.headers.authorization?.replace('Bearer ', '');
                
                // 验证token
                if (token) {
                    const session = auth.verifyToken(token);
                    if (!session) {
                        res.writeHead(401, corsHeaders);
                        res.end(JSON.stringify({ success: false, error: '未授权' }));
                        return;
                    }
                    data.username = session.username;
                }
                
                // 路由到对应的预测模块方法
                if (pathname === '/api/predictions/predict' && req.method === 'POST') {
                    result = await matchPredictor.predictMatch(data);
                } else if (pathname === '/api/predictions/list' && req.method === 'GET') {
                    result = await matchPredictor.getPredictions(query.username);
                } else if (pathname === '/api/predictions/stats' && req.method === 'GET') {
                    result = await matchPredictor.getStats(query.username);
                } else if (pathname === '/api/matches/add' && req.method === 'POST') {
                    result = await matchPredictor.addMatch(data);
                } else if (pathname === '/api/matches/result' && req.method === 'POST') {
                    result = await matchPredictor.updateMatchResult(data);
                } else {
                    res.writeHead(404, corsHeaders);
                    res.end(JSON.stringify({ success: false, error: '未找到' }));
                    return;
                }
                
                res.writeHead(200, corsHeaders);
                res.end(JSON.stringify(result));
            } catch (e) {
                console.error('API错误:', e);
                res.writeHead(500, corsHeaders);
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
        });
        return;
    }
    
    // 静态文件服务
    if (pathname === '/' || pathname === '/login.html') {
        const loginFile = path.join(__dirname, 'login.html');
        if (fs.existsSync(loginFile)) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(fs.readFileSync(loginFile));
        } else {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<h1>抖音文案提取器 - 云端版</h1><p>登录页面加载中...</p>');
        }
        return;
    }
    
    // 其他HTML页面
    const htmlFiles = ['index.html', 'predictions.html', 'authors.html', 'transcripts.html'];
    if (htmlFiles.includes(pathname.substring(1))) {
        const filePath = path.join(__dirname, pathname);
        if (fs.existsSync(filePath)) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(fs.readFileSync(filePath));
            return;
        }
    }
    
    // 其他静态资源
    const filePath = path.join(__dirname, pathname);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath);
        const contentType = mimeTypes[ext] || 'text/plain';
        res.writeHead(200, { ...corsHeaders, 'Content-Type': contentType });
        res.end(fs.readFileSync(filePath));
        return;
    }
    
    // 404
    res.writeHead(404, corsHeaders);
    res.end(JSON.stringify({ success: false, error: 'Not Found' }));
});

// 启动服务器（Railway 需要监听 0.0.0.0）
server.listen(PORT, '0.0.0.0', async () => {
    console.log('');
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║                                                                ║');
    console.log('║     🎬 抖音文案提取器（云端版）                                 ║');
    console.log('║                                                                ║');
    console.log(`║     📡 服务地址: ${process.env.RAILWAY_STATIC_URL || 'http://localhost:' + PORT}    ║`);
    console.log(`║     🔌 监听端口: ${PORT}                                         ║`);
    console.log(`║     🌍 监听地址: 0.0.0.0                                        ║`);
    console.log('║                                                                ║');
    console.log('║     📋 可用功能:                                               ║');
    console.log('║        • 用户注册/登录                                          ║');
    console.log('║        • 球赛预测（豆包 AI）                                    ║');
    console.log('║        • 准确率统计                                             ║');
    console.log('║                                                                ║');
    console.log('║     ⚠️  云端不可用:                                             ║');
    console.log('║        • 视频下载（需要 Puppeteer）                             ║');
    console.log('║        • 语音转写（需要 Whisper）                               ║');
    console.log('║                                                                ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log('');
    
    // 初始化比赛预测模块
    try {
        matchPredictor.setDoubaoConfig(DOUBAO_CONFIG);
        console.log('✅ 比赛预测模块初始化成功');
    } catch (e) {
        console.error('❌ 比赛预测模块初始化失败:', e.message);
    }
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`❌ 端口 ${PORT} 已被占用`);
    } else {
        console.error('服务器错误:', err);
    }
    process.exit(1);
});
