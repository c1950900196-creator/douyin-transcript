/**
 * 简化版服务器 - 用于测试部署
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3456;

const server = http.createServer((req, res) => {
    // CORS 头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }
    
    // API 测试
    if (req.url === '/api/test') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            success: true, 
            message: '服务器运行正常！',
            port: PORT,
            env: process.env.NODE_ENV 
        }));
        return;
    }
    
    // 登录页面
    if (req.url === '/' || req.url === '/login.html') {
        const loginFile = path.join(__dirname, 'login.html');
        if (fs.existsSync(loginFile)) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(fs.readFileSync(loginFile));
        } else {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<h1>抖音文案提取器 - 部署成功！</h1><p>登录页面加载中...</p>');
        }
        return;
    }
    
    // 静态文件
    let filePath = path.join(__dirname, req.url);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath);
        const contentTypes = {
            '.html': 'text/html; charset=utf-8',
            '.css': 'text/css',
            '.js': 'application/javascript'
        };
        res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'text/plain' });
        res.end(fs.readFileSync(filePath));
        return;
    }
    
    res.writeHead(404);
    res.end('Not Found');
});

server.listen(PORT, () => {
    console.log(`✅ 简化版服务器启动成功！端口: ${PORT}`);
});
