/**
 * 聚合数据足球联赛 API
 * 文档: https://www.juhe.cn/docs/api/id/90
 * 直接返回中文球队名
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./runtime-paths');

// API 配置（双 key 备用，主 key 限额时自动切换）
const API_KEYS = [
    'a15b2c29d1159641dcf9235df3aa4779',  // 主账号
    '982bf57170971c3b293b1e889750293d'   // 备用账号
];
let currentKeyIndex = 0;
const API_BASE = 'http://apis.juhe.cn/fapig/football/query';

function getApiKey() {
    return API_KEYS[currentKeyIndex];
}

function switchToBackupKey() {
    if (currentKeyIndex < API_KEYS.length - 1) {
        currentKeyIndex++;
        console.log(`⚠️ 主 API 限额，切换到备用 key ${currentKeyIndex + 1}`);
        return true;
    }
    return false;
}

// 缓存文件
const CACHE_FILE = path.join(getDataDir(), 'juhe_matches_cache.json');

// 支持的联赛类型（5个联赛，每次更新消耗5次请求）
// 注意：聚合数据免费版不支持欧冠/欧联
const LEAGUE_TYPES = {
    'yingchao': { name: '英超', nameEn: 'Premier League' },
    'xijia': { name: '西甲', nameEn: 'La Liga' },
    'dejia': { name: '德甲', nameEn: 'Bundesliga' },
    'yijia': { name: '意甲', nameEn: 'Serie A' },
    'fajia': { name: '法甲', nameEn: 'Ligue 1' }
};

/**
 * 发送 HTTP 请求
 */
function makeRequest(url) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        
        protocol.get(url, (res) => {
            // 设置 UTF-8 编码，避免中文乱码
            res.setEncoding('utf8');
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error('JSON解析失败: ' + e.message));
                }
            });
        }).on('error', reject);
    });
}

/**
 * 获取单个联赛的赛程
 */
async function getLeagueSchedule(leagueType) {
    const url = `${API_BASE}?key=${getApiKey()}&type=${leagueType}`;
    
    try {
        const response = await makeRequest(url);
        
        // 检查是否限额，尝试切换备用 key
        if (response.error_code === 10012 || response.reason?.includes('超过')) {
            console.warn(`⚠️ API 限额: ${response.reason}`);
            if (switchToBackupKey()) {
                // 用备用 key 重试
                return await getLeagueSchedule(leagueType);
            }
            return [];
        }
        
        if (response.error_code !== 0) {
            console.error(`获取${LEAGUE_TYPES[leagueType]?.name || leagueType}失败:`, response.reason);
            return [];
        }
        
        const result = response.result;
        const matches = [];
        
        // 解析比赛数据
        for (const dayData of (result.matchs || [])) {
            const date = dayData.date;
            
            for (const match of (dayData.list || [])) {
                matches.push({
                    matchId: `juhe_${leagueType}_${date}_${match.team1}_${match.team2}`.replace(/\s+/g, '_'),
                    league: LEAGUE_TYPES[leagueType]?.name || result.title,
                    leagueType: leagueType,
                    leagueCountry: getLeagueCountry(leagueType),
                    date: date,
                    time: match.time_start,
                    matchTime: `${date} ${match.time_start}`,
                    homeTeam: match.team1,
                    awayTeam: match.team2,
                    homeScore: match.team1_score !== '-' ? parseInt(match.team1_score) : null,
                    awayScore: match.team2_score !== '-' ? parseInt(match.team2_score) : null,
                    homeLogo: match.team1_logo,
                    awayLogo: match.team2_logo,
                    status: getMatchStatus(match.status),
                    statusText: match.status_text,
                    round: match.match_stage,
                    source: 'juhe'
                });
            }
        }
        
        return matches;
    } catch (e) {
        console.error(`获取${leagueType}赛程失败:`, e.message);
        return [];
    }
}

/**
 * 获取联赛所属国家
 */
function getLeagueCountry(leagueType) {
    const countries = {
        'yingchao': '英格兰',
        'xijia': '西班牙',
        'dejia': '德国',
        'yijia': '意大利',
        'fajia': '法国',
        'ouguan': '欧洲',
        'oulian': '欧洲',
        'zhongchao': '中国'
    };
    return countries[leagueType] || '未知';
}

/**
 * 获取比赛状态
 */
function getMatchStatus(status) {
    const statusMap = {
        '1': 'upcoming',   // 未开赛
        '2': 'live',       // 进行中
        '3': 'finished'    // 完赛
    };
    return statusMap[status] || 'unknown';
}

/**
 * 获取所有热门联赛的赛程
 */
async function getAllLeaguesSchedule(leagueTypes = null) {
    const types = leagueTypes || Object.keys(LEAGUE_TYPES);
    const allMatches = [];
    
    console.log(`📅 开始获取 ${types.length} 个联赛的赛程...`);
    
    for (const type of types) {
        console.log(`  获取 ${LEAGUE_TYPES[type]?.name || type}...`);
        const matches = await getLeagueSchedule(type);
        allMatches.push(...matches);
        
        // API 限流
        await new Promise(r => setTimeout(r, 500));
    }
    
    console.log(`✅ 共获取 ${allMatches.length} 场比赛`);
    return allMatches;
}

/**
 * 获取五大联赛赛程
 */
async function getTopLeaguesSchedule() {
    return getAllLeaguesSchedule(['yingchao', 'xijia', 'dejia', 'yijia', 'fajia']);
}

/**
 * 获取欧战赛程
 */
async function getEuropeanCupsSchedule() {
    return getAllLeaguesSchedule(['ouguan', 'oulian']);
}

/**
 * 保存到缓存
 */
function saveToCache(matches) {
    try {
        const cacheData = {
            lastUpdate: new Date().toISOString(),
            count: matches.length,
            matches: matches
        };
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cacheData, null, 2));
        console.log(`💾 已缓存 ${matches.length} 场比赛`);
    } catch (e) {
        console.error('保存缓存失败:', e.message);
    }
}

/**
 * 从缓存读取
 */
function loadFromCache() {
    try {
        if (fs.existsSync(CACHE_FILE)) {
            const cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
            return cache;
        }
    } catch (e) {
        console.error('读取缓存失败:', e.message);
    }
    return null;
}

/**
 * 获取比赛（带缓存，6小时过期）
 */
async function getMatches(forceUpdate = false) {
    // 检查缓存
    if (!forceUpdate) {
        const cache = loadFromCache();
        if (cache) {
            const lastUpdate = new Date(cache.lastUpdate);
            const hoursSinceUpdate = (Date.now() - lastUpdate.getTime()) / (1000 * 60 * 60);
            
            if (hoursSinceUpdate < 6) {
                console.log(`📦 使用缓存数据 (${hoursSinceUpdate.toFixed(1)} 小时前更新)`);
                return cache.matches;
            }
        }
    }
    
    // 获取新数据
    console.log('🔄 从聚合数据 API 获取最新赛程...');
    const matches = await getAllLeaguesSchedule();
    
    if (matches.length > 0) {
        saveToCache(matches);
    }
    
    return matches;
}

/**
 * 更新比赛数据
 */
async function updateMatches() {
    return getMatches(true);
}

/**
 * 获取已完成的比赛（用于同步结果）
 */
async function getFinishedMatches() {
    const matches = await getMatches();
    return matches.filter(m => m.status === 'finished');
}

/**
 * 获取即将进行的比赛
 */
async function getUpcomingMatches() {
    const matches = await getMatches();
    return matches.filter(m => m.status === 'upcoming');
}

// 导出
module.exports = {
    getLeagueSchedule,
    getAllLeaguesSchedule,
    getTopLeaguesSchedule,
    getEuropeanCupsSchedule,
    getMatches,
    updateMatches,
    getFinishedMatches,
    getUpcomingMatches,
    loadFromCache,
    saveToCache,
    LEAGUE_TYPES,
    getApiKey
};
