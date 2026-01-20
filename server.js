/**
 * 抖音视频文案提取器 - 服务端（本地版）
 * 支持：视频下载 + 音频提取 + 本地语音转文字
 * 
 * 依赖：
 * - ffmpeg（需要系统安装）
 * - Python 3 + openai-whisper（自动安装）
 * 
 * 完全离线运行，不需要任何API
 * 
 * 启动方式：node server.js
 * 默认端口：3456
 */

const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// 使用 Stealth 插件隐藏自动化特征
puppeteer.use(StealthPlugin());

// 作者监控模块
const authorMonitor = require('./author-monitor');

// 比赛预测模块
const matchPredictor = require('./match-predictor');

// 用户认证模块
const auth = require('./auth');

// ==================== 豆包 AI 文案修复配置 ====================
const DOUBAO_CONFIG = {
    enabled: true,  // 是否启用修复功能
    apiKey: process.env.DOUBAO_API_KEY || 'e68d0560-b1b7-4fee-afbc-13c528c14bcd',  // 豆包 API Key
    modelId: process.env.DOUBAO_MODEL_ID || 'doubao-seed-1-6-flash-250828',  // 模型 ID
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    systemPrompt: `你是一个专业的语音转写文案修复助手，专注于足球领域内容。

以下是通过 Whisper 语音识别得到的文案，由于语音识别的局限性，可能存在以下问题：
- 缺少标点符号
- 同音字错误（如"梅西"被识别成"没戏"、"C罗"被识别成"色落"等）
- 足球术语识别错误（如"越位"、"点球"、"角球"、"任意球"、"帽子戏法"等）
- 球员/球队名称识别错误

请对文案进行修复：
1. 添加正确的标点符号（逗号、句号、问号、感叹号等）
2. 修正足球相关的同音字错误（球员名、球队名、术语等）
3. 修正其他明显的语音识别错误
4. 适当分段，使内容更易读
5. 严格保持原意，不要添加、删除或改写内容
6. 保留口语化的表达风格
7. 直接输出修复后的文案，不要有任何解释说明

待修复的文案：`
};

// Chrome 路径（Mac）
const CHROME_PATHS = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    process.env.CHROME_PATH
].filter(Boolean);

// 查找 Chrome 路径
function findChromePath() {
    for (const chromePath of CHROME_PATHS) {
        if (fs.existsSync(chromePath)) {
            return chromePath;
        }
    }
    return null;
}

// 浏览器实例缓存
let browserInstance = null;

// 获取或创建浏览器实例
async function getBrowser() {
    if (browserInstance && browserInstance.connected) {
        return browserInstance;
    }
    
    const chromePath = findChromePath();
    if (!chromePath) {
        throw new Error('未找到 Chrome 浏览器');
    }
    
    browserInstance = await puppeteer.launch({
        executablePath: chromePath,
        headless: 'new', // 新版无头模式，不显示窗口且难以检测
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled',
            '--disable-infobars',
            '--window-size=1280,800'
        ],
        ignoreDefaultArgs: ['--enable-automation'],
        defaultViewport: { width: 1280, height: 800 }
    });
    
    return browserInstance;
}

// 关闭浏览器实例
async function closeBrowser() {
    if (browserInstance) {
        try {
            await browserInstance.close();
            browserInstance = null;
            console.log('浏览器已关闭');
        } catch (e) {
            console.log('关闭浏览器失败:', e.message);
        }
    }
}

const PORT = process.env.PORT || 3456;

// 临时文件目录
const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// 配置文件路径
const CONFIG_FILE = path.join(__dirname, 'config.json');

// 读取配置
function getConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        }
    } catch (e) {
        console.log('读取配置失败:', e.message);
    }
    return { modelSize: 'small' };
}

// 保存配置
function saveConfig(config) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

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
    '.ico': 'image/x-icon',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4'
};

// CORS 头
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8'
};

// 发送HTTP请求（支持二进制）
function makeRequest(requestUrl, options = {}, retryCount = 0) {
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
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
                'Accept': '*/*',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                'Referer': 'https://www.douyin.com/',
                ...options.headers
            },
            timeout: 60000,
            // 添加 SSL 选项，解决证书问题
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
                res.on('end', () => {
                    resolve({ 
                        data: Buffer.concat(chunks), 
                        statusCode: res.statusCode,
                        headers: res.headers 
                    });
                });
            } else {
                let data = '';
                res.setEncoding('utf8');
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    resolve({ 
                        data, 
                        statusCode: res.statusCode,
                        headers: res.headers 
                    });
                });
            }
        });

        req.on('error', (err) => {
            // 如果是网络错误且还有重试次数，自动重试
            if (retryCount < MAX_RETRIES && 
                (err.code === 'ECONNRESET' || 
                 err.code === 'ETIMEDOUT' ||
                 err.message.includes('socket disconnected') ||
                 err.message.includes('TLS'))) {
                console.log(`网络错误，${retryCount + 1}/${MAX_RETRIES} 重试中...`);
                setTimeout(() => {
                    makeRequest(requestUrl, options, retryCount + 1)
                        .then(resolve)
                        .catch(reject);
                }, 1000 * (retryCount + 1)); // 递增延迟
            } else {
                reject(err);
            }
        });
        req.on('timeout', () => {
            req.destroy();
            if (retryCount < MAX_RETRIES) {
                console.log(`请求超时，${retryCount + 1}/${MAX_RETRIES} 重试中...`);
                setTimeout(() => {
                    makeRequest(requestUrl, options, retryCount + 1)
                        .then(resolve)
                        .catch(reject);
                }, 1000 * (retryCount + 1));
            } else {
                reject(new Error('请求超时'));
            }
        });
        
        if (options.body) {
            req.write(options.body);
        }
        req.end();
    });
}

// 跟踪重定向获取最终URL
async function followRedirects(startUrl, maxRedirects = 10) {
    let currentUrl = startUrl;
    let redirectCount = 0;
    let lastResult = null;
    
    while (redirectCount < maxRedirects) {
        const result = await makeRequest(currentUrl);
        
        if (result.redirect) {
            currentUrl = result.redirect;
            if (!currentUrl.startsWith('http')) {
                const base = new URL(startUrl);
                currentUrl = base.origin + currentUrl;
            }
            redirectCount++;
            console.log(`重定向 ${redirectCount}: ${currentUrl}`);
        } else {
            return { url: currentUrl, ...result };
        }
        lastResult = result;
    }
    
    return { url: currentUrl, ...lastResult };
}

// 从HTML中提取视频信息和下载链接
function extractVideoInfo(html, finalUrl) {
    const info = {
        title: '',
        description: '',
        author: '',
        authorId: '',
        authorAvatar: '',
        authorSecUid: '',
        authorSignature: '',
        authorFollowers: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        hashtags: [],
        videoId: '',
        videoUrl: '',
        coverUrl: ''
    };
    
    try {
        const videoIdMatch = finalUrl.match(/video\/(\d+)/);
        if (videoIdMatch) {
            info.videoId = videoIdMatch[1];
        }
        
        const renderDataMatch = html.match(/<script id="RENDER_DATA"[^>]*>([^<]+)<\/script>/);
        if (renderDataMatch) {
            try {
                const decoded = decodeURIComponent(renderDataMatch[1]);
                const renderData = JSON.parse(decoded);
                
                const findVideoData = (obj, depth = 0) => {
                    if (!obj || typeof obj !== 'object' || depth > 10) return null;
                    
                    if (obj.aweme_detail || obj.awemeDetail) {
                        return obj.aweme_detail || obj.awemeDetail;
                    }
                    
                    for (const key of Object.keys(obj)) {
                        const result = findVideoData(obj[key], depth + 1);
                        if (result) return result;
                    }
                    return null;
                };
                
                const videoData = findVideoData(renderData);
                if (videoData) {
                    info.description = videoData.desc || '';
                    info.author = videoData.author?.nickname || '';
                    info.authorId = videoData.author?.unique_id || videoData.author?.short_id || '';
                    info.authorSecUid = videoData.author?.sec_uid || '';
                    info.authorSignature = videoData.author?.signature || '';
                    
                    // 提取作者头像
                    if (videoData.author?.avatar_thumb?.url_list) {
                        info.authorAvatar = videoData.author.avatar_thumb.url_list[0] || '';
                    } else if (videoData.author?.avatar_medium?.url_list) {
                        info.authorAvatar = videoData.author.avatar_medium.url_list[0] || '';
                    } else if (videoData.author?.avatar_larger?.url_list) {
                        info.authorAvatar = videoData.author.avatar_larger.url_list[0] || '';
                    }
                    
                    // 提取粉丝数（如果有）
                    if (videoData.author?.follower_count) {
                        info.authorFollowers = parseInt(videoData.author.follower_count) || 0;
                    }
                    
                    if (videoData.video) {
                        const playAddr = videoData.video.play_addr || videoData.video.playAddr;
                        if (playAddr && playAddr.url_list && playAddr.url_list.length > 0) {
                            info.videoUrl = playAddr.url_list[0];
                        }
                        if (!info.videoUrl && videoData.video.bit_rate) {
                            for (const br of videoData.video.bit_rate) {
                                if (br.play_addr && br.play_addr.url_list) {
                                    info.videoUrl = br.play_addr.url_list[0];
                                    break;
                                }
                            }
                        }
                    }
                    
                    if (videoData.video?.cover?.url_list) {
                        info.coverUrl = videoData.video.cover.url_list[0];
                    }
                    
                    if (videoData.statistics) {
                        info.likes = parseInt(videoData.statistics.digg_count) || 0;
                        info.comments = parseInt(videoData.statistics.comment_count) || 0;
                        info.shares = parseInt(videoData.statistics.share_count) || 0;
                    }
                }
            } catch (e) {
                console.log('解析 RENDER_DATA 失败:', e.message);
            }
        }
        
        if (!info.videoUrl) {
            const videoUrlPatterns = [
                /"playApi"\s*:\s*"([^"]+)"/,
                /"play_addr"\s*:\s*\{[^}]*"url_list"\s*:\s*\["([^"]+)"/,
                /src=["']([^"']*\.mp4[^"']*)/i,
                /"video_url"\s*:\s*"([^"]+)"/
            ];
            
            for (const pattern of videoUrlPatterns) {
                const match = html.match(pattern);
                if (match) {
                    let videoUrl = match[1];
                    videoUrl = videoUrl.replace(/\\u002F/g, '/').replace(/\\\//g, '/');
                    if (videoUrl.includes('mp4') || videoUrl.includes('video')) {
                        info.videoUrl = videoUrl;
                        break;
                    }
                }
            }
        }
        
        if (!info.description) {
            const descMatch = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i) ||
                             html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i);
            if (descMatch) {
                info.description = descMatch[1];
            }
        }
        
        if (!info.title) {
            const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
            if (titleMatch) {
                let title = titleMatch[1];
                title = title.replace(/\s*-\s*抖音.*$/, '').trim();
                info.title = title;
            }
        }
        
        if (!info.description && info.title) {
            info.description = info.title;
        }
        
        const hashtagMatches = info.description.match(/#[^\s#]+/g);
        if (hashtagMatches) {
            info.hashtags = [...new Set(hashtagMatches)];
        }
        
    } catch (e) {
        console.error('提取视频信息出错:', e);
    }
    
    return info;
}

/**
 * 使用 Puppeteer 获取完整的视频和作者信息
 */
async function getVideoInfoWithPuppeteer(videoUrl) {
    let page = null;
    let capturedVideoUrl = null;
    
    try {
        const browser = await getBrowser();
        page = await browser.newPage();
        
        // 拦截网络请求，捕获视频 URL
        await page.setRequestInterception(true);
        let capturedAudioUrl = null; // 备用音频URL
        
        page.on('request', request => {
            const reqUrl = request.url();
            // 只捕获真正的抖音视频 CDN 链接（排除字体和其他资源）
            if (reqUrl.includes('douyinvod.com') && 
                reqUrl.includes('/video/') && 
                !reqUrl.includes('fonts') &&
                !reqUrl.includes('.css')) {
                
                // 检查是否是纯音频流（需要排除）
                if (reqUrl.includes('media-audio') || reqUrl.includes('audio-only')) {
                    if (!capturedAudioUrl) {
                        capturedAudioUrl = reqUrl;
                        console.log('📢 捕获到音频流URL（备用）:', reqUrl.substring(0, 80) + '...');
                    }
                } else if (reqUrl.includes('media-video') || reqUrl.includes('play')) {
                    // 优先使用包含视频的 URL
                    capturedVideoUrl = reqUrl;
                    console.log('✅ 捕获到视频流URL:', reqUrl.substring(0, 80) + '...');
                } else if (!capturedVideoUrl) {
                    // 如果没有明确标识，也尝试使用
                    capturedVideoUrl = reqUrl;
                    console.log('📹 捕获到CDN URL:', reqUrl.substring(0, 80) + '...');
                }
            }
            request.continue();
        });
        
        // 反检测：隐藏 webdriver 属性
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
            Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
            window.chrome = { runtime: {} };
        });
        
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        // 设置额外的请求头
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
        });
        
        console.log('使用浏览器获取视频信息:', videoUrl);
        
        // 加载页面
        console.log('开始加载页面:', videoUrl);
        try {
            await page.goto(videoUrl, { 
                waitUntil: 'networkidle2',
                timeout: 45000 
            });
            console.log('页面加载完成');
        } catch (e) {
            console.log('页面加载超时，尝试继续提取...', e.message);
        }
        
        // 等待视频开始播放（关键：需要足够时间让视频请求发出）
        console.log('等待视频加载...');
        await new Promise(r => setTimeout(r, 10000));
        
        // 如果还没有捕获到视频 URL，尝试滚动和点击
        if (!capturedVideoUrl) {
            console.log('尝试触发视频加载...');
            try {
                // 滚动页面
                await page.evaluate(() => {
                    window.scrollBy(0, 300);
                });
                await new Promise(r => setTimeout(r, 2000));
                
                // 尝试点击视频
                await page.click('video').catch(() => {});
                await new Promise(r => setTimeout(r, 3000));
            } catch (e) {
                console.log('触发视频加载失败:', e.message);
            }
        }
        
        console.log('视频URL捕获状态:', capturedVideoUrl ? '成功' : '失败');
        
        // 检查是否有 RENDER_DATA 并获取详细信息
        const renderDataInfo = await page.evaluate(() => {
            const script = document.querySelector('script#RENDER_DATA');
            if (!script) return { exists: false };
            
            try {
                const decoded = decodeURIComponent(script.textContent);
                const data = JSON.parse(decoded);
                
                // 递归查找视频数据，支持多种结构
                const findVideoData = (obj, depth = 0) => {
                    if (!obj || typeof obj !== 'object' || depth > 20) return null;
                    // 常见的视频数据键名
                    if (obj.aweme_detail) return obj.aweme_detail;
                    if (obj.awemeDetail) return obj.awemeDetail;
                    if (obj.itemInfo && obj.itemInfo.itemStruct) return obj.itemInfo.itemStruct;
                    if (obj.videoData) return obj.videoData;
                    if (obj.detail) return obj.detail;
                    // 检查是否是视频对象（有 desc 和 video 属性）
                    if (obj.desc && obj.video && obj.aweme_id) return obj;
                    for (const key of Object.keys(obj)) {
                        const found = findVideoData(obj[key], depth + 1);
                        if (found) return found;
                    }
                    return null;
                };
                
                const videoData = findVideoData(data);
                if (videoData) {
                    return {
                        exists: true,
                        hasVideoData: true,
                        hasPlayAddr: !!(videoData.video?.play_addr?.url_list?.length > 0),
                        hasBitRate: !!(videoData.video?.bit_rate?.length > 0),
                        author: videoData.author?.nickname || '',
                        videoId: videoData.aweme_id || '',
                        desc: videoData.desc || ''
                    };
                }
                return { exists: true, hasVideoData: false, keys: Object.keys(data).slice(0, 10) };
            } catch (e) {
                return { exists: true, error: e.message };
            }
        });
        console.log('RENDER_DATA 详情:', JSON.stringify(renderDataInfo));
        
        // 从页面提取信息
        const info = await page.evaluate(() => {
            const result = {
                author: '',
                authorId: '',
                authorAvatar: '',
                authorSecUid: '',
                authorSignature: '',
                authorFollowers: 0,
                title: '',
                description: '',
                videoUrl: '',
                coverUrl: '',
                videoId: ''
            };
            
            try {
                // 从 RENDER_DATA 提取
                const renderDataScript = document.querySelector('script#RENDER_DATA');
                if (renderDataScript) {
                    const decoded = decodeURIComponent(renderDataScript.textContent);
                    const data = JSON.parse(decoded);
                    
                    // 递归查找视频数据，支持多种结构
                    const findVideoData = (obj, depth = 0) => {
                        if (!obj || typeof obj !== 'object' || depth > 20) return null;
                        if (obj.aweme_detail) return obj.aweme_detail;
                        if (obj.awemeDetail) return obj.awemeDetail;
                        if (obj.itemInfo && obj.itemInfo.itemStruct) return obj.itemInfo.itemStruct;
                        if (obj.videoData) return obj.videoData;
                        if (obj.detail) return obj.detail;
                        if (obj.desc && obj.video && obj.aweme_id) return obj;
                        for (const key of Object.keys(obj)) {
                            const found = findVideoData(obj[key], depth + 1);
                            if (found) return found;
                        }
                        return null;
                    };
                    
                    const videoData = findVideoData(data);
                    if (videoData) {
                        // 抖音的 desc 就是视频标题/描述
                        result.description = videoData.desc || '';
                        result.title = videoData.desc || videoData.share_info?.share_title || '';
                        result.videoId = videoData.aweme_id || '';
                        
                        if (videoData.author) {
                            result.author = videoData.author.nickname || '';
                            result.authorId = videoData.author.unique_id || videoData.author.short_id || '';
                            result.authorSecUid = videoData.author.sec_uid || '';
                            result.authorSignature = videoData.author.signature || '';
                            result.authorFollowers = videoData.author.follower_count || 0;
                            
                            // 头像
                            const avatarList = videoData.author.avatar_thumb?.url_list ||
                                             videoData.author.avatar_medium?.url_list ||
                                             videoData.author.avatar_larger?.url_list;
                            if (avatarList && avatarList.length > 0) {
                                result.authorAvatar = avatarList[0];
                            }
                        }
                        
                        // 视频URL - 尝试多种路径
                        const playAddr = videoData.video?.play_addr || videoData.video?.playAddr;
                        if (playAddr?.url_list && playAddr.url_list.length > 0) {
                            result.videoUrl = playAddr.url_list[0];
                        }
                        // 备选：bit_rate 中的链接
                        if (!result.videoUrl && videoData.video?.bit_rate) {
                            for (const br of videoData.video.bit_rate) {
                                if (br.play_addr?.url_list && br.play_addr.url_list.length > 0) {
                                    result.videoUrl = br.play_addr.url_list[0];
                                    break;
                                }
                            }
                        }
                        
                        // 封面
                        const cover = videoData.video?.cover || videoData.video?.origin_cover;
                        if (cover?.url_list && cover.url_list.length > 0) {
                            result.coverUrl = cover.url_list[0];
                        }
                    }
                }
                
                // 如果还没有视频URL，尝试从 video 元素获取
                if (!result.videoUrl) {
                    const videoEl = document.querySelector('video[src]');
                    if (videoEl && videoEl.src) {
                        result.videoUrl = videoEl.src;
                    }
                    // 尝试 source 元素
                    const sourceEl = document.querySelector('video source[src]');
                    if (!result.videoUrl && sourceEl && sourceEl.src) {
                        result.videoUrl = sourceEl.src;
                    }
                }
                
                // 如果没有作者信息，尝试从 DOM 提取
                if (!result.author || result.author === '我的') {
                    // 尝试多种选择器 - 优先使用视频作者区域的选择器
                    const selectors = [
                        // 抖音视频页面常见的作者选择器
                        '[data-e2e="video-author-nickname"]',
                        '[data-e2e="user-info"] span',
                        '.author-card-user-name',
                        '.video-info-detail .account-name',
                        '.author-info .name',
                        // 评论区作者
                        '.video-infos-container .author-container span',
                        // 通用选择器
                        '[class*="authorName"]',
                        '[class*="author-name"]',
                        '[class*="AuthorName"]',
                        '[class*="userName"]',
                        '.account-name',
                        '[class*="author"] [class*="name"]:not([class*="my"])',
                        '[class*="nickname"]',
                        // 备用：页面标题中可能有作者名
                        'h1[class*="title"]'
                    ];
                    
                    for (const selector of selectors) {
                        try {
                            const el = document.querySelector(selector);
                            if (el) {
                                const text = el.textContent.trim();
                                // 排除明显错误的值
                                if (text && 
                                    text !== '我的' && 
                                    text !== '我' && 
                                    text !== '关注' &&
                                    text !== '私信' &&
                                    !text.includes('登录') &&
                                    text.length > 0 && 
                                    text.length < 50) {
                                    result.author = text;
                                    break;
                                }
                            }
                        } catch (e) {}
                    }
                }
                
                if (!result.authorAvatar) {
                    // 尝试多种头像选择器 - 优先视频作者区域
                    const avatarSelectors = [
                        '[data-e2e="video-author-avatar"] img',
                        '[data-e2e="user-info"] img',
                        '.author-card-avatar img',
                        '.account-avatar img',
                        '.author-info img',
                        '[class*="avatar"] img',
                        '[class*="Avatar"] img',
                        'img[src*="douyinpic"][src*="aweme"]',
                        'img[src*="p3.douyinpic"]',
                        'img[src*="p6.douyinpic"]'
                    ];
                    
                    for (const selector of avatarSelectors) {
                        try {
                            const el = document.querySelector(selector);
                            if (el && el.src && 
                                (el.src.includes('douyinpic') || el.src.includes('bytednsdoc')) &&
                                !el.src.includes('default_avatar')) {
                                result.authorAvatar = el.src;
                                break;
                            }
                        } catch (e) {}
                    }
                }
                
                // 尝试从用户链接获取 secUid（排除 /user/self）
                if (!result.authorSecUid) {
                    const userLinks = document.querySelectorAll('a[href*="/user/"]');
                    for (const link of userLinks) {
                        if (!link.href.includes('/user/self')) {
                            const match = link.href.match(/\/user\/([^/?]+)/);
                            if (match && match[1] !== 'self') {
                                result.authorSecUid = match[1];
                                break;
                            }
                        }
                    }
                }
                
                // 如果没有标题，从 DOM 提取
                if (!result.title) {
                    const titleSelectors = [
                        '[data-e2e="video-desc"]',
                        '.video-info-detail .title',
                        '.video-info-container .desc',
                        '[class*="video-meta"] [class*="title"]',
                        '[class*="video-meta"] [class*="desc"]',
                        'h1[class*="title"]',
                        '[class*="videoDesc"]',
                        '[class*="video-desc"]',
                        '.xg-video-title'
                    ];
                    
                    for (const selector of titleSelectors) {
                        try {
                            const el = document.querySelector(selector);
                            if (el && el.textContent) {
                                const text = el.textContent.trim();
                                if (text && text.length > 0 && text.length < 500) {
                                    result.title = text;
                                    break;
                                }
                            }
                        } catch (e) {}
                    }
                }
                
                // 备用：从页面 title 提取（格式通常是 "视频标题 - 抖音"）
                if (!result.title) {
                    const pageTitle = document.title || '';
                    if (pageTitle && pageTitle.includes(' - ')) {
                        const parts = pageTitle.split(' - ');
                        if (parts[0] && parts[0].length > 0 && parts[0] !== '抖音') {
                            result.title = parts[0].trim();
                        }
                    }
                }
                
                // 调试：尝试获取页面上的作者信息元素
                if (!result.author) {
                    result._debug = {
                        bodyText: document.body?.innerText?.substring(0, 500) || '',
                        hasAuthorCard: !!document.querySelector('.author-card'),
                        hasVideoInfo: !!document.querySelector('.video-info-detail'),
                        allLinks: Array.from(document.querySelectorAll('a[href*="/user/"]')).slice(0, 3).map(a => a.href)
                    };
                }
                
            } catch (e) {
                console.log('提取失败:', e);
            }
            
            return result;
        });
        
        // 使用拦截到的URL - 抖音使用分离的视频/音频流
        // 我们需要音频流来做语音识别
        if (capturedAudioUrl) {
            // 优先使用音频流（用于语音识别更重要）
            info.audioUrl = capturedAudioUrl;
            console.log('✅ 捕获到独立音频流');
        }
        if (capturedVideoUrl) {
            info.videoUrl = capturedVideoUrl;
            console.log('✅ 捕获到视频流');
        }
        
        // 如果没有独立音频流，检查视频流是否包含音频
        if (!info.audioUrl && !info.videoUrl) {
            console.log('未捕获到任何流，尝试从DOM获取...');
            const domUrls = await page.evaluate(() => {
                const result = { video: null, audio: null };
                const video = document.querySelector('video');
                if (video && video.src) {
                    result.video = video.src;
                }
                return result;
            });
            if (domUrls.video) {
                info.videoUrl = domUrls.video;
                console.log('从DOM获取到视频URL');
            }
        }
        
        console.log('浏览器提取到作者:', info.author || '无', '头像:', info.authorAvatar ? '有' : '无');
        console.log('浏览器提取到视频URL:', info.videoUrl ? info.videoUrl.substring(0, 80) + '...' : '无');
        console.log('浏览器提取到视频ID:', info.videoId || '无');
        console.log('提取结果键:', Object.keys(info).filter(k => info[k] && k !== '_debug').join(', '));
        
        // 输出调试信息
        if (info._debug) {
            console.log('调试信息 - 页面内容片段:', info._debug.bodyText?.substring(0, 200));
            console.log('调试信息 - 用户链接:', info._debug.allLinks);
            delete info._debug; // 清理调试信息
        }
        
        return info;
        
    } catch (error) {
        console.error('Puppeteer 获取信息失败:', error.message);
        return null;
    } finally {
        if (page) {
            try { await page.close(); } catch (e) {}
        }
    }
}

// 清理抖音链接
function cleanDouyinUrl(inputUrl) {
    const shortMatch = inputUrl.match(/https?:\/\/v\.douyin\.com\/[a-zA-Z0-9]+\/?/);
    if (shortMatch) return shortMatch[0];
    
    const longMatch = inputUrl.match(/https?:\/\/www\.douyin\.com\/video\/\d+/);
    if (longMatch) return longMatch[0];
    
    const iesMatch = inputUrl.match(/https?:\/\/www\.iesdouyin\.com\/share\/video\/\d+/);
    if (iesMatch) return iesMatch[0];
    
    return inputUrl;
}

// 下载文件
async function downloadFile(fileUrl, savePath) {
    console.log('下载文件:', fileUrl);
    
    let cleanUrl = fileUrl.replace(/\\u002F/g, '/').replace(/\\\//g, '/');
    
    const result = await makeRequest(cleanUrl, { binary: true });
    
    if (result.redirect) {
        return downloadFile(result.redirect, savePath);
    }
    
    if (Buffer.isBuffer(result.data)) {
        fs.writeFileSync(savePath, result.data);
        console.log('文件已保存:', savePath);
        return savePath;
    }
    
    throw new Error('下载失败：未获取到文件数据');
}

// 检查ffmpeg是否可用
function checkFfmpeg() {
    return new Promise((resolve) => {
        // 先检查系统 PATH 中的 ffmpeg
        exec('ffmpeg -version', (error) => {
            if (!error) {
                resolve(true);
                return;
            }
            
            // 检查配置文件中保存的路径
            const config = getConfig();
            if (config.ffmpegPath && fs.existsSync(config.ffmpegPath)) {
                exec(`"${config.ffmpegPath}" -version`, (err2) => {
                    resolve(!err2);
                });
            } else {
                // 检查默认下载位置
                const defaultPath = path.join(process.env.HOME || '/tmp', '.ffmpeg', 'ffmpeg');
                if (fs.existsSync(defaultPath)) {
                    exec(`"${defaultPath}" -version`, (err3) => {
                        if (!err3) {
                            // 保存到配置
                            const cfg = getConfig();
                            cfg.ffmpegPath = defaultPath;
                            saveConfig(cfg);
                        }
                        resolve(!err3);
                    });
                } else {
                    resolve(false);
                }
            }
        });
    });
}

// 获取 FFmpeg 可执行路径
function getFfmpegPath() {
    const config = getConfig();
    if (config.ffmpegPath && fs.existsSync(config.ffmpegPath)) {
        return config.ffmpegPath;
    }
    const defaultPath = path.join(process.env.HOME || '/tmp', '.ffmpeg', 'ffmpeg');
    if (fs.existsSync(defaultPath)) {
        return defaultPath;
    }
    return 'ffmpeg'; // 使用系统 PATH
}

// 检查Python是否可用
function checkPython() {
    return new Promise((resolve) => {
        // 尝试多个Python命令
        const pythonCommands = ['python3', 'python'];
        let checked = 0;
        
        for (const cmd of pythonCommands) {
            exec(`${cmd} --version`, (error) => {
                checked++;
                if (!error) {
                    resolve(cmd);
                } else if (checked === pythonCommands.length) {
                    resolve(null);
                }
            });
        }
    });
}

// 检查whisper是否已安装
function checkWhisper(pythonCmd) {
    return new Promise((resolve) => {
        exec(`${pythonCmd} -c "import whisper; print('ok')"`, (error, stdout) => {
            resolve(!error && stdout.includes('ok'));
        });
    });
}

// 使用ffmpeg提取音频（MP3格式）
function extractAudio(videoPath, audioPath) {
    return new Promise((resolve, reject) => {
        const ffmpegPath = getFfmpegPath();
        console.log('提取音频:', videoPath, '->', audioPath);
        console.log('使用 FFmpeg:', ffmpegPath);
        
        const ffmpeg = spawn(ffmpegPath, [
            '-i', videoPath,
            '-vn',
            '-acodec', 'libmp3lame',
            '-ar', '16000',
            '-ac', '1',
            '-b:a', '64k',
            '-y',
            audioPath
        ]);
        
        let stderr = '';
        ffmpeg.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        
        ffmpeg.on('close', (code) => {
            if (code === 0) {
                console.log('音频提取成功');
                resolve(audioPath);
            } else {
                console.error('ffmpeg错误:', stderr);
                let errorMsg = '音频提取失败';
                if (stderr.includes('No such file')) {
                    errorMsg = '视频文件不存在，可能下载失败';
                } else if (stderr.includes('Invalid data')) {
                    errorMsg = '视频文件损坏或格式不支持';
                } else if (stderr.includes('moov atom not found')) {
                    errorMsg = '视频文件不完整，下载可能被中断';
                } else if (stderr.includes('does not contain')) {
                    errorMsg = '视频没有音轨，可能是无声视频';
                } else if (code === 1) {
                    errorMsg = '音频提取失败: FFmpeg 处理错误';
                }
                reject(new Error(errorMsg));
            }
        });
        
        ffmpeg.on('error', (err) => {
            reject(new Error('无法启动ffmpeg: ' + err.message));
        });
    });
}

// 使用ffmpeg提取音频为WAV格式（更兼容）
function extractAudioToWav(videoPath, audioPath) {
    return new Promise((resolve, reject) => {
        const ffmpegPath = getFfmpegPath();
        console.log('提取音频为WAV:', videoPath, '->', audioPath);
        console.log('使用 FFmpeg:', ffmpegPath);
        
        const ffmpeg = spawn(ffmpegPath, [
            '-y',           // 覆盖输出文件
            '-i', videoPath,
            '-vn',          // 不要视频
            '-acodec', 'pcm_s16le',  // PCM 16-bit 编码
            '-ar', '16000', // 16kHz 采样率
            '-ac', '1',     // 单声道
            audioPath
        ]);
        
        let stderr = '';
        ffmpeg.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        
        ffmpeg.on('close', (code) => {
            if (code === 0) {
                console.log('音频提取成功 (WAV)');
                resolve(audioPath);
            } else {
                console.error('ffmpeg错误:', stderr);
                let errorMsg = '音频提取失败';
                if (stderr.includes('does not contain any stream')) {
                    errorMsg = '视频没有音轨';
                } else if (stderr.includes('No such file')) {
                    errorMsg = '视频文件不存在';
                } else if (stderr.includes('Invalid data')) {
                    errorMsg = '视频格式不支持';
                }
                reject(new Error(errorMsg));
            }
        });
        
        ffmpeg.on('error', (err) => {
            reject(new Error('无法启动ffmpeg: ' + err.message));
        });
    });
}

// 使用本地Whisper模型进行语音转文字（支持进度回调）
function transcribeAudioLocal(audioPath, modelSize = 'small', progressCallback = null) {
    return new Promise(async (resolve, reject) => {
        console.log('开始本地语音转文字:', audioPath, '模型:', modelSize);
        
        const pythonCmd = await checkPython();
        if (!pythonCmd) {
            reject(new Error('未找到Python，请安装Python 3'));
            return;
        }
        
        const scriptPath = path.join(__dirname, 'transcribe.py');
        
        const python = spawn(pythonCmd, [scriptPath, audioPath, modelSize], {
            cwd: __dirname,
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
        });
        
        let stdout = '';
        let stderr = '';
        
        python.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        
        python.stderr.on('data', (data) => {
            const msg = data.toString();
            stderr += msg;
            
            // 解析进度信息
            const progressMatch = msg.match(/PROGRESS:(\d+)/);
            if (progressMatch && progressCallback) {
                const progress = parseInt(progressMatch[1]);
                progressCallback(progress);
            }
            
            // 打印其他信息
            if (msg.includes('加载') || msg.includes('转写') || msg.includes('下载') || msg.includes('音频时长')) {
                console.log('[Whisper]', msg.trim().replace(/PROGRESS:\d+/g, '').trim());
            }
        });
        
        python.on('close', (code) => {
            console.log('Python脚本退出，代码:', code);
            
            try {
                // 尝试解析JSON输出
                const lines = stdout.trim().split('\n');
                const lastLine = lines[lines.length - 1];
                const result = JSON.parse(lastLine);
                
                if (result.success) {
                    console.log('语音转文字成功');
                    resolve(result.text);
                } else {
                    reject(new Error(result.error || '转写失败'));
                }
            } catch (e) {
                console.error('解析输出失败:', stdout, stderr);
                reject(new Error('转写失败: ' + (stderr || stdout || '未知错误')));
            }
        });
        
        python.on('error', (err) => {
            reject(new Error('无法启动Python: ' + err.message));
        });
    });
}

// 清理临时文件
function cleanupTempFiles(files) {
    for (const file of files) {
        try {
            if (fs.existsSync(file)) {
                fs.unlinkSync(file);
                console.log('已清理:', file);
            }
        } catch (e) {
            console.log('清理失败:', file, e.message);
        }
    }
}

// ==================== 豆包 AI 润色功能 ====================
/**
 * 调用豆包 API 对文案进行润色（带重试机制）
 * @param {string} rawTranscript - 原始转写文案
 * @param {number} retryCount - 当前重试次数
 * @returns {Promise<{success: boolean, polished?: string, error?: string}>}
 */
async function polishTranscriptWithDoubao(rawTranscript, retryCount = 0) {
    const MAX_RETRIES = 2;  // 最多重试2次
    
    if (!DOUBAO_CONFIG.enabled) {
        console.log('豆包润色功能未启用');
        return { success: false, error: '润色功能未启用' };
    }
    
    if (!rawTranscript || rawTranscript.trim().length === 0) {
        return { success: false, error: '文案内容为空' };
    }
    
    if (retryCount === 0) {
        console.log('开始调用豆包 API 进行润色...');
        console.log('原始文案长度:', rawTranscript.length, '字');
    }
    
    const requestData = JSON.stringify({
        model: DOUBAO_CONFIG.modelId,
        messages: [
            { role: 'system', content: DOUBAO_CONFIG.systemPrompt },
            { role: 'user', content: rawTranscript }
        ],
        temperature: 0.3,  // 较低的温度使输出更稳定
        max_tokens: 4096
    });
    
    const urlParts = new URL(DOUBAO_CONFIG.baseUrl);
    
    const options = {
        hostname: urlParts.hostname,
        port: 443,
        path: urlParts.pathname,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${DOUBAO_CONFIG.apiKey}`,
            'Content-Length': Buffer.byteLength(requestData),
            'Connection': 'close'  // 避免 keep-alive 导致的连接问题
        }
    };
    
    const makeRequest = () => new Promise((resolve) => {
        const req = https.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                try {
                    if (res.statusCode !== 200) {
                        console.error('豆包 API 错误:', res.statusCode, data);
                        resolve({ success: false, error: `API 错误: ${res.statusCode}`, retryable: res.statusCode >= 500 });
                        return;
                    }
                    
                    const response = JSON.parse(data);
                    
                    if (response.choices && response.choices[0] && response.choices[0].message) {
                        const polishedText = response.choices[0].message.content;
                        console.log('润色完成，润色后长度:', polishedText.length, '字');
                        resolve({ success: true, polished: polishedText });
                    } else {
                        console.error('豆包 API 响应格式异常:', data);
                        resolve({ success: false, error: '响应格式异常', retryable: false });
                    }
                } catch (e) {
                    console.error('解析豆包响应失败:', e.message);
                    resolve({ success: false, error: '解析响应失败', retryable: false });
                }
            });
        });
        
        req.on('error', (e) => {
            console.error('豆包 API 请求失败:', e.message);
            resolve({ success: false, error: `请求失败: ${e.message}`, retryable: true });
        });
        
        // 增加超时时间到 90 秒
        req.setTimeout(90000, () => {
            req.destroy();
            resolve({ success: false, error: '请求超时', retryable: true });
        });
        
        req.write(requestData);
        req.end();
    });
    
    // 执行请求
    let result = await makeRequest();
    
    // 如果失败且可重试，则重试
    if (!result.success && result.retryable && retryCount < MAX_RETRIES) {
        console.log(`豆包 API 请求失败，第 ${retryCount + 1}/${MAX_RETRIES} 次重试中...`);
        await new Promise(r => setTimeout(r, 2000));  // 等待2秒后重试
        return polishTranscriptWithDoubao(rawTranscript, retryCount + 1);
    }
    
    return result;
}

/**
 * 获取豆包配置状态
 */
function getDoubaoConfig() {
    return {
        enabled: DOUBAO_CONFIG.enabled,
        modelId: DOUBAO_CONFIG.modelId,
        hasApiKey: !!DOUBAO_CONFIG.apiKey
    };
}

/**
 * 更新豆包配置
 */
function updateDoubaoConfig(newConfig) {
    if (typeof newConfig.enabled === 'boolean') {
        DOUBAO_CONFIG.enabled = newConfig.enabled;
    }
    if (newConfig.apiKey) {
        DOUBAO_CONFIG.apiKey = newConfig.apiKey;
    }
    if (newConfig.modelId) {
        DOUBAO_CONFIG.modelId = newConfig.modelId;
    }
    console.log('豆包配置已更新:', getDoubaoConfig());
}

// 处理基础提取请求
async function handleExtract(requestBody) {
    try {
        const { url: inputUrl } = JSON.parse(requestBody);
        
        if (!inputUrl) {
            return { success: false, error: '请提供抖音链接' };
        }
        
        const cleanUrl = cleanDouyinUrl(inputUrl);
        console.log('处理链接:', cleanUrl);
        
        const result = await followRedirects(cleanUrl);
        console.log('最终URL:', result.url);
        
        const videoInfo = extractVideoInfo(result.data, result.url);
        
        if (!videoInfo.description && !videoInfo.title) {
            console.log('尝试移动端请求...');
            const mobileResult = await makeRequest(cleanUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15'
                }
            });
            
            if (mobileResult.data) {
                const mobileInfo = extractVideoInfo(mobileResult.data, result.url);
                Object.assign(videoInfo, mobileInfo);
            }
        }
        
        return {
            success: true,
            data: {
                title: videoInfo.title,
                description: videoInfo.description,
                author: videoInfo.author,
                authorId: videoInfo.authorId,
                likes: videoInfo.likes,
                comments: videoInfo.comments,
                shares: videoInfo.shares,
                hashtags: videoInfo.hashtags,
                videoId: videoInfo.videoId,
                videoUrl: videoInfo.videoUrl,
                sourceUrl: result.url
            }
        };
        
    } catch (error) {
        console.error('提取错误:', error);
        return { 
            success: false, 
            error: error.message || '提取失败，请稍后重试' 
        };
    }
}

// 处理语音转写请求（本地Whisper）
// presetInfo 可选参数：包含预设的视频/作者信息，用于自动转写时传入已知信息
async function handleTranscribe(requestBody, presetInfo = null) {
    const tempFiles = [];
    
    try {
        const { url: inputUrl, modelSize: requestedModel } = JSON.parse(requestBody);
        
        if (!inputUrl) {
            return { success: false, error: '请提供抖音链接' };
        }
        
        // 获取模型大小配置
        const config = getConfig();
        const modelSize = requestedModel || config.modelSize || 'small';
        
        // 检查ffmpeg
        const hasFfmpeg = await checkFfmpeg();
        if (!hasFfmpeg) {
            return { 
                success: false, 
                error: '未检测到 ffmpeg，请先安装\n\nMac: brew install ffmpeg\nWindows: https://ffmpeg.org/download.html',
                needFfmpeg: true
            };
        }
        
        // 检查Python
        const pythonCmd = await checkPython();
        if (!pythonCmd) {
            return { 
                success: false, 
                error: '未检测到 Python，请先安装 Python 3\n\n下载: https://www.python.org/downloads/',
                needPython: true
            };
        }
        
        // 1. 获取视频信息
        console.log('\n========== 开始处理 ==========');
        const cleanUrl = cleanDouyinUrl(inputUrl);
        console.log('步骤1: 获取视频信息...');
        
        const result = await followRedirects(cleanUrl);
        const videoInfo = extractVideoInfo(result.data, result.url);
        
        // 使用 Puppeteer 获取完整视频和作者信息（更可靠）
        if (!videoInfo.author || !videoInfo.authorAvatar) {
            try {
                console.log('使用浏览器获取完整作者信息...');
                const fullUrl = `https://www.douyin.com/video/${videoInfo.videoId}`;
                const puppeteerInfo = await getVideoInfoWithPuppeteer(fullUrl);
                
                if (puppeteerInfo) {
                    // 合并信息，优先使用 Puppeteer 的数据
                    if (puppeteerInfo.author) videoInfo.author = puppeteerInfo.author;
                    if (puppeteerInfo.authorId) videoInfo.authorId = puppeteerInfo.authorId;
                    if (puppeteerInfo.authorAvatar) videoInfo.authorAvatar = puppeteerInfo.authorAvatar;
                    if (puppeteerInfo.authorSecUid) videoInfo.authorSecUid = puppeteerInfo.authorSecUid;
                    if (puppeteerInfo.authorSignature) videoInfo.authorSignature = puppeteerInfo.authorSignature;
                    if (puppeteerInfo.authorFollowers) videoInfo.authorFollowers = puppeteerInfo.authorFollowers;
                    if (puppeteerInfo.videoUrl && !videoInfo.videoUrl) videoInfo.videoUrl = puppeteerInfo.videoUrl;
                    if (puppeteerInfo.coverUrl && !videoInfo.coverUrl) videoInfo.coverUrl = puppeteerInfo.coverUrl;
                    if (puppeteerInfo.description && !videoInfo.description) videoInfo.description = puppeteerInfo.description;
                }
            } catch (e) {
                console.log('Puppeteer 获取失败:', e.message);
            }
        }
        
        // 备选：使用 API 获取信息（包括标题）
        if (videoInfo.videoId && (!videoInfo.videoUrl || !videoInfo.author || !videoInfo.title)) {
            const thirdPartyUrl = `https://www.iesdouyin.com/web/api/v2/aweme/iteminfo/?item_ids=${videoInfo.videoId}`;
            try {
                console.log('使用 API 获取视频详情（含标题）...');
                const apiResult = await makeRequest(thirdPartyUrl);
                if (apiResult.data) {
                    const apiData = JSON.parse(apiResult.data);
                    if (apiData.item_list && apiData.item_list[0]) {
                        const item = apiData.item_list[0];
                        
                        // 获取标题（desc 就是视频标题/描述）
                        if (!videoInfo.title && item.desc) {
                            videoInfo.title = item.desc;
                            console.log('从 API 获取到标题:', videoInfo.title.substring(0, 30));
                        }
                        
                        if (!videoInfo.videoUrl && item.video && item.video.play_addr && item.video.play_addr.url_list) {
                            videoInfo.videoUrl = item.video.play_addr.url_list[0];
                        }
                        
                        if (item.author && !videoInfo.author) {
                            videoInfo.author = item.author.nickname || videoInfo.author;
                            videoInfo.authorId = item.author.unique_id || item.author.short_id || videoInfo.authorId;
                            videoInfo.authorSecUid = item.author.sec_uid || videoInfo.authorSecUid;
                            if (item.author.avatar_thumb && item.author.avatar_thumb.url_list) {
                                videoInfo.authorAvatar = item.author.avatar_thumb.url_list[0];
                            }
                        }
                        
                        if (!videoInfo.coverUrl && item.video && item.video.cover && item.video.cover.url_list) {
                            videoInfo.coverUrl = item.video.cover.url_list[0];
                        }
                        
                        if (!videoInfo.description && item.desc) {
                            videoInfo.description = item.desc;
                        }
                    }
                }
            } catch (e) {
                console.log('API 解析失败:', e.message);
            }
        }
        
        console.log('最终作者信息:', videoInfo.author, '头像:', videoInfo.authorAvatar ? '有' : '无');
        console.log('视频URL:', videoInfo.videoUrl ? '有' : '无', '音频URL:', videoInfo.audioUrl ? '有' : '无');
        
        if (!videoInfo.videoUrl && !videoInfo.audioUrl) {
            return { 
                success: false, 
                error: '无法获取视频下载链接，视频可能已被删除、设为私密或受到访问限制' 
            };
        }
        
        let audioPath;
        
        // 抖音使用 DASH 格式，视频和音频可能是分开的
        if (videoInfo.audioUrl) {
            // 优先使用独立音频流
            console.log('步骤2: 下载独立音频流...');
            const tempAudioPath = path.join(TEMP_DIR, `audio_temp_${Date.now()}.mp4`);
            tempFiles.push(tempAudioPath);
            await downloadFile(videoInfo.audioUrl, tempAudioPath);
            console.log('音频流下载完成');
            
            // 转换为 WAV 格式
            console.log('步骤3: 转换音频格式...');
            audioPath = path.join(TEMP_DIR, `audio_${Date.now()}.wav`);
            tempFiles.push(audioPath);
            await extractAudioToWav(tempAudioPath, audioPath);
        } else {
            // 没有独立音频流，下载视频并提取音频
            console.log('步骤2: 下载视频...');
            const videoPath = path.join(TEMP_DIR, `video_${Date.now()}.mp4`);
            tempFiles.push(videoPath);
            
            await downloadFile(videoInfo.videoUrl, videoPath);
            
            const stats = fs.statSync(videoPath);
            if (stats.size < 1000) {
                throw new Error('下载的视频文件无效');
            }
            console.log('视频大小:', (stats.size / 1024 / 1024).toFixed(2), 'MB');
            
            // 提取音频（使用 WAV 格式确保兼容性）
            console.log('步骤3: 提取音频...');
            audioPath = path.join(TEMP_DIR, `audio_${Date.now()}.wav`);
            tempFiles.push(audioPath);
            
            await extractAudioToWav(videoPath, audioPath);
        }
        
        // 4. 语音转文字（本地Whisper）
        console.log('步骤4: 本地语音转文字 (模型:', modelSize, ')...');
        console.log('首次运行会自动下载模型，请耐心等待...');
        
        let transcript = await transcribeAudioLocal(audioPath, modelSize);
        let rawTranscript = transcript; // 保存原始转写结果
        
        // 5. 豆包 AI 润色（添加标点、修正错误）
        if (DOUBAO_CONFIG.enabled && transcript && transcript.trim().length > 0) {
            console.log('步骤5: 豆包 AI 润色...');
            try {
                const polishResult = await polishTranscriptWithDoubao(transcript);
                if (polishResult.success && polishResult.polished) {
                    transcript = polishResult.polished;
                    console.log('✅ 润色成功');
                } else {
                    console.log('⚠️ 润色失败，使用原始转写:', polishResult.error);
                }
            } catch (polishError) {
                console.log('⚠️ 润色出错，使用原始转写:', polishError.message);
            }
        }
        
        console.log('========== 处理完成 ==========\n');
        
        // 合并预设信息（用于自动转写时传入已知的作者/标题信息）
        if (presetInfo) {
            console.log('使用预设信息:', presetInfo.author || presetInfo.authorNickname, presetInfo.title);
            if (!videoInfo.title && presetInfo.title) videoInfo.title = presetInfo.title;
            if (!videoInfo.author && (presetInfo.author || presetInfo.authorNickname)) {
                videoInfo.author = presetInfo.author || presetInfo.authorNickname;
            }
            if (!videoInfo.authorId && presetInfo.authorId) videoInfo.authorId = presetInfo.authorId;
            if (!videoInfo.authorAvatar && presetInfo.authorAvatar) videoInfo.authorAvatar = presetInfo.authorAvatar;
            if (!videoInfo.authorSecUid && presetInfo.authorSecUid) videoInfo.authorSecUid = presetInfo.authorSecUid;
            if (!videoInfo.authorSecUid && presetInfo.authorUid) videoInfo.authorSecUid = presetInfo.authorUid;
        }
        
        const resultData = {
            title: videoInfo.title,
            description: videoInfo.description,
            author: videoInfo.author,
            authorId: videoInfo.authorId,
            authorAvatar: videoInfo.authorAvatar,
            authorSecUid: videoInfo.authorSecUid,
            authorSignature: videoInfo.authorSignature,
            authorFollowers: videoInfo.authorFollowers,
            hashtags: videoInfo.hashtags,
            transcript: transcript,
            videoId: videoInfo.videoId,
            coverUrl: videoInfo.coverUrl,
            modelUsed: modelSize,
            url: cleanUrl
        };
        
        // 自动保存文案到后台
        try {
            authorMonitor.saveTranscript(resultData);
            console.log('✅ 文案已自动保存到后台');
        } catch (saveError) {
            console.error('保存文案失败:', saveError.message);
        }
        
        return {
            success: true,
            data: resultData
        };
        
    } catch (error) {
        console.error('转写错误:', error);
        return { 
            success: false, 
            error: error.message || '转写失败，请稍后重试' 
        };
    } finally {
        cleanupTempFiles(tempFiles);
    }
}

// 处理语音转写请求（带进度回调）
async function handleTranscribeWithProgress(requestBody, progressCallback) {
    const tempFiles = [];
    
    try {
        const { url: inputUrl, modelSize: requestedModel } = JSON.parse(requestBody);
        
        if (!inputUrl) {
            return { success: false, error: '请提供抖音链接' };
        }
        
        const config = getConfig();
        const modelSize = requestedModel || config.modelSize || 'small';
        
        progressCallback(0, '检查依赖...');
        
        // 检查ffmpeg
        const hasFfmpeg = await checkFfmpeg();
        if (!hasFfmpeg) {
            return { success: false, error: '未检测到 ffmpeg', needFfmpeg: true };
        }
        
        // 检查Python
        const pythonCmd = await checkPython();
        if (!pythonCmd) {
            return { success: false, error: '未检测到 Python', needPython: true };
        }
        
        progressCallback(2, '获取视频信息...');
        
        // 1. 清理URL，获取视频ID
        const cleanUrl = cleanDouyinUrl(inputUrl);
        
        // 提取视频ID（从短链接或完整链接）
        let videoId = '';
        const videoIdMatch = cleanUrl.match(/video\/(\d+)/);
        if (videoIdMatch) {
            videoId = videoIdMatch[1];
        }
        
        let videoInfo = {
            title: '',
            description: '',
            author: '',
            authorId: '',
            authorAvatar: '',
            authorSecUid: '',
            authorSignature: '',
            authorFollowers: 0,
            likes: 0,
            comments: 0,
            shares: 0,
            hashtags: [],
            videoId: videoId,
            videoUrl: '',
            coverUrl: ''
        };
        
        progressCallback(5, '使用浏览器获取视频信息...');
        
        // 优先使用 Puppeteer 获取视频信息（绕过反爬）
        try {
            // 如果没有视频ID，需要先解析短链接
            let targetUrl = cleanUrl;
            if (!videoId && cleanUrl.includes('v.douyin.com')) {
                // 使用 Puppeteer 解析短链接
                const browser = await getBrowser();
                const page = await browser.newPage();
                
                await page.evaluateOnNewDocument(() => {
                    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                });
                
                await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
                
                try {
                    await page.goto(cleanUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                    targetUrl = page.url();
                    
                    const newMatch = targetUrl.match(/video\/(\d+)/);
                    if (newMatch) {
                        videoId = newMatch[1];
                        videoInfo.videoId = videoId;
                    }
                } finally {
                    await page.close();
                }
            }
            
            if (videoId) {
                progressCallback(8, '获取视频详情...');
                const fullUrl = `https://www.douyin.com/video/${videoId}`;
                const puppeteerInfo = await getVideoInfoWithPuppeteer(fullUrl);
                
                if (puppeteerInfo) {
                    if (puppeteerInfo.title) videoInfo.title = puppeteerInfo.title;
                    if (puppeteerInfo.author) videoInfo.author = puppeteerInfo.author;
                    if (puppeteerInfo.authorId) videoInfo.authorId = puppeteerInfo.authorId;
                    if (puppeteerInfo.authorAvatar) videoInfo.authorAvatar = puppeteerInfo.authorAvatar;
                    if (puppeteerInfo.authorSecUid) videoInfo.authorSecUid = puppeteerInfo.authorSecUid;
                    if (puppeteerInfo.authorSignature) videoInfo.authorSignature = puppeteerInfo.authorSignature;
                    if (puppeteerInfo.authorFollowers) videoInfo.authorFollowers = puppeteerInfo.authorFollowers;
                    if (puppeteerInfo.videoUrl) videoInfo.videoUrl = puppeteerInfo.videoUrl;
                    if (puppeteerInfo.audioUrl) videoInfo.audioUrl = puppeteerInfo.audioUrl; // 独立音频流
                    if (puppeteerInfo.coverUrl) videoInfo.coverUrl = puppeteerInfo.coverUrl;
                    if (puppeteerInfo.hashtags) videoInfo.hashtags = puppeteerInfo.hashtags;
                }
            }
        } catch (e) {
            console.log('Puppeteer 获取失败:', e.message);
        }
        
        // 备选：如果 Puppeteer 失败，尝试 HTTP 请求
        if (!videoInfo.videoUrl && !videoInfo.videoId) {
            try {
                progressCallback(10, '尝试备选方案...');
                const result = await followRedirects(cleanUrl);
                const httpInfo = extractVideoInfo(result.data, result.url);
                
                if (httpInfo.videoId) videoInfo.videoId = httpInfo.videoId;
                if (httpInfo.title) videoInfo.title = httpInfo.title;
                if (httpInfo.videoUrl) videoInfo.videoUrl = httpInfo.videoUrl;
            } catch (e) {
                console.log('HTTP 请求失败:', e.message);
            }
        }
        
        // 备选：使用移动端 API
        if (videoInfo.videoId && !videoInfo.videoUrl) {
            const mobileApiUrl = `https://www.iesdouyin.com/web/api/v2/aweme/iteminfo/?item_ids=${videoInfo.videoId}`;
            try {
                progressCallback(12, '尝试移动端接口...');
                const apiResult = await makeRequest(mobileApiUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_7_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Mobile/15E148 Safari/604.1',
                        'Referer': 'https://www.douyin.com/',
                        'Accept': 'application/json'
                    }
                });
                if (apiResult.data) {
                    const apiData = JSON.parse(apiResult.data);
                    if (apiData.item_list && apiData.item_list[0]) {
                        const item = apiData.item_list[0];
                        if (!videoInfo.videoUrl && item.video && item.video.play_addr && item.video.play_addr.url_list) {
                            videoInfo.videoUrl = item.video.play_addr.url_list[0];
                        }
                        if (item.author && !videoInfo.author) {
                            videoInfo.author = item.author.nickname;
                            if (item.author.avatar_thumb && item.author.avatar_thumb.url_list) {
                                videoInfo.authorAvatar = item.author.avatar_thumb.url_list[0];
                            }
                        }
                    }
                }
            } catch (e) {
                console.log('API 解析失败:', e.message);
            }
        }
        
        console.log('最终作者:', videoInfo.author, '头像:', videoInfo.authorAvatar ? '有' : '无');
        
        if (!videoInfo.videoUrl && !videoInfo.audioUrl) {
            return { success: false, error: '无法获取视频下载链接，视频可能已被删除或设为私密' };
        }
        
        let audioPath;
        
        // 抖音使用 DASH 格式，视频和音频可能是分开的
        // 如果有独立音频流，直接下载音频
        if (videoInfo.audioUrl) {
            progressCallback(8, '下载音频流...');
            console.log('检测到独立音频流，直接下载音频');
            const tempAudioPath = path.join(TEMP_DIR, `audio_temp_${Date.now()}.mp4`);
            tempFiles.push(tempAudioPath);
            await downloadFile(videoInfo.audioUrl, tempAudioPath);
            console.log('音频流下载完成:', tempAudioPath);
            
            // 转换为 WAV 格式
            progressCallback(15, '转换音频格式...');
            audioPath = path.join(TEMP_DIR, `audio_${Date.now()}.wav`);
            tempFiles.push(audioPath);
            await extractAudioToWav(tempAudioPath, audioPath);
        } else {
            // 没有独立音频流，下载视频并提取音频
            progressCallback(8, '下载视频...');
            const videoPath = path.join(TEMP_DIR, `video_${Date.now()}.mp4`);
            tempFiles.push(videoPath);
            await downloadFile(videoInfo.videoUrl, videoPath);
            
            progressCallback(15, '提取音频...');
            audioPath = path.join(TEMP_DIR, `audio_${Date.now()}.wav`);
            tempFiles.push(audioPath);
            
            await extractAudioToWav(videoPath, audioPath);
        }
        
        progressCallback(20, '正在转写，请稍候...');
        console.log('使用音频文件进行转写:', audioPath);
        
        // 4. 语音转文字（带进度）
        let transcript = await transcribeAudioLocal(audioPath, modelSize, (whisperProgress) => {
            // Whisper 进度从 20% 到 85%
            const mappedProgress = 20 + Math.floor(whisperProgress * 0.65);
            let message = '正在转写...';
            if (whisperProgress < 15) message = '加载模型...';
            else if (whisperProgress < 25) message = '处理音频...';
            else if (whisperProgress < 90) message = `正在转写... ${whisperProgress}%`;
            else if (whisperProgress < 97) message = '优化文本...';
            else message = '转写完成...';
            progressCallback(mappedProgress, message);
        });
        
        // 5. 豆包 AI 润色（添加标点、修正错误）
        if (DOUBAO_CONFIG.enabled && transcript && transcript.trim().length > 0) {
            progressCallback(88, '润色文案...');
            console.log('开始豆包 AI 润色...');
            try {
                const polishResult = await polishTranscriptWithDoubao(transcript);
                if (polishResult.success && polishResult.polished) {
                    transcript = polishResult.polished;
                    console.log('✅ 润色成功');
                } else {
                    console.log('⚠️ 润色失败，使用原始转写:', polishResult.error);
                }
            } catch (polishError) {
                console.log('⚠️ 润色出错，使用原始转写:', polishError.message);
            }
        }
        
        progressCallback(98, '保存结果...');
        
        const resultData = {
            title: videoInfo.title,
            description: videoInfo.description,
            author: videoInfo.author,
            authorId: videoInfo.authorId,
            authorAvatar: videoInfo.authorAvatar,
            authorSecUid: videoInfo.authorSecUid,
            authorSignature: videoInfo.authorSignature,
            authorFollowers: videoInfo.authorFollowers,
            hashtags: videoInfo.hashtags,
            transcript: transcript,
            videoId: videoInfo.videoId,
            coverUrl: videoInfo.coverUrl,
            modelUsed: modelSize,
            url: cleanUrl
        };
        
        // 自动保存文案到后台
        try {
            authorMonitor.saveTranscript(resultData);
        } catch (saveError) {
            console.error('保存文案失败:', saveError.message);
        }
        
        progressCallback(100, '完成！');
        
        return { success: true, data: resultData };
        
    } catch (error) {
        console.error('转写错误:', error);
        return { success: false, error: error.message || '转写失败，请稍后重试' };
    } finally {
        cleanupTempFiles(tempFiles);
        // 关闭浏览器（延迟 2 秒，避免影响其他请求）
        setTimeout(async () => {
            await closeBrowser();
        }, 2000);
    }
}

// 处理配置请求
async function handleConfig(requestBody) {
    try {
        const { action, modelSize } = JSON.parse(requestBody);
        const config = getConfig();
        
        if (action === 'get') {
            const pythonCmd = await checkPython();
            const hasWhisper = pythonCmd ? await checkWhisper(pythonCmd) : false;
            
            return {
                success: true,
                data: {
                    modelSize: config.modelSize || 'small',
                    hasPython: !!pythonCmd,
                    hasWhisper: hasWhisper
                }
            };
        }
        
        if (action === 'setModel' && modelSize) {
            const validModels = ['tiny', 'base', 'small', 'medium', 'large'];
            if (!validModels.includes(modelSize)) {
                return { success: false, error: '无效的模型大小' };
            }
            config.modelSize = modelSize;
            saveConfig(config);
            return { success: true, message: `模型已设置为 ${modelSize}` };
        }
        
        return { success: false, error: '无效的操作' };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// 检查系统依赖
async function handleCheckDeps() {
    const hasFfmpeg = await checkFfmpeg();
    const pythonCmd = await checkPython();
    const hasWhisper = pythonCmd ? await checkWhisper(pythonCmd) : false;
    const config = getConfig();
    const platform = process.platform; // darwin, win32, linux
    
    return {
        success: true,
        data: {
            ffmpeg: hasFfmpeg,
            python: !!pythonCmd,
            pythonCmd: pythonCmd,
            whisper: hasWhisper,
            modelSize: config.modelSize || 'small',
            platform: platform
        }
    };
}

// 检查 Homebrew 是否安装 (Mac)
function checkHomebrew() {
    return new Promise((resolve) => {
        exec('brew --version', (error) => {
            resolve(!error);
        });
    });
}

// 检查 winget 是否可用 (Windows)
function checkWinget() {
    return new Promise((resolve) => {
        exec('winget --version', (error) => {
            resolve(!error);
        });
    });
}

// 执行安装命令
function runInstallCommand(command, args = []) {
    return new Promise((resolve, reject) => {
        console.log('执行安装命令:', command, args.join(' '));
        
        const child = spawn(command, args, {
            shell: true,
            stdio: ['inherit', 'pipe', 'pipe']
        });
        
        let stdout = '';
        let stderr = '';
        
        child.stdout?.on('data', (data) => {
            stdout += data.toString();
            console.log(data.toString());
        });
        
        child.stderr?.on('data', (data) => {
            stderr += data.toString();
            console.log(data.toString());
        });
        
        child.on('close', (code) => {
            if (code === 0) {
                resolve({ success: true, output: stdout });
            } else {
                resolve({ success: false, error: stderr || stdout || '安装失败' });
            }
        });
        
        child.on('error', (err) => {
            resolve({ success: false, error: err.message });
        });
        
        // 超时处理 (5分钟)
        setTimeout(() => {
            child.kill();
            resolve({ success: false, error: '安装超时' });
        }, 300000);
    });
}

// 流式安装处理
async function handleInstallStream(requestBody, res) {
    const sseHeaders = {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    };
    
    res.writeHead(200, sseHeaders);
    
    function sendLog(message, type = 'info') {
        res.write(`data: ${JSON.stringify({ log: message, type })}\n\n`);
    }
    
    function sendStatus(status, error = null) {
        res.write(`data: ${JSON.stringify({ status, error })}\n\n`);
    }
    
    try {
        const { target } = JSON.parse(requestBody);
        const platform = process.platform;
        
        if (target === 'ffmpeg') {
            if (platform === 'darwin') {
                // Mac: 先尝试 Homebrew
                sendLog('检查 Homebrew...', 'cmd');
                const hasBrew = await checkHomebrew();
                
                let brewSuccess = false;
                
                if (hasBrew) {
                    sendLog('执行: brew install ffmpeg', 'cmd');
                    const result = await runInstallCommandStream('brew', ['install', 'ffmpeg'], sendLog);
                    brewSuccess = result.success;
                }
                
                if (!brewSuccess) {
                    // Homebrew 失败或不可用，尝试直接下载 FFmpeg
                    sendLog('', 'info');
                    sendLog('Homebrew 方式失败，尝试直接下载 FFmpeg...', 'warning');
                    
                    const ffmpegDir = path.join(process.env.HOME || '/tmp', '.ffmpeg');
                    const ffmpegPath = path.join(ffmpegDir, 'ffmpeg');
                    
                    // 创建目录
                    if (!fs.existsSync(ffmpegDir)) {
                        fs.mkdirSync(ffmpegDir, { recursive: true });
                    }
                    
                    // 下载 FFmpeg 静态二进制文件 (使用 evermeet.cx 提供的 macOS 版本)
                    sendLog('下载 FFmpeg 静态二进制文件...', 'info');
                    sendLog('来源: evermeet.cx (macOS 官方静态构建)', 'cmd');
                    
                    const downloadResult = await runInstallCommandStream(
                        'curl',
                        ['-L', '-o', path.join(ffmpegDir, 'ffmpeg.zip'), 
                         'https://evermeet.cx/ffmpeg/getrelease/zip'],
                        sendLog
                    );
                    
                    if (downloadResult.success) {
                        sendLog('解压 FFmpeg...', 'info');
                        const unzipResult = await runInstallCommandStream(
                            'unzip',
                            ['-o', path.join(ffmpegDir, 'ffmpeg.zip'), '-d', ffmpegDir],
                            sendLog
                        );
                        
                        if (unzipResult.success) {
                            // 设置可执行权限
                            await runInstallCommandStream('chmod', ['+x', ffmpegPath], sendLog);
                            
                            // 检查是否成功
                            if (fs.existsSync(ffmpegPath)) {
                                sendLog(`FFmpeg 已下载到: ${ffmpegPath}`, 'success');
                                
                                // 创建符号链接到 /usr/local/bin (如果有权限)
                                const symlinkResult = await runInstallCommandStream(
                                    'ln',
                                    ['-sf', ffmpegPath, '/usr/local/bin/ffmpeg'],
                                    sendLog
                                );
                                
                                if (symlinkResult.success) {
                                    sendLog('已创建符号链接到 /usr/local/bin/ffmpeg', 'success');
                                    sendStatus('success');
                                } else {
                                    // 如果无法创建符号链接，添加到 PATH 说明
                                    sendLog('无法创建系统链接，请手动添加到 PATH:', 'warning');
                                    sendLog(`export PATH="${ffmpegDir}:$PATH"`, 'info');
                                    
                                    // 保存路径到配置文件供程序使用
                                    const config = getConfig();
                                    config.ffmpegPath = ffmpegPath;
                                    saveConfig(config);
                                    sendLog('已保存 FFmpeg 路径到配置', 'success');
                                    sendStatus('success');
                                }
                            } else {
                                sendStatus('error', '解压后未找到 FFmpeg');
                            }
                        } else {
                            sendStatus('error', '解压失败');
                        }
                    } else {
                        sendLog('下载失败，请检查网络连接', 'error');
                        sendLog('您也可以手动下载: https://evermeet.cx/ffmpeg/', 'info');
                        sendStatus('error', '下载 FFmpeg 失败');
                    }
                } else {
                    sendStatus('success');
                }
                
            } else if (platform === 'win32') {
                // Windows: 检查 winget
                sendLog('检查 winget...', 'cmd');
                const hasWinget = await checkWinget();
                
                if (hasWinget) {
                    sendLog('执行: winget install FFmpeg', 'cmd');
                    const result = await runInstallCommandStream(
                        'winget',
                        ['install', 'FFmpeg', '-e', '--accept-package-agreements', '--accept-source-agreements'],
                        sendLog
                    );
                    
                    if (result.success) {
                        sendLog('请重启终端使配置生效', 'warning');
                        sendStatus('success');
                    } else {
                        sendLog('winget 安装失败，尝试使用 chocolatey...', 'warning');
                        
                        // 尝试 choco
                        const hasChoco = await checkCommand('choco --version');
                        if (hasChoco) {
                            sendLog('执行: choco install ffmpeg -y', 'cmd');
                            const chocoResult = await runInstallCommandStream('choco', ['install', 'ffmpeg', '-y'], sendLog);
                            if (chocoResult.success) {
                                sendStatus('success');
                            } else {
                                sendStatus('error', '请手动下载安装 FFmpeg: https://ffmpeg.org/download.html');
                            }
                        } else {
                            sendStatus('error', '请手动下载安装 FFmpeg: https://ffmpeg.org/download.html');
                        }
                    }
                } else {
                    sendLog('winget 不可用，请手动安装 FFmpeg', 'error');
                    sendStatus('error', '请从 https://ffmpeg.org/download.html 下载安装');
                }
            } else {
                sendLog('Linux 系统请使用包管理器安装: sudo apt install ffmpeg', 'info');
                sendStatus('error', '请使用系统包管理器安装');
            }
        }
        
        else if (target === 'python') {
            if (platform === 'darwin') {
                sendLog('检查 Homebrew...', 'cmd');
                const hasBrew = await checkHomebrew();
                
                if (!hasBrew) {
                    sendLog('Homebrew 未安装，开始安装...', 'warning');
                    const brewInstall = await runInstallCommandStream(
                        '/bin/bash',
                        ['-c', 'NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'],
                        sendLog
                    );
                    
                    if (!brewInstall.success) {
                        sendStatus('error', 'Homebrew 安装失败');
                        res.end();
                        return;
                    }
                }
                
                sendLog('执行: brew install python@3', 'cmd');
                const result = await runInstallCommandStream('brew', ['install', 'python@3'], sendLog);
                
                if (result.success) {
                    sendStatus('success');
                } else {
                    sendStatus('error', result.error);
                }
                
            } else if (platform === 'win32') {
                sendLog('检查 winget...', 'cmd');
                const hasWinget = await checkWinget();
                
                if (hasWinget) {
                    sendLog('执行: winget install Python.Python.3.11', 'cmd');
                    const result = await runInstallCommandStream(
                        'winget',
                        ['install', 'Python.Python.3.11', '-e', '--accept-package-agreements', '--accept-source-agreements'],
                        sendLog
                    );
                    
                    if (result.success) {
                        sendLog('请重启终端使配置生效', 'warning');
                        sendStatus('success');
                    } else {
                        sendStatus('error', '请从 https://python.org/downloads/ 下载安装');
                    }
                } else {
                    sendStatus('error', '请从 https://python.org/downloads/ 下载安装');
                }
            } else {
                sendStatus('error', '请使用系统包管理器安装: sudo apt install python3');
            }
        }
        
        else if (target === 'whisper') {
            const pythonCmd = await checkPython();
            if (!pythonCmd) {
                sendStatus('error', '请先安装 Python');
                res.end();
                return;
            }
            
            sendLog(`使用 ${pythonCmd} 安装 openai-whisper...`, 'info');
            sendLog('📦 使用清华大学镜像源加速下载...', 'success');
            sendLog(`执行: ${pythonCmd} -m pip install openai-whisper -i https://pypi.tuna.tsinghua.edu.cn/simple`, 'cmd');
            
            const result = await runInstallCommandStreamWithTimeout(
                pythonCmd,
                ['-m', 'pip', 'install', 'openai-whisper', '-i', 'https://pypi.tuna.tsinghua.edu.cn/simple', '--trusted-host', 'pypi.tuna.tsinghua.edu.cn'],
                sendLog,
                600000  // 10分钟超时
            );
            
            if (result.success) {
                sendStatus('success');
            } else {
                sendLog('', 'info');
                sendLog('❌ 安装失败，请在终端手动运行:', 'error');
                sendLog('pip3 install openai-whisper -i https://pypi.tuna.tsinghua.edu.cn/simple', 'cmd');
                sendStatus('error', result.error);
            }
        }
        
        else {
            sendStatus('error', '未知的安装目标');
        }
        
    } catch (error) {
        sendStatus('error', error.message);
    }
    
    res.end();
}

// 检查命令是否可用
function checkCommand(cmd) {
    return new Promise((resolve) => {
        exec(cmd, (error) => {
            resolve(!error);
        });
    });
}

// 流式执行安装命令
function runInstallCommandStream(command, args, sendLog) {
    return runInstallCommandStreamWithTimeout(command, args, sendLog, 300000); // 默认5分钟
}

// 带超时和心跳的流式安装
function runInstallCommandStreamWithTimeout(command, args, sendLog, timeout = 300000) {
    return new Promise((resolve) => {
        console.log('执行:', command, args.join(' '));
        
        const child = spawn(command, args, {
            shell: true,
            env: { ...process.env, HOMEBREW_NO_AUTO_UPDATE: '1', PIP_PROGRESS_BAR: 'on' }
        });
        
        let lastActivity = Date.now();
        let isResolved = false;
        
        // 心跳检测 - 每30秒发送一次状态
        const heartbeat = setInterval(() => {
            const elapsed = Math.round((Date.now() - lastActivity) / 1000);
            if (elapsed > 30 && !isResolved) {
                sendLog(`⏳ 下载中... (已等待 ${elapsed} 秒)`, 'info');
            }
        }, 30000);
        
        // 超时处理
        const timeoutId = setTimeout(() => {
            if (!isResolved) {
                isResolved = true;
                clearInterval(heartbeat);
                child.kill('SIGTERM');
                sendLog('⏰ 安装超时', 'error');
                resolve({ success: false, error: '安装超时', timeout: true });
            }
        }, timeout);
        
        child.stdout?.on('data', (data) => {
            lastActivity = Date.now();
            const lines = data.toString().split('\n').filter(l => l.trim());
            lines.forEach(line => {
                sendLog(line, 'info');
            });
        });
        
        child.stderr?.on('data', (data) => {
            lastActivity = Date.now();
            const lines = data.toString().split('\n').filter(l => l.trim());
            lines.forEach(line => {
                // 某些正常输出也会走 stderr
                if (line.toLowerCase().includes('error') || line.toLowerCase().includes('fail')) {
                    sendLog(line, 'error');
                } else if (line.toLowerCase().includes('warning')) {
                    sendLog(line, 'warning');
                } else {
                    sendLog(line, 'info');
                }
            });
        });
        
        child.on('close', (code) => {
            if (!isResolved) {
                isResolved = true;
                clearInterval(heartbeat);
                clearTimeout(timeoutId);
                if (code === 0) {
                    resolve({ success: true });
                } else {
                    resolve({ success: false, error: `退出码: ${code}` });
                }
            }
        });
        
        child.on('error', (err) => {
            if (!isResolved) {
                isResolved = true;
                clearInterval(heartbeat);
                clearTimeout(timeoutId);
                sendLog(`错误: ${err.message}`, 'error');
                resolve({ success: false, error: err.message });
            }
        });
    });
}

// 创建HTTP服务器
const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
        res.writeHead(204, corsHeaders);
        res.end();
        return;
    }
    
    const parsedUrl = url.parse(req.url, true);
    
    // API: 基础提取
    if (parsedUrl.pathname === '/api/extract' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            const result = await handleExtract(body);
            res.writeHead(200, corsHeaders);
            res.end(JSON.stringify(result));
        });
        return;
    }
    
    // API: 语音转写（普通版本）
    if (parsedUrl.pathname === '/api/transcribe' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            const result = await handleTranscribe(body);
            res.writeHead(200, corsHeaders);
            res.end(JSON.stringify(result));
        });
        return;
    }
    
    // API: 语音转写（流式版本，支持进度）
    if (parsedUrl.pathname === '/api/transcribe-stream' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            // 使用 Server-Sent Events
            res.writeHead(200, {
                ...corsHeaders,
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive'
            });
            
            const sendEvent = (eventType, data) => {
                res.write(`event: ${eventType}\n`);
                res.write(`data: ${JSON.stringify(data)}\n\n`);
            };
            
            try {
                const result = await handleTranscribeWithProgress(body, (progress, message) => {
                    sendEvent('progress', { progress, message });
                });
                
                sendEvent('complete', result);
            } catch (error) {
                sendEvent('error', { error: error.message });
            }
            
            res.end();
        });
        return;
    }
    
    // API: 配置管理
    if (parsedUrl.pathname === '/api/config' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            const result = await handleConfig(body);
            res.writeHead(200, corsHeaders);
            res.end(JSON.stringify(result));
        });
        return;
    }
    
    // API: 豆包配置 - 获取
    if (parsedUrl.pathname === '/api/doubao/config' && req.method === 'GET') {
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify({ success: true, data: getDoubaoConfig() }));
        return;
    }
    
    // API: 豆包配置 - 更新
    if (parsedUrl.pathname === '/api/doubao/config' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const config = JSON.parse(body);
                updateDoubaoConfig(config);
                res.writeHead(200, corsHeaders);
                res.end(JSON.stringify({ success: true, data: getDoubaoConfig() }));
            } catch (e) {
                res.writeHead(400, corsHeaders);
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
        });
        return;
    }
    
    // API: 单独润色请求
    if (parsedUrl.pathname === '/api/doubao/polish' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { text } = JSON.parse(body);
                if (!text) {
                    res.writeHead(400, corsHeaders);
                    res.end(JSON.stringify({ success: false, error: '请提供文本' }));
                    return;
                }
                const result = await polishTranscriptWithDoubao(text);
                res.writeHead(200, corsHeaders);
                res.end(JSON.stringify(result));
            } catch (e) {
                res.writeHead(500, corsHeaders);
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
        });
        return;
    }
    
    // API: 检查依赖
    if (parsedUrl.pathname === '/api/check-deps') {
        const result = await handleCheckDeps();
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify(result));
        return;
    }
    
    // API: 流式安装依赖
    if (parsedUrl.pathname === '/api/install-stream' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            await handleInstallStream(body, res);
        });
        return;
    }
    
    // ==================== 作者监控 API ====================
    
    // 获取所有作者
    if (parsedUrl.pathname === '/api/authors' && req.method === 'GET') {
        const authors = authorMonitor.getAuthors();
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify({ success: true, data: authors }));
        return;
    }
    
    // 添加作者
    if (parsedUrl.pathname === '/api/authors' && req.method === 'POST') {
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
                // 添加作者，并传入转写回调（自动转写7天内前3个视频）
                // 回调函数现在接收 videoUrl 和 videoInfo（包含作者/标题信息）
                const result = await authorMonitor.addAuthor(authorUrl, async (videoUrl, videoInfo) => {
                    return await handleTranscribe(JSON.stringify({ url: videoUrl, modelSize: 'small' }), videoInfo);
                });
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
    if (parsedUrl.pathname.startsWith('/api/authors/') && req.method === 'DELETE') {
        const authorId = parsedUrl.pathname.split('/').pop();
        const result = authorMonitor.removeAuthor(authorId);
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify(result));
        return;
    }
    
    // 获取所有视频
    if (parsedUrl.pathname === '/api/videos' && req.method === 'GET') {
        const videos = authorMonitor.getVideos();
        const transcripts = authorMonitor.getTranscripts();
        
        // 获取所有已提取文案的视频 ID
        const extractedVideoIds = new Set(
            transcripts
                .filter(t => t.videoUrl)
                .map(t => {
                    // 从 videoUrl 提取视频 ID
                    const match = t.videoUrl.match(/\/video\/(\d+)/);
                    return match ? match[1] : null;
                })
                .filter(Boolean)
        );
        
        // 标记每个视频是否已提取
        const videosWithStatus = videos.map(v => ({
            ...v,
            hasTranscript: extractedVideoIds.has(v.videoId)
        }));
        
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify({ success: true, data: videosWithStatus }));
        return;
    }
    
    // 获取某个作者的视频
    if (parsedUrl.pathname.startsWith('/api/authors/') && parsedUrl.pathname.endsWith('/videos')) {
        const parts = parsedUrl.pathname.split('/');
        const authorId = parts[parts.length - 2];
        const videos = authorMonitor.getAuthorVideoList(authorId);
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify({ success: true, data: videos }));
        return;
    }
    
    // 获取监控状态
    if (parsedUrl.pathname === '/api/monitor/status') {
        const status = authorMonitor.getMonitorStatus();
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify({ success: true, data: status }));
        return;
    }
    
    // 打开浏览器登录抖音
    if (parsedUrl.pathname === '/api/douyin/login' && req.method === 'POST') {
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify({ success: true, message: '正在打开浏览器，请在浏览器中登录抖音...' }));
        // 异步执行
        authorMonitor.openLoginBrowser().then(result => {
            console.log('登录结果:', result);
        });
        return;
    }
    
    // 检查抖音登录状态
    if (parsedUrl.pathname === '/api/douyin/status') {
        const result = authorMonitor.checkLoginStatus();
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify(result));
        return;
    }
    
    // 获取当前任务状态
    if (parsedUrl.pathname === '/api/monitor/task') {
        const taskStatus = authorMonitor.getTaskStatus();
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify({ success: true, data: taskStatus }));
        return;
    }
    
    // 手动触发检查更新
    if (parsedUrl.pathname === '/api/monitor/check' && req.method === 'POST') {
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify({ success: true, message: '开始检查更新...' }));
        // 异步执行检查，传递视频信息（包含作者信息）
        authorMonitor.checkAllUpdates(async (videoUrl, videoInfo) => {
            // 将视频信息作为预设信息传递给 handleTranscribe
            const presetInfo = videoInfo ? {
                title: videoInfo.title,
                author: videoInfo.authorNickname,
                authorNickname: videoInfo.authorNickname,
                authorId: videoInfo.authorId,
                authorAvatar: videoInfo.authorAvatar,
                authorSecUid: videoInfo.authorSecUid || videoInfo.authorUid
            } : null;
            return await handleTranscribe(JSON.stringify({ url: videoUrl, modelSize: 'small' }), presetInfo);
        });
        return;
    }
    
    // 更新视频标题
    if (parsedUrl.pathname === '/api/monitor/update-titles' && req.method === 'POST') {
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify({ success: true, message: '开始更新标题...' }));
        // 异步执行更新
        authorMonitor.updateVideoTitles((current, total, videoId) => {
            console.log(`更新标题进度: ${current}/${total}`);
        }).then(result => {
            console.log(`标题更新完成: ${result.updated}/${result.total}`);
        }).catch(err => {
            console.error('更新标题失败:', err);
        });
        return;
    }
    
    // 获取监控日志
    if (parsedUrl.pathname === '/api/monitor/logs') {
        const limit = parseInt(parsedUrl.searchParams?.get('limit')) || 100;
        const logs = authorMonitor.getLogs(limit);
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify({ success: true, data: logs }));
        return;
    }
    
    // ==================== 文案管理 API ====================
    
    // 获取所有文案
    if (parsedUrl.pathname === '/api/transcripts' && req.method === 'GET') {
        const transcripts = authorMonitor.getTranscripts();
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify({ success: true, data: transcripts, count: transcripts.length }));
        return;
    }
    
    // 刷新作者信息
    if (parsedUrl.pathname.startsWith('/api/transcripts/refresh-author/') && req.method === 'POST') {
        const id = parsedUrl.pathname.split('/').pop();
        
        try {
            // 获取文案信息
            const transcripts = authorMonitor.getTranscripts();
            const transcript = transcripts.find(t => t.id === id);
            
            if (!transcript) {
                res.writeHead(404, corsHeaders);
                res.end(JSON.stringify({ success: false, message: '文案不存在' }));
                return;
            }
            
            const videoId = transcript.videoId || id;
            console.log('刷新作者信息，视频ID:', videoId);
            
            let authorInfo = null;
            
            // 方法0：从已保存的作者数据中匹配（最快最可靠）
            if (transcript.authorSecUid) {
                const authors = authorMonitor.getAuthors();
                const matchedAuthor = authors.find(a => a.secUid === transcript.authorSecUid);
                if (matchedAuthor && matchedAuthor.nickname) {
                    authorInfo = {
                        author: matchedAuthor.nickname,
                        authorId: matchedAuthor.uniqueId || '',
                        authorAvatar: matchedAuthor.avatar || '',
                        authorSecUid: matchedAuthor.secUid,
                        authorSignature: matchedAuthor.signature || '',
                        authorFollowers: matchedAuthor.followerCount || 0
                    };
                    console.log('从本地作者数据匹配到:', authorInfo.author);
                }
            }
            
            // 方法1：使用抖音 API 获取视频详情（如果本地没有匹配到）
            if (!authorInfo) try {
                const apiUrl = `https://www.iesdouyin.com/web/api/v2/aweme/iteminfo/?item_ids=${videoId}`;
                console.log('尝试 API:', apiUrl);
                
                const apiResult = await makeRequest(apiUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_7_1 like Mac OS X) AppleWebKit/605.1.15',
                        'Referer': 'https://www.douyin.com/',
                        'Accept': 'application/json'
                    }
                });
                
                if (apiResult.data) {
                    const apiData = JSON.parse(apiResult.data);
                    if (apiData.item_list && apiData.item_list[0]) {
                        const item = apiData.item_list[0];
                        if (item.author) {
                            authorInfo = {
                                author: item.author.nickname,
                                authorId: item.author.unique_id || item.author.short_id,
                                authorSecUid: item.author.sec_uid,
                                authorSignature: item.author.signature,
                                authorFollowers: item.author.follower_count
                            };
                            if (item.author.avatar_thumb && item.author.avatar_thumb.url_list) {
                                authorInfo.authorAvatar = item.author.avatar_thumb.url_list[0];
                            }
                            console.log('API 获取到作者:', authorInfo.author);
                        }
                    }
                }
            } catch (e) {
                console.log('API 获取失败:', e.message);
            }
            
            // 方法2：如果 API 失败，使用 Puppeteer
            if (!authorInfo || !authorInfo.author) {
                console.log('尝试 Puppeteer 获取作者信息...');
                const videoUrl = `https://www.douyin.com/video/${videoId}`;
                const puppeteerInfo = await getVideoInfoWithPuppeteer(videoUrl);
                if (puppeteerInfo && puppeteerInfo.author) {
                    authorInfo = puppeteerInfo;
                }
            }
            
            if (authorInfo && authorInfo.author) {
                // 更新文案中的作者信息
                transcript.author = authorInfo.author;
                transcript.authorId = authorInfo.authorId || transcript.authorId;
                transcript.authorAvatar = authorInfo.authorAvatar || transcript.authorAvatar;
                transcript.authorSecUid = authorInfo.authorSecUid || transcript.authorSecUid;
                transcript.authorSignature = authorInfo.authorSignature || transcript.authorSignature;
                transcript.authorFollowers = authorInfo.authorFollowers || transcript.authorFollowers;
                
                // 保存更新
                authorMonitor.saveTranscript(transcript);
                
                res.writeHead(200, corsHeaders);
                res.end(JSON.stringify({ 
                    success: true, 
                    message: '作者信息已更新',
                    author: authorInfo.author
                }));
            } else {
                res.writeHead(200, corsHeaders);
                res.end(JSON.stringify({ 
                    success: false, 
                    message: '无法获取作者信息，抖音可能限制了访问' 
                }));
            }
        } catch (error) {
            console.error('刷新作者信息失败:', error.message);
            res.writeHead(500, corsHeaders);
            res.end(JSON.stringify({ success: false, message: error.message }));
        } finally {
            await closeBrowser();
        }
        return;
    }
    
    // 删除单个文案
    if (parsedUrl.pathname.startsWith('/api/transcripts/') && req.method === 'DELETE') {
        const id = parsedUrl.pathname.split('/').pop();
        const result = authorMonitor.deleteTranscript(id);
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify(result));
        return;
    }
    
    // 清空所有文案
    if (parsedUrl.pathname === '/api/transcripts/clear' && req.method === 'POST') {
        const result = authorMonitor.clearTranscripts();
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify(result));
        return;
    }
    
    // 导出文案
    if (parsedUrl.pathname === '/api/transcripts/export') {
        const format = parsedUrl.searchParams?.get('format') || 'txt';
        const result = authorMonitor.exportTranscripts(format);
        
        if (!result.success) {
            res.writeHead(400, corsHeaders);
            res.end(JSON.stringify(result));
            return;
        }
        
        res.writeHead(200, {
            ...corsHeaders,
            'Content-Type': result.mimeType + '; charset=utf-8',
            'Content-Disposition': `attachment; filename="${encodeURIComponent(result.filename)}"`,
        });
        res.end(result.content);
        return;
    }
    
    // ==================== 用户认证 API ====================
    
    // 用户注册
    if (parsedUrl.pathname === '/api/auth/register' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { username, password, nickname } = JSON.parse(body);
                const result = auth.register(username, password, nickname);
                res.writeHead(result.success ? 200 : 400, corsHeaders);
                res.end(JSON.stringify(result));
            } catch (e) {
                res.writeHead(400, corsHeaders);
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
        });
        return;
    }
    
    // 用户登录
    if (parsedUrl.pathname === '/api/auth/login' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { username, password } = JSON.parse(body);
                const result = auth.login(username, password);
                res.writeHead(result.success ? 200 : 401, corsHeaders);
                res.end(JSON.stringify(result));
            } catch (e) {
                res.writeHead(400, corsHeaders);
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
        });
        return;
    }
    
    // 验证Token
    if (parsedUrl.pathname === '/api/auth/verify' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { token } = JSON.parse(body);
                const result = auth.verifyToken(token);
                res.writeHead(result.valid ? 200 : 401, corsHeaders);
                res.end(JSON.stringify(result));
            } catch (e) {
                res.writeHead(400, corsHeaders);
                res.end(JSON.stringify({ valid: false, error: e.message }));
            }
        });
        return;
    }
    
    // 用户登出
    if (parsedUrl.pathname === '/api/auth/logout' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { token } = JSON.parse(body);
                const result = auth.logout(token);
                res.writeHead(200, corsHeaders);
                res.end(JSON.stringify(result));
            } catch (e) {
                res.writeHead(400, corsHeaders);
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
        });
        return;
    }
    
    // ==================== 比赛预测 API ====================
    
    // 搜索最近的比赛（同步返回结果）
    if (parsedUrl.pathname === '/api/matches/search' && req.method === 'POST') {
        (async () => {
            try {
                console.log('开始搜索比赛...');
                const result = await matchPredictor.searchUpcomingMatches();
                console.log('比赛搜索完成:', result.success ? `找到 ${result.matches?.length || 0} 场` : result.error);
                res.writeHead(200, corsHeaders);
                res.end(JSON.stringify(result));
            } catch (e) {
                res.writeHead(500, corsHeaders);
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
        })();
        return;
    }
    
    // 获取比赛列表
    if (parsedUrl.pathname === '/api/matches' && req.method === 'GET') {
        const matches = matchPredictor.getMatches();
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify({ success: true, data: matches }));
        return;
    }
    
    // 添加比赛
    if (parsedUrl.pathname === '/api/matches' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const matchData = JSON.parse(body);
                const result = matchPredictor.addMatch(matchData);
                res.writeHead(200, corsHeaders);
                res.end(JSON.stringify(result));
            } catch (e) {
                res.writeHead(400, corsHeaders);
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
        });
        return;
    }
    
    // 更新比赛结果
    if (parsedUrl.pathname.startsWith('/api/matches/') && parsedUrl.pathname.endsWith('/result') && req.method === 'POST') {
        const matchId = decodeURIComponent(parsedUrl.pathname.split('/')[3]);
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { result } = JSON.parse(body);
                const updateResult = matchPredictor.updateMatchResult(matchId, result);
                res.writeHead(200, corsHeaders);
                res.end(JSON.stringify(updateResult));
            } catch (e) {
                res.writeHead(400, corsHeaders);
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
        });
        return;
    }
    
    // 筛选比赛相关文案
    if (parsedUrl.pathname === '/api/predictions/filter' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { matchId } = JSON.parse(body);
                const transcripts = authorMonitor.getTranscripts();
                const result = await matchPredictor.filterTranscriptsForMatch(matchId, transcripts);
                res.writeHead(200, corsHeaders);
                res.end(JSON.stringify(result));
            } catch (e) {
                res.writeHead(500, corsHeaders);
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
        });
        return;
    }
    
    // 分析预测倾向
    if (parsedUrl.pathname === '/api/predictions/analyze' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { matchId, transcriptIds } = JSON.parse(body);
                const allTranscripts = authorMonitor.getTranscripts();
                const transcripts = transcriptIds 
                    ? allTranscripts.filter(t => transcriptIds.includes(t.videoId || t.id))
                    : allTranscripts;
                
                const result = await matchPredictor.analyzePredictions(matchId, transcripts);
                res.writeHead(200, corsHeaders);
                res.end(JSON.stringify(result));
            } catch (e) {
                res.writeHead(500, corsHeaders);
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
        });
        return;
    }
    
    // 豆包独立预测（不参考博主意见）
    if (parsedUrl.pathname === '/api/predictions/doubao' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { matchId } = JSON.parse(body);
                const result = await matchPredictor.getDoubaoPrediction(matchId);
                res.writeHead(200, corsHeaders);
                res.end(JSON.stringify(result));
            } catch (e) {
                res.writeHead(500, corsHeaders);
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
        });
        return;
    }
    
    // 保存用户对比赛的预测
    if (parsedUrl.pathname === '/api/matches/user-prediction' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { matchId, prediction } = JSON.parse(body);
                const result = matchPredictor.saveUserMatchPrediction(matchId, prediction);
                res.writeHead(200, corsHeaders);
                res.end(JSON.stringify(result));
            } catch (e) {
                res.writeHead(400, corsHeaders);
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
        });
        return;
    }
    
    // 保存预测记录
    if (parsedUrl.pathname === '/api/predictions' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { matchId, analysis, userPrediction } = JSON.parse(body);
                const result = matchPredictor.savePredictionRecord(matchId, analysis, userPrediction);
                res.writeHead(200, corsHeaders);
                res.end(JSON.stringify(result));
            } catch (e) {
                res.writeHead(400, corsHeaders);
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
        });
        return;
    }
    
    // 获取预测列表
    if (parsedUrl.pathname === '/api/predictions' && req.method === 'GET') {
        const predictions = matchPredictor.getPredictions();
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify({ success: true, data: predictions }));
        return;
    }
    
    // 更新用户预测
    if (parsedUrl.pathname.startsWith('/api/predictions/') && parsedUrl.pathname.endsWith('/user') && req.method === 'POST') {
        const predictionId = parsedUrl.pathname.split('/')[3];
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { prediction } = JSON.parse(body);
                const result = matchPredictor.updateUserPrediction(predictionId, prediction);
                res.writeHead(200, corsHeaders);
                res.end(JSON.stringify(result));
            } catch (e) {
                res.writeHead(400, corsHeaders);
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
        });
        return;
    }
    
    // 计算总体预测
    if (parsedUrl.pathname.startsWith('/api/predictions/') && parsedUrl.pathname.endsWith('/calculate') && req.method === 'GET') {
        const predictionId = parsedUrl.pathname.split('/')[3];
        const result = matchPredictor.calculateOverallPrediction(predictionId);
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify(result));
        return;
    }
    
    // 获取准确率统计
    if (parsedUrl.pathname === '/api/accuracy' && req.method === 'GET') {
        const accuracy = matchPredictor.getAccuracy();
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify({ success: true, data: accuracy }));
        return;
    }
    
    // 禁用/启用自媒体
    if (parsedUrl.pathname.startsWith('/api/accuracy/author/') && req.method === 'POST') {
        const authorId = decodeURIComponent(parsedUrl.pathname.split('/')[4]);
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
    
    // 健康检查
    if (parsedUrl.pathname === '/health') {
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
        return;
    }
    
    // 静态文件服务
    let filePath = parsedUrl.pathname;
    if (filePath === '/') filePath = '/index.html';
    
    const fullPath = path.join(__dirname, filePath);
    const ext = path.extname(fullPath).toLowerCase();
    
    if (!fullPath.startsWith(__dirname)) {
        res.writeHead(403, corsHeaders);
        res.end(JSON.stringify({ error: 'Forbidden' }));
        return;
    }
    
    fs.readFile(fullPath, (err, data) => {
        if (err) {
            res.writeHead(404, corsHeaders);
            res.end(JSON.stringify({ error: 'Not Found' }));
            return;
        }
        
        const contentType = mimeTypes[ext] || 'application/octet-stream';
        res.writeHead(200, { ...corsHeaders, 'Content-Type': contentType });
        res.end(data);
    });
});

// 启动服务器
server.listen(PORT, async () => {
    const hasFfmpeg = await checkFfmpeg();
    const pythonCmd = await checkPython();
    const hasWhisper = pythonCmd ? await checkWhisper(pythonCmd) : false;
    const config = getConfig();
    
    console.log('');
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║                                                                ║');
    console.log('║     🎬 抖音视频文案提取器（本地离线版）                          ║');
    console.log('║                                                                ║');
    console.log(`║     📡 服务地址: http://localhost:${PORT}                         ║`);
    console.log('║                                                                ║');
    console.log('║     📋 功能:                                                   ║');
    console.log('║        • 提取视频标题、描述、话题标签                           ║');
    console.log('║        • 下载视频并提取音频                                     ║');
    console.log('║        • 本地语音转文字（无需API，完全离线）                     ║');
    console.log('║                                                                ║');
    console.log('║     ⚙️  系统状态:                                               ║');
    console.log(`║        • FFmpeg: ${hasFfmpeg ? '✅ 已安装' : '❌ 未安装'}                                  ║`);
    console.log(`║        • Python: ${pythonCmd ? '✅ 已安装 (' + pythonCmd + ')' : '❌ 未安装'}                           ║`);
    console.log(`║        • Whisper: ${hasWhisper ? '✅ 已安装' : '⚠️  首次使用自动安装'}                        ║`);
    console.log(`║        • 模型大小: ${config.modelSize || 'small'}                                     ║`);
    console.log('║                                                                ║');
    console.log('║     💡 使用说明:                                                ║');
    console.log('║        1. 打开浏览器访问上述地址                                ║');
    console.log('║        2. 粘贴抖音链接，点击「语音转文字」                       ║');
    console.log('║        3. 首次运行会自动下载模型（约500MB）                      ║');
    console.log('║                                                                ║');
    console.log('║     👤 作者监控:                                                ║');
    const monitorStatus = authorMonitor.getMonitorStatus();
    console.log(`║        • 监控作者: ${monitorStatus.authorCount} 个                                       ║`);
    console.log(`║        • 已抓取视频: ${monitorStatus.videoCount} 个                                     ║`);
    console.log('║        • 自动检查: 每6小时                                      ║');
    console.log('║                                                                ║');
    console.log('║     ⌨️  按 Ctrl+C 停止服务                                      ║');
    console.log('║                                                                ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log('');
    
    // 启动作者监控
    authorMonitor.startMonitor(async (videoUrl) => {
        return await handleTranscribe(JSON.stringify({ url: videoUrl, modelSize: config.modelSize || 'small' }));
    });
    
    // 初始化比赛预测模块
    matchPredictor.setDoubaoConfig(DOUBAO_CONFIG);
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`❌ 端口 ${PORT} 已被占用，请关闭占用该端口的程序后重试`);
    } else {
        console.error('服务器错误:', err);
    }
    process.exit(1);
});
