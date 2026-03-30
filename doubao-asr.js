/**
 * 豆包语音识别 API 模块
 * 使用豆包录音文件识别模型2.0
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// 豆包语音识别配置
const DOUBAO_ASR_CONFIG = {
    appId: process.env.DOUBAO_ASR_APP_ID || '9815940423',
    accessKey: process.env.DOUBAO_ASR_ACCESS_KEY || 'yRDU6hQEygvJgt58eRrhmsipdhB20BNV',
    resourceId: 'volc.seedasr.auc', // 模型2.0
    submitUrl: 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit',
    queryUrl: 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/query'
};

/**
 * 生成UUID
 */
function generateRequestId() {
    // 简单的UUID生成
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * 发送HTTP请求
 */
function makeRequest(url, options, body) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        
        const reqOptions = {
            hostname: urlObj.hostname,
            port: 443,
            path: urlObj.pathname,
            method: options.method || 'POST',
            headers: options.headers || {}
        };
        
        const req = https.request(reqOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    body: data
                });
            });
        });
        
        req.on('error', reject);
        req.setTimeout(120000, () => {
            req.destroy();
            reject(new Error('请求超时'));
        });
        
        if (body) {
            req.write(body);
        }
        req.end();
    });
}

/**
 * 提交语音识别任务
 * @param {string} audioUrl - 音频文件URL
 * @param {string} format - 音频格式 (mp3, wav, mp4等)
 */
async function submitTask(audioUrl, format = 'mp3') {
    const requestId = generateRequestId();
    
    console.log(`📤 提交语音识别任务: ${requestId}`);
    console.log(`   音频URL: ${audioUrl.substring(0, 80)}...`);
    
    const headers = {
        'Content-Type': 'application/json',
        'X-Api-App-Key': DOUBAO_ASR_CONFIG.appId,
        'X-Api-Access-Key': DOUBAO_ASR_CONFIG.accessKey,
        'X-Api-Resource-Id': DOUBAO_ASR_CONFIG.resourceId,
        'X-Api-Request-Id': requestId,
        'X-Api-Sequence': '-1'
    };
    
    const body = JSON.stringify({
        user: {
            uid: 'douyin-extractor-' + Date.now()
        },
        audio: {
            format: format,
            url: audioUrl
        },
        request: {
            model_name: 'bigmodel',
            enable_itn: true,      // 启用文本规范化
            enable_punc: true,     // 启用标点符号
            enable_ddc: true,      // 启用顺滑（去除语气词等）
            show_utterances: true  // 输出分句信息
        }
    });
    
    // 添加重试逻辑
    const maxRetries = 3;
    let lastError = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await makeRequest(DOUBAO_ASR_CONFIG.submitUrl, { headers }, body);
            
            const statusCode = response.headers['x-api-status-code'];
            const message = response.headers['x-api-message'];
            
            console.log(`   提交状态: ${statusCode} - ${message}`);
            
            if (statusCode === '20000000') {
                return {
                    success: true,
                    requestId: requestId,
                    message: 'OK'
                };
            } else {
                return {
                    success: false,
                    error: `提交失败: ${statusCode} - ${message}`,
                    requestId: requestId
                };
            }
        } catch (error) {
            lastError = error;
            console.error(`提交任务失败 (第${attempt}次): ${error.message}`);
            
            if (attempt < maxRetries) {
                const waitTime = attempt * 5000; // 5秒, 10秒, 15秒
                console.log(`   等待 ${waitTime/1000} 秒后重试...`);
                await new Promise(r => setTimeout(r, waitTime));
            }
        }
    }
    
    return {
        success: false,
        error: lastError?.message || '提交失败',
        requestId: requestId
    };
}

/**
 * 查询识别结果
 * @param {string} requestId - 任务ID
 */
async function queryResult(requestId) {
    const headers = {
        'Content-Type': 'application/json',
        'X-Api-App-Key': DOUBAO_ASR_CONFIG.appId,
        'X-Api-Access-Key': DOUBAO_ASR_CONFIG.accessKey,
        'X-Api-Resource-Id': DOUBAO_ASR_CONFIG.resourceId,
        'X-Api-Request-Id': requestId
    };
    
    try {
        const response = await makeRequest(DOUBAO_ASR_CONFIG.queryUrl, { headers }, '{}');
        
        const statusCode = response.headers['x-api-status-code'];
        const message = response.headers['x-api-message'];
        
        // 20000000 = 成功
        // 20000001 = 正在处理中
        // 20000002 = 任务在队列中
        if (statusCode === '20000000') {
            try {
                const result = JSON.parse(response.body);
                return {
                    success: true,
                    status: 'completed',
                    text: result.result?.text || '',
                    utterances: result.result?.utterances || [],
                    duration: result.audio_info?.duration || 0
                };
            } catch (e) {
                return {
                    success: true,
                    status: 'completed',
                    text: response.body,
                    utterances: []
                };
            }
        } else if (statusCode === '20000001' || statusCode === '20000002') {
            return {
                success: true,
                status: 'processing',
                message: message
            };
        } else {
            return {
                success: false,
                status: 'failed',
                error: `${statusCode} - ${message}`
            };
        }
    } catch (error) {
        console.error('查询结果失败:', error.message);
        return {
            success: false,
            status: 'error',
            error: error.message
        };
    }
}

/**
 * 等待识别完成并返回结果
 * @param {string} requestId - 任务ID
 * @param {number} maxWaitTime - 最大等待时间（毫秒）
 * @param {function} progressCallback - 进度回调
 */
async function waitForResult(requestId, maxWaitTime = 300000, progressCallback = null) {
    const startTime = Date.now();
    let pollCount = 0;
    
    while (Date.now() - startTime < maxWaitTime) {
        pollCount++;
        
        if (progressCallback) {
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            progressCallback(`正在识别中... (${elapsed}秒)`);
        }
        
        const result = await queryResult(requestId);
        
        if (result.status === 'completed') {
            console.log(`✅ 识别完成，用时 ${Math.round((Date.now() - startTime) / 1000)} 秒`);
            return result;
        } else if (result.status === 'failed' || result.status === 'error') {
            console.error(`❌ 识别失败: ${result.error}`);
            return result;
        }
        
        // 等待后继续轮询
        // 前几次轮询间隔短，后面逐渐增加
        const waitTime = pollCount < 5 ? 2000 : (pollCount < 10 ? 3000 : 5000);
        await new Promise(r => setTimeout(r, waitTime));
    }
    
    return {
        success: false,
        status: 'timeout',
        error: '识别超时'
    };
}

/**
 * 主函数：语音转写
 * @param {string} audioUrl - 音频URL
 * @param {string} format - 音频格式
 * @param {function} progressCallback - 进度回调
 */
async function transcribeAudio(audioUrl, format = 'mp3', progressCallback = null) {
    try {
        // 1. 提交任务
        if (progressCallback) progressCallback('提交识别任务...');
        const submitResult = await submitTask(audioUrl, format);
        
        if (!submitResult.success) {
            return {
                success: false,
                error: submitResult.error
            };
        }
        
        // 2. 等待结果
        if (progressCallback) progressCallback('等待识别结果...');
        const result = await waitForResult(submitResult.requestId, 300000, progressCallback);
        
        if (result.success && result.status === 'completed') {
            return {
                success: true,
                text: result.text,
                utterances: result.utterances,
                duration: result.duration
            };
        } else {
            return {
                success: false,
                error: result.error || '识别失败'
            };
        }
    } catch (error) {
        console.error('语音转写失败:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * 检查配置是否有效
 */
function checkConfig() {
    return {
        appId: DOUBAO_ASR_CONFIG.appId,
        accessKey: DOUBAO_ASR_CONFIG.accessKey ? '已配置' : '未配置',
        resourceId: DOUBAO_ASR_CONFIG.resourceId
    };
}

module.exports = {
    transcribeAudio,
    submitTask,
    queryResult,
    waitForResult,
    checkConfig,
    DOUBAO_ASR_CONFIG
};
