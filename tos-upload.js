/**
 * 火山引擎 TOS (对象存储) 上传模块
 * 用于临时托管音频文件供豆包API访问
 */

const https = require('https');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// TOS 配置 - 使用火山引擎对象存储
const TOS_CONFIG = {
    accessKeyId: process.env.TOS_ACCESS_KEY_ID || '',
    accessKeySecret: process.env.TOS_ACCESS_KEY_SECRET || '',
    bucket: process.env.TOS_BUCKET || 'douyin-audio-temp',
    region: process.env.TOS_REGION || 'cn-beijing',
    endpoint: process.env.TOS_ENDPOINT || 'tos-cn-beijing.volces.com'
};

/**
 * 生成签名
 */
function generateSignature(stringToSign, secretKey) {
    return crypto.createHmac('sha256', secretKey).update(stringToSign).digest('base64');
}

/**
 * 获取当前 UTC 时间字符串
 */
function getDateString() {
    return new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
}

/**
 * 上传文件到 TOS
 * @param {string} localPath - 本地文件路径
 * @param {string} objectKey - 对象存储中的文件名
 * @returns {Promise<string>} - 返回公开访问的 URL
 */
async function uploadToTOS(localPath, objectKey) {
    // 如果没有配置 TOS，返回 null
    if (!TOS_CONFIG.accessKeyId || !TOS_CONFIG.accessKeySecret) {
        console.log('⚠️ TOS 未配置，跳过上传');
        return null;
    }
    
    const fileContent = fs.readFileSync(localPath);
    const contentType = 'audio/mp4';
    const date = new Date().toUTCString();
    
    const host = `${TOS_CONFIG.bucket}.${TOS_CONFIG.endpoint}`;
    const canonicalResource = `/${TOS_CONFIG.bucket}/${objectKey}`;
    
    // 生成签名字符串
    const stringToSign = `PUT\n\n${contentType}\n${date}\n${canonicalResource}`;
    const signature = generateSignature(stringToSign, TOS_CONFIG.accessKeySecret);
    
    return new Promise((resolve, reject) => {
        const options = {
            hostname: host,
            port: 443,
            path: `/${objectKey}`,
            method: 'PUT',
            headers: {
                'Host': host,
                'Date': date,
                'Content-Type': contentType,
                'Content-Length': fileContent.length,
                'Authorization': `TOS ${TOS_CONFIG.accessKeyId}:${signature}`
            }
        };
        
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    const publicUrl = `https://${host}/${objectKey}`;
                    console.log('✅ 文件上传成功:', publicUrl);
                    resolve(publicUrl);
                } else {
                    console.error('TOS 上传失败:', res.statusCode, data);
                    reject(new Error(`TOS 上传失败: ${res.statusCode}`));
                }
            });
        });
        
        req.on('error', reject);
        req.write(fileContent);
        req.end();
    });
}

/**
 * 删除 TOS 中的文件
 */
async function deleteFromTOS(objectKey) {
    if (!TOS_CONFIG.accessKeyId || !TOS_CONFIG.accessKeySecret) {
        return;
    }
    
    const date = new Date().toUTCString();
    const host = `${TOS_CONFIG.bucket}.${TOS_CONFIG.endpoint}`;
    const canonicalResource = `/${TOS_CONFIG.bucket}/${objectKey}`;
    
    const stringToSign = `DELETE\n\n\n${date}\n${canonicalResource}`;
    const signature = generateSignature(stringToSign, TOS_CONFIG.accessKeySecret);
    
    return new Promise((resolve) => {
        const options = {
            hostname: host,
            port: 443,
            path: `/${objectKey}`,
            method: 'DELETE',
            headers: {
                'Host': host,
                'Date': date,
                'Authorization': `TOS ${TOS_CONFIG.accessKeyId}:${signature}`
            }
        };
        
        const req = https.request(options, (res) => {
            resolve(res.statusCode === 204);
        });
        
        req.on('error', () => resolve(false));
        req.end();
    });
}

/**
 * 检查 TOS 是否已配置
 */
function isTOSConfigured() {
    return !!(TOS_CONFIG.accessKeyId && TOS_CONFIG.accessKeySecret);
}

/**
 * 设置 TOS 配置
 */
function setTOSConfig(config) {
    if (config.accessKeyId) TOS_CONFIG.accessKeyId = config.accessKeyId;
    if (config.accessKeySecret) TOS_CONFIG.accessKeySecret = config.accessKeySecret;
    if (config.bucket) TOS_CONFIG.bucket = config.bucket;
    if (config.region) TOS_CONFIG.region = config.region;
    if (config.endpoint) TOS_CONFIG.endpoint = config.endpoint;
}

module.exports = {
    uploadToTOS,
    deleteFromTOS,
    isTOSConfigured,
    setTOSConfig,
    TOS_CONFIG
};
