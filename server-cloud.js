/**
 * 抖音文案提取器 - 云端版（含作者监控）
 * 功能：用户认证、球赛预测、数据管理、作者监控、抖音登录（通过 noVNC 远程桌面）
 */

// ==================== 终端日志捕获 ====================
const terminalLogs = [];
const MAX_TERMINAL_LOGS = 200;
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

function addTerminalLog(type, ...args) {
    const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
    terminalLogs.push({ time: new Date().toISOString(), type, message });
    while (terminalLogs.length > MAX_TERMINAL_LOGS) terminalLogs.shift();
}
console.log = (...args) => { addTerminalLog('log', ...args); originalLog.apply(console, args); };
console.error = (...args) => { addTerminalLog('error', ...args); originalError.apply(console, args); };
console.warn = (...args) => { addTerminalLog('warn', ...args); originalWarn.apply(console, args); };

function getTerminalLogs(since = null) {
    if (since) return terminalLogs.filter(log => new Date(log.time) > new Date(since));
    return terminalLogs.slice(-50);
}

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

// 作者监控模块（含 Puppeteer）
console.log('📥 加载 author-monitor.js...');
let authorMonitor = null;
try {
    authorMonitor = require('./author-monitor');
    console.log('✅ author-monitor.js 加载成功');
} catch (e) {
    console.warn('⚠️  author-monitor.js 加载失败:', e.message);
    console.warn('   作者监控功能不可用，请运行 npm install 安装依赖');
}

// 转写相关依赖
const { spawn } = require('child_process');
const runtimePaths = require('./runtime-paths');
let doubaoASR = null;
try {
    doubaoASR = require('./doubao-asr');
    console.log('✅ doubao-asr.js 加载成功');
} catch (e) {
    console.warn('⚠️  doubao-asr.js 加载失败:', e.message);
}

const TEMP_DIR = runtimePaths.getTempDir();

// noVNC 端口（start.sh 中通过环境变量传入）
const NOVNC_PORT = process.env.NOVNC_PORT || 6080;

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
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json; charset=utf-8'
};

// ==================== 转写辅助函数 ====================

function makeHttpRequest(requestUrl, options = {}, retryCount = 0) {
    const MAX_RETRIES = 3;
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(requestUrl);
        const protocol = parsedUrl.protocol === 'https:' ? https : http;
        const requestOptions = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port,
            path: parsedUrl.pathname + parsedUrl.search,
            method: options.method || 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
                'Accept': '*/*',
                'Referer': 'https://www.douyin.com/',
                ...options.headers
            },
            timeout: 60000,
            rejectUnauthorized: false
        };
        const req = protocol.request(requestOptions, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                resolve({ redirect: res.headers.location, statusCode: res.statusCode });
                return;
            }
            if (options.binary) {
                const chunks = [];
                res.on('data', chunk => chunks.push(chunk));
                res.on('end', () => resolve({ data: Buffer.concat(chunks), statusCode: res.statusCode, headers: res.headers }));
            } else {
                let data = '';
                res.setEncoding('utf8');
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve({ data, statusCode: res.statusCode, headers: res.headers }));
            }
        });
        req.on('error', (err) => {
            if (retryCount < MAX_RETRIES && (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT')) {
                setTimeout(() => makeHttpRequest(requestUrl, options, retryCount + 1).then(resolve).catch(reject), 1000 * (retryCount + 1));
            } else { reject(err); }
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
        if (options.body) req.write(options.body);
        req.end();
    });
}

async function downloadAudioFile(fileUrl, savePath) {
    let cleanUrl = fileUrl.replace(/\\u002F/g, '/').replace(/\\\//g, '/');
    const result = await makeHttpRequest(cleanUrl, { binary: true });
    if (result.redirect) return downloadAudioFile(result.redirect, savePath);
    if (!Buffer.isBuffer(result.data) || result.data.length < 10000) {
        throw new Error(`下载文件无效(${result.data?.length || 0}字节)`);
    }
    const head = result.data.slice(0, 200).toString('utf8');
    if (head.includes('<!DOCTYPE') || head.includes('<html')) {
        throw new Error('下载到HTML页面而非音频');
    }
    fs.writeFileSync(savePath, result.data);
    console.log(`  文件已下载: ${(result.data.length / 1024 / 1024).toFixed(2)} MB`);
    return savePath;
}

function convertToMp3(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        const ffmpegPath = runtimePaths.getFFmpegPath();
        const ffmpeg = spawn(ffmpegPath, ['-y', '-i', inputPath, '-vn', '-acodec', 'libmp3lame', '-ar', '16000', '-ac', '1', '-ab', '128k', '-f', 'mp3', outputPath]);
        let stderr = '';
        ffmpeg.stderr.on('data', (data) => { stderr += data.toString(); });
        ffmpeg.on('close', (code) => {
            if (code === 0) { resolve(outputPath); return; }
            const lastLines = stderr.split('\n').slice(-5).join(' ');
            if (lastLines.includes('does not contain any stream') || lastLines.includes('no audio')) {
                reject(new Error('源文件没有音频轨'));
            } else {
                reject(new Error('MP3转换失败(code=' + code + '): ' + lastLines.substring(0, 300)));
            }
        });
        ffmpeg.on('error', (err) => { reject(new Error('无法启动ffmpeg: ' + err.message)); });
    });
}

function cleanupTempFiles(files) {
    for (const file of files) {
        try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch (e) {}
    }
}

async function getVideoDownloadUrl(videoId) {
    const pageUrl = `https://www.douyin.com/video/${videoId}`;
    
    async function tryBrowserExtract(attempt = 1) {
        if (!authorMonitor) return null;
        
        const browser = await authorMonitor.getBrowser(true);
        const page = await browser.newPage();
        
        let capturedAudioUrl = null;
        let capturedVideoUrl = null;
        
        page.on('response', (response) => {
            const url = response.url();
            const isCDN = url.includes('douyinvod.com') || (url.includes('bytedance') && url.includes('/video/'));
            if (isCDN) {
                if (url.includes('media-audio') || (url.includes('audio') && !url.includes('video'))) {
                    capturedAudioUrl = url;
                } else {
                    capturedVideoUrl = url;
                }
            }
        });
        
        const gotoOk = await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 30000 })
            .then(() => true).catch(() => false);
        
        await new Promise(r => setTimeout(r, gotoOk ? 5000 : 8000));
        
        const pageInfo = await page.evaluate(() => {
            const script = document.querySelector('script#RENDER_DATA');
            const title = document.title || '';
            const hasRenderData = !!script;
            let videoUrl = null;
            let isVideoPage = false;
            
            if (script) {
                try {
                    const decoded = decodeURIComponent(script.textContent);
                    const data = JSON.parse(decoded);
                    const findVD = (obj, d = 0) => {
                        if (!obj || typeof obj !== 'object' || d > 20) return null;
                        if (obj.aweme_detail) return obj.aweme_detail;
                        if (obj.awemeDetail) return obj.awemeDetail;
                        if (obj.desc && obj.video && obj.aweme_id) return obj;
                        for (const k of Object.keys(obj)) { const f = findVD(obj[k], d+1); if (f) return f; }
                        return null;
                    };
                    const vd = findVD(data);
                    if (vd) {
                        isVideoPage = true;
                        const pa = vd.video?.play_addr || vd.video?.playAddr;
                        if (pa?.url_list?.length > 0) videoUrl = pa.url_list[0];
                        if (!videoUrl && vd.video?.bit_rate) {
                            for (const br of vd.video.bit_rate) {
                                if (br.play_addr?.url_list?.length > 0) { videoUrl = br.play_addr.url_list[0]; break; }
                            }
                        }
                    }
                } catch (e) {}
            }
            return { videoUrl, title, hasRenderData, isVideoPage };
        }).catch(() => ({ videoUrl: null, title: '(evaluate失败)', hasRenderData: false, isVideoPage: false }));
        
        await page.close();
        
        const audioUrl = capturedAudioUrl;
        const videoUrl = pageInfo.videoUrl || capturedVideoUrl;
        
        if (audioUrl || videoUrl) {
            console.log(`  链接获取(浏览器第${attempt}次): audio=${audioUrl ? 'CDN' : '无'}, video=${videoUrl ? 'OK' : '无'}`);
            return { audioUrl, videoUrl: audioUrl || videoUrl };
        }
        
        console.log(`  浏览器第${attempt}次未获取到链接 | goto=${gotoOk ? 'OK' : '超时'} | title="${pageInfo.title.substring(0, 40)}" | RENDER_DATA=${pageInfo.hasRenderData} | 视频数据=${pageInfo.isVideoPage} | CDN=${capturedVideoUrl ? 'YES' : 'NO'}`);
        return null;
    }
    
    // 第1次尝试
    try {
        const result = await tryBrowserExtract(1);
        if (result) return result;
    } catch (e) {
        console.log('  浏览器第1次失败:', e.message);
    }
    
    // 等待后重试
    console.log('  等待5秒后重试...');
    await new Promise(r => setTimeout(r, 5000));
    
    try {
        const result = await tryBrowserExtract(2);
        if (result) return result;
    } catch (e) {
        console.log('  浏览器第2次失败:', e.message);
    }
    
    return { audioUrl: null, videoUrl: null };
}

async function handleTranscribeCloud(videoUrl, videoInfo) {
    if (!doubaoASR) return { success: false, error: '豆包ASR模块不可用' };
    
    const tempFiles = [];
    try {
        console.log(`🎬 云端转写: ${videoInfo?.title || videoUrl}`);
        
        const videoIdMatch = videoUrl.match(/video\/(\d+)/);
        if (!videoIdMatch) return { success: false, error: '无效的视频URL' };
        const videoId = videoIdMatch[1];
        
        // 获取视频/音频下载链接
        console.log('  步骤1: 获取下载链接...');
        const downloadUrls = await getVideoDownloadUrl(videoId);
        const audioSourceUrl = downloadUrls.audioUrl || downloadUrls.videoUrl;
        
        if (!audioSourceUrl) return { success: false, error: '无法获取视频下载链接' };
        
        // 下载音频
        console.log('  步骤2: 下载音频...');
        const tempAudioPath = path.join(TEMP_DIR, `audio_temp_${Date.now()}.mp4`);
        tempFiles.push(tempAudioPath);
        await downloadAudioFile(audioSourceUrl, tempAudioPath);
        
        // 转换为 MP3
        console.log('  步骤3: 转换为MP3...');
        const mp3Path = path.join(TEMP_DIR, `audio_${Date.now()}.mp3`);
        tempFiles.push(mp3Path);
        await convertToMp3(tempAudioPath, mp3Path);
        
        const mp3Size = fs.statSync(mp3Path).size;
        if (mp3Size < 5000) return { success: false, error: 'MP3文件太小，视频可能没有音轨' };
        
        // 豆包 ASR 转写
        console.log('  步骤4: 豆包ASR转写...');
        const asrResult = await doubaoASR.transcribeFromFile(mp3Path, 'mp3');
        if (!asrResult.success) throw new Error(asrResult.error);
        
        console.log(`  ✅ 转写成功: ${asrResult.text.length} 字`);
        
        let videoPublishTime = null;
        if (videoInfo?.createTime) {
            const ct = typeof videoInfo.createTime === 'number' && videoInfo.createTime < 1e12
                ? new Date(videoInfo.createTime * 1000)
                : new Date(videoInfo.createTime);
            if (!isNaN(ct.getTime())) videoPublishTime = ct.toISOString();
        }
        if (!videoPublishTime) {
            try {
                const ts = Number(BigInt(videoId) >> 32n);
                const d = new Date(ts * 1000);
                if (d.getFullYear() >= 2020 && d.getFullYear() <= 2030) videoPublishTime = d.toISOString();
            } catch(e) {}
        }
        
        const resultData = {
            title: videoInfo?.title || '',
            author: videoInfo?.authorNickname || videoInfo?.author || '',
            authorId: videoInfo?.authorId || '',
            authorAvatar: videoInfo?.authorAvatar || '',
            authorSecUid: videoInfo?.authorSecUid || videoInfo?.authorUid || '',
            transcript: asrResult.text,
            videoId: videoId,
            coverUrl: videoInfo?.coverUrl || '',
            modelUsed: '豆包ASR',
            url: videoUrl,
            videoPublishTime: videoPublishTime
        };
        
        return { success: true, data: resultData };
    } catch (error) {
        console.error('  ❌ 转写失败:', error.message);
        return { success: false, error: error.message };
    } finally {
        cleanupTempFiles(tempFiles);
    }
}

// 监控转写回调
const monitorTranscribeCallback = async (videoUrl, videoInfo) => {
    const result = await handleTranscribeCloud(videoUrl, videoInfo);
    if (result.success && result.data && authorMonitor) {
        const videoId = result.data.videoId;
        authorMonitor.saveTranscript({
            id: videoId,
            videoId: videoId,
            title: result.data.title || '',
            author: result.data.author || '',
            authorId: result.data.authorId || '',
            authorAvatar: result.data.authorAvatar || '',
            authorSecUid: result.data.authorSecUid || '',
            authorSignature: '',
            authorFollowers: 0,
            transcript: result.data.transcript,
            hashtags: [],
            coverUrl: result.data.coverUrl || '',
            url: result.data.url || videoUrl,
            createdAt: new Date().toISOString(),
            modelUsed: result.data.modelUsed || 'doubao-asr',
            videoPublishTime: result.data.videoPublishTime || null
        });
        console.log(`  📝 已保存到文案库: ${result.data.author} - ${videoId}`);
    }
    return result;
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
                puppeteer: !!authorMonitor,
                authorMonitor: !!authorMonitor,
                novnc: true,
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
                if (pathname === '/api/predictions' && req.method === 'GET') {
                    // 预测记录列表（含作者预测丰富化数据）
                    const predictions = matchPredictor.getPredictions();
                    const transcripts = authorMonitor ? authorMonitor.getTranscripts() : [];
                    const matches = matchPredictor.getMatches();
                    const authors = authorMonitor ? authorMonitor.getAuthors() : [];
                    
                    const authorAvatarMap = {};
                    for (const author of authors) {
                        const avatar = author.localAvatar || author.avatar || '';
                        if (author.nickname) authorAvatarMap[author.nickname] = avatar;
                        if (author.secUid) authorAvatarMap[author.secUid] = avatar;
                    }
                    
                    const enrichedPredictions = predictions.map(pred => {
                        let matchTime = pred.match?.matchTime || '';
                        if (!matchTime) {
                            const match = matches.find(m =>
                                (m.homeTeam === pred.match?.homeTeam && m.awayTeam === pred.match?.awayTeam) ||
                                (m.homeTeam === pred.match?.awayTeam && m.awayTeam === pred.match?.homeTeam)
                            );
                            if (match) matchTime = match.matchTime;
                        }
                        
                        const enrichedAuthorPredictions = (pred.authorPredictions || []).map(ap => {
                            let transcriptContent = '';
                            let videoPublishTime = null;
                            if (ap.videoId) {
                                const transcript = transcripts.find(t => t.videoId === ap.videoId || t.id === ap.videoId);
                                if (transcript) {
                                    transcriptContent = transcript.transcript || transcript.content || '';
                                    videoPublishTime = transcript.videoPublishTime || transcript.createdAt || null;
                                }
                            }
                            let avatar = ap.authorAvatar || '';
                            if (ap.author && authorAvatarMap[ap.author]) avatar = authorAvatarMap[ap.author];
                            else if (ap.authorSecUid && authorAvatarMap[ap.authorSecUid]) avatar = authorAvatarMap[ap.authorSecUid];
                            return { ...ap, authorAvatar: avatar, transcriptContent, videoPublishTime };
                        });
                        
                        return { ...pred, match: { ...pred.match, matchTime }, authorPredictions: enrichedAuthorPredictions };
                    });
                    
                    res.writeHead(200, corsHeaders);
                    res.end(JSON.stringify({ success: true, data: enrichedPredictions }));
                    return;
                } else if (pathname.startsWith('/api/predictions/') && pathname.endsWith('/user') && req.method === 'POST') {
                    // 更新用户预测
                    const predictionId = pathname.split('/')[3];
                    result = matchPredictor.updateUserPrediction(predictionId, data.prediction);
                } else if (pathname === '/api/predictions' && req.method === 'POST') {
                    const { matchId, analysis, userPrediction } = data;
                    result = matchPredictor.savePredictionRecord(matchId, analysis, userPrediction);
                } else if (pathname === '/api/predictions/predict' && req.method === 'POST') {
                    result = await matchPredictor.predictMatch(data);
                } else if (pathname === '/api/predictions/list' && req.method === 'GET') {
                    result = await matchPredictor.getPredictions(query.username);
                } else if (pathname === '/api/predictions/stats' && req.method === 'GET') {
                    result = await matchPredictor.getStats(query.username);
                } else if (pathname === '/api/predictions/filter' && req.method === 'POST') {
                    const transcripts = authorMonitor ? authorMonitor.getTranscripts() : [];
                    result = await matchPredictor.filterTranscriptsForMatch(data.matchId, transcripts);
                } else if (pathname === '/api/predictions/analyze' && req.method === 'POST') {
                    const allTranscripts = authorMonitor ? authorMonitor.getTranscripts() : [];
                    const transcripts = data.transcriptIds
                        ? allTranscripts.filter(t => data.transcriptIds.includes(t.videoId || t.id))
                        : allTranscripts;
                    result = await matchPredictor.analyzePredictions(data.matchId, transcripts);
                } else if (pathname === '/api/predictions/doubao' && req.method === 'POST') {
                    result = await matchPredictor.getDoubaoPrediction(data.matchId);
                } else if (pathname === '/api/matches' && req.method === 'GET') {
                    const matches = matchPredictor.getMatches();
                    res.writeHead(200, corsHeaders);
                    res.end(JSON.stringify({ success: true, data: matches }));
                    return;
                } else if (pathname === '/api/matches' && req.method === 'POST') {
                    result = matchPredictor.addMatch(data);
                } else if (pathname === '/api/matches/search' && req.method === 'POST') {
                    result = await matchPredictor.searchUpcomingMatches();
                } else if (pathname === '/api/matches/author-predictions' && req.method === 'POST') {
                    const predictions = matchPredictor.getPredictions();
                    const transcripts = authorMonitor ? authorMonitor.getTranscripts() : [];
                    let matchedPrediction = null;
                    for (const pred of predictions) {
                        const predHome = pred.match?.homeTeam || '';
                        const predAway = pred.match?.awayTeam || '';
                        if ((predHome === data.homeTeam && predAway === data.awayTeam) ||
                            (predHome === data.awayTeam && predAway === data.homeTeam) ||
                            (predHome.includes(data.homeTeam) && predAway.includes(data.awayTeam)) ||
                            (predHome.includes(data.awayTeam) && predAway.includes(data.homeTeam)) ||
                            (data.homeTeam.includes(predHome) && data.awayTeam.includes(predAway)) ||
                            (data.homeTeam.includes(predAway) && data.awayTeam.includes(predHome))) {
                            if (pred.authorPredictions && pred.authorPredictions.length > 0) {
                                matchedPrediction = pred;
                                break;
                            }
                        }
                    }
                    if (matchedPrediction && matchedPrediction.authorPredictions) {
                        const enriched = matchedPrediction.authorPredictions.map(ap => {
                            let transcriptContent = '';
                            if (ap.videoId) {
                                const t = transcripts.find(t => t.videoId === ap.videoId || t.id === ap.videoId);
                                if (t) transcriptContent = t.transcript || t.content || '';
                            }
                            return { ...ap, transcriptContent };
                        });
                        res.writeHead(200, corsHeaders);
                        res.end(JSON.stringify({ success: true, data: enriched }));
                    } else {
                        res.writeHead(200, corsHeaders);
                        res.end(JSON.stringify({ success: true, data: [] }));
                    }
                    return;
                } else if (pathname === '/api/matches/user-prediction' && req.method === 'POST') {
                    result = matchPredictor.saveUserMatchPrediction(data.matchId, data.prediction);
                } else if (pathname.startsWith('/api/matches/') && pathname.endsWith('/result') && req.method === 'POST') {
                    const matchId = decodeURIComponent(pathname.split('/')[3]);
                    result = matchPredictor.updateMatchResult(matchId, data.result);
                } else if (pathname === '/api/matches/add' && req.method === 'POST') {
                    result = await matchPredictor.addMatch(data);
                } else if (pathname === '/api/matches/result' && req.method === 'POST') {
                    result = await matchPredictor.updateMatchResult(data);
                } else if (pathname.match(/^\/api\/predictions\/[^/]+\/update-match$/) && req.method === 'POST') {
                    const predId = decodeURIComponent(pathname.split('/')[3]);
                    result = matchPredictor.updatePredictionMatch({
                        predictionId: predId,
                        authorIndex: data.authorIndex,
                        newMatchId: data.newMatchId,
                        newPrediction: data.newPrediction
                    });
                    if (!result.success) {
                        const status = result.error?.includes('不存在') ? 404 : 400;
                        res.writeHead(status, corsHeaders);
                        res.end(JSON.stringify(result));
                        return;
                    }
                    res.writeHead(200, corsHeaders);
                    res.end(JSON.stringify(result));
                    return;
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
    
    // ==================== 准确率统计 API ====================
    
    if (pathname === '/api/accuracy' && req.method === 'GET') {
        const predictions = matchPredictor.getPredictions();
        const matches = matchPredictor.getMatches();
        const accuracyData = matchPredictor.getAccuracy();
        
        function findMatchByTeams(homeTeam, awayTeam) {
            if (!homeTeam || !awayTeam) return null;
            let match = matches.find(m => m.homeTeam === homeTeam && m.awayTeam === awayTeam);
            if (match) return match;
            match = matches.find(m => m.homeTeam === awayTeam && m.awayTeam === homeTeam);
            if (match) return match;
            const normalize = (s) => s.replace(/[·\s]/g, '').toLowerCase();
            const h = normalize(homeTeam), a = normalize(awayTeam);
            return matches.find(m => {
                const mh = normalize(m.homeTeam || ''), ma = normalize(m.awayTeam || '');
                const hMatch = h.includes(mh.slice(0,3)) || mh.includes(h.slice(0,3));
                const aMatch = a.includes(ma.slice(0,3)) || ma.includes(a.slice(0,3));
                const hMatchRev = h.includes(ma.slice(0,3)) || ma.includes(h.slice(0,3));
                const aMatchRev = a.includes(mh.slice(0,3)) || mh.includes(a.slice(0,3));
                return (hMatch && aMatch) || (hMatchRev && aMatchRev);
            });
        }
        
        const authorStats = {};
        let doubaoStats = { wins: 0, total: 0 };
        let userStats = { wins: 0, total: 0 };
        
        for (const pred of predictions) {
            let match = matches.find(m => m.matchId === pred.matchId);
            if (!match) {
                match = findMatchByTeams(pred.match?.homeTeam, pred.match?.awayTeam);
            }
            const matchResult = match?.result || pred.result;
            if (!matchResult) continue;
            
            let winner;
            const hasScore = matchResult.homeScore !== null && matchResult.homeScore !== undefined &&
                             matchResult.awayScore !== null && matchResult.awayScore !== undefined;
            if (hasScore) {
                if (matchResult.homeScore > matchResult.awayScore) winner = 'home';
                else if (matchResult.homeScore < matchResult.awayScore) winner = 'away';
                else winner = 'draw';
            } else if (matchResult.winner) {
                winner = matchResult.winner;
            } else {
                continue;
            }
            
            if (pred.authorPredictions) {
                for (const ap of pred.authorPredictions) {
                    if (ap.prediction === 'unclear') continue;
                    const authorId = ap.authorId || ap.author;
                    if (!authorStats[authorId]) {
                        const existingData = accuracyData.authors?.[authorId] || {};
                        authorStats[authorId] = {
                            name: ap.author || existingData.name || authorId,
                            avatar: ap.authorAvatar || existingData.avatar || '',
                            wins: 0, total: 0,
                            disabled: existingData.disabled || false
                        };
                    }
                    if (ap.author) authorStats[authorId].name = ap.author;
                    if (ap.authorAvatar) authorStats[authorId].avatar = ap.authorAvatar;
                    authorStats[authorId].total++;
                    if (ap.prediction === winner) authorStats[authorId].wins++;
                }
            }
            
            if (pred.doubaoPrediction && pred.doubaoPrediction.prediction && pred.doubaoPrediction.prediction !== 'unclear') {
                doubaoStats.total++;
                if (pred.doubaoPrediction.prediction === winner) doubaoStats.wins++;
            }
            if (pred.userPrediction && pred.userPrediction !== 'unclear') {
                userStats.total++;
                if (pred.userPrediction === winner) userStats.wins++;
            }
        }
        
        for (const [id, data] of Object.entries(accuracyData.authors || {})) {
            if (!authorStats[id]) continue;
            if (data.disabled !== undefined) authorStats[id].disabled = data.disabled;
        }
        
        const transcripts = authorMonitor ? authorMonitor.getTranscripts() : [];
        const authorList = authorMonitor ? authorMonitor.getAuthors() : [];
        const uniqueNameToId = {};
        for (const a of authorList) {
            const stableId = a.uid || a.secUid || '';
            if (!stableId || !a.nickname) continue;
            if (uniqueNameToId[a.nickname] && uniqueNameToId[a.nickname] !== stableId) {
                uniqueNameToId[a.nickname] = null;
            } else if (!(a.nickname in uniqueNameToId)) {
                uniqueNameToId[a.nickname] = stableId;
            }
        }

        for (const [authorId, stat] of Object.entries(authorStats)) {
            let latestById = null;
            let latestByNameFallback = null;
            for (const t of transcripts) {
                const pubTime = t.videoPublishTime || t.createdAt;
                if (!pubTime) continue;
                const tStableId = t.authorId || t.authorSecUid || '';
                if (tStableId && tStableId === authorId) {
                    if (!latestById || pubTime > latestById) latestById = pubTime;
                    continue;
                }

                // 兜底：只有作者名能唯一映射到同一稳定 ID 时才按名称回填，避免重名串数据。
                const mappedId = t.author ? uniqueNameToId[t.author] : null;
                if (!latestById && mappedId && mappedId === authorId) {
                    if (!latestByNameFallback || pubTime > latestByNameFallback) latestByNameFallback = pubTime;
                    continue;
                }

                if (!latestById && !mappedId && t.author && (t.author === authorId || t.author === stat.name)) {
                    if (!latestByNameFallback || pubTime > latestByNameFallback) latestByNameFallback = pubTime;
                }
            }
            stat.latestVideoTime = latestById || latestByNameFallback || null;
        }
        
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify({ success: true, data: { authors: authorStats, doubao: doubaoStats, user: userStats } }));
        return;
    }
    
    if (pathname.startsWith('/api/author-stats/') && req.method === 'GET') {
        const authorId = decodeURIComponent(pathname.split('/')[3]);
        try {
            const predictions = matchPredictor.getPredictions();
            const matches = matchPredictor.getMatches();
            const transcripts = authorMonitor ? authorMonitor.getTranscripts() : [];
            
            function findMatchByTeams(homeTeam, awayTeam) {
                if (!homeTeam || !awayTeam) return null;
                let match = matches.find(m => m.homeTeam === homeTeam && m.awayTeam === awayTeam);
                if (match) return match;
                match = matches.find(m => m.homeTeam === awayTeam && m.awayTeam === homeTeam);
                if (match) return match;
                const normalize = (s) => s.replace(/[·\s]/g, '').toLowerCase();
                const h = normalize(homeTeam), a = normalize(awayTeam);
                return matches.find(m => {
                    const mh = normalize(m.homeTeam || ''), ma = normalize(m.awayTeam || '');
                    const hMatch = h.includes(mh.slice(0,3)) || mh.includes(h.slice(0,3));
                    const aMatch = a.includes(ma.slice(0,3)) || ma.includes(a.slice(0,3));
                    const hMatchRev = h.includes(ma.slice(0,3)) || ma.includes(h.slice(0,3));
                    const aMatchRev = a.includes(mh.slice(0,3)) || mh.includes(a.slice(0,3));
                    return (hMatch && aMatch) || (hMatchRev && aMatchRev);
                });
            }
            
            const authorHistory = [];
            let wins = 0, total = 0;
            
            for (const pred of predictions) {
                if (!pred.authorPredictions) continue;
                for (let apIdx = 0; apIdx < pred.authorPredictions.length; apIdx++) {
                    const ap = pred.authorPredictions[apIdx];
                    if (ap.authorId === authorId || ap.author === authorId) {
                        if (ap.prediction === 'unclear') continue;
                        let match = matches.find(m => m.matchId === pred.matchId);
                        if (!match) match = findMatchByTeams(pred.match?.homeTeam, pred.match?.awayTeam);
                        const matchResult = match?.result || pred.result;
                        
                        let winner = null;
                        if (matchResult) {
                            if (matchResult.homeScore !== undefined && matchResult.awayScore !== undefined &&
                                matchResult.homeScore !== null && matchResult.awayScore !== null) {
                                if (matchResult.homeScore > matchResult.awayScore) winner = 'home';
                                else if (matchResult.homeScore < matchResult.awayScore) winner = 'away';
                                else winner = 'draw';
                            } else if (matchResult.winner) {
                                winner = matchResult.winner;
                            }
                        }
                        
                        let transcriptContent = '';
                        let videoPublishTime = null;
                        if (ap.videoId) {
                            const t = transcripts.find(t => t.videoId === ap.videoId || t.id === ap.videoId);
                            if (t) {
                                transcriptContent = t.transcript || t.content || '';
                                videoPublishTime = t.videoPublishTime || t.createdAt || null;
                            }
                        }
                        
                        const matchTime = match?.matchTime || pred.match?.matchTime || '';
                        authorHistory.push({
                            match: `${pred.match?.homeTeam || '主队'} vs ${pred.match?.awayTeam || '客队'}`,
                            homeTeam: pred.match?.homeTeam, awayTeam: pred.match?.awayTeam,
                            league: pred.match?.league, matchTime, date: matchTime,
                            prediction: ap.prediction, reason: ap.reason, result: winner,
                            homeScore: matchResult?.homeScore, awayScore: matchResult?.awayScore,
                            videoUrl: ap.videoUrl, transcript: transcriptContent,
                            videoPublishTime: videoPublishTime,
                            predictionId: pred.id,
                            authorIndex: apIdx
                        });
                        
                        if (winner) {
                            total++;
                            if (ap.prediction === winner) wins++;
                        }
                    }
                }
            }
            
            authorHistory.sort((a, b) => {
                const ta = a.matchTime || a.date || '';
                const tb = b.matchTime || b.date || '';
                if (!ta && !tb) return 0;
                if (!ta) return 1;
                if (!tb) return -1;
                return tb.localeCompare(ta);
            });
            
            res.writeHead(200, corsHeaders);
            res.end(JSON.stringify({ success: true, data: { authorId, total, wins, history: authorHistory } }));
        } catch (e) {
            res.writeHead(500, corsHeaders);
            res.end(JSON.stringify({ success: false, error: e.message }));
        }
        return;
    }
    
    if (pathname.startsWith('/api/accuracy/author/') && req.method === 'POST') {
        const authorId = decodeURIComponent(pathname.split('/')[4]);
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { disabled } = JSON.parse(body);
                const result = matchPredictor.toggleAuthorDisabled(authorId, disabled);
                res.writeHead(200, corsHeaders);
                res.end(JSON.stringify(result));
            } catch (e) {
                res.writeHead(400, corsHeaders);
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
        });
        return;
    }
    
    // ==================== 作者监控 API ====================
    
    if (authorMonitor) {
        // 获取所有作者
        if (pathname === '/api/authors' && req.method === 'GET') {
            const authors = authorMonitor.getAuthors();
            res.writeHead(200, corsHeaders);
            res.end(JSON.stringify({ success: true, data: authors }));
            return;
        }
        
        // 添加作者
        if (pathname === '/api/authors' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', async () => {
                try {
                    const { url: authorUrl } = JSON.parse(body);
                    if (!authorUrl) {
                        res.writeHead(400, corsHeaders);
                        res.end(JSON.stringify({ success: false, error: '请提供作者主页链接' }));
                        return;
                    }
                    const result = await authorMonitor.addAuthor(authorUrl, null);
                    res.writeHead(200, corsHeaders);
                    res.end(JSON.stringify(result));
                } catch (error) {
                    res.writeHead(500, corsHeaders);
                    res.end(JSON.stringify({ success: false, error: error.message }));
                }
            });
            return;
        }
        
        // 删除作者
        if (pathname.startsWith('/api/authors/') && pathname.endsWith('/videos')) {
            // 获取某个作者的视频（需要在 DELETE 路由之前匹配）
            const parts = pathname.split('/');
            const authorId = parts[parts.length - 2];
            const videos = authorMonitor.getAuthorVideoList(authorId);
            res.writeHead(200, corsHeaders);
            res.end(JSON.stringify({ success: true, data: videos }));
            return;
        }
        
        if (pathname.startsWith('/api/authors/') && req.method === 'DELETE') {
            const authorId = pathname.split('/').pop();
            const result = authorMonitor.removeAuthor(authorId);
            res.writeHead(200, corsHeaders);
            res.end(JSON.stringify(result));
            return;
        }
        
        // 获取所有视频
        if (pathname === '/api/videos' && req.method === 'GET') {
            const videos = authorMonitor.getVideos();
            res.writeHead(200, corsHeaders);
            res.end(JSON.stringify({ success: true, data: videos }));
            return;
        }
        
        // 获取监控状态
        if (pathname === '/api/monitor/status') {
            const status = authorMonitor.getMonitorStatus();
            res.writeHead(200, corsHeaders);
            res.end(JSON.stringify({ success: true, data: status }));
            return;
        }
        
        // 打开浏览器登录抖音（通过 noVNC 远程操作）
        if (pathname === '/api/douyin/login' && req.method === 'POST') {
            const host = req.headers.host || 'localhost';
            const hostname = host.split(':')[0];
            const novncUrl = `http://${hostname}:${NOVNC_PORT}/vnc.html`;
            
            res.writeHead(200, corsHeaders);
            res.end(JSON.stringify({ 
                success: true, 
                message: '正在打开浏览器，请通过远程桌面操作登录...',
                novncUrl: novncUrl
            }));
            
            authorMonitor.openLoginBrowser().then(result => {
                console.log('登录结果:', result);
            });
            return;
        }
        
        // 检查抖音登录状态
        if (pathname === '/api/douyin/status') {
            (async () => {
                try {
                    const result = await authorMonitor.checkLoginStatus();
                    res.writeHead(200, corsHeaders);
                    res.end(JSON.stringify(result));
                } catch (error) {
                    res.writeHead(500, corsHeaders);
                    res.end(JSON.stringify({ success: false, isLoggedIn: false, message: error.message }));
                }
            })();
            return;
        }
        
        // 获取当前任务状态
        if (pathname === '/api/monitor/task') {
            const taskStatus = authorMonitor.getTaskStatus();
            res.writeHead(200, corsHeaders);
            res.end(JSON.stringify({ success: true, data: taskStatus }));
            return;
        }
        
        // 手动触发检查更新
        if (pathname === '/api/monitor/check' && req.method === 'POST') {
            res.writeHead(200, corsHeaders);
            res.end(JSON.stringify({ success: true, message: '开始检查更新...' }));
            authorMonitor.checkAllUpdates(monitorTranscribeCallback, 'manual');
            return;
        }
        
        // 停止当前检查任务
        if (pathname === '/api/monitor/stop' && req.method === 'POST') {
            const result = authorMonitor.stopCurrentTask();
            res.writeHead(200, corsHeaders);
            res.end(JSON.stringify(result));
            return;
        }
        
        // 更新视频标题
        if (pathname === '/api/monitor/update-titles' && req.method === 'POST') {
            res.writeHead(200, corsHeaders);
            res.end(JSON.stringify({ success: true, message: '开始更新标题...' }));
            authorMonitor.updateVideoTitles((current, total) => {
                console.log(`更新标题进度: ${current}/${total}`);
            }).then(result => {
                console.log(`标题更新完成: ${result.updated}/${result.total}`);
            }).catch(err => {
                console.error('更新标题失败:', err);
            });
            return;
        }
        
        // 获取监控日志
        if (pathname === '/api/monitor/logs') {
            const limit = parseInt(query.limit) || 100;
            const logs = authorMonitor.getLogs(limit);
            res.writeHead(200, corsHeaders);
            res.end(JSON.stringify({ success: true, data: logs }));
            return;
        }
        
        // 获取自动检查日志
        if (pathname === '/api/monitor/check-logs') {
            const limit = parseInt(query.limit) || 50;
            const logs = authorMonitor.getCheckLogs(limit);
            res.writeHead(200, corsHeaders);
            res.end(JSON.stringify({ success: true, data: logs }));
            return;
        }
        
        // 获取终端日志
        if (pathname === '/api/terminal/logs') {
            const since = query.since;
            const logs = getTerminalLogs(since);
            res.writeHead(200, corsHeaders);
            res.end(JSON.stringify({ success: true, data: logs }));
            return;
        }
        
        // ==================== 文案管理 API ====================
        
        // 获取所有文案
        if (pathname === '/api/transcripts' && req.method === 'GET') {
            const transcripts = authorMonitor.getTranscripts();
            res.writeHead(200, corsHeaders);
            res.end(JSON.stringify({ success: true, data: transcripts, count: transcripts.length }));
            return;
        }
        
        // 手动匹配文案到比赛
        if (pathname.match(/^\/api\/transcripts\/[^/]+\/manual-match$/) && req.method === 'POST') {
            const transcriptId = decodeURIComponent(pathname.split('/')[3]);
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                try {
                    const { matchId, prediction, authorId, authorName } = JSON.parse(body);
                    const result = matchPredictor.manualMatchTranscriptToPrediction({
                        transcriptId,
                        matchId,
                        prediction,
                        authorId,
                        authorName
                    });
                    if (!result.success) {
                        const status = result.error?.includes('不存在') ? 404 : 400;
                        res.writeHead(status, corsHeaders);
                        res.end(JSON.stringify(result));
                        return;
                    }
                    res.writeHead(200, corsHeaders);
                    res.end(JSON.stringify(result));
                } catch (e) {
                    res.writeHead(500, corsHeaders);
                    res.end(JSON.stringify({ success: false, error: e.message }));
                }
            });
            return;
        }
        
        // 删除单个文案
        if (pathname.startsWith('/api/transcripts/') && req.method === 'DELETE') {
            const id = pathname.split('/').pop();
            const result = authorMonitor.deleteTranscript(id);
            res.writeHead(200, corsHeaders);
            res.end(JSON.stringify(result));
            return;
        }
        
        // 清空所有文案
        if (pathname === '/api/transcripts/clear' && req.method === 'POST') {
            const result = authorMonitor.clearTranscripts();
            res.writeHead(200, corsHeaders);
            res.end(JSON.stringify(result));
            return;
        }
        
        // 导出文案
        if (pathname === '/api/transcripts/export') {
            const format = query.format || 'txt';
            const result = authorMonitor.exportTranscripts(format);
            if (result.success) {
                const contentType = format === 'json' ? 'application/json' : 'text/plain';
                res.writeHead(200, {
                    ...corsHeaders,
                    'Content-Type': `${contentType}; charset=utf-8`,
                    'Content-Disposition': `attachment; filename="transcripts.${format}"`
                });
                res.end(result.data);
            } else {
                res.writeHead(500, corsHeaders);
                res.end(JSON.stringify(result));
            }
            return;
        }
    } else {
        // authorMonitor 未加载时，返回提示
        if (pathname.startsWith('/api/authors') || pathname.startsWith('/api/monitor') || 
            pathname.startsWith('/api/douyin') || pathname.startsWith('/api/transcripts') ||
            pathname === '/api/videos') {
            res.writeHead(503, corsHeaders);
            res.end(JSON.stringify({ 
                success: false, 
                error: '作者监控模块未加载，请运行 npm install 安装 Puppeteer 依赖' 
            }));
            return;
        }
    }
    
    // ==================== 静态文件 ====================
    
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
    console.log('║     🎬 抖音文案提取器（云端版 + 作者监控）                       ║');
    console.log('║                                                                ║');
    console.log(`║     📡 主页面:    http://0.0.0.0:${PORT}`);
    console.log(`║     🖥️  远程桌面:  http://0.0.0.0:${NOVNC_PORT}/vnc.html`);
    console.log('║                                                                ║');
    console.log('║     📋 可用功能:                                               ║');
    console.log('║        • 用户注册/登录                                          ║');
    console.log('║        • 球赛预测（豆包 AI）                                    ║');
    console.log('║        • 作者监控 + 抖音登录（noVNC 远程桌面）                  ║');
    console.log('║        • 文案管理                                               ║');
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
    
    // 启动时自动更新比赛数据（未来3天赛程 + 补充已完赛结果）
    matchPredictor.autoUpdateOnStartup().then(result => {
        if (result.skipped) {
            console.log('⚽ 球赛数据已是最新，跳过');
        } else if (result.success) {
            console.log(`⚽ 球赛数据更新完成: ${result.matches || 0} 场比赛, ${result.results || 0} 条结果同步`);
        } else {
            console.error('⚽ 球赛数据更新失败:', result.error);
        }
    }).catch(e => console.error('自动更新异常:', e.message));
    
    // 启动作者监控
    if (authorMonitor) {
        try {
            authorMonitor.startMonitor(monitorTranscribeCallback);
            console.log('✅ 作者监控已启动（每6小时自动检查+自动转写）');
        } catch (e) {
            console.error('⚠️  作者监控启动失败:', e.message);
        }
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
