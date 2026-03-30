/**
 * 足球赛事数据 API 模块
 * 使用 API-Football 获取真实的球赛数据
 * 官网: https://www.api-football.com
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./runtime-paths');

// API 配置
const API_CONFIG = {
    // API-Football 配置（推荐）
    apiFootball: {
        baseUrl: 'https://v3.football.api-sports.io',
        apiKey: process.env.API_FOOTBALL_KEY || 'c6c02cd65c3e70dda98da6d50d24381c', // 已配置（正确）
        enabled: true // ✅ 已启用
    },
    
    // 极速数据配置（中文友好）
    jisuapi: {
        baseUrl: 'https://api.jisuapi.com',
        apiKey: process.env.JISU_API_KEY || '', // 需要注册获取
        enabled: false
    }
};

// 数据目录
const DATA_DIR = getDataDir();
const MATCHES_CACHE_FILE = path.join(DATA_DIR, 'matches_cache.json');

// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * 发送 HTTP 请求
 */
function makeRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
        https.get(url, options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error('解析响应失败: ' + e.message));
                }
            });
        }).on('error', reject);
    });
}

/**
 * 使用 API-Football 获取比赛数据
 * 文档: https://www.api-football.com/documentation-v3
 */
async function fetchMatchesFromAPIFootball(date = null) {
    if (!API_CONFIG.apiFootball.enabled || !API_CONFIG.apiFootball.apiKey) {
        throw new Error('API-Football 未配置或未启用');
    }
    
    // 默认获取今天和明天的比赛
    const today = date || new Date().toISOString().split('T')[0];
    const url = `${API_CONFIG.apiFootball.baseUrl}/fixtures?date=${today}`;
    
    const options = {
        headers: {
            'x-rapidapi-host': 'v3.football.api-sports.io',
            'x-rapidapi-key': API_CONFIG.apiFootball.apiKey
        }
    };
    
    console.log('正在从 API-Football 获取比赛数据...');
    const response = await makeRequest(url, options);
    
    if (!response.response) {
        throw new Error('API 返回数据格式错误');
    }
    
    // 转换为统一格式
    const matches = response.response.map(fixture => ({
        matchId: `af_${fixture.fixture.id}`,
        league: fixture.league.name,
        leagueCountry: fixture.league.country,
        leagueLogo: fixture.league.logo,
        homeTeam: fixture.teams.home.name,
        homeTeamLogo: fixture.teams.home.logo,
        awayTeam: fixture.teams.away.name,
        awayTeamLogo: fixture.teams.away.logo,
        matchTime: new Date(fixture.fixture.date),
        status: fixture.fixture.status.long,
        venue: fixture.fixture.venue?.name || '未知场地',
        round: fixture.league.round || '',
        // 比分（如果已开始）
        homeScore: fixture.goals.home,
        awayScore: fixture.goals.away,
        // 元数据
        source: 'api-football',
        fetchTime: new Date().toISOString()
    }));
    
    console.log(`✅ 获取到 ${matches.length} 场比赛`);
    return matches;
}

/**
 * 使用极速数据获取比赛数据（中文）
 */
async function fetchMatchesFromJisu(date = null) {
    if (!API_CONFIG.jisuapi.enabled || !API_CONFIG.jisuapi.apiKey) {
        throw new Error('极速数据 API 未配置或未启用');
    }
    
    // 极速数据的足球赛程接口
    const url = `${API_CONFIG.jisuapi.baseUrl}/football/match?appkey=${API_CONFIG.jisuapi.apiKey}`;
    
    console.log('正在从极速数据获取比赛数据...');
    const response = await makeRequest(url);
    
    if (response.status !== '0') {
        throw new Error(`API 错误: ${response.msg}`);
    }
    
    // 转换为统一格式
    const matches = response.result.map(match => ({
        matchId: `jisu_${match.matchid}`,
        league: match.league,
        leagueCountry: match.country || '国际',
        homeTeam: match.hometeam,
        awayTeam: match.guestteam,
        matchTime: new Date(match.matchtime),
        status: match.status,
        venue: match.address || '未知场地',
        round: match.round || '',
        homeScore: match.homescore,
        awayScore: match.guestscore,
        source: 'jisuapi',
        fetchTime: new Date().toISOString()
    }));
    
    console.log(`✅ 获取到 ${matches.length} 场比赛`);
    return matches;
}

/**
 * 获取指定联赛的比赛
 */
async function getLeagueMatches(leagueId, season = 2024) {
    if (!API_CONFIG.apiFootball.enabled) {
        throw new Error('API-Football 未启用');
    }
    
    const url = `${API_CONFIG.apiFootball.baseUrl}/fixtures?league=${leagueId}&season=${season}`;
    const options = {
        headers: {
            'x-rapidapi-host': 'v3.football.api-sports.io',
            'x-rapidapi-key': API_CONFIG.apiFootball.apiKey
        }
    };
    
    const response = await makeRequest(url, options);
    return response.response || [];
}

/**
 * 获取热门联赛的 ID
 * API-Football 联赛 ID 参考:
 * 39 - 英超 (Premier League)
 * 140 - 西甲 (La Liga)
 * 78 - 德甲 (Bundesliga)
 * 135 - 意甲 (Serie A)
 * 61 - 法甲 (Ligue 1)
 * 88 - 荷甲 (Eredivisie)
 * 94 - 葡超 (Primeira Liga)
 * 203 - 土超 (Süper Lig)
 * 94 - 中超 (Chinese Super League)
 */
const POPULAR_LEAGUES = {
    'premier-league': { id: 39, name: 'Premier League', nameZh: '英超', country: '英格兰' },
    'la-liga': { id: 140, name: 'La Liga', nameZh: '西甲', country: '西班牙' },
    'bundesliga': { id: 78, name: 'Bundesliga', nameZh: '德甲', country: '德国' },
    'serie-a': { id: 135, name: 'Serie A', nameZh: '意甲', country: '意大利' },
    'ligue-1': { id: 61, name: 'Ligue 1', nameZh: '法甲', country: '法国' },
    'champions-league': { id: 2, name: 'UEFA Champions League', nameZh: '欧冠', country: '欧洲' },
    'europa-league': { id: 3, name: 'UEFA Europa League', nameZh: '欧联', country: '欧洲' },
    'world-cup': { id: 1, name: 'World Cup', nameZh: '世界杯', country: '国际' },
    'chinese-super-league': { id: 94, name: 'Chinese Super League', nameZh: '中超', country: '中国' }
};

/**
 * 获取近期比赛（未来几天）
 * 免费账号：每天100次请求限制，获取今天和未来几天的比赛
 */
async function getUpcomingMatches(days = 3) {
    const matches = [];
    
    // 从今天开始获取
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // 获取最多 days 天的比赛
    for (let i = 0; i < days; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() + i);
        
        const dateStr = date.toISOString().split('T')[0];
        
        try {
            console.log(`正在获取 ${dateStr} 的比赛...`);
            const dayMatches = await fetchMatchesFromAPIFootball(dateStr);
            matches.push(...dayMatches);
            
            // API 限流，延迟一下
            await new Promise(r => setTimeout(r, 1000));
        } catch (e) {
            console.error(`获取 ${dateStr} 的比赛失败:`, e.message);
        }
    }
    
    return matches;
}

/**
 * 筛选热门联赛的比赛
 */
function filterPopularLeagues(matches) {
    const popularLeagueNames = Object.values(POPULAR_LEAGUES).map(l => l.name);
    return matches.filter(match => {
        return popularLeagueNames.some(name => match.league.includes(name));
    });
}

/**
 * 保存比赛到缓存
 */
function saveMatchesToCache(matches) {
    try {
        fs.writeFileSync(MATCHES_CACHE_FILE, JSON.stringify({
            lastUpdate: new Date().toISOString(),
            count: matches.length,
            matches: matches
        }, null, 2));
        console.log(`✅ 已保存 ${matches.length} 场比赛到缓存`);
    } catch (e) {
        console.error('保存缓存失败:', e.message);
    }
}

/**
 * 从缓存读取比赛
 */
function loadMatchesFromCache() {
    try {
        if (fs.existsSync(MATCHES_CACHE_FILE)) {
            const cache = JSON.parse(fs.readFileSync(MATCHES_CACHE_FILE, 'utf-8'));
            console.log(`从缓存读取 ${cache.count} 场比赛（更新于 ${cache.lastUpdate}）`);
            return cache.matches;
        }
    } catch (e) {
        console.error('读取缓存失败:', e.message);
    }
    return [];
}

/**
 * 更新比赛数据（每天更新一次）
 */
async function updateMatches() {
    try {
        console.log('开始更新比赛数据...');
        
        // 优先使用 API-Football
        let matches = [];
        if (API_CONFIG.apiFootball.enabled && API_CONFIG.apiFootball.apiKey) {
            matches = await getUpcomingMatches(7);
        } else if (API_CONFIG.jisuapi.enabled && API_CONFIG.jisuapi.apiKey) {
            matches = await fetchMatchesFromJisu();
        } else {
            console.warn('⚠️ 没有配置任何 API，使用缓存数据');
            return loadMatchesFromCache();
        }
        
        // 不再筛选，保存所有比赛，让前端来筛选
        console.log(`获取到 ${matches.length} 场比赛`);
        
        // 保存到缓存（所有比赛）
        saveMatchesToCache(matches);
        
        return matches;
    } catch (e) {
        console.error('更新比赛数据失败:', e.message);
        console.log('使用缓存数据');
        return loadMatchesFromCache();
    }
}

/**
 * 获取比赛列表（带缓存）
 */
async function getMatches(forceUpdate = false) {
    // 检查缓存是否过期（超过12小时）
    const cache = loadMatchesFromCache();
    if (!forceUpdate && cache.length > 0) {
        try {
            const cacheData = JSON.parse(fs.readFileSync(MATCHES_CACHE_FILE, 'utf-8'));
            const lastUpdate = new Date(cacheData.lastUpdate);
            const now = new Date();
            const hoursSinceUpdate = (now - lastUpdate) / (1000 * 60 * 60);
            
            if (hoursSinceUpdate < 12) {
                console.log(`使用缓存数据（${hoursSinceUpdate.toFixed(1)} 小时前更新）`);
                return cache;
            }
        } catch (e) {}
    }
    
    // 更新数据
    return await updateMatches();
}

/**
 * 获取指定日期的比赛结果（已完成的比赛）
 */
async function getMatchResults(date) {
    if (!API_CONFIG.apiFootball.enabled || !API_CONFIG.apiFootball.apiKey) {
        throw new Error('API-Football 未配置或未启用');
    }
    
    const dateStr = date || new Date().toISOString().split('T')[0];
    const url = `${API_CONFIG.apiFootball.baseUrl}/fixtures?date=${dateStr}&status=FT`; // FT = Full Time (已结束)
    
    const options = {
        headers: {
            'x-rapidapi-host': 'v3.football.api-sports.io',
            'x-rapidapi-key': API_CONFIG.apiFootball.apiKey
        }
    };
    
    console.log(`获取 ${dateStr} 的比赛结果...`);
    const response = await makeRequest(url, options);
    
    if (!response.response) {
        return [];
    }
    
    // 转换为简化格式
    return response.response.map(fixture => ({
        matchId: `af_${fixture.fixture.id}`,
        league: fixture.league.name,
        leagueCountry: fixture.league.country,
        homeTeam: fixture.teams.home.name,
        awayTeam: fixture.teams.away.name,
        homeScore: fixture.goals.home,
        awayScore: fixture.goals.away,
        matchTime: fixture.fixture.date,
        status: 'finished',
        // 判断胜负
        winner: fixture.goals.home > fixture.goals.away ? 'home' : 
                fixture.goals.away > fixture.goals.home ? 'away' : 'draw'
    }));
}

/**
 * 获取最近几天的比赛结果
 */
async function getRecentResults(days = 3) {
    const results = [];
    const today = new Date();
    
    for (let i = 1; i <= days; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        
        try {
            const dayResults = await getMatchResults(dateStr);
            results.push(...dayResults);
            console.log(`  ${dateStr}: ${dayResults.length} 场已完成`);
        } catch (e) {
            console.error(`获取 ${dateStr} 结果失败:`, e.message);
        }
        
        // 避免请求过快
        await new Promise(r => setTimeout(r, 500));
    }
    
    return results;
}

// 导出
module.exports = {
    getMatches,
    updateMatches,
    getLeagueMatches,
    fetchMatchesFromAPIFootball,
    fetchMatchesFromJisu,
    getMatchResults,
    getRecentResults,
    POPULAR_LEAGUES,
    API_CONFIG
};
