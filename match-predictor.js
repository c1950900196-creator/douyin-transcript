/**
 * 球赛预测模块
 * 功能：
 * 1. 使用真实足球 API 获取比赛数据
 * 2. 筛选关于特定比赛的文案
 * 3. 分析博主倾向并统计
 * 4. 记录预测准确率
 */

const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./runtime-paths');
const https = require('https');
const footballAPI = require('./jisu-football-api'); // 极速数据 API (中文球队名，支持欧冠)

// 数据文件路径
const DATA_DIR = getDataDir();
const MATCHES_FILE = path.join(DATA_DIR, 'matches.json');           // 比赛信息
const PREDICTIONS_FILE = path.join(DATA_DIR, 'predictions.json');   // 预测记录
const ACCURACY_FILE = path.join(DATA_DIR, 'accuracy.json');         // 准确率统计
const TRANSCRIPTS_FILE = path.join(DATA_DIR, 'transcripts.json');   // 文案记录

// 标准球队名字典（必须和极速数据 API 返回的名称完全一致）
const STANDARD_TEAM_NAMES = {
    '英超': [
        '曼彻斯特城','曼彻斯特联','利物浦','阿森纳','切尔西','托特纳姆热刺',
        '纽卡斯尔联','阿斯顿维拉','西汉姆联','布莱顿','狼队','水晶宫',
        '富勒姆','伯恩茅斯','布伦特福德','诺丁汉森林','埃弗顿','莱斯特城',
        '伯恩利','南安普顿','伊普斯维奇','利兹联','桑德兰'
    ],
    '西甲': [
        '巴塞罗那','皇家马德里','马德里竞技','皇家社会','比利亚雷亚尔',
        '皇家贝蒂斯','赫罗纳','塞维利亚','瓦伦西亚','毕尔巴鄂竞技',
        '赫塔菲','塞尔塔','奥萨苏纳','皇家马略卡','阿拉维斯',
        '拉斯帕尔马斯','莱加内斯','巴拉多利德','西班牙人','巴列卡诺',
        '莱万特','埃尔切','皇家奥维耶多'
    ],
    '德甲': [
        '拜仁慕尼黑','多特蒙德','RB莱比锡','勒沃库森','法兰克福',
        '门兴格拉德巴赫','沃尔夫斯堡','弗赖堡','斯图加特','柏林联合',
        '美因茨','奥格斯堡','云达不莱梅','海登海姆','科隆',
        '波鸿','霍芬海姆','圣保利','荷尔施泰因基尔','汉堡','柏林赫塔','达姆施塔特'
    ],
    '意甲': [
        '国际米兰','AC米兰','尤文图斯','那不勒斯','罗马','拉齐奥',
        '亚特兰大','佛罗伦萨','博洛尼亚','都灵','维罗纳','乌迪内斯',
        '恩波利','卡利亚里','热那亚','蒙扎','帕尔马','科莫',
        '威尼斯','莱切','萨索洛','克雷莫纳','比萨'
    ],
    '法甲': [
        '巴黎圣日耳曼','马赛','里昂','摩纳哥','尼斯','里尔',
        '朗斯','雷恩','斯特拉斯堡','南特','蒙彼利埃','图卢兹',
        '布雷斯特','兰斯','勒阿弗尔','欧塞尔','圣埃蒂安','昂热',
        '洛里昂','梅斯','巴黎FC'
    ],
    '欧冠': [
        '布鲁日','卡拉巴克','奥林匹亚科斯','博德闪耀','埃因霍温',
        '加拉塔萨雷','本菲卡','圣吉罗斯','帕福斯FC','布拉格斯拉维亚',
        '阿贾克斯','哥本哈根','阿拉木图凯拉特','葡萄牙体育',
        '比利亚雷亚尔','毕尔巴鄂竞技','马德里竞技'
    ],
    '欧联杯': [
        '中日德兰','乌德勒支','亨克','凯尔特人','前进之鹰','博洛尼亚',
        '卢多格雷茨','塞萨洛尼基','巴塞尔','布兰','布加勒斯特星','布拉加',
        '帕纳辛纳科斯','年轻人','格拉斯哥流浪者','格拉茨风暴','比尔森胜利',
        '波尔图','特拉维夫马卡比','萨尔茨堡红牛','萨格勒布迪纳摩',
        '贝尔格莱德红星','费伦茨瓦罗斯','费内巴切','费耶诺德','马尔默'
    ],
    '欧协联': [
        '华沙莱吉亚','布拉格斯巴达','维也纳快速','顿涅茨克矿工',
        '雅典AEK','阿尔克马尔','阿伯丁','基辅迪纳摩','波兹南莱赫','舒尔本'
    ],
    '中超': [
        '上海海港','上海申花','北京国安','天津津门虎','山东泰山','成都蓉城',
        '武汉三镇','浙江俱乐部绿城','深圳新鹏城','长春亚泰','青岛海牛',
        '青岛西海岸','大连英博海发','河南队','梅州客家','云南玉昆'
    ],
    '亚冠': [
        '利雅得新月','吉达阿赫利','伊蒂哈德','广岛三箭','神户胜利船',
        '町田泽维亚','蔚山HD','首尔FC','江原FC','武里南联',
        '墨尔本城','杜海勒','萨德','巴格达警察','大不里士拖拉机'
    ],
    '日职联': [
        'FC东京','东京绿茵','京都不死鸟','名古屋鲸八','大阪樱花','大阪钢巴',
        '川崎前锋','广岛三箭','横滨水手','横滨FC','浦和红钻','鹿岛鹿角',
        '柏太阳神','神户胜利船','町田泽维亚','福冈黄蜂','新潟天鹅','清水心跳'
    ],
    '韩K联': [
        '全北现代','蔚山HD','首尔FC','仁川联队','大邱FC','大田市民',
        '浦项制铁','济州联队','江原FC','光州FC','水原城','尚州尚武'
    ],
    '澳超': [
        '墨尔本城','墨尔本胜利','悉尼FC','西悉尼流浪者','布里斯班狮吼',
        '阿德莱德联','珀斯光荣','纽卡斯尔喷气机','惠灵顿凤凰','奥克兰FC',
        '中央海岸水手','麦克阿瑟FC'
    ],
    '美职业': [
        '迈阿密国际','洛杉矶银河','洛杉矶FC','纽约城','纽约红牛',
        '西雅图海湾人','亚特兰大联','费城联合','辛辛那提FC','哥伦布机员',
        '多伦多FC','温哥华白浪','波特兰伐木工','芝加哥火焰','达拉斯FC',
        '休斯敦迪纳摩','奥兰多城','夏洛特FC','明尼苏达联','圣何塞地震',
        '皇家盐湖城','科罗拉多急流','纳什维尔SC','蒙特利尔CF'
    ],
    '沙特联': [
        '利雅得新月','吉达阿赫利','利雅得胜利','伊蒂哈德','利雅得青年',
        '达马克','阿尔费萨里','吉达联合','阿尔沙巴布','阿尔拉伊德'
    ],
    '德国杯': [
        '拜仁慕尼黑','RB莱比锡','勒沃库森','斯图加特','弗赖堡',
        '圣保利','柏林赫塔','柏林联合','汉堡','波鸿','达姆施塔特','荷尔斯泰因'
    ],
    '世南美预': [
        '阿根廷','巴西','乌拉圭','哥伦比亚','厄瓜多尔','智利',
        '巴拉圭','秘鲁','委内瑞拉','玻利维亚'
    ],
    '世亚预': ['伊拉克','阿联酋'],
    '欧国联': ['葡萄牙','西班牙']
};

// 常见别名 → 标准名 映射（解决2字缩写无法模糊匹配的问题）
const TEAM_ALIASES = {
    // 英超
    '曼城': '曼彻斯特城', '曼联': '曼彻斯特联', '热刺': '托特纳姆热刺',
    '纽卡': '纽卡斯尔联', '维拉': '阿斯顿维拉', '西汉': '西汉姆联', '西汉姆': '西汉姆联',
    '布莱': '布莱顿', '诺森': '诺丁汉森林', '诺丁汉': '诺丁汉森林',
    '莱斯特': '莱斯特城', '伊普': '伊普斯维奇', '南安': '南安普顿',
    // 西甲
    '巴萨': '巴塞罗那', '皇马': '皇家马德里', '马竞': '马德里竞技',
    '皇社': '皇家社会', '黄潜': '比利亚雷亚尔', '比利亚雷尔': '比利亚雷亚尔',
    '贝蒂斯': '皇家贝蒂斯', '马洛卡': '皇家马略卡', '马略卡': '皇家马略卡',
    '赫塔费': '赫塔菲', '毕巴': '毕尔巴鄂竞技', '毕尔巴鄂': '毕尔巴鄂竞技',
    // 德甲
    '拜仁': '拜仁慕尼黑', '大黄蜂': '多特蒙德', '莱比锡': 'RB莱比锡',
    '药厂': '勒沃库森', '门兴': '门兴格拉德巴赫', '狼堡': '沃尔夫斯堡',
    '不莱梅': '云达不莱梅', '赫塔': '柏林赫塔',
    // 意甲
    '国米': '国际米兰', '米兰': 'AC米兰', 'AC': 'AC米兰',
    '尤文': '尤文图斯', '那不': '那不勒斯', '佛罗': '佛罗伦萨',
    '紫百合': '佛罗伦萨', '亚特': '亚特兰大', '博洛': '博洛尼亚',
    // 法甲
    '巴黎': '巴黎圣日耳曼', '大巴黎': '巴黎圣日耳曼', 'PSG': '巴黎圣日耳曼',
    // 欧战
    '加拉塔': '加拉塔萨雷', '奥林匹亚克斯': '奥林匹亚科斯',
    '里斯本竞技': '葡萄牙体育', '费耶诺': '费耶诺德',
    // 中超
    '海港': '上海海港', '申花': '上海申花', '国安': '北京国安',
    '泰山': '山东泰山', '蓉城': '成都蓉城', '三镇': '武汉三镇',
    '绿城': '浙江俱乐部绿城', '亚泰': '长春亚泰', '鹏城': '深圳新鹏城',
    '津门虎': '天津津门虎',
    // 亚冠/沙特
    '新月': '利雅得新月', '阿赫利': '吉达阿赫利',
    // 日职联
    '川崎': '川崎前锋', '浦和': '浦和红钻', '鹿岛': '鹿岛鹿角',
    // 韩K联
    '全北': '全北现代', '蔚山': '蔚山HD',
    // 澳超
    '悉尼': '悉尼FC',
    // 美职
    '迈阿密': '迈阿密国际',
    // 国家队
    '国足': '中国', '日本队': '日本', '韩国队': '韩国'
};

/**
 * 生成标准球队名列表（用于注入豆包 prompt）
 */
function getStandardTeamNamesPrompt() {
    let text = '';
    for (const [league, teams] of Object.entries(STANDARD_TEAM_NAMES)) {
        text += `${league}：${teams.join('、')}\n`;
    }
    return text;
}

/**
 * 将球队名标准化为数据库中的名称
 * AI 输出别名时自动映射回标准名
 */
function normalizeTeamName(name) {
    if (!name) return name;
    const trimmed = name.trim();
    
    // 1. 检查是否已经是标准名
    for (const teams of Object.values(STANDARD_TEAM_NAMES)) {
        if (teams.includes(trimmed)) return trimmed;
    }
    
    // 2. 查别名字典（解决"曼城"→"曼彻斯特城"等短缩写）
    if (TEAM_ALIASES[trimmed]) return TEAM_ALIASES[trimmed];
    
    // 3. 用 fuzzyMatch 找对应的标准名
    for (const teams of Object.values(STANDARD_TEAM_NAMES)) {
        for (const stdName of teams) {
            if (fuzzyMatch(trimmed, stdName)) return stdName;
        }
    }
    
    // 4. 别名字典的模糊匹配（处理"曼城队"→"曼城"→"曼彻斯特城"等变体）
    // 限制：输入长度最多比别名多1个字符，防止"布莱代合作"匹配"布莱"
    for (const [alias, stdName] of Object.entries(TEAM_ALIASES)) {
        if (trimmed.includes(alias) && trimmed.length <= alias.length + 1) {
            return stdName;
        }
        if (alias.includes(trimmed) && alias.length <= trimmed.length + 1) {
            return stdName;
        }
    }
    
    return trimmed;
}

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
    writeJsonAtomic(MATCHES_FILE, matches);
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
    writeJsonAtomic(PREDICTIONS_FILE, predictions);
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
    writeJsonAtomic(ACCURACY_FILE, accuracy);
}

function getTranscripts() {
    try {
        if (fs.existsSync(TRANSCRIPTS_FILE)) {
            return JSON.parse(fs.readFileSync(TRANSCRIPTS_FILE, 'utf-8'));
        }
    } catch (e) {
        console.error('读取文案失败:', e);
    }
    return [];
}

function writeJsonAtomic(filePath, data) {
    const tmpFile = `${filePath}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpFile, filePath);
}

function commitJsonFilesWithRollback(writes) {
    const backups = writes.map(w => {
        const existed = fs.existsSync(w.path);
        return {
            path: w.path,
            existed,
            content: existed ? fs.readFileSync(w.path, 'utf-8') : null
        };
    });

    try {
        for (const w of writes) {
            writeJsonAtomic(w.path, w.data);
        }
    } catch (e) {
        for (const backup of backups) {
            try {
                if (backup.existed) fs.writeFileSync(backup.path, backup.content, 'utf-8');
                else if (fs.existsSync(backup.path)) fs.unlinkSync(backup.path);
            } catch (_) {}
        }
        throw e;
    }
}

function findMatchForPrediction(pred, matches) {
    let match = matches.find(m => m.matchId === pred.matchId);
    if (match) return match;
    const homeTeam = pred.match?.homeTeam;
    const awayTeam = pred.match?.awayTeam;
    if (!homeTeam || !awayTeam) return null;
    match = matches.find(m =>
        (m.homeTeam === homeTeam && m.awayTeam === awayTeam) ||
        (m.homeTeam === awayTeam && m.awayTeam === homeTeam)
    );
    return match || null;
}

function extractWinner(matchResult) {
    if (!matchResult) return null;
    const hasScore = matchResult.homeScore !== null && matchResult.homeScore !== undefined &&
                     matchResult.awayScore !== null && matchResult.awayScore !== undefined;
    if (hasScore) {
        if (matchResult.homeScore > matchResult.awayScore) return 'home';
        if (matchResult.homeScore < matchResult.awayScore) return 'away';
        return 'draw';
    }
    if (matchResult.winner) return matchResult.winner;
    return null;
}

function recalculateAccuracyFromPredictions(predictions, matches, prevAccuracy = null) {
    const previous = prevAccuracy || getAccuracy();
    const accuracy = { authors: {}, doubao: { wins: 0, total: 0 }, user: { wins: 0, total: 0 } };

    for (const pred of predictions) {
        const match = findMatchForPrediction(pred, matches);
        const winner = extractWinner(match?.result || pred.result);
        if (!winner) continue;

        for (const ap of (pred.authorPredictions || [])) {
            if (ap.prediction === 'unclear') continue;
            const authorId = ap.authorId || ap.author;
            if (!authorId) continue;
            if (!accuracy.authors[authorId]) {
                accuracy.authors[authorId] = {
                    wins: 0,
                    total: 0,
                    disabled: previous.authors?.[authorId]?.disabled || false
                };
            }
            accuracy.authors[authorId].total++;
            if (ap.prediction === winner) accuracy.authors[authorId].wins++;
        }

        if (pred.doubaoPrediction?.prediction && pred.doubaoPrediction.prediction !== 'unclear') {
            accuracy.doubao.total++;
            if (pred.doubaoPrediction.prediction === winner) accuracy.doubao.wins++;
        }
        if (pred.userPrediction && pred.userPrediction !== 'unclear') {
            accuracy.user.total++;
            if (pred.userPrediction === winner) accuracy.user.wins++;
        }
    }

    return accuracy;
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
 * 搜索最近的足球比赛（使用极速数据 API，中文球队名，支持欧冠）
 * 优化：不传日期参数获取默认数据 + 未来3天按日期获取 + 更新已完赛但无结果的比赛
 */
async function searchUpcomingMatches() {
    try {
        console.log('正在从极速数据 API 获取比赛数据（中文）...');
        
        // 1. 获取默认数据（当前轮次）
        let apiMatches = await footballAPI.getMatches(true);
        
        if (!apiMatches || apiMatches.length === 0) {
            apiMatches = [];
        }
        console.log(`📋 默认数据: ${apiMatches.length} 场`);
        
        // 2. 获取未来3天的赛程
        const existingIds = new Set(apiMatches.map(m => m.matchId));
        for (let dayOffset = 0; dayOffset <= 3; dayOffset++) {
            const d = new Date();
            d.setDate(d.getDate() + dayOffset);
            const dateStr = d.toISOString().split('T')[0];
            
            try {
                console.log(`  📅 获取 ${dateStr} 赛程...`);
                const dayMatches = await footballAPI.getMatchesByDate(dateStr);
                let added = 0;
                for (const m of dayMatches) {
                    if (!existingIds.has(m.matchId)) {
                        apiMatches.push(m);
                        existingIds.add(m.matchId);
                        added++;
                    }
                }
                if (added > 0) console.log(`    +${added} 场新赛事`);
            } catch (e) {
                console.error(`    获取 ${dateStr} 失败:`, e.message);
            }
        }
        
        // 3. 查找已过比赛时间但无结果的比赛，按日期去 API 补结果
        const currentDbMatches = getMatches();
        const now = new Date();
        const pendingDates = new Set();
        
        for (const m of currentDbMatches) {
            if (m.result && m.result.homeScore !== null && m.result.homeScore !== undefined) continue;
            if (!m.matchTime) continue;
            
            const matchDate = new Date(m.matchTime.replace(' ', 'T'));
            if (isNaN(matchDate.getTime())) continue;
            
            // 比赛时间已过2小时以上（确保已踢完），且在最近7天内
            const hoursPassed = (now - matchDate) / (1000 * 60 * 60);
            if (hoursPassed > 2 && hoursPassed < 7 * 24) {
                const dateKey = m.matchTime.split(' ')[0];
                if (!existingIds.has('_fetched_' + dateKey)) {
                    pendingDates.add(dateKey);
                }
            }
        }
        
        if (pendingDates.size > 0) {
            console.log(`🔍 有 ${pendingDates.size} 个日期需要补充比赛结果: ${[...pendingDates].join(', ')}`);
            for (const dateStr of pendingDates) {
                try {
                    const resultMatches = await footballAPI.getMatchesByDate(dateStr);
                    for (const m of resultMatches) {
                        if (!existingIds.has(m.matchId)) {
                            apiMatches.push(m);
                            existingIds.add(m.matchId);
                        } else {
                            // 已存在但可能没结果，用API数据覆盖
                            const idx = apiMatches.findIndex(am => am.matchId === m.matchId);
                            if (idx >= 0 && m.homeScore !== null && m.homeScore !== undefined) {
                                apiMatches[idx] = m;
                            }
                        }
                    }
                } catch (e) {
                    console.error(`  补充 ${dateStr} 结果失败:`, e.message);
                }
            }
        }
        
        if (apiMatches.length === 0) {
            console.log('⚠️ API 未返回比赛数据');
            return { success: false, error: '无比赛数据' };
        }
        
        console.log(`✅ 共获取到 ${apiMatches.length} 场比赛`);
        
        // 转换为内部格式并智能合并
        const existingMatches = getMatches();
        let newCount = 0;
        let updatedCount = 0;
        
        for (const match of apiMatches) {
            // 处理时间格式
            let matchTime = match.matchTime;
            if (matchTime && !matchTime.includes('T')) {
                matchTime = matchTime;
            } else if (matchTime) {
                matchTime = new Date(matchTime).toISOString().slice(0, 16).replace('T', ' ');
            }
            
            // API 返回的比分
            const apiHasScore = match.homeScore !== null && match.homeScore !== undefined;
            const apiResult = apiHasScore ? {
                homeScore: match.homeScore,
                awayScore: match.awayScore
            } : null;
            
            // 检查是否已存在
            const existIndex = existingMatches.findIndex(m => m.matchId === match.matchId);
            
            if (existIndex >= 0) {
                // 已存在的比赛：智能更新
                const existing = existingMatches[existIndex];
                
                // 更新状态
                if (match.status) {
                    existing.status = match.status;
                }
                if (match.statusText) {
                    existing.statusText = match.statusText;
                }
                
                // 只在以下情况更新比分：
                // 1. 旧数据没有比分，新数据有比分
                // 2. 新数据有比分（可能是更新的比分）
                const existingHasScore = existing.result && 
                    existing.result.homeScore !== null && 
                    existing.result.homeScore !== undefined;
                
                if (apiHasScore && (!existingHasScore || 
                    existing.result.homeScore !== apiResult.homeScore ||
                    existing.result.awayScore !== apiResult.awayScore)) {
                    existing.result = apiResult;
                    console.log(`  📊 更新比分: ${existing.homeTeam} ${apiResult.homeScore}:${apiResult.awayScore} ${existing.awayTeam}`);
                    updatedCount++;
                }
                
                // 更新其他非关键字段
                existing.leagueCountry = match.leagueCountry || existing.leagueCountry || '';
                existing.round = match.round || existing.round || '';
                
            } else {
                // 新比赛：添加
                const formattedMatch = {
                    matchId: match.matchId,
                    league: match.league,
                    leagueCountry: match.leagueCountry || '',
                    matchTime: matchTime,
                    homeTeam: match.homeTeam,
                    awayTeam: match.awayTeam,
                    homeLogo: match.homeLogo || null,
                    awayLogo: match.awayLogo || null,
                    handicap: null,
                    odds: null,
                    createdAt: new Date().toISOString(),
                    status: match.status || 'upcoming',
                    statusText: match.statusText || '',
                    round: match.round || '',
                    result: apiResult,
                    source: match.source || 'jisu'
                };
                existingMatches.unshift(formattedMatch);
                newCount++;
            }
        }
        
        saveMatches(existingMatches);
        
        console.log(`✅ 比赛更新完成: 总共 ${existingMatches.length} 场，新增 ${newCount} 场，更新比分 ${updatedCount} 场`);
        return { success: true, matches: existingMatches, newCount, updatedCount };
    } catch (error) {
        console.error('获取比赛数据失败:', error.message);
        return getSampleMatchesResult();
    }
}

/**
 * 获取示例比赛数据（API 不可用时的后备方案）
 */
function getSampleMatchesResult() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const timeStr = tomorrow.toISOString().slice(0, 16).replace('T', ' ');
    
    const sampleMatches = [
        {
            matchId: `sample_${Date.now()}_1`,
            league: "英超",
            matchTime: timeStr,
            homeTeam: "曼联",
            awayTeam: "利物浦",
            handicap: "平手/半球",
            odds: { home: "1.95", away: "1.90" },
            venue: "老特拉福德",
            source: 'sample',
            status: 'upcoming',
            result: null
        },
        {
            matchId: `sample_${Date.now()}_2`,
            league: "西甲",
            matchTime: timeStr,
            homeTeam: "巴塞罗那",
            awayTeam: "皇家马德里",
            handicap: "平手",
            odds: { home: "2.05", away: "1.85" },
            venue: "诺坎普球场",
            source: 'sample',
            status: 'upcoming',
            result: null
        }
    ];
    
    return { success: true, matches: sampleMatches };
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

function manualMatchTranscriptToPrediction({ transcriptId, matchId, prediction, authorId, authorName }) {
    if (!matchId || !prediction) return { success: false, error: '缺少 matchId 或 prediction' };
    if (!['home', 'away', 'draw'].includes(prediction)) return { success: false, error: 'prediction 无效' };

    const matches = getMatches();
    const match = matches.find(m => m.matchId === matchId);
    if (!match) return { success: false, error: '比赛不存在' };

    const transcripts = getTranscripts();
    const transcript = transcripts.find(t => t.id === transcriptId || t.videoId === transcriptId);
    if (!transcript) return { success: false, error: '文案不存在' };

    const predictions = getPredictions();
    let pred = predictions.find(p => p.matchId === matchId);
    if (!pred) {
        pred = {
            id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            matchId,
            match: {
                league: match.league,
                homeTeam: match.homeTeam,
                awayTeam: match.awayTeam,
                matchTime: match.matchTime,
                handicap: match.handicap
            },
            createdAt: new Date().toISOString(),
            authorPredictions: [],
            summary: {},
            doubaoPrediction: null,
            userPrediction: null,
            result: null
        };
        predictions.unshift(pred);
    }

    const aId = authorId || transcript.authorId || transcript.authorSecUid || '';
    const aName = authorName || transcript.author || '未知';
    const existingApIdx = pred.authorPredictions.findIndex(ap =>
        (ap.authorId === aId || ap.author === aName) && ap.videoId === transcript.videoId
    );
    const apRecord = {
        author: aName,
        authorId: aId,
        authorAvatar: transcript.authorAvatar || '',
        authorSecUid: transcript.authorSecUid || '',
        prediction,
        reason: '',
        videoId: transcript.videoId || '',
        videoUrl: transcript.url || '',
        manualMatch: true
    };
    if (existingApIdx >= 0) pred.authorPredictions[existingApIdx] = { ...pred.authorPredictions[existingApIdx], ...apRecord };
    else pred.authorPredictions.push(apRecord);

    const tIdx = transcripts.findIndex(t => t.id === transcriptId || t.videoId === transcriptId);
    if (tIdx >= 0) {
        transcripts[tIdx].predictions = transcripts[tIdx].predictions || [];
        const matchEntry = {
            league: match.league,
            homeTeam: match.homeTeam,
            awayTeam: match.awayTeam,
            prediction,
            matchId,
            manualMatch: true
        };
        const existingPredIdx = transcripts[tIdx].predictions.findIndex(p => p.matchId === matchId);
        if (existingPredIdx >= 0) transcripts[tIdx].predictions[existingPredIdx] = matchEntry;
        else transcripts[tIdx].predictions.push(matchEntry);
        transcripts[tIdx].hasPrediction = true;
    }

    const accuracy = recalculateAccuracyFromPredictions(predictions, matches, getAccuracy());
    commitJsonFilesWithRollback([
        { path: PREDICTIONS_FILE, data: predictions },
        { path: TRANSCRIPTS_FILE, data: transcripts },
        { path: ACCURACY_FILE, data: accuracy }
    ]);

    return { success: true, prediction: pred };
}

function updatePredictionMatch({ predictionId, authorIndex, newMatchId, newPrediction }) {
    if (!predictionId) return { success: false, error: 'predictionId 必填' };
    if (newPrediction && !['home', 'away', 'draw'].includes(newPrediction)) {
        return { success: false, error: 'newPrediction 无效' };
    }

    const predictions = getPredictions();
    const pred = predictions.find(p => p.id === predictionId);
    if (!pred) return { success: false, error: '预测记录不存在' };

    if (authorIndex !== undefined && pred.authorPredictions?.[authorIndex]) {
        if (newPrediction) {
            pred.authorPredictions[authorIndex].prediction = newPrediction;
            pred.authorPredictions[authorIndex].manualMatch = true;
        }
    }

    const matches = getMatches();
    if (newMatchId) {
        const newMatch = matches.find(m => m.matchId === newMatchId);
        if (!newMatch) return { success: false, error: '目标比赛不存在' };
        pred.matchId = newMatchId;
        pred.match = {
            league: newMatch.league,
            homeTeam: newMatch.homeTeam,
            awayTeam: newMatch.awayTeam,
            matchTime: newMatch.matchTime,
            handicap: newMatch.handicap
        };
    }

    const accuracy = recalculateAccuracyFromPredictions(predictions, matches, getAccuracy());
    commitJsonFilesWithRollback([
        { path: PREDICTIONS_FILE, data: predictions },
        { path: ACCURACY_FILE, data: accuracy }
    ]);

    return { success: true, prediction: pred };
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

// ==================== 自媒体预测分析功能 ====================

/**
 * 分析文案是否包含比赛预测（支持多场比赛）
 * @param {Object} transcriptData - 文案数据
 * @returns {Promise<Object>} 分析结果，包含 predictions 数组
 */
async function analyzeTranscriptForPrediction(transcriptData) {
    if (!DOUBAO_CONFIG || !DOUBAO_CONFIG.apiKey) {
        console.log('豆包配置未设置，跳过预测分析');
        return { success: false, error: '豆包配置未设置' };
    }
    
    const transcript = transcriptData.transcript || '';
    if (!transcript || transcript.length < 50) {
        return { success: false, error: '文案内容过短' };
    }
    
    console.log(`🔍 分析文案是否包含比赛预测: ${transcriptData.author || '未知作者'}`);
    
    const prompt = `分析以下足球相关文案，判断是否包含对比赛的胜负预测倾向。注意：一条文案可能包含对多场比赛的预测。

文案内容：
${transcript.substring(0, 2000)}

请以JSON格式返回（只返回JSON，不要其他文字）：
{
  "hasPrediction": true或false,
  "predictions": [
    {
      "match": {
        "homeTeam": "主队中文名",
        "awayTeam": "客队中文名",
        "league": "联赛名称（如英超、西甲、欧冠等）"
      },
      "prediction": "home"或"away"或"draw",
      "predictedWinner": "预测获胜的球队名",
      "confidence": "high"或"medium"或"low",
      "reason": "预测依据摘要（30字以内）"
    }
  ]
}

【重要】主客场判断规则：
- 文案中通常会说"A vs B"、"A对阵B"、"A主场迎战B"，其中A是主队，B是客队
- 文案中如果说"做客"、"客场挑战"、"远征"等词语，描述的是客队
- 如果文案说"阿森纳 VS 曼联"，则阿森纳是主队(homeTeam)，曼联是客队(awayTeam)
- 如果文案说"曼联做客阿森纳"，则阿森纳是主队，曼联是客队

【重要】prediction字段填写规则：
- prediction 必须根据实际主客场关系来填写，不是根据谁会赢
- 如果预测主队(homeTeam)会赢，prediction填"home"
- 如果预测客队(awayTeam)会赢，prediction填"away"
- 如果预测平局，prediction填"draw"
- predictedWinner 填预测会赢的球队名字

其他注意事项：
- 博主通常不会直接说"xx队会赢"，而是用暗示性表达如"看好主队"、"客队有机会"、"主场不败"、"做球迷没问题"等
- 如果文案只是分析没有明确倾向，hasPrediction 设为 false，predictions 为空数组
- 如果文案提到多场比赛的预测，全部列在 predictions 数组中

【最重要】homeTeam 和 awayTeam 必须严格使用以下标准名称，禁止使用任何缩写或别名：
${getStandardTeamNamesPrompt()}
示例：必须写"马德里竞技"不能写"马竞"，必须写"皇家马德里"不能写"皇马"，必须写"巴塞罗那"不能写"巴萨"，必须写"比利亚雷亚尔"不能写"黄潜"，必须写"巴黎圣日耳曼"不能写"大巴黎"或"巴黎"，必须写"曼彻斯特城"不能写"曼城"，必须写"曼彻斯特联"不能写"曼联"，必须写"托特纳姆热刺"不能写"热刺"，必须写"拜仁慕尼黑"不能写"拜仁"，必须写"RB莱比锡"不能写"莱比锡"。
如果文案中出现的球队不在上述列表中，请使用你认为最接近的标准名称。`;

    const result = await callDoubaoAPI(prompt);
    
    if (!result.success) {
        console.log('预测分析API调用失败:', result.error);
        return { success: false, error: result.error };
    }
    
    try {
        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const analysis = JSON.parse(jsonMatch[0]);
            
            // 兼容旧格式：如果返回的是单个 match 而不是 predictions 数组
            if (analysis.hasPrediction && !analysis.predictions && analysis.match) {
                analysis.predictions = [{
                    match: analysis.match,
                    prediction: analysis.prediction,
                    confidence: analysis.confidence,
                    reason: analysis.reason
                }];
            }
            
            // 二次校验：将 AI 输出的球队名标准化为数据库名称
            if (analysis.predictions && analysis.predictions.length > 0) {
                for (const pred of analysis.predictions) {
                    if (pred.match) {
                        const origHome = pred.match.homeTeam;
                        const origAway = pred.match.awayTeam;
                        pred.match.homeTeam = normalizeTeamName(pred.match.homeTeam);
                        pred.match.awayTeam = normalizeTeamName(pred.match.awayTeam);
                        if (origHome !== pred.match.homeTeam) {
                            console.log(`  📛 球队名标准化: ${origHome} → ${pred.match.homeTeam}`);
                        }
                        if (origAway !== pred.match.awayTeam) {
                            console.log(`  📛 球队名标准化: ${origAway} → ${pred.match.awayTeam}`);
                        }
                    }
                }
            }
            
            const predictionsCount = analysis.predictions?.length || 0;
            console.log(`✅ 预测分析完成: hasPrediction=${analysis.hasPrediction}, 检测到 ${predictionsCount} 场比赛预测`);
            
            return { success: true, analysis };
        }
    } catch (e) {
        console.log('预测分析解析失败:', e.message);
        return { success: false, error: '解析失败: ' + e.message };
    }
    
    return { success: false, error: '无法解析分析结果' };
}

/**
 * 将自媒体预测添加到比赛记录中（支持多场比赛）
 * @param {Object} transcriptData - 文案数据
 * @param {Object} analysis - 分析结果，包含 predictions 数组
 * @returns {Object} 添加结果
 */
function addAuthorPrediction(transcriptData, analysis) {
    if (!analysis || !analysis.hasPrediction) {
        return { success: false, error: '无预测信息' };
    }
    
    // 获取预测数组（支持新旧格式）
    let predictionsList = analysis.predictions || [];
    
    // 兼容旧格式：单个 match 对象
    if (predictionsList.length === 0 && analysis.match) {
        predictionsList = [{
            match: analysis.match,
            prediction: analysis.prediction,
            confidence: analysis.confidence,
            reason: analysis.reason
        }];
    }
    
    if (predictionsList.length === 0) {
        return { success: false, error: '无预测信息' };
    }
    
    const allPredictions = getPredictions();
    const allMatches = getMatches();
    const results = [];
    
    // 处理每一场比赛的预测
    for (const singlePred of predictionsList) {
        const matchInfo = singlePred.match || {};
        const homeTeam = matchInfo.homeTeam || '';
        const awayTeam = matchInfo.awayTeam || '';
        
        if (!homeTeam || !awayTeam) {
            console.log('⚠️ 跳过无效预测：缺少球队信息');
            continue;
        }
        
        // 模糊匹配比赛
        let matchedPrediction = null;
        let matchedMatch = null;
        
        // 首先在 predictions 中查找
        for (const pred of allPredictions) {
            const predHome = pred.match?.homeTeam || '';
            const predAway = pred.match?.awayTeam || '';
            
            if ((fuzzyMatch(predHome, homeTeam) && fuzzyMatch(predAway, awayTeam)) ||
                (fuzzyMatch(predHome, awayTeam) && fuzzyMatch(predAway, homeTeam))) {
                matchedPrediction = pred;
                break;
            }
        }
        
        // 如果在 predictions 中没找到，在 matches 中查找并创建新的预测记录
        if (!matchedPrediction) {
            for (const match of allMatches) {
                if ((fuzzyMatch(match.homeTeam, homeTeam) && fuzzyMatch(match.awayTeam, awayTeam)) ||
                    (fuzzyMatch(match.homeTeam, awayTeam) && fuzzyMatch(match.awayTeam, homeTeam))) {
                    matchedMatch = match;
                    break;
                }
            }
            
            if (matchedMatch) {
                // 创建新的预测记录
                matchedPrediction = {
                    id: Date.now().toString() + '_' + Math.random().toString(36).substr(2, 5),
                    matchId: matchedMatch.matchId,
                    match: {
                        league: matchedMatch.league,
                        homeTeam: matchedMatch.homeTeam,
                        awayTeam: matchedMatch.awayTeam,
                        matchTime: matchedMatch.matchTime,
                        handicap: matchedMatch.handicap
                    },
                    createdAt: new Date().toISOString(),
                    authorPredictions: [],
                    summary: {},
                    doubaoPrediction: matchedMatch.doubaoPrediction || null,
                    userPrediction: null,
                    result: null
                };
                allPredictions.unshift(matchedPrediction);
            }
        }
        
    // 如果没有找到匹配的比赛，创建一个新的预测记录
    if (!matchedPrediction) {
        console.log(`📝 创建新的预测记录: ${homeTeam} vs ${awayTeam}`);
        matchedPrediction = {
            id: Date.now().toString() + '_' + Math.random().toString(36).substr(2, 5),
            matchId: `auto_${homeTeam}_vs_${awayTeam}_${Date.now()}`,
            match: {
                league: matchInfo.league || '',
                homeTeam: homeTeam,
                awayTeam: awayTeam,
                matchTime: '',
                handicap: null
            },
            createdAt: new Date().toISOString(),
            authorPredictions: [],
            summary: {},
            doubaoPrediction: null,
            userPrediction: null,
            result: null
        };
        allPredictions.unshift(matchedPrediction);
    }
        
        // 检查是否已有该作者对这场比赛的预测
        const authorId = transcriptData.authorSecUid || transcriptData.authorId || transcriptData.author;
        const existingIndex = matchedPrediction.authorPredictions.findIndex(
            p => p.authorId === authorId || p.author === transcriptData.author
        );
        
        const authorPrediction = {
            author: transcriptData.author || '未知作者',
            authorId: authorId,
            authorAvatar: transcriptData.authorAvatar || '',
            videoId: transcriptData.videoId || '',
            videoUrl: transcriptData.url || '',
            prediction: singlePred.prediction || 'unclear',
            confidence: singlePred.confidence || 'low',
            reason: singlePred.reason || '',
            createdAt: new Date().toISOString()
        };
        
        if (existingIndex >= 0) {
            matchedPrediction.authorPredictions[existingIndex] = authorPrediction;
            console.log(`📝 更新自媒体预测: ${authorPrediction.author} -> ${singlePred.prediction} (${homeTeam} vs ${awayTeam})`);
        } else {
            matchedPrediction.authorPredictions.push(authorPrediction);
            console.log(`✅ 添加自媒体预测: ${authorPrediction.author} -> ${singlePred.prediction} (${homeTeam} vs ${awayTeam})`);
        }
        
        // 更新统计摘要
        updatePredictionSummary(matchedPrediction);
        
        results.push({ 
            success: true, 
            matchId: matchedPrediction.matchId,
            match: `${homeTeam} vs ${awayTeam}`,
            prediction: singlePred.prediction
        });
    }
    
    savePredictions(allPredictions);
    
    const successCount = results.filter(r => r.success).length;
    console.log(`📊 预测添加完成: ${successCount}/${predictionsList.length} 场比赛`);
    
    return { 
        success: successCount > 0, 
        total: predictionsList.length,
        added: successCount,
        results
    };
}

/**
 * 模糊匹配球队名称
 */
function fuzzyMatch(name1, name2) {
    if (!name1 || !name2) return false;
    
    // 移除特殊字符和空格，统一转小写（保留中文和英文字母数字）
    const normalize = (s) => s.toLowerCase()
        .replace(/\s+/g, '')
        .replace(/[çć]/g, 'c')
        .replace(/[šś]/g, 's')
        .replace(/[žź]/g, 'z')
        .replace(/[ñ]/g, 'n')
        .replace(/[áàâä]/g, 'a')
        .replace(/[éèêë]/g, 'e')
        .replace(/[íìîï]/g, 'i')
        .replace(/[óòôö]/g, 'o')
        .replace(/[úùûü]/g, 'u')
        .replace(/[ß]/g, 'ss')
        .replace(/[^\u4e00-\u9fa5a-z0-9]/g, '');  // 保留中文、英文、数字
    
    const n1 = normalize(name1);
    const n2 = normalize(name2);
    
    // 空字符串不匹配
    if (!n1 || !n2) return false;
    
    // 完全匹配
    if (n1 === n2) return true;
    
    // 包含匹配（2个中文字符已足够区分）
    if (n1.length >= 2 && n2.length >= 2) {
        if (n1.includes(n2) || n2.includes(n1)) return true;
    }
    
    // 常见别名匹配
    const aliases = {
        // 英超
        '曼联': ['manchester united', 'man utd', 'manutd', '曼彻斯特联'],
        '曼城': ['manchester city', 'man city', 'mancity', '曼彻斯特城'],
        '利物浦': ['liverpool', 'lfc'],
        '切尔西': ['chelsea', 'cfc'],
        '阿森纳': ['arsenal', 'afc', '枪手'],
        '热刺': ['tottenham', 'spurs', '托特纳姆', 'tottenham hotspur'],
        '纽卡': ['newcastle', '纽卡斯尔', '纽卡斯尔联', 'newcastle united'],
        '阿斯顿维拉': ['astonvilla', 'villa', 'aston villa'],
        '西汉姆': ['west ham', 'westham', '西汉姆联'],
        '布莱顿': ['brighton', 'brighton & hove albion'],
        '狼队': ['wolves', 'wolverhampton'],
        '水晶宫': ['crystal palace'],
        '富勒姆': ['fulham'],
        '伯恩茅斯': ['bournemouth', 'afc bournemouth'],
        '布伦特福德': ['brentford'],
        '诺丁汉森林': ['nottingham forest', 'nottingham', 'forest'],
        '埃弗顿': ['everton'],
        '莱斯特城': ['leicester', 'leicester city'],
        // 西甲
        '巴萨': ['barcelona', 'barca', '巴塞罗那', 'fc barcelona'],
        '皇马': ['real madrid', 'realmadrid', '皇家马德里'],
        '马竞': ['atletico', 'atleticomadrid', '马德里竞技', 'atletico madrid', 'atletico de madrid'],
        '赫塔菲': ['getafe', '赫塔费'],
        '赫罗纳': ['girona', '吉罗纳'],
        '莱切': ['lecce', '莱切'],
        '博洛尼亚': ['bologna', '博洛尼亚'],
        '洛里昂': ['lorient', '洛里昂'],
        '前进之鹰': ['go ahead eagles', '前进之鹰'],
        '塞维利亚': ['sevilla', 'sevilla fc'],
        '比利亚雷亚尔': ['villarreal'],
        '皇家社会': ['real sociedad', 'sociedad'],
        '贝蒂斯': ['real betis', 'betis'],
        '瓦伦西亚': ['valencia', 'valencia cf'],
        // 德甲
        '拜仁': ['bayern', 'bayernmunich', '拜仁慕尼黑', 'bayern munich', 'fc bayern'],
        '多特': ['dortmund', 'bvb', '多特蒙德', 'borussia dortmund'],
        '莱比锡': ['rb leipzig', 'leipzig', 'rbleipzig'],
        '勒沃库森': ['leverkusen', 'bayer leverkusen', 'bayer 04'],
        '法兰克福': ['frankfurt', 'eintrachtfrankfurt', 'eintracht frankfurt'],
        '门兴': ['monchengladbach', 'gladbach', 'borussia monchengladbach'],
        '沃尔夫斯堡': ['wolfsburg', 'vfl wolfsburg'],
        '弗赖堡': ['freiburg', 'sc freiburg'],
        '斯图加特': ['stuttgart', 'vfb stuttgart'],
        // 意甲
        '尤文': ['juventus', 'juve', '尤文图斯'],
        '国米': ['inter', 'intermilan', '国际米兰', 'inter milan', 'fc internazionale'],
        'ac米兰': ['acmilan', 'milan', 'ac米兰', 'ac milan'],
        '那不勒斯': ['napoli', 'ssc napoli'],
        '罗马': ['roma', 'as roma'],
        '拉齐奥': ['lazio', 'ss lazio'],
        '亚特兰大': ['atalanta', 'atalanta bc'],
        '佛罗伦萨': ['fiorentina', 'acf fiorentina'],
        '博洛尼亚': ['bologna', 'bologna fc'],
        '都灵': ['torino', 'torino fc'],
        '维罗纳': ['verona', 'hellas verona'],
        '莱切': ['lecce', 'us lecce'],
        '萨索洛': ['sassuolo', 'us sassuolo'],
        '恩波利': ['empoli', 'empoli fc'],
        '热那亚': ['genoa', 'genoa cfc'],
        '乌迪内斯': ['udinese'],
        '萨勒尼塔纳': ['salernitana'],
        '卡利亚里': ['cagliari'],
        '弗洛西诺内': ['frosinone'],
        '蒙扎': ['monza', 'ac monza'],
        '帕尔马': ['parma', 'parma calcio'],
        '科莫': ['como', 'como 1907'],
        '威尼斯': ['venezia', 'venezia fc'],
        // 法甲
        '巴黎': ['psg', 'paris', '巴黎圣日耳曼', '大巴黎', 'paris saint-germain', 'paris saint germain'],
        '马赛': ['marseille', 'om', 'olympiquemarseille', 'olympique marseille'],
        '里昂': ['lyon', 'olympiquelyon', 'olympique lyon', 'olympique lyonnais'],
        '摩纳哥': ['monaco', 'as monaco'],
        '尼斯': ['nice', 'ogc nice'],
        '里尔': ['lille', 'losc', 'losc lille'],
        '朗斯': ['lens', 'rc lens'],
        '雷恩': ['rennes', 'stade rennais'],
        '斯特拉斯堡': ['strasbourg', 'rc strasbourg'],
        '南特': ['nantes', 'fc nantes'],
        '蒙彼利埃': ['montpellier'],
        '图卢兹': ['toulouse'],
        '布雷斯特': ['brest', 'stade brestois'],
        '兰斯': ['reims', 'stade reims'],
        '勒阿弗尔': ['le havre'],
        '欧塞尔': ['auxerre', 'aj auxerre'],
        '圣埃蒂安': ['saint-etienne', 'saint etienne', 'as saint-etienne'],
        '昂热': ['angers', 'angers sco'],
        // 欧冠
        '埃因霍温': ['psv', 'psveindhoven', 'psv eindhoven'],
        '加拉塔萨雷': ['galatasaray'],
        '费内巴切': ['fenerbahce'],
        '卡拉巴克': ['卡拉巴赫', 'qarabag', 'qarabağ'],
        '圣吉罗斯': ['圣吉尔', 'union saint-gilloise', 'royale union saint-gilloise'],
        '帕福斯fc': ['帕福斯', 'pafos', 'pafos fc'],
        '布拉格斯拉维亚': ['slavia prague', 'slavia praha', '布拉格斯拉维亚'],
        '年轻人': ['young boys', 'bsc young boys', 'youngboys', 'bscyoungboys'],
        '前进之鹰': ['go ahead eagles', 'goaheadeagles', 'eagles'],
        '布拉格斯巴达': ['sparta prague', 'sparta praha'],
        '萨尔茨堡': ['red bull salzburg', 'salzburg', 'rb salzburg'],
        '本菲卡': ['benfica', 'sl benfica'],
        '波尔图': ['porto', 'fc porto'],
        '顿涅茨克矿工': ['shakhtar', 'shakhtar donetsk'],
        '凯尔特人': ['celtic', 'celtic fc'],
        '阿贾克斯': ['ajax', 'afc ajax'],
        '布鲁日': ['club brugge', 'brugge'],
        '安德莱赫特': ['anderlecht', 'rsc anderlecht']
    };
    
    for (const [key, values] of Object.entries(aliases)) {
        const allNames = [key, ...values].map(a => normalize(a));
        
        // 匹配函数：要求完全匹配，或者长度>=4时才允许包含匹配
        const isMatch = (name, target) => {
            if (name === target) return true;
            if (name.length >= 4 && target.length >= 4) {
                return name.includes(target) || target.includes(name);
            }
            return false;
        };
        
        const match1 = allNames.some(a => isMatch(n1, a));
        const match2 = allNames.some(a => isMatch(n2, a));
        if (match1 && match2) return true;
    }
    
    return false;
}

/**
 * 更新预测统计摘要
 */
function updatePredictionSummary(prediction) {
    let homeWin = 0, awayWin = 0, draw = 0, unclear = 0;
    
    for (const p of prediction.authorPredictions) {
        if (p.prediction === 'home') homeWin++;
        else if (p.prediction === 'away') awayWin++;
        else if (p.prediction === 'draw') draw++;
        else unclear++;
    }
    
    prediction.summary = { homeWin, awayWin, draw, unclear };
}

/**
 * 录入比赛结果并更新所有相关自媒体的胜率
 * @param {string} predictionId - 预测记录ID
 * @param {string} result - 比赛结果 'home' | 'away' | 'draw'
 * @returns {Object} 更新结果
 */
function updatePredictionResult(predictionId, result, scoreInfo = null) {
    const predictions = getPredictions();
    const predIndex = predictions.findIndex(p => p.id === predictionId);
    
    if (predIndex < 0) {
        return { success: false, error: '预测记录不存在' };
    }
    
    const prediction = predictions[predIndex];
    
    // 如果已有结果，不允许重复录入
    if (prediction.result) {
        return { success: false, error: '该比赛结果已录入' };
    }
    
    // 保存结果和比分
    prediction.result = {
        winner: typeof result === 'object' ? result.winner : result,
        homeScore: scoreInfo?.homeScore ?? (typeof result === 'object' ? result.homeScore : null),
        awayScore: scoreInfo?.awayScore ?? (typeof result === 'object' ? result.awayScore : null),
        recordedAt: new Date().toISOString()
    };
    
    // 更新每个自媒体的胜率
    const accuracy = getAccuracy();
    
    for (const authorPred of prediction.authorPredictions) {
        if (authorPred.prediction === 'unclear') continue;
        
        const authorId = authorPred.authorId || authorPred.author;
        
        if (!accuracy.authors[authorId]) {
            accuracy.authors[authorId] = {
                name: authorPred.author,
                avatar: authorPred.authorAvatar || '',
                wins: 0,
                total: 0,
                history: []
            };
        }
        
        const winnerResult = prediction.result.winner;
        const isCorrect = authorPred.prediction === winnerResult;
        accuracy.authors[authorId].total++;
        if (isCorrect) {
            accuracy.authors[authorId].wins++;
        }
        
        // 更新头像和名字（可能有变化）
        accuracy.authors[authorId].name = authorPred.author;
        if (authorPred.authorAvatar) {
            accuracy.authors[authorId].avatar = authorPred.authorAvatar;
        }
        
        // 添加历史记录（包含文案、理由和比分）
        accuracy.authors[authorId].history = accuracy.authors[authorId].history || [];
        accuracy.authors[authorId].history.unshift({
            matchId: prediction.matchId,
            homeTeam: prediction.match.homeTeam,
            awayTeam: prediction.match.awayTeam,
            league: prediction.match.league,
            prediction: authorPred.prediction,
            result: winnerResult,
            homeScore: prediction.result.homeScore,
            awayScore: prediction.result.awayScore,
            correct: isCorrect,
            reason: authorPred.reason || '',
            videoId: authorPred.videoId || '',
            videoUrl: authorPred.videoUrl || '',
            date: new Date().toISOString().split('T')[0]
        });
        
        // 限制历史记录数量
        if (accuracy.authors[authorId].history.length > 100) {
            accuracy.authors[authorId].history = accuracy.authors[authorId].history.slice(0, 100);
        }
    }
    
    // 更新豆包准确率
    if (prediction.doubaoPrediction && prediction.doubaoPrediction.prediction) {
        accuracy.doubao = accuracy.doubao || { wins: 0, total: 0 };
        accuracy.doubao.total++;
        if (prediction.doubaoPrediction.prediction === result) {
            accuracy.doubao.wins++;
        }
    }
    
    // 更新用户准确率
    if (prediction.userPrediction) {
        accuracy.user = accuracy.user || { wins: 0, total: 0 };
        accuracy.user.total++;
        if (prediction.userPrediction === result) {
            accuracy.user.wins++;
        }
    }
    
    savePredictions(predictions);
    saveAccuracy(accuracy);
    
    console.log(`✅ 比赛结果已录入: ${prediction.match.homeTeam} vs ${prediction.match.awayTeam} -> ${result}`);
    
    return { 
        success: true, 
        prediction: prediction,
        updatedAuthors: prediction.authorPredictions.length
    };
}

/**
 * 获取自媒体胜率排名
 * @param {Object} options - 选项 { minPredictions: 最低预测数, sortBy: 'winRate'|'total' }
 * @returns {Array} 排名列表
 */
function getAuthorStats(options = {}) {
    const { minPredictions = 1, sortBy = 'winRate' } = options;
    const accuracy = getAccuracy();
    
    const stats = [];
    
    for (const [authorId, data] of Object.entries(accuracy.authors || {})) {
        if (data.total < minPredictions) continue;
        
        const winRate = data.total > 0 ? (data.wins / data.total * 100) : 0;
        
        stats.push({
            authorId,
            name: data.name || authorId,
            avatar: data.avatar || '',
            wins: data.wins || 0,
            total: data.total || 0,
            winRate: Math.round(winRate * 10) / 10,
            history: data.history || [],
            recentForm: getRecentForm(data.history || [])
        });
    }
    
    // 排序
    if (sortBy === 'winRate') {
        stats.sort((a, b) => {
            if (b.winRate !== a.winRate) return b.winRate - a.winRate;
            return b.total - a.total;
        });
    } else {
        stats.sort((a, b) => b.total - a.total);
    }
    
    return stats;
}

/**
 * 获取最近战绩表现
 */
function getRecentForm(history) {
    const recent = history.slice(0, 5);
    return recent.map(h => h.correct ? 'W' : 'L').join('');
}

/**
 * 获取单个自媒体的详细统计（包含文案内容和比分）
 * @param {string} authorId - 作者ID
 * @returns {Object} 详细统计
 */
function getAuthorDetail(authorId) {
    const accuracy = getAccuracy();
    const data = accuracy.authors[authorId];
    
    if (!data) {
        return { success: false, error: '自媒体不存在' };
    }
    
    // 加载文案数据
    let transcripts = [];
    try {
        const transcriptsFile = path.join(DATA_DIR, 'transcripts.json');
        if (fs.existsSync(transcriptsFile)) {
            transcripts = JSON.parse(fs.readFileSync(transcriptsFile, 'utf-8'));
        }
    } catch (e) {
        console.error('加载文案失败:', e.message);
    }
    
    // 加载预测数据（获取比分）
    let predictions = [];
    try {
        predictions = getPredictions();
    } catch (e) {
        console.error('加载预测失败:', e.message);
    }
    
    const winRate = data.total > 0 ? (data.wins / data.total * 100) : 0;
    
    // 为每条历史记录添加文案内容和比分
    const historyWithDetails = (data.history || []).map(h => {
        let transcript = '';
        let homeScore = null;
        let awayScore = null;
        let reason = h.reason || '';
        
        // 从 predictions 中获取比分和 videoId
        if (h.matchId) {
            const pred = predictions.find(p => p.matchId === h.matchId);
            if (pred) {
                // 获取比分
                if (pred.result && pred.result.homeScore !== undefined) {
                    homeScore = pred.result.homeScore;
                    awayScore = pred.result.awayScore;
                }
                
                // 如果历史记录中没有 videoId，从 authorPredictions 中查找
                if (!h.videoId && pred.authorPredictions) {
                    const ap = pred.authorPredictions.find(a => a.authorId === authorId);
                    if (ap) {
                        if (!reason && ap.reason) reason = ap.reason;
                        if (ap.videoId) {
                            // 查找文案
                            const t = transcripts.find(t => t.videoId === ap.videoId);
                            if (t) transcript = t.transcript || '';
                        }
                    }
                }
            }
        }
        
        // 如果已有 videoId，直接查找文案
        if (h.videoId && !transcript) {
            const t = transcripts.find(t => t.videoId === h.videoId);
            if (t) transcript = t.transcript || '';
        }
        
        return { 
            ...h, 
            transcript,
            reason,
            homeScore,
            awayScore
        };
    });
    
    return {
        success: true,
        data: {
            authorId,
            name: data.name || authorId,
            avatar: data.avatar || '',
            wins: data.wins || 0,
            total: data.total || 0,
            winRate: Math.round(winRate * 10) / 10,
            history: historyWithDetails,
            recentForm: getRecentForm(data.history || [])
        }
    };
}

// ==================== 自动同步比赛结果 ====================

// 记录上次更新日期
let lastUpdateDate = null;

/**
 * 检查是否需要更新比赛数据（6小时内更新过则不需要）
 */
function needsUpdate() {
    try {
        const cacheFile = path.join(getDataDir(), 'jisu_matches_cache.json');
        if (fs.existsSync(cacheFile)) {
            const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
            if (cache.lastUpdate) {
                const lastUpdate = new Date(cache.lastUpdate);
                const hoursSinceUpdate = (Date.now() - lastUpdate.getTime()) / (1000 * 60 * 60);
                if (hoursSinceUpdate < 24) {
                    console.log(`📦 比赛数据在 ${hoursSinceUpdate.toFixed(1)} 小时前已更新，跳过`);
                    return false;
                }
            }
        }
    } catch (e) {
        console.error('检查缓存失败:', e.message);
    }
    
    return true;
}

/**
 * 自动同步最近的比赛结果到预测记录
 */
async function syncMatchResults() {
    console.log('🔄 开始同步比赛结果...');
    
    try {
        // 获取最近3天的比赛结果
        const recentResults = await footballAPI.getRecentResults(3);
        console.log(`📊 获取到 ${recentResults.length} 场已完成的比赛`);
        
        if (recentResults.length === 0) {
            return { success: true, updated: 0, message: '没有新的比赛结果' };
        }
        
        // 获取所有预测记录
        const predictions = getPredictions();
        let updated = 0;
        
        for (const result of recentResults) {
            // 查找匹配的预测记录
            for (const pred of predictions) {
                // 跳过已有结果的
                if (pred.result) continue;
                
                const predHome = pred.match?.homeTeam || '';
                const predAway = pred.match?.awayTeam || '';
                
                // 使用模糊匹配
                if ((fuzzyMatch(predHome, result.homeTeam) && fuzzyMatch(predAway, result.awayTeam)) ||
                    (fuzzyMatch(predHome, result.awayTeam) && fuzzyMatch(predAway, result.homeTeam))) {
                    
                    console.log(`  ✅ 匹配: ${result.homeTeam} ${result.homeScore}-${result.awayScore} ${result.awayTeam} -> ${result.winner}`);
                    
                    // 更新预测结果（包含比分）
                    const updateResult = updatePredictionResult(pred.id, result.winner, {
                        homeScore: result.homeScore,
                        awayScore: result.awayScore
                    });
                    if (updateResult.success) {
                        updated++;
                    }
                }
            }
        }
        
        console.log(`✅ 同步完成，更新了 ${updated} 条预测结果`);
        return { success: true, updated, total: recentResults.length };
        
    } catch (e) {
        console.error('同步比赛结果失败:', e.message);
        return { success: false, error: e.message };
    }
}

/**
 * 启动时自动检查和更新
 */
async function autoUpdateOnStartup() {
    console.log('📅 检查是否需要更新比赛数据...');
    
    const today = new Date().toISOString().split('T')[0];
    
    if (needsUpdate()) {
        console.log('🔄 今天尚未更新，开始自动更新...');
        
        try {
            // 1. 更新今天和明天的比赛列表
            const searchResult = await searchUpcomingMatches();
            console.log(`📋 比赛列表已更新: ${searchResult.matches?.length || 0} 场`);
            
            // 2. 同步最近比赛结果
            const syncResult = await syncMatchResults();
            console.log(`📊 结果同步: ${syncResult.updated || 0} 条更新`);
            
            lastUpdateDate = today;
            return { success: true, matches: searchResult.matches?.length, results: syncResult.updated };
            
        } catch (e) {
            console.error('自动更新失败:', e.message);
            return { success: false, error: e.message };
        }
    } else {
        console.log('✅ 今天已更新过，跳过自动更新');
        return { success: true, skipped: true };
    }
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
    updatePredictionMatch,
    manualMatchTranscriptToPrediction,
    saveUserMatchPrediction,
    // 准确率相关
    getAccuracy,
    toggleAuthorDisabled,
    calculateOverallPrediction,
    // 新增：自媒体预测分析
    analyzeTranscriptForPrediction,
    addAuthorPrediction,
    updatePredictionResult,
    getAuthorStats,
    getAuthorDetail,
    // 工具函数
    fuzzyMatch,
    normalizeTeamName,
    // 自动更新
    autoUpdateOnStartup,
    syncMatchResults,
    needsUpdate
};
