/**
 * 前端认证检查脚本
 * 在需要登录的页面引入此脚本
 */

(function() {
    const API_BASE = window.location.origin;
    const token = localStorage.getItem('auth_token');
    
    // 如果没有token，直接跳转登录
    if (!token) {
        window.location.href = 'login.html';
        return;
    }
    
    // 验证token是否有效
    fetch(`${API_BASE}/api/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
    })
    .then(res => res.json())
    .then(data => {
        if (!data.valid) {
            // Token无效，清除并跳转登录
            localStorage.removeItem('auth_token');
            localStorage.removeItem('user_info');
            window.location.href = 'login.html';
        } else {
            // Token有效，更新用户信息
            localStorage.setItem('user_info', JSON.stringify(data.user));
            
            // 触发认证成功事件
            window.dispatchEvent(new CustomEvent('authReady', { detail: data.user }));
        }
    })
    .catch(err => {
        console.error('认证检查失败:', err);
        // 网络错误时不强制跳转，允许离线使用
    });
    
    // 提供全局登出函数
    window.logout = function() {
        const token = localStorage.getItem('auth_token');
        
        fetch(`${API_BASE}/api/auth/logout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
        })
        .finally(() => {
            localStorage.removeItem('auth_token');
            localStorage.removeItem('user_info');
            window.location.href = 'login.html';
        });
    };
    
    // 获取当前用户信息
    window.getCurrentUser = function() {
        try {
            return JSON.parse(localStorage.getItem('user_info'));
        } catch {
            return null;
        }
    };
})();
