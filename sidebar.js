/**
 * 统一侧边栏导航组件
 */
(function() {
    // 导航项配置
    const navItems = [
        { id: 'extract', icon: '🎬', label: '文案提取', href: 'index.html' },
        { id: 'authors', icon: '👤', label: '作者监控', href: 'authors.html' },
        { id: 'transcripts', icon: '📝', label: '文案库', href: 'transcripts.html' },
        { id: 'predictions', icon: '⚽', label: '球赛预测', href: 'predictions.html' }
    ];
    
    // 获取当前页面ID
    function getCurrentPageId() {
        const path = window.location.pathname;
        const filename = path.split('/').pop() || 'index.html';
        
        for (const item of navItems) {
            if (item.href === filename) {
                return item.id;
            }
        }
        return 'extract';
    }
    
    // 创建侧边栏HTML
    function createSidebar() {
        const currentId = getCurrentPageId();
        
        const sidebarHTML = `
            <div class="app-sidebar">
                <div class="sidebar-logo">
                    <span class="logo-icon">⚽</span>
                    <span class="logo-text">预测系统</span>
                </div>
                <nav class="sidebar-nav">
                    ${navItems.map(item => `
                        <a href="${item.href}" class="nav-item ${item.id === currentId ? 'active' : ''}" data-id="${item.id}">
                            <span class="nav-icon">${item.icon}</span>
                            <span class="nav-label">${item.label}</span>
                        </a>
                    `).join('')}
                </nav>
                <div class="sidebar-footer">
                    <a href="#" class="nav-item logout" onclick="if(typeof logout==='function'){logout();}else{localStorage.removeItem('authToken');window.location.href='login.html';}return false;">
                        <span class="nav-icon">🚪</span>
                        <span class="nav-label">退出</span>
                    </a>
                </div>
            </div>
        `;
        
        return sidebarHTML;
    }
    
    // 创建侧边栏样式
    function createStyles() {
        const styles = `
            <style id="sidebar-styles">
                :root {
                    --sidebar-width: 180px;
                    --sidebar-collapsed-width: 60px;
                    --sidebar-bg: #0d0d0d;
                    --sidebar-hover: #1a1a1a;
                    --sidebar-active: #1f1f1f;
                    --sidebar-text: #e0e0e0;
                    --sidebar-text-muted: #888;
                    --sidebar-accent: #3b82f6;
                }
                
                /* 重置所有页面的 body 样式 */
                html, body {
                    margin: 0 !important;
                    padding: 0 !important;
                    min-height: 100vh;
                    background: #0a0a0a !important;
                }
                
                /* 侧边栏 - 使用 !important 确保不被覆盖 */
                .app-sidebar {
                    width: var(--sidebar-width) !important;
                    min-width: var(--sidebar-width) !important;
                    max-width: var(--sidebar-width) !important;
                    height: 100vh !important;
                    position: fixed !important;
                    left: 0 !important;
                    top: 0 !important;
                    background: var(--sidebar-bg) !important;
                    border-right: 1px solid #222 !important;
                    display: flex !important;
                    flex-direction: column !important;
                    z-index: 9999 !important;
                    overflow: hidden !important;
                }
                
                .app-sidebar .sidebar-logo {
                    padding: 16px 14px !important;
                    display: flex !important;
                    align-items: center !important;
                    gap: 10px !important;
                    border-bottom: 1px solid #222 !important;
                    background: transparent !important;
                    margin: 0 !important;
                }
                
                .app-sidebar .sidebar-logo .logo-icon {
                    font-size: 20px !important;
                    width: auto !important;
                    height: auto !important;
                    background: none !important;
                    border-radius: 0 !important;
                    padding: 0 !important;
                    margin: 0 !important;
                    text-align: center !important;
                    animation: none !important;
                }
                
                .app-sidebar .sidebar-logo .logo-text {
                    font-size: 15px !important;
                    font-weight: 600 !important;
                    color: var(--sidebar-text) !important;
                    white-space: nowrap !important;
                    background: none !important;
                    -webkit-background-clip: unset !important;
                    -webkit-text-fill-color: unset !important;
                }
                
                .app-sidebar .sidebar-nav {
                    flex: 1 !important;
                    padding: 10px 6px !important;
                    display: flex !important;
                    flex-direction: column !important;
                    gap: 2px !important;
                    overflow-y: auto !important;
                }
                
                .app-sidebar .nav-item {
                    display: flex !important;
                    align-items: center !important;
                    gap: 10px !important;
                    padding: 10px 12px !important;
                    border-radius: 6px !important;
                    color: var(--sidebar-text-muted) !important;
                    text-decoration: none !important;
                    transition: all 0.2s ease !important;
                    cursor: pointer !important;
                    background: transparent !important;
                    border: none !important;
                    font-size: inherit !important;
                }
                
                .app-sidebar .nav-item:hover {
                    background: var(--sidebar-hover) !important;
                    color: var(--sidebar-text) !important;
                }
                
                .app-sidebar .nav-item.active {
                    background: var(--sidebar-active) !important;
                    color: var(--sidebar-accent) !important;
                }
                
                .app-sidebar .nav-icon {
                    font-size: 16px !important;
                    width: 22px !important;
                    text-align: center !important;
                    flex-shrink: 0 !important;
                }
                
                .app-sidebar .nav-label {
                    font-size: 13px !important;
                    white-space: nowrap !important;
                }
                
                .app-sidebar .sidebar-footer {
                    padding: 10px 6px !important;
                    border-top: 1px solid #222 !important;
                }
                
                .app-sidebar .sidebar-footer .nav-item.logout:hover {
                    background: rgba(239, 68, 68, 0.15) !important;
                    color: #ef4444 !important;
                }
                
                /* 主内容区域 */
                .app-main {
                    margin-left: var(--sidebar-width) !important;
                    min-height: 100vh !important;
                    width: calc(100% - var(--sidebar-width)) !important;
                    position: relative !important;
                }
                
                /* 确保背景元素在主内容区域内 */
                .app-main .background {
                    position: absolute !important;
                    left: 0 !important;
                    top: 0 !important;
                    width: 100% !important;
                    height: 100% !important;
                }
                
                /* 移动端适配 */
                @media (max-width: 768px) {
                    .app-sidebar {
                        width: var(--sidebar-collapsed-width) !important;
                        min-width: var(--sidebar-collapsed-width) !important;
                        max-width: var(--sidebar-collapsed-width) !important;
                    }
                    
                    .app-sidebar .sidebar-logo .logo-text,
                    .app-sidebar .nav-label {
                        display: none !important;
                    }
                    
                    .app-sidebar .nav-item {
                        justify-content: center !important;
                        padding: 12px !important;
                    }
                    
                    .app-main {
                        margin-left: var(--sidebar-collapsed-width) !important;
                        width: calc(100% - var(--sidebar-collapsed-width)) !important;
                    }
                }
            </style>
        `;
        
        return styles;
    }
    
    // 初始化侧边栏（使用 DOM 操作而非 innerHTML，保留事件绑定）
    function initSidebar() {
        // 添加样式
        document.head.insertAdjacentHTML('beforeend', createStyles());
        
        // 创建侧边栏元素
        const sidebarDiv = document.createElement('div');
        sidebarDiv.innerHTML = createSidebar();
        const sidebar = sidebarDiv.firstElementChild;
        
        // 创建主内容包装器
        const appMain = document.createElement('div');
        appMain.className = 'app-main';
        
        // 将 body 中的所有子元素移动到 appMain 中（保留事件绑定）
        while (document.body.firstChild) {
            appMain.appendChild(document.body.firstChild);
        }
        
        // 添加侧边栏和主内容到 body
        document.body.appendChild(sidebar);
        document.body.appendChild(appMain);
    }
    
    // DOM 加载完成后初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initSidebar);
    } else {
        initSidebar();
    }
})();
