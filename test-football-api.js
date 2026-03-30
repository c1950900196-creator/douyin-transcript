/**
 * 足球 API 测试脚本
 * 用于测试 API 连接和数据获取
 */

const footballAPI = require('./football-api');

async function test() {
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║                                                                ║');
    console.log('║               🎯 足球赛事 API 测试                              ║');
    console.log('║                                                                ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log('');
    
    // 检查 API 配置
    console.log('📋 检查 API 配置...');
    console.log('');
    
    if (footballAPI.API_CONFIG.apiFootball.enabled) {
        console.log('✅ API-Football: 已启用');
        console.log(`   API Key: ${footballAPI.API_CONFIG.apiFootball.apiKey ? '已配置' : '❌ 未配置'}`);
    } else {
        console.log('⚠️  API-Football: 未启用');
    }
    
    if (footballAPI.API_CONFIG.jisuapi.enabled) {
        console.log('✅ 极速数据: 已启用');
        console.log(`   API Key: ${footballAPI.API_CONFIG.jisuapi.apiKey ? '已配置' : '❌ 未配置'}`);
    } else {
        console.log('⚠️  极速数据: 未启用');
    }
    
    console.log('');
    console.log('─'.repeat(70));
    console.log('');
    
    // 测试获取比赛数据
    try {
        console.log('📡 正在获取比赛数据...');
        console.log('');
        
        const matches = await footballAPI.getMatches();
        
        console.log(`✅ 成功获取 ${matches.length} 场比赛！`);
        console.log('');
        console.log('─'.repeat(70));
        console.log('');
        
        if (matches.length > 0) {
            console.log('📊 比赛数据预览（前 5 场）:');
            console.log('');
            
            matches.slice(0, 5).forEach((match, index) => {
                console.log(`${index + 1}. 【${match.league}】`);
                console.log(`   ${match.homeTeam} vs ${match.awayTeam}`);
                console.log(`   时间: ${new Date(match.matchTime).toLocaleString('zh-CN')}`);
                console.log(`   场地: ${match.venue}`);
                console.log(`   状态: ${match.status}`);
                if (match.homeScore !== null) {
                    console.log(`   比分: ${match.homeScore} - ${match.awayScore}`);
                }
                console.log('');
            });
            
            console.log('─'.repeat(70));
            console.log('');
            
            // 统计联赛分布
            const leagueStats = {};
            matches.forEach(match => {
                leagueStats[match.league] = (leagueStats[match.league] || 0) + 1;
            });
            
            console.log('📈 联赛分布统计:');
            console.log('');
            Object.entries(leagueStats)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10)
                .forEach(([league, count]) => {
                    console.log(`   ${league}: ${count} 场`);
                });
            
            console.log('');
            console.log('─'.repeat(70));
            console.log('');
            console.log('🎉 测试成功！API 工作正常！');
            
        } else {
            console.log('⚠️  没有获取到比赛数据');
            console.log('');
            console.log('可能原因:');
            console.log('1. API Key 未配置或无效');
            console.log('2. API 未启用');
            console.log('3. 网络连接问题');
            console.log('4. API 请求额度用完');
            console.log('');
            console.log('请检查配置并参考 足球API使用指南.md');
        }
        
    } catch (error) {
        console.log('❌ 获取比赛数据失败！');
        console.log('');
        console.log('错误信息:', error.message);
        console.log('');
        console.log('解决方案:');
        console.log('1. 检查 API Key 是否正确配置');
        console.log('2. 确认 API 已启用（enabled: true）');
        console.log('3. 检查网络连接');
        console.log('4. 查看详细错误日志');
        console.log('');
        console.log('参考文档: 足球API使用指南.md');
    }
    
    console.log('');
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║                                                                ║');
    console.log('║               测试完成                                          ║');
    console.log('║                                                                ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
}

// 运行测试
test().catch(console.error);
