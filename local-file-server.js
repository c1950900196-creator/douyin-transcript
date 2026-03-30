/**
 * 本地文件托管服务
 * 使用 localtunnel 内网穿透，为豆包API提供音频文件访问
 * 文件自动在1小时后删除
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');

// 配置
const FILE_SERVER_PORT = 3457;  // 文件服务端口
const FILE_EXPIRE_TIME = 60 * 60 * 1000;  // 1小时后删除
const AUDIO_DIR = path.join(__dirname, 'temp', 'audio-hosting');

// 全局状态
let tunnelUrl = null;
let tunnelProcess = null;
let fileServer = null;
let cleanupTimer = null;

// 确保目录存在
function ensureDir() {
    if (!fs.existsSync(AUDIO_DIR)) {
        fs.mkdirSync(AUDIO_DIR, { recursive: true });
    }
}

// 启动文件服务器
function startFileServer() {
    return new Promise((resolve, reject) => {
        ensureDir();
        
        fileServer = http.createServer((req, res) => {
            const fileName = path.basename(req.url);
            const filePath = path.join(AUDIO_DIR, fileName);
            
            // 安全检查
            if (!filePath.startsWith(AUDIO_DIR)) {
                res.writeHead(403);
                res.end('Forbidden');
                return;
            }
            
            if (!fs.existsSync(filePath)) {
                res.writeHead(404);
                res.end('Not Found');
                return;
            }
            
            const stat = fs.statSync(filePath);
            res.writeHead(200, {
                'Content-Type': 'audio/mpeg',
                'Content-Length': stat.size,
                'Cache-Control': 'no-cache'
            });
            
            fs.createReadStream(filePath).pipe(res);
        });
        
        fileServer.listen(FILE_SERVER_PORT, () => {
            console.log(`📁 本地文件服务启动: http://localhost:${FILE_SERVER_PORT}`);
            resolve();
        });
        
        fileServer.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                console.log(`⚠️ 端口 ${FILE_SERVER_PORT} 已被占用，尝试复用...`);
                resolve();
            } else {
                reject(err);
            }
        });
    });
}

// 启动 localtunnel 隧道
function startTunnel() {
    return new Promise((resolve, reject) => {
        console.log('🌐 启动 localtunnel 隧道...');
        
        // 生成唯一子域名
        const subdomain = `doubao-audio-${Date.now().toString(36)}`;
        
        tunnelProcess = spawn('lt', ['--port', FILE_SERVER_PORT.toString(), '--subdomain', subdomain], {
            stdio: ['ignore', 'pipe', 'pipe']
        });
        
        let output = '';
        let resolved = false;
        
        tunnelProcess.stdout.on('data', (data) => {
            output += data.toString();
            console.log('   lt stdout:', data.toString().trim());
            
            // 查找 URL
            const match = output.match(/your url is: (https:\/\/[^\s]+)/i);
            if (match && !resolved) {
                tunnelUrl = match[1];
                console.log(`✅ localtunnel 隧道启动成功: ${tunnelUrl}`);
                resolved = true;
                resolve(tunnelUrl);
            }
        });
        
        tunnelProcess.stderr.on('data', (data) => {
            console.log('   lt stderr:', data.toString().trim());
        });
        
        tunnelProcess.on('error', (err) => {
            if (!resolved) {
                reject(new Error(`localtunnel 启动失败: ${err.message}`));
            }
        });
        
        tunnelProcess.on('close', (code) => {
            if (!resolved) {
                reject(new Error(`localtunnel 进程退出，代码: ${code}`));
            }
        });
        
        // 超时
        setTimeout(() => {
            if (!resolved) {
                resolved = true;
                reject(new Error('localtunnel 启动超时'));
            }
        }, 30000);
    });
}

// 存储文件并返回公网 URL
async function hostFile(localFilePath) {
    ensureDir();
    
    // 确保隧道已启动
    if (!tunnelUrl) {
        await init();
    }
    
    if (!tunnelUrl) {
        throw new Error('隧道未启动，无法提供公网访问');
    }
    
    // 生成唯一文件名
    const ext = path.extname(localFilePath);
    const fileName = `audio_${Date.now()}_${Math.random().toString(36).substring(7)}${ext}`;
    const destPath = path.join(AUDIO_DIR, fileName);
    
    // 复制文件
    fs.copyFileSync(localFilePath, destPath);
    console.log(`📁 文件已托管: ${fileName}`);
    
    // 设置自动清理
    setTimeout(() => {
        if (fs.existsSync(destPath)) {
            fs.unlinkSync(destPath);
            console.log(`🗑️ 已清理过期文件: ${fileName}`);
        }
    }, FILE_EXPIRE_TIME);
    
    // 返回公网 URL
    const publicUrl = `${tunnelUrl}/${fileName}`;
    console.log(`🌐 公网URL: ${publicUrl}`);
    
    return publicUrl;
}

// 初始化服务
async function init() {
    try {
        await startFileServer();
        await startTunnel();
        
        // 定期清理过期文件
        cleanupTimer = setInterval(() => {
            cleanupExpiredFiles();
        }, 10 * 60 * 1000);  // 每10分钟检查
        
        return tunnelUrl;
    } catch (err) {
        console.error('❌ 本地文件服务初始化失败:', err.message);
        throw err;
    }
}

// 清理过期文件
function cleanupExpiredFiles() {
    ensureDir();
    const now = Date.now();
    const files = fs.readdirSync(AUDIO_DIR);
    
    for (const file of files) {
        const filePath = path.join(AUDIO_DIR, file);
        const stat = fs.statSync(filePath);
        const age = now - stat.mtimeMs;
        
        if (age > FILE_EXPIRE_TIME) {
            fs.unlinkSync(filePath);
            console.log(`🗑️ 已清理过期文件: ${file}`);
        }
    }
}

// 停止服务
function stop() {
    if (tunnelProcess) {
        tunnelProcess.kill();
        tunnelProcess = null;
    }
    if (fileServer) {
        fileServer.close();
        fileServer = null;
    }
    if (cleanupTimer) {
        clearInterval(cleanupTimer);
        cleanupTimer = null;
    }
    tunnelUrl = null;
    console.log('📁 本地文件服务已停止');
}

// 获取当前状态
function getStatus() {
    return {
        running: !!tunnelUrl,
        tunnelUrl: tunnelUrl,
        fileServerPort: FILE_SERVER_PORT
    };
}

module.exports = {
    init,
    hostFile,
    stop,
    getStatus
};
