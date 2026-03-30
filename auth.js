/**
 * 用户认证模块
 * 提供注册、登录、会话管理功能
 */

const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./runtime-paths');
const crypto = require('crypto');

// 数据文件路径
const DATA_DIR = getDataDir();
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ==================== 工具函数 ====================

/**
 * 生成密码哈希
 */
function hashPassword(password, salt = null) {
    salt = salt || crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
    return { hash, salt };
}

/**
 * 验证密码
 */
function verifyPassword(password, hash, salt) {
    const result = hashPassword(password, salt);
    return result.hash === hash;
}

/**
 * 生成会话Token
 */
function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

// ==================== 用户管理 ====================

/**
 * 获取所有用户
 */
function getUsers() {
    try {
        if (fs.existsSync(USERS_FILE)) {
            return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
        }
    } catch (e) {
        console.error('读取用户数据失败:', e);
    }
    return [];
}

/**
 * 保存用户数据
 */
function saveUsers(users) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

/**
 * 注册新用户
 */
function register(username, password, nickname = null) {
    if (!username || !password) {
        return { success: false, error: '用户名和密码不能为空' };
    }
    
    if (username.length < 3 || username.length > 20) {
        return { success: false, error: '用户名长度需要3-20个字符' };
    }
    
    if (password.length < 6) {
        return { success: false, error: '密码长度至少6个字符' };
    }
    
    const users = getUsers();
    
    // 检查用户名是否已存在
    if (users.find(u => u.username === username)) {
        return { success: false, error: '用户名已存在' };
    }
    
    // 创建新用户
    const { hash, salt } = hashPassword(password);
    const newUser = {
        id: crypto.randomUUID(),
        username,
        nickname: nickname || username,
        passwordHash: hash,
        salt,
        createdAt: new Date().toISOString(),
        lastLoginAt: null
    };
    
    users.push(newUser);
    saveUsers(users);
    
    console.log('✅ 新用户注册:', username);
    
    return { 
        success: true, 
        user: { 
            id: newUser.id, 
            username: newUser.username, 
            nickname: newUser.nickname 
        } 
    };
}

/**
 * 用户登录
 */
function login(username, password) {
    if (!username || !password) {
        return { success: false, error: '用户名和密码不能为空' };
    }
    
    const users = getUsers();
    const user = users.find(u => u.username === username);
    
    if (!user) {
        return { success: false, error: '用户名或密码错误' };
    }
    
    if (!verifyPassword(password, user.passwordHash, user.salt)) {
        return { success: false, error: '用户名或密码错误' };
    }
    
    // 更新最后登录时间
    user.lastLoginAt = new Date().toISOString();
    saveUsers(users);
    
    // 创建会话
    const token = generateToken();
    const session = {
        token,
        userId: user.id,
        username: user.username,
        nickname: user.nickname,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7天有效期
    };
    
    saveSession(session);
    
    console.log('✅ 用户登录:', username);
    
    return { 
        success: true, 
        token,
        user: { 
            id: user.id, 
            username: user.username, 
            nickname: user.nickname 
        } 
    };
}

/**
 * 用户登出
 */
function logout(token) {
    if (!token) {
        return { success: false, error: '无效的Token' };
    }
    
    const sessions = getSessions();
    const filtered = sessions.filter(s => s.token !== token);
    saveSessions(filtered);
    
    return { success: true };
}

// ==================== 会话管理 ====================

/**
 * 获取所有会话
 */
function getSessions() {
    try {
        if (fs.existsSync(SESSIONS_FILE)) {
            return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf-8'));
        }
    } catch (e) {
        console.error('读取会话数据失败:', e);
    }
    return [];
}

/**
 * 保存所有会话
 */
function saveSessions(sessions) {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
}

/**
 * 保存单个会话
 */
function saveSession(session) {
    const sessions = getSessions();
    // 清理该用户的旧会话（可选：允许多设备登录则注释掉这行）
    const filtered = sessions.filter(s => s.userId !== session.userId);
    filtered.push(session);
    saveSessions(filtered);
}

/**
 * 验证Token
 */
function verifyToken(token) {
    if (!token) {
        return { valid: false, error: '未提供Token' };
    }
    
    const sessions = getSessions();
    const session = sessions.find(s => s.token === token);
    
    if (!session) {
        return { valid: false, error: 'Token无效' };
    }
    
    // 检查是否过期
    if (new Date(session.expiresAt) < new Date()) {
        // 删除过期会话
        const filtered = sessions.filter(s => s.token !== token);
        saveSessions(filtered);
        return { valid: false, error: 'Token已过期' };
    }
    
    return { 
        valid: true, 
        user: {
            id: session.userId,
            username: session.username,
            nickname: session.nickname
        }
    };
}

/**
 * 清理过期会话
 */
function cleanExpiredSessions() {
    const sessions = getSessions();
    const now = new Date();
    const valid = sessions.filter(s => new Date(s.expiresAt) > now);
    
    if (valid.length < sessions.length) {
        saveSessions(valid);
        console.log(`清理了 ${sessions.length - valid.length} 个过期会话`);
    }
}

// 每小时清理一次过期会话
setInterval(cleanExpiredSessions, 60 * 60 * 1000);

// ==================== 导出模块 ====================

module.exports = {
    register,
    login,
    logout,
    verifyToken,
    getUsers,
    cleanExpiredSessions
};
