/**
 * 极速数据足球赛事 API
 * 文档: https://www.jisuapi.com/api/football/
 * 支持五大联赛 + 欧冠，直接返回中文球队名
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./runtime-paths');

// API 配置
const API_KEY = 'c3bac79872266dd5';
const API_BASE = 'https://api.jisuapi.com/football/query';

// 缓存文件
const CACHE_FILE = path.join(getDataDir(), 'jisu_matches_cache.json');

// 支持的联赛（6个联赛，每次更新消耗6次请求）
const LEAGUE_TYPES = {
    'yingchao': { name: '英超', matchname: '英超' },
    'xijia': { name: '西甲', matchname: '西甲' },
    'dejia': { name: '德甲', matchname: '德甲' },
    'yijia': { name: '意甲', matchname: '意甲' },
    'fajia': { name: '法甲', matchname: '法甲' },
    'ouguan': { name: '欧冠', matchname: '欧冠' }
};

// 额外支持的联赛（可选）
const EXTRA_LEAGUES = {
    'oulian': { name: '欧联杯', matchname: '欧联杯' },
    'zhongchao': { name: '中超', matchname: '中超' },
    'yaguan': { name: '亚冠', matchname: '亚冠' }
};

/**
 * 发送 HTTPS 请求
 */
function makeRequest(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { timeout: 15000 }, (res) => {
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
        }).on('error', reject).on('timeout', () => {
            reject(new Error('请求超时'));
        });
    });
}

/**
 * 获取单个联赛的赛程
 * @param {string} matchname - 联赛名称（中文）
 * @param {string} date - 日期（可选，格式：2026-01-20）
 */
async function getLeagueSchedule(matchname, date = null) {
    let url = `${API_BASE}?appkey=${API_KEY}&matchname=${encodeURIComponent(matchname)}`;
    if (date) {
        url += `&date=${date}`;
    }
    
    try {
        const response = await makeRequest(url);
        
        if (response.status !== 0) {
            console.error(`获取${matchname}失败:`, response.msg);
            return [];
        }
        
        const list = response.result?.list || [];
        const matches = [];
        
        for (const match of list) {
            // 确定比赛状态
            let status = 'upcoming';
            if (match.status === '已结束') {
                status = 'finished';
            } else if (match.status === '进行中') {
                status = 'live';
            }
            
            // 解析比分（极速数据中 left_team 是主队，显示在左边）
            const homeScore = match.score_left !== undefined && match.score_left !== '' 
                ? parseInt(match.score_left) : null;
            const awayScore = match.score_right !== undefined && match.score_right !== ''
                ? parseInt(match.score_right) : null;
            
            matches.push({
                matchId: `jisu_${matchname}_${match.start_date}_${match.left_team}_${match.right_team}`.replace(/\s+/g, '_'),
                league: matchname,
                leagueType: getLeagueType(matchname),
                leagueCountry: getLeagueCountry(matchname),
                date: match.start_date,
                time: match.start_time,
                matchTime: `${match.start_date} ${match.start_time}`,
                homeTeam: match.left_team,   // left_team 是主队（显示在左边）
                awayTeam: match.right_team,  // right_team 是客队（显示在右边）
                homeScore: homeScore,
                awayScore: awayScore,
                status: status,
                statusText: match.status,
                updatetime: match.updatetime || response.result?.updatetime,
                source: 'jisu'
            });
        }
        
        return matches;
    } catch (e) {
        console.error(`获取${matchname}赛程失败:`, e.message);
        return [];
    }
}

/**
 * 获取联赛类型代码
 */
function getLeagueType(matchname) {
    for (const [type, info] of Object.entries({...LEAGUE_TYPES, ...EXTRA_LEAGUES})) {
        if (info.matchname === matchname || info.name === matchname) {
            return type;
        }
    }
    return 'unknown';
}

/**
 * 获取联赛所属国家/地区
 */
function getLeagueCountry(matchname) {
    const countries = {
        '英超': '英格兰',
        '西甲': '西班牙',
        '德甲': '德国',
        '意甲': '意大利',
        '法甲': '法国',
        '欧冠': '欧洲',
        '欧联杯': '欧洲',
        '中超': '中国',
        '亚冠': '亚洲'
    };
    return countries[matchname] || '未知';
}

/**
 * 获取所有热门联赛的赛程（五大联赛 + 欧冠）
 */
async function getAllLeaguesSchedule(leagueTypes = null) {
    const types = leagueTypes || Object.keys(LEAGUE_TYPES);
    const allMatches = [];
    
    console.log(`📅 开始获取 ${types.length} 个联赛的赛程...`);
    
    for (const type of types) {
        const leagueInfo = LEAGUE_TYPES[type] || EXTRA_LEAGUES[type];
        if (!leagueInfo) continue;
        
        console.log(`  获取 ${leagueInfo.name}...`);
        const matches = await getLeagueSchedule(leagueInfo.matchname);
        allMatches.push(...matches);
        
        // API 限流：每个请求间隔 300ms
        await new Promise(r => setTimeout(r, 300));
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
 * 获取欧战赛程（欧冠 + 欧联）
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
        
        // 确保 data 目录存在
        const dataDir = path.dirname(CACHE_FILE);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cacheData, null, 2), 'utf-8');
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
 * 获取比赛（带缓存，24小时过期）
 */
async function getMatches(forceUpdate = false) {
    // 检查缓存
    if (!forceUpdate) {
        const cache = loadFromCache();
        if (cache) {
            const lastUpdate = new Date(cache.lastUpdate);
            const hoursSinceUpdate = (Date.now() - lastUpdate.getTime()) / (1000 * 60 * 60);
            
            if (hoursSinceUpdate < 24) {
                console.log(`📦 使用缓存数据 (${hoursSinceUpdate.toFixed(1)} 小时前更新)`);
                return cache.matches;
            }
        }
    }
    
    // 获取新数据
    console.log('🔄 从极速数据 API 获取最新赛程...');
    const matches = await getAllLeaguesSchedule();
    
    if (matches.length > 0) {
        saveToCache(matches);
    }
    
    return matches;
}

/**
 * 强制更新比赛数据
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

/**
 * 获取最近的比赛结果（用于同步到预测记录）
 * @param {number} days - 获取最近几天的结果
 */
async function getRecentResults(days = 3) {
    const matches = await getMatches(true); // 强制刷新获取最新数据
    
    const now = new Date();
    const cutoffDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    
    return matches.filter(m => {
        if (m.status !== 'finished') return false;
        
        // 解析比赛日期
        const matchDate = new Date(m.date || m.matchTime?.split(' ')[0]);
        return matchDate >= cutoffDate;
    }).map(m => ({
        matchId: m.matchId,
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        homeScore: m.homeScore,
        awayScore: m.awayScore,
        league: m.league,
        date: m.date,
        winner: m.homeScore > m.awayScore ? 'home' : 
                m.awayScore > m.homeScore ? 'away' : 'draw'
    }));
}

/**
 * 获取 API Key（供外部调用）
 */
function getApiKey() {
    return API_KEY;
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
    getRecentResults,
    loadFromCache,
    saveToCache,
    LEAGUE_TYPES,
    EXTRA_LEAGUES,
    getApiKey
};
