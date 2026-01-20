/**
 * 球赛预测模块
 * 功能：
 * 1. 豆包联网搜索最近有亚洲盘口的球赛
 * 2. 筛选关于特定比赛的文案
 * 3. 分析博主倾向并统计
 * 4. 记录预测准确率
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// 数据文件路径
const DATA_DIR = path.join(__dirname, 'data');
const MATCHES_FILE = path.join(DATA_DIR, 'matches.json');           // 比赛信息
const PREDICTIONS_FILE = path.join(DATA_DIR, 'predictions.json');   // 预测记录
const ACCURACY_FILE = path.join(DATA_DIR, 'accuracy.json');         // 准确率统计

// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 豆包配置（从主配置读取）
let DOUBAO_CONFIG = null;

function setDoubaoConfig(config) {
    DOUBAO_CONFIG = config;
}

// ==================== 数据读写函数 ====================

function getMatches() {
    try {
        if (fs.existsSync(MATCHES_FILE)) {
            return JSON.parse(fs.readFileSync(MATCHES_FILE, 'utf-8'));
        }
    } catch (e) {
        console.error('读取比赛列表失败:', e);
    }
    return [];
}

function saveMatches(matches) {
    fs.writeFileSync(MATCHES_FILE, JSON.stringify(matches, null, 2), 'utf-8');
}

function getPredictions() {
    try {
        if (fs.existsSync(PREDICTIONS_FILE)) {
            return JSON.parse(fs.readFileSync(PREDICTIONS_FILE, 'utf-8'));
        }
    } catch (e) {
        console.error('读取预测记录失败:', e);
    }
    return [];
}

function savePredictions(predictions) {
    fs.writeFileSync(PREDICTIONS_FILE, JSON.stringify(predictions, null, 2), 'utf-8');
}

function getAccuracy() {
    try {
        if (fs.existsSync(ACCURACY_FILE)) {
            return JSON.parse(fs.readFileSync(ACCURACY_FILE, 'utf-8'));
        }
    } catch (e) {
        console.error('读取准确率统计失败:', e);
    }
    return {
        authors: {},      // 各自媒体的准确率 { authorId: { wins, total, disabled } }
        doubao: { wins: 0, total: 0 },   // 豆包的准确率
        user: { wins: 0, total: 0 }      // 用户的准确率
    };
}

function saveAccuracy(accuracy) {
    fs.writeFileSync(ACCURACY_FILE, JSON.stringify(accuracy, null, 2), 'utf-8');
}

// ==================== 豆包 API 调用 ====================

/**
 * 调用豆包 API（支持联网搜索）
 */
async function callDoubaoAPI(prompt, useWebSearch = false) {
    if (!DOUBAO_CONFIG || !DOUBAO_CONFIG.apiKey) {
        return { success: false, error: '豆包配置未设置' };
    }
    
    const messages = [
        { role: 'user', content: prompt }
    ];
    
    // 如果需要联网搜索，使用不同的模型或添加特殊参数
    const requestData = JSON.stringify({
        model: DOUBAO_CONFIG.modelId,
        messages: messages,
        temperature: 0.3,
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
            'Connection': 'close'
        }
    };
    
    return new Promise((resolve) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    if (res.statusCode !== 200) {
                        resolve({ success: false, error: `API 错误: ${res.statusCode}` });
                        return;
                    }
                    const response = JSON.parse(data);
                    if (response.choices && response.choices[0] && response.choices[0].message) {
                        resolve({ success: true, content: response.choices[0].message.content });
                    } else {
                        resolve({ success: false, error: '响应格式异常' });
                    }
                } catch (e) {
                    resolve({ success: false, error: '解析响应失败' });
                }
            });
        });
        
        req.on('error', (e) => {
            resolve({ success: false, error: e.message });
        });
        
        req.setTimeout(120000, () => {
            req.destroy();
            resolve({ success: false, error: '请求超时（120秒）' });
        });
        
        req.write(requestData);
        req.end();
    });
}

// ==================== 比赛相关功能 ====================

/**
 * 搜索最近的足球比赛（亚洲盘口）
 */
async function searchUpcomingMatches() {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const dateStr = `${tomorrow.getFullYear()}年${tomorrow.getMonth() + 1}月${tomorrow.getDate()}日`;
    
    const prompt = `请搜索${dateStr}前后的足球比赛信息，特别是有亚洲盘口的热门比赛。
请按以下JSON格式返回（只返回JSON，不要其他内容）：
[
  {
    "matchId": "唯一标识（联赛+日期+主队vs客队）",
    "league": "联赛名称",
    "matchTime": "比赛时间（格式：YYYY-MM-DD HH:mm）",
    "homeTeam": "主队名称",
    "awayTeam": "客队名称",
    "handicap": "亚洲盘口（如：主队让0.5球）",
    "odds": {
      "home": "主队赔率",
      "away": "客队赔率"
    }
  }
]

请列出5-10场热门比赛，包括英超、西甲、德甲、意甲、法甲、欧冠等主要联赛。`;

    console.log('搜索最近的足球比赛...');
    const result = await callDoubaoAPI(prompt, true);
    
    if (!result.success) {
        return { success: false, error: result.error };
    }
    
    try {
        // 尝试从响应中提取 JSON
        let content = result.content;
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            const matches = JSON.parse(jsonMatch[0]);
            
            // 保存比赛信息
            const existingMatches = getMatches();
            for (const match of matches) {
                const existIndex = existingMatches.findIndex(m => m.matchId === match.matchId);
                if (existIndex >= 0) {
                    existingMatches[existIndex] = { ...existingMatches[existIndex], ...match };
                } else {
                    match.createdAt = new Date().toISOString();
                    match.status = 'upcoming'; // upcoming, finished
                    match.result = null; // 比赛结果
                    existingMatches.unshift(match);
                }
            }
            saveMatches(existingMatches);
            
            return { success: true, matches };
        } else {
            return { success: false, error: '无法解析比赛信息', raw: content };
        }
    } catch (e) {
        return { success: false, error: '解析比赛信息失败: ' + e.message, raw: result.content };
    }
}

/**
 * 手动添加比赛
 */
function addMatch(matchData) {
    const matches = getMatches();
    
    const match = {
        matchId: matchData.matchId || `${matchData.league}_${matchData.matchTime}_${matchData.homeTeam}vs${matchData.awayTeam}`,
        league: matchData.league || '',
        matchTime: matchData.matchTime || '',
        homeTeam: matchData.homeTeam || '',
        awayTeam: matchData.awayTeam || '',
        handicap: matchData.handicap || '',
        odds: matchData.odds || {},
        createdAt: new Date().toISOString(),
        status: 'upcoming',
        result: null
    };
    
    matches.unshift(match);
    saveMatches(matches);
    
    return { success: true, match };
}

/**
 * 更新比赛结果
 */
function updateMatchResult(matchId, result) {
    const matches = getMatches();
    const matchIndex = matches.findIndex(m => m.matchId === matchId);
    
    if (matchIndex < 0) {
        return { success: false, error: '比赛不存在' };
    }
    
    matches[matchIndex].status = 'finished';
    matches[matchIndex].result = result; // { winner: 'home'|'away'|'draw', score: '2-1' }
    matches[matchIndex].finishedAt = new Date().toISOString();
    
    saveMatches(matches);
    
    // 更新准确率
    updateAccuracyAfterResult(matchId, result);
    
    return { success: true, match: matches[matchIndex] };
}

// ==================== 文案筛选和分析 ====================

/**
 * 筛选关于特定比赛的文案
 */
async function filterTranscriptsForMatch(matchId, transcripts) {
    const matches = getMatches();
    const match = matches.find(m => m.matchId === matchId);
    
    if (!match) {
        return { success: false, error: '比赛不存在' };
    }
    
    const prompt = `以下是一些足球相关的视频文案，请判断哪些是关于这场比赛的预测：
比赛信息：${match.homeTeam} vs ${match.awayTeam}（${match.league}，${match.matchTime}）

文案列表：
${transcripts.map((t, i) => `[${i}] 作者: ${t.author || '未知'}\n内容: ${t.transcript?.substring(0, 300) || '无内容'}`).join('\n\n')}

请返回JSON格式（只返回JSON）：
{
  "relatedIndexes": [相关文案的索引数组],
  "reason": "筛选理由"
}`;

    const result = await callDoubaoAPI(prompt);
    
    if (!result.success) {
        return { success: false, error: result.error };
    }
    
    try {
        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            const relatedTranscripts = parsed.relatedIndexes.map(i => transcripts[i]).filter(Boolean);
            return { success: true, transcripts: relatedTranscripts, reason: parsed.reason };
        }
    } catch (e) {
        return { success: false, error: '解析失败: ' + e.message };
    }
    
    return { success: false, error: '无法解析筛选结果' };
}

/**
 * 豆包独立预测比赛结果（不参考博主意见）
 */
async function getDoubaoPrediction(matchId) {
    const matches = getMatches();
    const match = matches.find(m => m.matchId === matchId);
    
    if (!match) {
        return { success: false, error: '比赛不存在' };
    }
    
    const prompt = `你是一个专业的足球分析师，请根据你的专业知识独立分析这场比赛。

比赛信息：
- 联赛：${match.league}
- 主队：${match.homeTeam}
- 客队：${match.awayTeam}
- 比赛时间：${match.matchTime}
- 亚洲盘口：${match.handicap || '未知'}

请基于以下因素进行分析：
1. 两队近期状态和战绩
2. 历史交锋记录
3. 主客场优势
4. 关键球员情况
5. 盘口分析

请返回JSON格式（只返回JSON，不要其他文字）：
{
  "prediction": "home" 或 "away" 或 "draw",
  "confidence": "high" 或 "medium" 或 "low",
  "reason": "详细的分析理由（100字以内）",
  "score": "预测比分如2-1"
}`;

    // 如果已有预测结果，直接返回
    if (match.doubaoPrediction) {
        console.log('返回已有的豆包预测:', match.homeTeam, 'vs', match.awayTeam);
        return { success: true, prediction: match.doubaoPrediction, match };
    }
    
    console.log('豆包独立预测比赛:', match.homeTeam, 'vs', match.awayTeam);
    const result = await callDoubaoAPI(prompt);
    
    if (!result.success) {
        return { success: false, error: result.error };
    }
    
    try {
        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const prediction = JSON.parse(jsonMatch[0]);
            
            // 保存预测结果到比赛数据
            const allMatches = getMatches();
            const matchIndex = allMatches.findIndex(m => m.matchId === matchId);
            if (matchIndex >= 0) {
                allMatches[matchIndex].doubaoPrediction = prediction;
                allMatches[matchIndex].predictionTime = new Date().toISOString();
                saveMatches(allMatches);
                console.log('✅ 预测结果已保存');
            }
            
            return { success: true, prediction, match: allMatches[matchIndex] || match };
        }
    } catch (e) {
        return { success: false, error: '解析失败: ' + e.message, raw: result.content };
    }
    
    return { success: false, error: '无法解析预测结果' };
}

/**
 * 分析博主预测倾向
 */
async function analyzePredictions(matchId, transcripts) {
    const matches = getMatches();
    const match = matches.find(m => m.matchId === matchId);
    
    if (!match) {
        return { success: false, error: '比赛不存在' };
    }
    
    const prompt = `请分析以下足球预测文案，判断每个博主认为哪支球队会赢。

比赛信息：${match.homeTeam}(主) vs ${match.awayTeam}(客)
盘口：${match.handicap || '未知'}

文案列表：
${transcripts.map((t, i) => `[${i}] 作者: ${t.author || '未知'} (ID: ${t.authorSecUid || t.authorId || i})
内容: ${t.transcript?.substring(0, 500) || '无内容'}`).join('\n\n---\n\n')}

请仔细分析每个文案的预测倾向，返回JSON格式（只返回JSON）：
{
  "predictions": [
    {
      "index": 0,
      "author": "作者名",
      "authorId": "作者ID",
      "prediction": "home" | "away" | "draw" | "unclear",
      "confidence": "high" | "medium" | "low",
      "reason": "判断理由"
    }
  ],
  "summary": {
    "homeWin": 0,
    "awayWin": 0,
    "draw": 0,
    "unclear": 0
  }
}`;

    console.log('分析博主预测倾向...');
    const result = await callDoubaoAPI(prompt);
    
    if (!result.success) {
        return { success: false, error: result.error };
    }
    
    try {
        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const analysis = JSON.parse(jsonMatch[0]);
            return { success: true, analysis, match };
        }
    } catch (e) {
        return { success: false, error: '解析失败: ' + e.message, raw: result.content };
    }
    
    return { success: false, error: '无法解析分析结果' };
}

/**
 * 保存预测记录
 */
function savePredictionRecord(matchId, analysisResult, userPrediction = null) {
    const predictions = getPredictions();
    const matches = getMatches();
    const match = matches.find(m => m.matchId === matchId);
    
    if (!match) {
        return { success: false, error: '比赛不存在' };
    }
    
    const record = {
        id: Date.now().toString(),
        matchId,
        match: {
            league: match.league,
            homeTeam: match.homeTeam,
            awayTeam: match.awayTeam,
            matchTime: match.matchTime,
            handicap: match.handicap
        },
        createdAt: new Date().toISOString(),
        authorPredictions: analysisResult.predictions || [],
        summary: analysisResult.summary || {},
        doubaoPrediction: analysisResult.doubaoPrediction || null,
        userPrediction: userPrediction, // 'home' | 'away' | 'draw'
        result: null // 比赛结果后填写
    };
    
    predictions.unshift(record);
    savePredictions(predictions);
    
    return { success: true, record };
}

/**
 * 更新用户预测
 */
function updateUserPrediction(predictionId, userPrediction) {
    const predictions = getPredictions();
    const index = predictions.findIndex(p => p.id === predictionId);
    
    if (index < 0) {
        return { success: false, error: '预测记录不存在' };
    }
    
    predictions[index].userPrediction = userPrediction;
    savePredictions(predictions);
    
    return { success: true, record: predictions[index] };
}

// ==================== 准确率统计 ====================

/**
 * 比赛结果出来后更新准确率
 */
function updateAccuracyAfterResult(matchId, result) {
    const predictions = getPredictions();
    const accuracy = getAccuracy();
    
    // 找到这场比赛的所有预测记录
    const matchPredictions = predictions.filter(p => p.matchId === matchId && !p.result);
    
    for (const pred of matchPredictions) {
        pred.result = result;
        
        // 更新各博主准确率
        for (const authorPred of pred.authorPredictions) {
            if (authorPred.prediction === 'unclear') continue;
            
            const authorId = authorPred.authorId || authorPred.author;
            if (!accuracy.authors[authorId]) {
                accuracy.authors[authorId] = { 
                    name: authorPred.author,
                    wins: 0, 
                    total: 0, 
                    disabled: false 
                };
            }
            
            accuracy.authors[authorId].total++;
            if (authorPred.prediction === result.winner) {
                accuracy.authors[authorId].wins++;
            }
        }
        
        // 更新豆包准确率
        if (pred.doubaoPrediction && pred.doubaoPrediction.prediction) {
            accuracy.doubao.total++;
            if (pred.doubaoPrediction.prediction === result.winner) {
                accuracy.doubao.wins++;
            }
        }
        
        // 更新用户准确率
        if (pred.userPrediction) {
            accuracy.user.total++;
            if (pred.userPrediction === result.winner) {
                accuracy.user.wins++;
            }
        }
    }
    
    savePredictions(predictions);
    saveAccuracy(accuracy);
    
    return { success: true };
}

/**
 * 禁用/启用自媒体
 */
function toggleAuthorDisabled(authorId, disabled) {
    const accuracy = getAccuracy();
    
    if (!accuracy.authors[authorId]) {
        return { success: false, error: '自媒体不存在' };
    }
    
    accuracy.authors[authorId].disabled = disabled;
    saveAccuracy(accuracy);
    
    return { success: true, author: accuracy.authors[authorId] };
}

/**
 * 计算总体胜率预测（排除禁用的自媒体）
 */
function calculateOverallPrediction(predictionId) {
    const predictions = getPredictions();
    const accuracy = getAccuracy();
    const pred = predictions.find(p => p.id === predictionId);
    
    if (!pred) {
        return { success: false, error: '预测记录不存在' };
    }
    
    let homeVotes = 0;
    let awayVotes = 0;
    let drawVotes = 0;
    let totalWeight = 0;
    
    for (const authorPred of pred.authorPredictions) {
        if (authorPred.prediction === 'unclear') continue;
        
        const authorId = authorPred.authorId || authorPred.author;
        const authorAccuracy = accuracy.authors[authorId];
        
        // 跳过禁用的自媒体
        if (authorAccuracy && authorAccuracy.disabled) continue;
        
        // 权重：根据历史准确率
        let weight = 1;
        if (authorAccuracy && authorAccuracy.total >= 3) {
            weight = authorAccuracy.wins / authorAccuracy.total + 0.5; // 0.5-1.5
        }
        
        if (authorPred.prediction === 'home') homeVotes += weight;
        else if (authorPred.prediction === 'away') awayVotes += weight;
        else if (authorPred.prediction === 'draw') drawVotes += weight;
        
        totalWeight += weight;
    }
    
    const total = homeVotes + awayVotes + drawVotes;
    
    return {
        success: true,
        prediction: {
            homePercent: total > 0 ? Math.round((homeVotes / total) * 100) : 0,
            awayPercent: total > 0 ? Math.round((awayVotes / total) * 100) : 0,
            drawPercent: total > 0 ? Math.round((drawVotes / total) * 100) : 0,
            recommended: homeVotes >= awayVotes && homeVotes >= drawVotes ? 'home' :
                         awayVotes >= homeVotes && awayVotes >= drawVotes ? 'away' : 'draw',
            totalVoters: pred.authorPredictions.filter(p => p.prediction !== 'unclear').length,
            activeVoters: pred.authorPredictions.filter(p => {
                if (p.prediction === 'unclear') return false;
                const aid = p.authorId || p.author;
                const acc = accuracy.authors[aid];
                return !acc || !acc.disabled;
            }).length
        }
    };
}

/**
 * 保存用户对比赛的预测到比赛数据
 */
function saveUserMatchPrediction(matchId, prediction) {
    const matches = getMatches();
    const matchIndex = matches.findIndex(m => m.matchId === matchId);
    
    if (matchIndex < 0) {
        return { success: false, error: '比赛不存在' };
    }
    
    matches[matchIndex].userPrediction = prediction;
    matches[matchIndex].userPredictionTime = new Date().toISOString();
    saveMatches(matches);
    
    return { success: true, match: matches[matchIndex] };
}

// ==================== 导出模块 ====================

module.exports = {
    setDoubaoConfig,
    // 比赛相关
    getMatches,
    searchUpcomingMatches,
    addMatch,
    updateMatchResult,
    // 预测相关
    getPredictions,
    filterTranscriptsForMatch,
    analyzePredictions,
    getDoubaoPrediction,
    savePredictionRecord,
    updateUserPrediction,
    saveUserMatchPrediction,
    // 准确率相关
    getAccuracy,
    toggleAuthorDisabled,
    calculateOverallPrediction
};
