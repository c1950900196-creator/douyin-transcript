/**
 * 抖音作者监控模块
 * 功能：
 * 1. 存储和管理多个作者信息
 * 2. 每6小时自动检查作者主页更新
 * 3. 自动抓取新视频的标题和文案
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { getDataDir, getRuntimePath } = require('./runtime-paths');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// 延迟加载 match-predictor 避免循环依赖
let matchPredictor = null;
function getMatchPredictor() {
    if (!matchPredictor) {
        matchPredictor = require('./match-predictor');
    }
    return matchPredictor;
}

// 使用 Stealth 插件隐藏自动化特征（启用所有反检测功能）
const stealth = StealthPlugin();
// 启用所有 evasions
stealth.enabledEvasions.add('chrome.app');
stealth.enabledEvasions.add('chrome.csi');
stealth.enabledEvasions.add('chrome.loadTimes');
stealth.enabledEvasions.add('chrome.runtime');
stealth.enabledEvasions.add('iframe.contentWindow');
stealth.enabledEvasions.add('media.codecs');
stealth.enabledEvasions.add('navigator.hardwareConcurrency');
stealth.enabledEvasions.add('navigator.languages');
stealth.enabledEvasions.add('navigator.permissions');
stealth.enabledEvasions.add('navigator.plugins');
stealth.enabledEvasions.add('navigator.webdriver');
stealth.enabledEvasions.add('sourceurl');
stealth.enabledEvasions.add('user-agent-override');
stealth.enabledEvasions.add('webgl.vendor');
stealth.enabledEvasions.add('window.outerdimensions');

puppeteer.use(stealth);

console.log('✅ Puppeteer Stealth 插件已启用，反检测功能已激活');

// Chrome 路径（支持 Mac/Linux/Railway）
const CHROME_PATHS = [
    // Railway / Linux
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    // Mac
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
let browserLock = false; // 浏览器锁，防止并发

// 用户数据目录（保存登录状态）
const USER_DATA_DIR = getRuntimePath('chrome-user-data');

// 确保用户数据目录存在
if (!fs.existsSync(USER_DATA_DIR)) {
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
}

// 任务队列
const taskQueue = [];
let isProcessingQueue = false;

// 添加任务到队列
function addToQueue(task) {
    taskQueue.push(task);
    console.log(`任务入队，当前队列长度: ${taskQueue.length}`);
    processQueue();
}

// 处理任务队列
async function processQueue() {
    if (isProcessingQueue || taskQueue.length === 0) {
        return;
    }
    
    isProcessingQueue = true;
    
    while (taskQueue.length > 0) {
        const task = taskQueue.shift();
        console.log(`执行任务: ${task.name}，剩余队列: ${taskQueue.length}`);
        
        try {
            await task.execute();
        } catch (e) {
            console.error(`任务执行失败: ${task.name}`, e.message);
        }
        
        // 任务间隔
        await new Promise(r => setTimeout(r, 1000));
    }
    
    isProcessingQueue = false;
}

// 获取或创建浏览器实例（带锁，使用用户数据目录保存登录状态）
async function getBrowser(headless = true, retryCount = 0) {
    // 等待锁释放（最多等10秒）
    let waitTime = 0;
    while (browserLock && waitTime < 10000) {
        await new Promise(r => setTimeout(r, 100));
        waitTime += 100;
    }
    
    if (browserInstance && browserInstance.connected) {
        return browserInstance;
    }
    
    browserLock = true;
    
    try {
        const chromePath = findChromePath();
        if (!chromePath) {
            throw new Error('未找到 Chrome 浏览器，请安装 Google Chrome');
        }
        
        console.log('启动浏览器:', chromePath);
        console.log('用户数据目录:', USER_DATA_DIR);
        
        // 随机窗口大小，模拟真实用户
        const widths = [1280, 1366, 1440, 1536, 1920];
        const heights = [720, 768, 800, 864, 900, 1080];
        const width = widths[Math.floor(Math.random() * widths.length)];
        const height = heights[Math.floor(Math.random() * heights.length)];
        
        browserInstance = await puppeteer.launch({
            executablePath: chromePath,
            headless: headless ? 'new' : false,
            userDataDir: USER_DATA_DIR,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled',
                '--disable-infobars',
                `--window-size=${width},${height}`,
                '--no-proxy-server',
                '--disable-extensions',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process',
                '--lang=zh-CN',
                '--accept-lang=zh-CN,zh;q=0.9',
                // 模拟真实用户
                '--disable-background-networking',
                '--disable-default-apps',
                '--disable-hang-monitor',
                '--disable-prompt-on-repost',
                '--disable-sync',
                '--disable-translate',
                '--metrics-recording-only',
                '--no-first-run',
                '--safebrowsing-disable-auto-update'
            ],
            ignoreDefaultArgs: ['--enable-automation', '--enable-blink-features=AutomationControlled'],
            defaultViewport: { width, height }
        });
        
        return browserInstance;
    } catch (e) {
        browserLock = false;
        
        // 如果是浏览器已运行的错误，尝试清理并重试
        if (e.message.includes('already running') && retryCount < 2) {
            console.log('检测到浏览器冲突，尝试清理...');
            cleanupBrowserLocks();
            browserInstance = null;
            
            // 尝试杀死残留的Chrome进程
            try {
                const { execSync } = require('child_process');
                execSync('pkill -f "chrome-user-data" 2>/dev/null || true', { timeout: 5000 });
            } catch (killErr) {
                // 忽略
            }
            
            await new Promise(r => setTimeout(r, 2000));
            console.log(`重试启动浏览器 (第${retryCount + 1}次)...`);
            return getBrowser(headless, retryCount + 1);
        }
        
        throw e;
    } finally {
        browserLock = false;
    }
}

// 打开浏览器让用户登录抖音（改进版：自动关闭浏览器）
async function openLoginBrowser() {
    console.log('打开浏览器进行抖音登录...');
    
    // 先关闭现有浏览器
    await closeBrowser();
    
    let browser = null;
    
    try {
        const chromePath = findChromePath();
        if (!chromePath) {
            throw new Error('未找到 Chrome 浏览器');
        }
        
        console.log('正在启动浏览器...');
        console.log('Chrome 路径:', chromePath);
        console.log('用户数据目录:', USER_DATA_DIR);
        
        // 以非无头模式打开浏览器
        browser = await puppeteer.launch({
            executablePath: chromePath,
            headless: false, // 显示窗口让用户登录
            userDataDir: USER_DATA_DIR,
            args: [
                '--no-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled',
                '--disable-infobars',
                '--window-size=1280,900',
                '--disable-notifications',  // 禁用通知
                '--disable-popup-blocking', // 禁用弹窗拦截
                '--no-default-browser-check',
                '--no-first-run'
            ],
            ignoreDefaultArgs: ['--enable-automation'],
            defaultViewport: null // 使用窗口大小
        });
        
        console.log('浏览器已启动，正在打开抖音页面...');
        
        const page = await browser.newPage();
        
        // 设置更长的超时时间
        page.setDefaultTimeout(60000);
        
        // 打开抖音首页
        await page.goto('https://www.douyin.com/', { 
            waitUntil: 'domcontentloaded',
            timeout: 30000 
        }).catch(e => {
            console.log('页面加载警告:', e.message);
        });
        
        console.log('');
        console.log('╔════════════════════════════════════════════════════════════════╗');
        console.log('║                                                                ║');
        console.log('║     🌐 浏览器已打开，请在浏览器中登录抖音账号                 ║');
        console.log('║                                                                ║');
        console.log('║     登录步骤：                                                 ║');
        console.log('║     1️⃣  点击页面右上角的「登录」按钮                            ║');
        console.log('║     2️⃣  扫码或使用手机号登录                                    ║');
        console.log('║     3️⃣  登录成功后，浏览器会在 60 秒后自动关闭                  ║');
        console.log('║                                                                ║');
        console.log('║     💡 如需提前结束，直接关闭浏览器窗口即可                     ║');
        console.log('║                                                                ║');
        console.log('╚════════════════════════════════════════════════════════════════╝');
        console.log('');
        
        // 等待浏览器关闭或 60 秒超时
        await Promise.race([
            new Promise(resolve => {
                browser.on('disconnected', resolve);
            }),
            new Promise(resolve => setTimeout(resolve, 60000))
        ]);
        
        // 如果浏览器还在运行，强制关闭
        if (browser && browser.connected) {
            console.log('⏰ 60 秒已到，自动关闭浏览器...');
            await browser.close().catch(() => {});
        }
        
        console.log('✅ 浏览器已关闭，登录状态已保存');
        console.log('');
        
        // 等待一下让文件系统同步
        await new Promise(r => setTimeout(r, 1000));
        
        return { success: true, message: '登录完成！请刷新页面查看状态' };
        
    } catch (error) {
        console.error('❌ 打开登录浏览器失败:', error.message);
        
        // 确保浏览器被关闭
        if (browser) {
            try {
                await browser.close();
            } catch (e) {}
        }
        
        return { success: false, error: error.message };
    }
}

// 检查是否已登录（通过检查 cookie 文件和用户数据）
function checkLoginStatus() {
    try {
        // 检查用户数据目录是否存在
        if (!fs.existsSync(USER_DATA_DIR)) {
            return { 
                success: true, 
                isLoggedIn: false,
                message: '未登录，请点击登录按钮'
            };
        }
        
        const cookiesPath = path.join(USER_DATA_DIR, 'Default', 'Cookies');
        const localStatePath = path.join(USER_DATA_DIR, 'Local State');
        const preferencesPath = path.join(USER_DATA_DIR, 'Default', 'Preferences');
        
        // 详细检查文件状态
        let hasValidData = false;
        let details = [];
        
        // 检查 Cookies 文件
        if (fs.existsSync(cookiesPath)) {
            const stats = fs.statSync(cookiesPath);
            details.push(`Cookies: ${(stats.size / 1024).toFixed(1)}KB`);
            // Cookies 文件大于 10KB 通常意味着有登录状态
            if (stats.size > 10000) {
                hasValidData = true;
            }
        } else {
            details.push('Cookies: 不存在');
        }
        
        // 检查 Local State 文件
        if (fs.existsSync(localStatePath)) {
            const stats = fs.statSync(localStatePath);
            details.push(`Local State: ${(stats.size / 1024).toFixed(1)}KB`);
            if (stats.size > 100) {
                hasValidData = true;
            }
        } else {
            details.push('Local State: 不存在');
        }
        
        // 检查 Preferences 文件
        if (fs.existsSync(preferencesPath)) {
            const stats = fs.statSync(preferencesPath);
            details.push(`Preferences: ${(stats.size / 1024).toFixed(1)}KB`);
        } else {
            details.push('Preferences: 不存在');
        }
        
        const message = hasValidData 
            ? `已保存登录状态 (${details.join(', ')})` 
            : `未检测到登录状态 (${details.join(', ')})`;
        
        console.log('登录状态检查:', message);
        
        return { 
            success: true, 
            isLoggedIn: hasValidData,
            message,
            details: details.join(', ')
        };
        
    } catch (error) {
        console.error('检查登录状态失败:', error.message);
        return { 
            success: false, 
            isLoggedIn: false, 
            error: error.message,
            message: '检查失败: ' + error.message
        };
    }
}

// 关闭浏览器
async function closeBrowser() {
    browserLock = false; // 先释放锁
    if (browserInstance) {
        try {
            await browserInstance.close();
        } catch (e) {
            console.error('关闭浏览器失败:', e.message);
        }
        browserInstance = null;
    }
    // 清理锁文件
    cleanupBrowserLocks();
}

// 清理浏览器锁文件
function cleanupBrowserLocks() {
    const lockFiles = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];
    for (const file of lockFiles) {
        const lockPath = path.join(USER_DATA_DIR, file);
        try {
            if (fs.existsSync(lockPath)) {
                fs.unlinkSync(lockPath);
                console.log(`已删除锁文件: ${file}`);
            }
        } catch (e) {
            // 忽略删除失败
        }
    }
}

// 数据文件路径
const DATA_DIR = getDataDir();
const AUTHORS_FILE = path.join(DATA_DIR, 'authors.json');
const VIDEOS_FILE = path.join(DATA_DIR, 'videos.json');
const LOGS_FILE = path.join(DATA_DIR, 'monitor-logs.json');
const TRANSCRIPTS_FILE = path.join(DATA_DIR, 'transcripts.json');
const AVATARS_DIR = path.join(DATA_DIR, 'avatars');

// 确保头像目录存在
if (!fs.existsSync(AVATARS_DIR)) {
    fs.mkdirSync(AVATARS_DIR, { recursive: true });
}

/**
 * 从页面中提取并保存头像（在已打开的页面中执行）
 * @param {Page} page - Puppeteer 页面对象
 * @param {string} authorId - 作者ID（用于文件名）
 * @returns {string|null} - 本地头像路径或null
 */
async function extractAvatarFromPage(page, authorId) {
    if (!page || !authorId) return null;
    
    try {
        const fileName = `${authorId}.jpg`;
        const localPath = path.join(AVATARS_DIR, fileName);
        
        // 如果已存在且不太旧（7天内），跳过
        if (fs.existsSync(localPath)) {
            const stat = fs.statSync(localPath);
            const ageInDays = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60 * 24);
            if (ageInDays < 7) {
                return `/avatars/${fileName}`;
            }
        }
        
        // 在页面中找到作者头像元素并转换为 base64
        const avatarBase64 = await page.evaluate(() => {
            // 优先找作者主页的大头像（排除右上角用户自己的小头像）
            // 作者头像通常在主内容区域，尺寸较大
            const allAvatars = document.querySelectorAll('img[src*="aweme-avatar"]');
            let authorAvatar = null;
            
            for (const img of allAvatars) {
                // 跳过太小的头像（可能是用户自己的头像或评论头像）
                const rect = img.getBoundingClientRect();
                if (rect.width >= 60 && rect.height >= 60) {
                    // 跳过右上角区域的头像（那是用户自己的）
                    if (rect.left > window.innerWidth - 200 && rect.top < 100) {
                        continue;
                    }
                    authorAvatar = img;
                    break;
                }
            }
            
            // 备用：尝试其他选择器
            if (!authorAvatar) {
                authorAvatar = document.querySelector('[data-e2e="user-avatar"] img') ||
                              document.querySelector('.author-card img[src*="avatar"]') ||
                              document.querySelector('[class*="authorInfo"] img');
            }
            
            if (!authorAvatar) return null;
            
            // 创建 canvas 获取图片数据
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = authorAvatar.naturalWidth || 100;
            canvas.height = authorAvatar.naturalHeight || 100;
            
            try {
                ctx.drawImage(authorAvatar, 0, 0);
                return canvas.toDataURL('image/jpeg', 0.9);
            } catch (e) {
                // 跨域图片无法绘制
                return null;
            }
        });
        
        if (avatarBase64 && avatarBase64.startsWith('data:image')) {
            // 保存 base64 为文件
            const base64Data = avatarBase64.replace(/^data:image\/\w+;base64,/, '');
            fs.writeFileSync(localPath, Buffer.from(base64Data, 'base64'));
            console.log(`✅ 头像已保存: ${fileName}`);
            return `/avatars/${fileName}`;
        }
        
        return null;
    } catch (e) {
        console.error(`提取头像失败:`, e.message);
        return null;
    }
}

/**
 * 下载头像到本地（备用方法，标记为需要从页面提取）
 */
async function downloadAvatar(avatarUrl, authorId) {
    // 这个函数现在只是标记作者需要头像
    // 实际头像会在 getAuthorVideos 时通过 extractAvatarFromPage 获取
    return null;
}

// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 监控间隔（6小时 = 21600000 毫秒）
const MONITOR_INTERVAL = 6 * 60 * 60 * 1000;

// 定时器引用
let monitorTimer = null;

/**
 * 读取作者列表
 */
function getAuthors() {
    try {
        if (fs.existsSync(AUTHORS_FILE)) {
            return JSON.parse(fs.readFileSync(AUTHORS_FILE, 'utf-8'));
        }
    } catch (e) {
        console.error('读取作者列表失败:', e);
    }
    return [];
}

/**
 * 保存作者列表
 */
function saveAuthors(authors) {
    fs.writeFileSync(AUTHORS_FILE, JSON.stringify(authors, null, 2), 'utf-8');
}

/**
 * 读取视频列表
 */
function getVideos() {
    try {
        if (fs.existsSync(VIDEOS_FILE)) {
            return JSON.parse(fs.readFileSync(VIDEOS_FILE, 'utf-8'));
        }
    } catch (e) {
        console.error('读取视频列表失败:', e);
    }
    return [];
}

/**
 * 保存视频列表
 */
function saveVideos(videos) {
    fs.writeFileSync(VIDEOS_FILE, JSON.stringify(videos, null, 2), 'utf-8');
}

/**
 * 添加监控日志
 */
function addLog(type, message, data = null) {
    let logs = [];
    try {
        if (fs.existsSync(LOGS_FILE)) {
            logs = JSON.parse(fs.readFileSync(LOGS_FILE, 'utf-8'));
        }
    } catch (e) {}
    
    logs.unshift({
        time: new Date().toISOString(),
        type,
        message,
        data
    });
    
    // 只保留最近1000条日志
    if (logs.length > 1000) {
        logs = logs.slice(0, 1000);
    }
    
    fs.writeFileSync(LOGS_FILE, JSON.stringify(logs, null, 2), 'utf-8');
}

/**
 * 获取日志
 */
function getLogs(limit = 100) {
    try {
        if (fs.existsSync(LOGS_FILE)) {
            const logs = JSON.parse(fs.readFileSync(LOGS_FILE, 'utf-8'));
            return logs.slice(0, limit);
        }
    } catch (e) {}
    return [];
}

/**
 * 读取文案列表（自动补充缺失的作者信息）
 */
function getTranscripts() {
    try {
        if (fs.existsSync(TRANSCRIPTS_FILE)) {
            const transcripts = JSON.parse(fs.readFileSync(TRANSCRIPTS_FILE, 'utf-8'));
            const authors = getAuthors();
            
            // 自动补充缺失的作者名称
            let needSave = false;
            for (const t of transcripts) {
                if (!t.author && t.authorSecUid) {
                    const author = authors.find(a => a.secUid === t.authorSecUid || a.uid === t.authorSecUid);
                    if (author && author.nickname) {
                        t.author = author.nickname;
                        needSave = true;
                    }
                }
            }
            
            // 如果有修复，保存回文件
            if (needSave) {
                fs.writeFileSync(TRANSCRIPTS_FILE, JSON.stringify(transcripts, null, 2), 'utf-8');
                console.log('✅ 已自动补充文案的作者信息');
            }
            
            return transcripts;
        }
    } catch (e) {
        console.error('读取文案列表失败:', e);
    }
    return [];
}

/**
 * 保存文案
 */
function saveTranscript(transcriptData) {
    const transcripts = getTranscripts();
    
    // 检查是否已存在（通过 videoId 判断）
    const existingIndex = transcripts.findIndex(t => t.videoId === transcriptData.videoId);
    
    const record = {
        id: transcriptData.videoId || Date.now().toString(),
        videoId: transcriptData.videoId || '',
        title: transcriptData.title || '',
        author: transcriptData.author || '',
        authorId: transcriptData.authorId || '',
        authorAvatar: transcriptData.authorAvatar || '',
        authorSecUid: transcriptData.authorSecUid || '',
        authorSignature: transcriptData.authorSignature || '',
        authorFollowers: transcriptData.authorFollowers || 0,
        transcript: transcriptData.transcript || '',
        hashtags: transcriptData.hashtags || [],
        coverUrl: transcriptData.coverUrl || '',
        url: transcriptData.url || '',
        createdAt: new Date().toISOString(),
        modelUsed: transcriptData.modelUsed || 'small'
    };
    
    if (existingIndex >= 0) {
        // 更新现有记录
        transcripts[existingIndex] = { ...transcripts[existingIndex], ...record };
    } else {
        // 添加新记录
        transcripts.unshift(record);
    }
    
    // 限制最多保存 1000 条
    if (transcripts.length > 1000) {
        transcripts.splice(1000);
    }
    
    fs.writeFileSync(TRANSCRIPTS_FILE, JSON.stringify(transcripts, null, 2), 'utf-8');
    addLog('transcript', `保存文案: ${record.title.substring(0, 30)}...`);
    
    // 异步分析文案是否包含比赛预测
    analyzePredictionAsync(record).catch(err => {
        console.error('预测分析失败:', err.message);
    });
    
    return record;
}

/**
 * 异步分析文案是否包含比赛预测（支持多场比赛）
 * 同时将预测结果保存到文案记录中
 */
async function analyzePredictionAsync(transcriptData) {
    try {
        const predictor = getMatchPredictor();
        
        // 分析文案
        const result = await predictor.analyzeTranscriptForPrediction(transcriptData);
        
        if (result.success && result.analysis) {
            const analysis = result.analysis;
            
            if (analysis.hasPrediction) {
                // 将预测添加到比赛记录（支持多场比赛）
                const addResult = predictor.addAuthorPrediction(transcriptData, analysis);
                
                if (addResult.success) {
                    const count = addResult.added || 1;
                    if (count === 1) {
                        const firstResult = addResult.results?.[0];
                        addLog('prediction', `检测到比赛预测: ${transcriptData.author} -> ${firstResult?.prediction || '未知'} (${firstResult?.match || ''})`);
                    } else {
                        addLog('prediction', `检测到 ${count} 场比赛预测: ${transcriptData.author}`);
                    }
                }
            }
            
            // 无论是否有预测，都将分析结果保存到文案记录中
            updateTranscriptWithPredictions(transcriptData.videoId || transcriptData.id, analysis);
        }
    } catch (err) {
        console.error('预测分析异常:', err.message);
    }
}

/**
 * 更新文案记录，添加预测信息
 */
function updateTranscriptWithPredictions(transcriptId, analysis) {
    if (!transcriptId || !analysis) return;
    
    try {
        const transcripts = getTranscripts();
        const index = transcripts.findIndex(t => t.id === transcriptId || t.videoId === transcriptId);
        
        if (index >= 0) {
            // 保存预测信息到文案记录
            transcripts[index].predictions = analysis.predictions || [];
            transcripts[index].hasPrediction = analysis.hasPrediction || false;
            
            fs.writeFileSync(TRANSCRIPTS_FILE, JSON.stringify(transcripts, null, 2), 'utf-8');
            console.log(`✅ 预测信息已保存到文案: ${transcriptId}`);
        }
    } catch (err) {
        console.error('更新文案预测信息失败:', err.message);
    }
}

/**
 * 删除文案
 */
function deleteTranscript(id) {
    const transcripts = getTranscripts();
    const index = transcripts.findIndex(t => t.id === id || t.videoId === id);
    
    if (index === -1) {
        return { success: false, message: '文案不存在' };
    }
    
    const deleted = transcripts.splice(index, 1)[0];
    fs.writeFileSync(TRANSCRIPTS_FILE, JSON.stringify(transcripts, null, 2), 'utf-8');
    
    return { success: true, message: '已删除', deleted };
}

/**
 * 清空所有文案
 */
function clearTranscripts() {
    fs.writeFileSync(TRANSCRIPTS_FILE, JSON.stringify([], null, 2), 'utf-8');
    addLog('clear', '已清空所有文案');
    return { success: true, message: '已清空' };
}

/**
 * 导出文案
 * @param {string} format - 导出格式: 'json' | 'txt' | 'csv'
 */
function exportTranscripts(format = 'txt') {
    const transcripts = getTranscripts();
    
    if (transcripts.length === 0) {
        return { success: false, error: '没有文案可导出' };
    }
    
    let content = '';
    let filename = '';
    let mimeType = '';
    
    switch (format) {
        case 'json':
            content = JSON.stringify(transcripts, null, 2);
            filename = `抖音文案_${formatDateForFile()}.json`;
            mimeType = 'application/json';
            break;
            
        case 'csv':
            // CSV 格式
            const headers = ['标题', '作者', '文案', '话题标签', '提取时间'];
            const rows = transcripts.map(t => [
                `"${(t.title || '').replace(/"/g, '""')}"`,
                `"${(t.author || '').replace(/"/g, '""')}"`,
                `"${(t.transcript || '').replace(/"/g, '""')}"`,
                `"${(t.hashtags || []).join(' ')}"`,
                `"${t.createdAt || ''}"`
            ].join(','));
            content = '\uFEFF' + headers.join(',') + '\n' + rows.join('\n');
            filename = `抖音文案_${formatDateForFile()}.csv`;
            mimeType = 'text/csv';
            break;
            
        case 'txt':
        default:
            // 纯文本格式
            content = transcripts.map((t, i) => {
                return `【${i + 1}】${t.title || '无标题'}
作者: ${t.author || '未知'}
时间: ${t.createdAt || ''}
话题: ${(t.hashtags || []).join(' ') || '无'}

${t.transcript || '(无文案)'}

${'='.repeat(50)}
`;
            }).join('\n');
            filename = `抖音文案_${formatDateForFile()}.txt`;
            mimeType = 'text/plain';
            break;
    }
    
    return {
        success: true,
        content,
        filename,
        mimeType,
        count: transcripts.length
    };
}

/**
 * 格式化日期用于文件名
 */
function formatDateForFile() {
    const now = new Date();
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
}

/**
 * HTTP 请求工具
 */
function makeRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const protocol = parsedUrl.protocol === 'https:' ? https : http;
        
        const reqOptions = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port,
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
                'Accept': '*/*',
                'Accept-Language': 'zh-CN,zh;q=0.9',
                'Referer': 'https://www.douyin.com/',
                ...options.headers
            },
            timeout: 30000,
            rejectUnauthorized: false
        };
        
        const req = protocol.request(reqOptions, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                // 跟随重定向
                makeRequest(res.headers.location, options).then(resolve).catch(reject);
                return;
            }
            
            let data = '';
            res.setEncoding('utf8');
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ data, statusCode: res.statusCode, url: res.url || url }));
        });
        
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('请求超时'));
        });
        req.end();
    });
}

/**
 * 从抖音用户主页链接提取用户信息
 */
async function parseAuthorPage(authorUrl) {
    console.log('解析作者主页:', authorUrl);
    
    try {
        // 清理链接
        let cleanUrl = authorUrl;
        const urlMatch = authorUrl.match(/https?:\/\/[^\s]+/);
        if (urlMatch) {
            cleanUrl = urlMatch[0];
        }
        
        // 提取用户信息
        let authorInfo = {
            url: cleanUrl,
            secUid: null,
            uid: null,
            nickname: null,
            signature: null,
            avatar: null,
            followerCount: 0,
            videoCount: 0,
            addedAt: new Date().toISOString(),
            lastChecked: null,
            videos: []
        };
        
        // 方法1: 从 URL 中提取 sec_uid（用户主页链接格式）
        // 格式: https://www.douyin.com/user/MS4wLjABAAAAxxxxx
        const secUidFromUrl = cleanUrl.match(/user\/([A-Za-z0-9_-]+)/);
        if (secUidFromUrl) {
            authorInfo.secUid = secUidFromUrl[1];
            console.log('从URL提取到 secUid:', authorInfo.secUid);
        }
        
        // 方法2: 从分享链接中提取
        // 格式: https://v.douyin.com/xxxxx/
        if (!authorInfo.secUid && cleanUrl.includes('v.douyin.com')) {
            try {
                const result = await makeRequest(cleanUrl);
                const finalUrl = result.url || '';
                const secUidMatch = finalUrl.match(/sec_uid=([^&]+)/);
                if (secUidMatch) {
                    authorInfo.secUid = decodeURIComponent(secUidMatch[1]);
                    console.log('从重定向提取到 secUid:', authorInfo.secUid);
                }
            } catch (e) {
                console.log('跟随重定向失败:', e.message);
            }
        }
        
        // 如果没有获取到 secUid，尝试直接使用 URL 中的 ID 作为 uid
        if (!authorInfo.secUid) {
            const uidMatch = cleanUrl.match(/user\/(\d+)/);
            if (uidMatch) {
                authorInfo.uid = uidMatch[1];
            }
        }
        
        // 使用 secUid 获取用户详细信息
        if (authorInfo.secUid) {
            // 方法1: 通过用户信息 API
            try {
                const userApiUrl = `https://www.iesdouyin.com/web/api/v2/user/info/?sec_uid=${authorInfo.secUid}`;
                console.log('请求用户信息API:', userApiUrl);
                
                const userResult = await makeRequest(userApiUrl);
                if (userResult.data && userResult.data.length > 10) {
                    const userData = JSON.parse(userResult.data);
                    if (userData.user_info) {
                        const user = userData.user_info;
                        authorInfo.uid = user.uid || authorInfo.uid;
                        authorInfo.nickname = user.nickname || authorInfo.nickname;
                        authorInfo.signature = user.signature || '';
                        authorInfo.avatar = user.avatar_thumb?.url_list?.[0] || user.avatar_medium?.url_list?.[0] || '';
                        authorInfo.followerCount = user.follower_count || 0;
                        authorInfo.videoCount = user.aweme_count || 0;
                        console.log('获取到用户信息:', authorInfo.nickname, '粉丝:', authorInfo.followerCount);
                    }
                }
            } catch (e) {
                console.log('用户信息API失败:', e.message);
            }
            
            // 方法2: 如果方法1失败，尝试从视频列表获取
            if (!authorInfo.nickname || authorInfo.nickname.startsWith('用户_')) {
                try {
                    const postApiUrl = `https://www.iesdouyin.com/web/api/v2/aweme/post/?sec_uid=${authorInfo.secUid}&count=5&max_cursor=0`;
                    console.log('请求视频列表API:', postApiUrl);
                    
                    const postResult = await makeRequest(postApiUrl);
                    if (postResult.data && postResult.data.length > 10) {
                        const postData = JSON.parse(postResult.data);
                        
                        if (postData.aweme_list && postData.aweme_list.length > 0) {
                            const firstVideo = postData.aweme_list[0];
                            if (firstVideo.author) {
                                authorInfo.uid = firstVideo.author.uid || authorInfo.uid;
                                authorInfo.nickname = firstVideo.author.nickname || authorInfo.nickname;
                                authorInfo.signature = firstVideo.author.signature || '';
                                authorInfo.avatar = firstVideo.author.avatar_thumb?.url_list?.[0] || '';
                                authorInfo.followerCount = firstVideo.author.follower_count || 0;
                                console.log('从视频获取用户信息:', authorInfo.nickname);
                            }
                        }
                    }
                } catch (e) {
                    console.log('视频列表API失败:', e.message);
                }
            }
        }
        
        // 如果还是没有昵称，提示用户链接可能有问题
        if (!authorInfo.nickname && authorInfo.secUid) {
            // 检查 secUid 长度，正常应该超过 40 个字符
            if (authorInfo.secUid.length < 40) {
                throw new Error(`链接不完整！sec_uid 太短 (${authorInfo.secUid.length} 字符)。请复制完整的作者主页链接。`);
            }
            authorInfo.nickname = '未知用户';
        }
        
        if (!authorInfo.secUid && !authorInfo.uid) {
            throw new Error('无法解析作者信息，请确保链接格式正确。支持的格式：\n1. https://www.douyin.com/user/xxxxx\n2. 抖音分享的用户主页链接');
        }
        
        return authorInfo;
        
    } catch (error) {
        console.error('解析作者主页失败:', error);
        throw error;
    }
}

/**
 * 获取作者的视频列表（使用 Puppeteer 浏览器自动化）
 */
async function getAuthorVideos(author, retryCount = 0) {
    console.log('获取作者视频列表:', author.nickname || author.uid);
    
    const secUid = author.secUid;
    if (!secUid) {
        console.log('缺少 secUid，无法获取视频列表');
        return [];
    }
    
    let page = null;
    let browser = null;
    
    try {
        // 复用现有浏览器实例，如果不存在则创建新的
        try {
            browser = await getBrowser();
        } catch (browserError) {
            console.log('浏览器获取失败，尝试关闭并重新创建...');
            await closeBrowser();
            await new Promise(r => setTimeout(r, 1000));
            browser = await getBrowser();
        }
        
        page = await browser.newPage();
        
        // Stealth 插件已处理大部分反检测，这里只添加额外的请求头
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8'
        });
        
        // 策略：先访问抖音首页建立会话，再跳转到用户页面
        const userUrl = `https://www.douyin.com/user/${secUid}`;
        
        // 第一步：先访问抖音首页
        console.log('第一步：访问抖音首页建立会话...');
        try {
            await page.goto('https://www.douyin.com/', { 
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });
            
            // 等待首页加载，模拟用户浏览
            const homeWait = 3000 + Math.random() * 4000;
            console.log(`首页加载中，等待 ${Math.round(homeWait/1000)} 秒...`);
            await new Promise(r => setTimeout(r, homeWait));
            
            // 模拟在首页的交互
            const viewport = page.viewport();
            if (viewport) {
                // 随机移动鼠标
                await page.mouse.move(
                    Math.floor(Math.random() * viewport.width * 0.5) + 100,
                    Math.floor(Math.random() * viewport.height * 0.3) + 100,
                    { steps: 10 }
                );
                await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
                
                // 滚动一下
                await page.evaluate(() => {
                    window.scrollBy({ top: 200 + Math.random() * 300, behavior: 'smooth' });
                });
                await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000));
            }
        } catch (e) {
            console.log('首页访问出现问题，继续尝试:', e.message);
        }
        
        // 第二步：跳转到用户主页
        console.log('第二步：跳转到用户主页:', userUrl);
        await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
        
        await page.goto(userUrl, { 
            waitUntil: 'domcontentloaded',
            timeout: 90000
        });
        
        // 模拟真实用户行为：随机等待
        const waitTime = 3000 + Math.random() * 3000;
        console.log(`等待页面加载 ${Math.round(waitTime/1000)} 秒...`);
        await new Promise(r => setTimeout(r, waitTime));
        
        // 模拟鼠标移动
        const viewport = page.viewport();
        if (viewport) {
            const x = Math.floor(Math.random() * viewport.width * 0.5) + viewport.width * 0.25;
            const y = Math.floor(Math.random() * viewport.height * 0.3) + 100;
            await page.mouse.move(x, y, { steps: 10 });
            await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
        }
        
        // 模拟真实用户滚动行为（增加滚动次数确保加载所有视频）
        console.log('模拟用户滚动浏览...');
        for (let i = 0; i < 6; i++) {
            // 随机滚动距离（增大滚动距离）
            const scrollDistance = 400 + Math.floor(Math.random() * 600);
            await page.evaluate((distance) => {
                window.scrollBy({ top: distance, behavior: 'smooth' });
            }, scrollDistance);
            
            // 随机等待（稍微增加等待时间确保内容加载）
            await new Promise(r => setTimeout(r, 1000 + Math.random() * 1500));
            
            // 偶尔移动鼠标
            if (Math.random() > 0.5) {
                const viewport = page.viewport();
                if (viewport) {
                    const x = Math.floor(Math.random() * viewport.width * 0.6) + viewport.width * 0.2;
                    const y = Math.floor(Math.random() * viewport.height * 0.5) + viewport.height * 0.25;
                    await page.mouse.move(x, y, { steps: 5 });
                }
            }
        }
        
        // 滚动回顶部
        await page.evaluate(() => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
        await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000));
        
        // 从页面中提取视频数据，只提取当前作者的视频
        const videos = await page.evaluate((authorSecUid) => {
            const results = [];
            
            // 方法1: 从 window.__RENDER_DATA__ 提取
            try {
                const renderDataScript = document.querySelector('script#RENDER_DATA');
                if (renderDataScript) {
                    const decoded = decodeURIComponent(renderDataScript.textContent);
                    const data = JSON.parse(decoded);
                    
                    // 递归查找视频列表
                    const findVideos = (obj, depth = 0) => {
                        if (!obj || typeof obj !== 'object' || depth > 15) return null;
                        
                        if (Array.isArray(obj.aweme_list) && obj.aweme_list.length > 0) return obj.aweme_list;
                        if (Array.isArray(obj.awemeList) && obj.awemeList.length > 0) return obj.awemeList;
                        if (obj.post?.data && Array.isArray(obj.post.data)) return obj.post.data;
                        
                        for (const key of Object.keys(obj)) {
                            const found = findVideos(obj[key], depth + 1);
                            if (found) return found;
                        }
                        return null;
                    };
                    
                    const videoList = findVideos(data);
                    if (videoList) {
                        // 只返回属于当前作者的视频
                        return videoList
                            .filter(item => {
                                // 验证视频作者的 sec_uid 与当前作者匹配
                                const videoAuthorSecUid = item.author?.sec_uid || item.author?.secUid || '';
                                return !authorSecUid || videoAuthorSecUid === authorSecUid || !videoAuthorSecUid;
                            })
                            .map(item => {
                                // 尝试多种方式获取标题
                                const title = item.desc || 
                                             item.title ||
                                             item.share_info?.share_title ||
                                             item.video?.title ||
                                             item.caption ||
                                             '';
                                return {
                                    videoId: item.aweme_id || item.awemeId || item.id || '',
                                    title: title,
                                    createTime: item.create_time || item.createTime || null,
                                    authorSecUid: item.author?.sec_uid || ''
                                };
                            });
                    }
                }
            } catch (e) {
                console.log('RENDER_DATA 解析失败:', e);
            }
            
            // 方法2: 从 DOM 中提取 - 只从作品列表区域提取
            try {
                // 优先从作品列表区域提取，避免推荐视频
                const postContainer = document.querySelector('[class*="post-list"]') ||
                                     document.querySelector('[class*="work-list"]') ||
                                     document.querySelector('[class*="user-post"]') ||
                                     document.querySelector('[data-e2e="user-post-list"]');
                
                const container = postContainer || document;
                const videoLinks = container.querySelectorAll('a[href*="/video/"]');
                const seen = new Set();
                
                videoLinks.forEach(link => {
                    const match = link.href.match(/\/video\/(\d+)/);
                    if (match && !seen.has(match[1])) {
                        seen.add(match[1]);
                        
                        // 尝试获取标题
                        const titleEl = link.querySelector('[class*="title"]') || 
                                       link.closest('[class*="item"]')?.querySelector('[class*="title"]');
                        
                        results.push({
                            videoId: match[1],
                            title: titleEl?.textContent?.trim() || '',
                            createTime: null
                        });
                    }
                });
            } catch (e) {
                console.log('DOM 提取失败:', e);
            }
            
            return results;
        }, secUid);
        
        if (videos && videos.length > 0) {
            console.log(`✅ 从浏览器获取到 ${videos.length} 个视频`);
            
            // 顺便提取头像到本地
            if (!author.localAvatar) {
                const localAvatar = await extractAvatarFromPage(page, secUid);
                if (localAvatar) {
                    // 更新作者的本地头像
                    const authors = getAuthors();
                    const idx = authors.findIndex(a => a.secUid === secUid);
                    if (idx >= 0) {
                        authors[idx].localAvatar = localAvatar;
                        saveAuthors(authors);
                    }
                }
            }
            
            return videos.map(v => ({
                videoId: v.videoId,
                title: v.title || '',
                createTime: v.createTime ? new Date(v.createTime * 1000).toISOString() : null,
                cover: '',
                playCount: 0,
                likeCount: 0,
                commentCount: 0,
                shareCount: 0,
                duration: 0,
                authorUid: author.uid || secUid,
                authorNickname: author.nickname
            })).filter(v => v.videoId);
        }
        
        // 视频获取失败，尝试再滚动一下重新获取
        console.log('⚠️ 未能获取视频，尝试再次滚动...');
        
        // 再次滚动尝试加载
        for (let i = 0; i < 3; i++) {
            await page.evaluate(() => {
                window.scrollBy({ top: 500, behavior: 'smooth' });
            });
            await new Promise(r => setTimeout(r, 1500));
        }
        
        // 再次尝试获取
        const retryVideos = await page.evaluate(() => {
            const results = [];
            const videoLinks = document.querySelectorAll('a[href*="/video/"]');
            const seen = new Set();
            
            videoLinks.forEach(link => {
                const match = link.href.match(/\/video\/(\d+)/);
                if (match && !seen.has(match[1])) {
                    seen.add(match[1]);
                    results.push({ videoId: match[1], title: '', createTime: null });
                }
            });
            
            return results;
        });
        
        if (retryVideos && retryVideos.length > 0) {
            console.log(`✅ 重试成功，获取到 ${retryVideos.length} 个视频`);
            return retryVideos.map(v => ({
                videoId: v.videoId,
                title: v.title || '',
                createTime: null,
                authorUid: author.uid || secUid,
                authorNickname: author.nickname
            }));
        }
        
        console.log('⚠️ 未能从页面获取到视频列表');
        return [];
        
    } catch (error) {
        console.error('获取作者视频列表失败:', error.message);
        
        // 如果是网络错误或浏览器错误，尝试重试（最多重试3次）
        const isRetryable = error.message.includes('timeout') || 
                           error.message.includes('browser') || 
                           error.message.includes('Target closed') || 
                           error.message.includes('detached') ||
                           error.message.includes('CONNECTION_CLOSED') ||
                           error.message.includes('net::ERR');
        
        if (retryCount < 3 && isRetryable) {
            // 随机延迟 10-20 秒后重试，避免被检测
            const delay = 10000 + Math.random() * 10000;
            console.log(`第 ${retryCount + 1} 次重试获取视频列表，等待 ${Math.round(delay/1000)} 秒...`);
            await closeBrowser();
            await new Promise(r => setTimeout(r, delay));
            return getAuthorVideos(author, retryCount + 1);
        }
        
        addLog('error', `获取视频列表失败: ${error.message}`, { secUid });
        return [];
    } finally {
        if (page) {
            try {
                await page.close();
            } catch (e) {}
        }
    }
}

/**
 * 添加作者
 * @param {string} authorUrl - 作者主页链接
 * @param {function} transcribeCallback - 转写回调函数（可选）
 */
async function addAuthor(authorUrl, transcribeCallback) {
    const authors = getAuthors();
    
    // 解析作者信息
    const authorInfo = await parseAuthorPage(authorUrl);
    
    // 检查是否已存在
    const existingIndex = authors.findIndex(a => 
        (a.secUid && a.secUid === authorInfo.secUid) ||
        (a.uid && a.uid === authorInfo.uid) ||
        (a.url === authorInfo.url)
    );
    
    if (existingIndex >= 0) {
        // 更新现有作者信息
        const updatedAuthor = {
            ...authors[existingIndex],
            ...authorInfo,
            addedAt: authors[existingIndex].addedAt // 保留原添加时间
        };
        
        // 下载头像到本地
        if (authorInfo.avatar) {
            const localAvatar = await downloadAvatar(authorInfo.avatar, authorInfo.secUid || authorInfo.uid);
            if (localAvatar) {
                updatedAuthor.localAvatar = localAvatar;
            }
        }
        
        authors[existingIndex] = updatedAuthor;
        saveAuthors(authors);
        addLog('update', `更新作者: ${authorInfo.nickname || authorInfo.uid}`);
        
        // 即使是更新作者，也获取视频列表并自动转写
        if (transcribeCallback) {
            console.log('更新作者后自动获取视频列表...');
            fetchAndTranscribeForAuthor(updatedAuthor, transcribeCallback);
        }
        
        return { success: true, message: '作者信息已更新', author: updatedAuthor, isNew: false };
    }
    
    // 下载头像到本地
    if (authorInfo.avatar) {
        const localAvatar = await downloadAvatar(authorInfo.avatar, authorInfo.secUid || authorInfo.uid);
        if (localAvatar) {
            authorInfo.localAvatar = localAvatar;
        }
    }
    
    // 添加新作者
    authors.push(authorInfo);
    saveAuthors(authors);
    
    addLog('add', `添加作者: ${authorInfo.nickname || authorInfo.uid}`, { authorId: authorInfo.uid });
    
    // 异步获取视频列表和转写（不阻塞API响应）
    if (transcribeCallback) {
        console.log('添加作者后异步获取视频列表...');
        fetchAndTranscribeForAuthor(authorInfo, transcribeCallback);
    }
    
    return { 
        success: true, 
        message: '作者添加成功，正在后台获取视频...', 
        author: authorInfo, 
        isNew: true, 
        videoCount: 0, // 视频将在后台获取
        autoTranscribeCount: 0
    };
}

/**
 * 获取作者视频并自动转写（用于新增或更新作者后）
 * @param {Object} authorInfo - 作者信息
 * @param {function} transcribeCallback - 转写回调函数
 */
async function fetchAndTranscribeForAuthor(authorInfo, transcribeCallback) {
    const authorName = authorInfo.nickname || authorInfo.uid || '未知作者';
    console.log(`开始获取作者 ${authorName} 的视频列表...`);
    
    // 异步执行，不阻塞返回
    addToQueue({
        name: `获取视频-${authorName}`,
        execute: async () => {
            // 更新任务状态：正在获取视频列表
            currentTask.isRunning = true;
            currentTask.type = 'fetch_videos';
            currentTask.message = `正在获取 ${authorName} 的视频列表...`;
            currentTask.currentAuthor = authorName;
            currentTask.progress = 10;
            
            try {
                const videos = await getAuthorVideos(authorInfo);
                let videosToTranscribe = [];
                
                if (videos.length > 0) {
                    const allVideos = getVideos();
                    const newVideos = videos.filter(v => !allVideos.some(av => av.videoId === v.videoId));
                    if (newVideos.length > 0) {
                        // 将新视频添加到开头，这样在列表中会显示在前面
                        allVideos.unshift(...newVideos);
                        saveVideos(allVideos);
                        addLog('videos', `获取到 ${newVideos.length} 个视频`, { authorId: authorInfo.uid });
                    }
                    
                    // 筛选7天内的视频，取前3个进行转写
                    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
                    const recentVideos = videos.filter(v => {
                        if (!v.createTime) return true;
                        const createTimestamp = new Date(v.createTime).getTime();
                        return createTimestamp >= sevenDaysAgo;
                    });
                    
                    // 取前3个
                    videosToTranscribe = recentVideos.slice(0, 3);
                    
                    console.log(`筛选出 ${videosToTranscribe.length} 个7天内的视频进行转写`);
                    addLog('auto_transcribe', `准备转写 ${videosToTranscribe.length} 个近期视频`, { 
                        authorId: authorInfo.uid,
                        videos: videosToTranscribe.map(v => v.videoId)
                    });
                    
                    // 更新任务状态：获取成功，准备转写
                    currentTask.message = `✅ 获取到 ${videos.length} 个视频，准备转写 ${videosToTranscribe.length} 个`;
                    currentTask.progress = 20;
                    currentTask.totalVideos = videosToTranscribe.length;
                    currentTask.completedVideos = 0;
                    
                    // 添加转写任务到队列
                    for (let i = 0; i < videosToTranscribe.length; i++) {
                        const video = videosToTranscribe[i];
                        const videoUrl = `https://www.douyin.com/video/${video.videoId}`;
                        const taskIndex = i + 1;
                        const totalTasks = videosToTranscribe.length;
                        
                        addToQueue({
                            name: `自动转写-${video.videoId}`,
                            execute: async () => {
                                console.log(`[${taskIndex}/${totalTasks}] 自动转写: ${video.videoId}`);
                                
                                currentTask.isRunning = true;
                                currentTask.type = 'auto_transcribe';
                                currentTask.message = `自动转写: ${video.title?.substring(0, 20) || video.videoId}`;
                                currentTask.currentVideo = video.title || video.videoId;
                                currentTask.progress = Math.round((taskIndex / totalTasks) * 100);
                                
                                try {
                                    // 传入视频信息，包含作者和标题
                                    const result = await transcribeCallback(videoUrl, video);
                                    if (result && result.success) {
                                        addLog('transcribe', `自动转写成功: ${video.title?.substring(0, 30) || video.videoId}`);
                                        console.log(`[${taskIndex}/${totalTasks}] ✅ 转写成功`);
                                    } else {
                                        addLog('error', `自动转写失败: ${video.videoId}`, { error: result?.error });
                                        console.log(`[${taskIndex}/${totalTasks}] ❌ 转写失败: ${result?.error}`);
                                    }
                                } catch (e) {
                                    console.error(`[${taskIndex}/${totalTasks}] 转写失败:`, e.message);
                                    addLog('error', `自动转写失败: ${video.videoId}`, { error: e.message });
                                }
                                
                                // 更新已完成数量
                                currentTask.completedVideos = taskIndex;
                                currentTask.message = `自动转写: ${taskIndex}/${totalTasks}`;
                                
                                if (taskIndex === totalTasks) {
                                    currentTask.isRunning = false;
                                    currentTask.progress = 100;
                                    currentTask.message = `✅ 自动转写完成，共 ${totalTasks} 个视频`;
                                    console.log(`✅ 自动转写完成，共 ${totalTasks} 个视频`);
                                }
                            }
                        });
                    }
                } else {
                    console.log('未获取到视频列表');
                    addLog('error', `获取 ${authorName} 的视频列表失败`);
                    // 更新任务状态为失败
                    currentTask.isRunning = false;
                    currentTask.progress = 0;
                    currentTask.message = `❌ 获取 ${authorName} 的视频列表失败`;
                }
            } catch (e) {
                console.error('获取视频列表失败:', e.message);
                addLog('error', `获取视频列表失败: ${e.message}`);
                // 更新任务状态为失败
                currentTask.isRunning = false;
                currentTask.progress = 0;
                currentTask.message = `❌ 获取视频失败: ${e.message.substring(0, 50)}`;
            }
        }
    });
}

/**
 * 删除作者
 */
function removeAuthor(authorId) {
    const authors = getAuthors();
    const index = authors.findIndex(a => a.uid === authorId || a.secUid === authorId);
    
    if (index === -1) {
        return { success: false, message: '作者不存在' };
    }
    
    const removed = authors.splice(index, 1)[0];
    saveAuthors(authors);
    
    addLog('remove', `删除作者: ${removed.nickname || removed.uid}`);
    
    return { success: true, message: '作者已删除', author: removed };
}

/**
 * 检查单个作者的更新
 */
async function checkAuthorUpdate(author, transcribeCallback) {
    console.log(`检查作者更新: ${author.nickname || author.uid}`);
    
    try {
        const videos = await getAuthorVideos(author);
        const allVideos = getVideos();
        
        // 找出新视频
        const newVideos = videos.filter(v => !allVideos.some(av => av.videoId === v.videoId));
        
        if (newVideos.length > 0) {
            console.log(`发现 ${newVideos.length} 个新视频`);
            addLog('new_videos', `${author.nickname || author.uid} 有 ${newVideos.length} 个新视频`, {
                authorId: author.uid,
                videos: newVideos.map(v => ({ id: v.videoId, title: v.title }))
            });
            
            // 为每个新视频提取文案
            for (const video of newVideos) {
                try {
                    // 构建视频链接
                    const videoUrl = `https://www.douyin.com/video/${video.videoId}`;
                    
                    // 调用转写回调（如果提供），传入视频信息
                    if (transcribeCallback) {
                        const result = await transcribeCallback(videoUrl, video);
                        if (result.success) {
                            video.transcript = result.data?.transcript || '';
                            addLog('transcribe', `转写成功: ${video.title.substring(0, 30)}...`);
                        }
                    }
                } catch (e) {
                    console.error('转写失败:', e.message);
                    addLog('error', `转写失败: ${video.title.substring(0, 30)}...`, { error: e.message });
                }
                
                // 添加到视频列表开头，这样新视频会显示在前面
                allVideos.unshift(video);
            }
            
            saveVideos(allVideos);
        }
        
        // 更新作者的最后检查时间
        const authors = getAuthors();
        const authorIndex = authors.findIndex(a => a.uid === author.uid || a.secUid === author.secUid);
        if (authorIndex >= 0) {
            authors[authorIndex].lastChecked = new Date().toISOString();
            saveAuthors(authors);
        }
        
        return {
            success: true,
            newVideosCount: newVideos.length,
            newVideos,
            totalVideos: videos.length
        };
        
    } catch (error) {
        console.error('检查更新失败:', error);
        addLog('error', `检查 ${author.nickname || author.uid} 更新失败`, { error: error.message });
        return { success: false, error: error.message };
    }
}

/**
 * 检查所有作者的更新
 */
// 当前任务状态
let currentTask = {
    isRunning: false,
    type: '', // 'check' | 'transcribe'
    progress: 0,
    message: '',
    currentAuthor: '',
    currentVideo: '',
    totalVideos: 0,
    completedVideos: 0,
    newVideos: []
};

function getTaskStatus() {
    return { ...currentTask };
}

async function checkAllUpdates(transcribeCallback) {
    const authors = getAuthors();
    console.log(`开始检查 ${authors.length} 个作者的更新...`);
    addLog('check_start', `开始检查 ${authors.length} 个作者的更新`);
    
    currentTask = {
        isRunning: true,
        type: 'check',
        progress: 0,
        message: `正在检查 ${authors.length} 个作者的更新...`,
        currentAuthor: '',
        currentVideo: '',
        totalVideos: 0,
        completedVideos: 0,
        newVideos: []
    };
    
    let totalNewVideos = 0;
    let allNewVideos = [];
    
    for (let i = 0; i < authors.length; i++) {
        const author = authors[i];
        console.log(`[${i + 1}/${authors.length}] 检查作者: ${author.nickname || author.uid || '未知'}`);
        
        currentTask.currentAuthor = author.nickname || author.uid || '未知';
        currentTask.message = `[${i + 1}/${authors.length}] 正在检查: ${currentTask.currentAuthor}`;
        currentTask.progress = Math.round((i / authors.length) * 30); // 检查阶段占 30%
        
        try {
            const result = await checkAuthorUpdate(author, null); // 检查时不立即转写
            const authorName = author.nickname || author.uid || '未知';
            if (result && result.success) {
                totalNewVideos += result.newVideosCount;
                if (result.newVideos) {
                    allNewVideos.push(...result.newVideos);
                }
                console.log(`[${i + 1}/${authors.length}] 发现 ${result.newVideosCount} 个新视频`);
                // 为每个作者添加检查结果日志
                if (result.newVideosCount > 0) {
                    addLog('new_video', `${authorName}: 发现 ${result.newVideosCount} 个新视频`);
                } else {
                    addLog('check_author', `${authorName}: 无新视频 (共 ${result.totalVideos || 0} 个视频)`);
                }
            } else {
                addLog('check_author', `${authorName}: 获取失败`);
            }
        } catch (e) {
            console.error(`[${i + 1}/${authors.length}] 检查作者更新失败:`, e.message);
            addLog('error', `检查 ${author.nickname || author.uid} 失败: ${e.message}`);
            // 出错时关闭浏览器，下次会自动重新创建
            await closeBrowser();
        }
        
        if (i < authors.length - 1) {
            // 随机延迟 3-6 秒（减少等待时间）
            const delay = 3000 + Math.random() * 3000;
            console.log(`等待 ${Math.round(delay/1000)} 秒后检查下一个作者...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    
    addLog('check_complete', `检查完成，共发现 ${totalNewVideos} 个新视频`);
    console.log(`✅ 检查完成，共发现 ${totalNewVideos} 个新视频`);
    
    // 如果有新视频且有转写回调，开始后台转写
    if (allNewVideos.length > 0 && transcribeCallback) {
        currentTask.type = 'transcribe';
        currentTask.message = `开始转写 ${allNewVideos.length} 个新视频...`;
        currentTask.totalVideos = allNewVideos.length;
        currentTask.completedVideos = 0;
        currentTask.newVideos = allNewVideos;
        
        // 后台转写（不阻塞返回）
        transcribeInBackground(allNewVideos, transcribeCallback);
    } else {
        currentTask.isRunning = false;
        currentTask.message = `完成！共发现 ${totalNewVideos} 个新视频`;
        currentTask.progress = 100;
    }
    
    return { totalNewVideos, newVideos: allNewVideos };
}

// 后台转写函数
async function transcribeInBackground(videos, transcribeCallback) {
    // 获取有效作者列表
    const authors = getAuthors();
    const validSecUids = new Set(authors.map(a => a.secUid).filter(Boolean));
    
    // 只转写属于已添加作者的视频
    const validVideos = videos.filter(v => {
        const authorUid = v.authorUid || v.authorSecUid || '';
        return validSecUids.has(authorUid);
    });
    
    if (validVideos.length === 0) {
        console.log('⚠️ 没有需要转写的有效视频');
        currentTask.isRunning = false;
        currentTask.message = '没有需要转写的视频';
        currentTask.progress = 100;
        return;
    }
    
    console.log(`开始后台转写 ${validVideos.length} 个视频（过滤掉 ${videos.length - validVideos.length} 个无关视频）...`);
    
    for (let i = 0; i < validVideos.length; i++) {
        const video = validVideos[i];
        const videoUrl = `https://www.douyin.com/video/${video.videoId}`;
        
        currentTask.currentVideo = video.title || video.videoId;
        currentTask.completedVideos = i;
        currentTask.progress = 30 + Math.round((i / validVideos.length) * 70);
        currentTask.message = `[${i + 1}/${validVideos.length}] 正在转写: ${currentTask.currentVideo.substring(0, 20)}...`;
        
        console.log(`[${i + 1}/${validVideos.length}] 转写视频: ${video.videoId} (作者: ${video.authorNickname || '未知'})`);
        
        try {
            // 转写使用 HTTP API，不需要浏览器，传入视频信息
            const result = await transcribeCallback(videoUrl, video);
            if (result && result.success) {
                addLog('transcribe', `转写成功: ${video.title?.substring(0, 30) || video.videoId}`);
                console.log(`[${i + 1}/${validVideos.length}] ✅ 转写成功`);
            } else {
                addLog('error', `转写失败: ${video.videoId}`, { error: result?.error });
                console.log(`[${i + 1}/${validVideos.length}] ❌ 转写失败: ${result?.error || '未知错误'}`);
            }
        } catch (e) {
            console.error(`[${i + 1}/${validVideos.length}] 转写失败:`, e.message);
            addLog('error', `转写失败: ${video.videoId}`, { error: e.message });
        }
        
        // 每个视频之间间隔 2 秒
        if (i < validVideos.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
    
    currentTask.isRunning = false;
    currentTask.completedVideos = validVideos.length;
    currentTask.progress = 100;
    currentTask.message = `✅ 完成！已转写 ${validVideos.length} 个视频`;
    console.log(`✅ 后台转写完成，共转写 ${validVideos.length} 个视频`);
}

/**
 * 启动定时监控
 */
function startMonitor(transcribeCallback) {
    if (monitorTimer) {
        console.log('监控已在运行');
        return;
    }
    
    console.log('启动作者监控，间隔: 6小时');
    addLog('monitor_start', '监控服务已启动');
    
    // 不再启动时自动检查，改为用户手动触发
    // setTimeout(() => {
    //     checkAllUpdates(transcribeCallback);
    // }, 5000);
    
    // 设置定时器（每6小时自动检查一次）
    monitorTimer = setInterval(() => {
        checkAllUpdates(transcribeCallback);
    }, MONITOR_INTERVAL);
}

/**
 * 关闭浏览器实例
 */
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

/**
 * 停止定时监控
 */
function stopMonitor() {
    if (monitorTimer) {
        clearInterval(monitorTimer);
        monitorTimer = null;
        addLog('monitor_stop', '监控服务已停止');
        console.log('监控已停止');
    }
}

/**
 * 获取监控状态
 */
function getMonitorStatus() {
    const authors = getAuthors();
    const videos = getVideos();
    const logs = getLogs(10);
    
    return {
        isRunning: !!monitorTimer,
        authorCount: authors.length,
        videoCount: videos.length,
        checkInterval: '6小时',
        recentLogs: logs
    };
}

/**
 * 获取作者的视频列表（已抓取的）
 */
function getAuthorVideoList(authorId) {
    const videos = getVideos();
    return videos.filter(v => v.authorUid === authorId);
}

/**
 * 获取视频详情（标题）
 */
async function getVideoDetail(videoId) {
    let page = null;
    try {
        const browser = await getBrowser();
        page = await browser.newPage();
        
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        });
        
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        const videoUrl = `https://www.douyin.com/video/${videoId}`;
        await page.goto(videoUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, 3000));
        
        const detail = await page.evaluate(() => {
            let title = '';
            
            // 从 RENDER_DATA 获取
            try {
                const script = document.querySelector('script#RENDER_DATA');
                if (script) {
                    const decoded = decodeURIComponent(script.textContent);
                    const data = JSON.parse(decoded);
                    
                    const findDesc = (obj, depth = 0) => {
                        if (!obj || typeof obj !== 'object' || depth > 10) return null;
                        if (obj.desc) return obj.desc;
                        if (obj.aweme?.detail?.desc) return obj.aweme.detail.desc;
                        for (const key of Object.keys(obj)) {
                            const found = findDesc(obj[key], depth + 1);
                            if (found) return found;
                        }
                        return null;
                    };
                    
                    title = findDesc(data) || '';
                }
            } catch (e) {}
            
            // 从页面元素获取
            if (!title) {
                const descEl = document.querySelector('[data-e2e="video-desc"]') ||
                              document.querySelector('[class*="video-info-detail"]') ||
                              document.querySelector('[class*="desc"]');
                title = descEl?.textContent?.trim() || '';
            }
            
            return { title };
        });
        
        return detail.title || '';
    } catch (e) {
        console.error('获取视频详情失败:', e.message);
        return '';
    } finally {
        if (page) {
            try { await page.close(); } catch (e) {}
        }
    }
}

/**
 * 更新视频标题
 */
async function updateVideoTitles(progressCallback) {
    const videos = getVideos();
    const videosWithoutTitle = videos.filter(v => !v.title);
    
    console.log(`需要更新标题的视频: ${videosWithoutTitle.length}`);
    
    let updated = 0;
    for (let i = 0; i < videosWithoutTitle.length; i++) {
        const video = videosWithoutTitle[i];
        
        if (progressCallback) {
            progressCallback(i + 1, videosWithoutTitle.length, video.videoId);
        }
        
        try {
            const title = await getVideoDetail(video.videoId);
            if (title) {
                video.title = title;
                updated++;
                console.log(`[${i + 1}/${videosWithoutTitle.length}] ✅ ${title.substring(0, 30)}...`);
            } else {
                console.log(`[${i + 1}/${videosWithoutTitle.length}] ⚠️ 未获取到标题`);
            }
        } catch (e) {
            console.error(`[${i + 1}/${videosWithoutTitle.length}] ❌ 失败:`, e.message);
        }
        
        // 每 10 个视频保存一次
        if ((i + 1) % 10 === 0) {
            saveVideos(videos);
        }
        
        // 间隔 1 秒
        await new Promise(r => setTimeout(r, 1000));
    }
    
    saveVideos(videos);
    await closeBrowser();
    
    return { total: videosWithoutTitle.length, updated };
}

/**
 * 下载所有作者的头像到本地
 */
async function downloadAllAvatars() {
    const authors = getAuthors();
    let downloaded = 0;
    
    for (const author of authors) {
        if (author.avatar && !author.localAvatar) {
            const localAvatar = await downloadAvatar(author.avatar, author.secUid || author.uid);
            if (localAvatar) {
                author.localAvatar = localAvatar;
                downloaded++;
            }
        }
    }
    
    if (downloaded > 0) {
        saveAuthors(authors);
        console.log(`✅ 已下载 ${downloaded} 个作者头像到本地`);
    }
    
    return downloaded;
}

module.exports = {
    getAuthors,
    addAuthor,
    removeAuthor,
    getVideos,
    getAuthorVideos,
    checkAuthorUpdate,
    checkAllUpdates,
    startMonitor,
    stopMonitor,
    getMonitorStatus,
    getAuthorVideoList,
    getLogs,
    closeBrowser,
    getTaskStatus,
    getVideoDetail,
    updateVideoTitles,
    addToQueue,
    // 登录相关
    openLoginBrowser,
    checkLoginStatus,
    // 文案相关
    getTranscripts,
    saveTranscript,
    deleteTranscript,
    clearTranscripts,
    exportTranscripts,
    // 头像相关
    downloadAllAvatars
};

