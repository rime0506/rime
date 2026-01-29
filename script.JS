// 动态生成 Manifest 以支持单文件 PWA
const manifest = {
    "name": "Ins风桌面",
    "short_name": "Ins桌面",
    "start_url": ".",
    "display": "standalone",
    "background_color": "#ffffff",
    "theme_color": "#ffffff",
    "orientation": "portrait",
    "icons": [
        {
            "src": "https://img.heliar.top/file/1769158422909_无标题281_20251207015501_20260123165317.png",
            "sizes": "192x192",
            "type": "image/png"
        },
        {
            "src": "https://img.heliar.top/file/1769158422909_无标题281_20251207015501_20260123165317.png",
            "sizes": "512x512",
            "type": "image/png"
        }
    ]
};
const stringManifest = JSON.stringify(manifest);
const blob = new Blob([stringManifest], {type: 'application/manifest+json'});
const manifestURL = URL.createObjectURL(blob);
// 等待 DOM 加载完成后再设置 manifest
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
        const manifestLink = document.querySelector('#manifest-link');
        if (manifestLink) {
            manifestLink.setAttribute('href', manifestURL);
        }
    });
} else {
    const manifestLink = document.querySelector('#manifest-link');
    if (manifestLink) {
        manifestLink.setAttribute('href', manifestURL);
    }
}

// iOS 100vh 修复：动态计算视口高度
function setVh() {
    // 获取视口高度，不包含浏览器 UI（如 Safari 底部栏）
    let vh = window.innerHeight + 'px';
    document.documentElement.style.setProperty('--vh', vh);
}
// 初始化并监听 resize
setVh();
window.addEventListener('resize', setVh);

// 初始化DEXie数据库
const db = new Dexie('DesktopDB');
// 版本升级：增加 lorebooks 表
db.version(1).stores({
    dexiData: 'key, value'
});
db.version(2).stores({
    dexiData: 'key, value',
    lorebooks: '++id, name' // 新增世界书表：id自增，name索引
});
db.version(3).stores({
    dexiData: 'key, value',
    lorebooks: '++id, name',
    characters: '++id, name, type' // 新增角色表：type 用于区分 Char/NPC/User
});
db.version(4).stores({
    dexiData: 'key, value',
    lorebooks: '++id, name',
    characters: '++id, name, type',
    sticker_categories: '++id, name'
});
db.version(5).stores({
    dexiData: 'key, value',
    lorebooks: '++id, name',
    characters: '++id, name, type',
    sticker_categories: '++id, name',
    moments: '++id, userId, time, ownerUserId' // 新增朋友圈表 (ownerUserId 用于账号隔离)
});
db.version(6).stores({
    dexiData: 'key, value',
    lorebooks: '++id, name',
    characters: '++id, name, type',
    sticker_categories: '++id, name',
    moments: '++id, userId, time, ownerUserId',
    friend_requests: '++id, fromCharId, toAccountId, status, time' // 新增好友申请表
});

        let currentSelectIcon = '';
        let currentCharacterType = 'char'; // 默认为 char
        let editingCharId = null; // 当前编辑的角色ID
        let currentChatCharId = null; // 当前聊天对象ID
        let currentChatUserId = null; // 当前聊天使用的 User ID (临时缓存)
        let currentMyCharId = localStorage.getItem('current_my_char_id'); // 当前登录的“我”的角色ID

        // 模拟用户ID，实际项目中可能来自登录
        let currentUserId = localStorage.getItem('user_id');
        if (!currentUserId) {
            currentUserId = 'user_' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem('user_id', currentUserId);
        }
        
        // 全局定时器变量
        let notifTimer = null;
        let autoChatTimer = null; // 主动聊天定时器
        const autoChatLocks = new Set(); // 存储正在进行主动聊天的 charId，防止并发触发
        // 记录已知的通知ID，用于判断新消息
        let knownNotifIds = new Set();
        let isFirstLoad = true;
        // 缓存最新一条通知，用于定时弹窗文案
        let latestNotification = null;

        // --- 聊天交互全局变量 ---
        let longPressTimer = null;
        let isLongPress = false;
        let activeMsgIndex = -1; // 当前操作的消息索引
        let isSelectionMode = false;
        let selectedIndices = new Set(); // 选中的消息索引集合

        // 全局变量：表情包管理
        let currentStickerCategoryId = null;

        // 手动触发推送订阅（新增函数）
        async function manualSubscribePush() {
            console.log('[Manual] 手动触发推送订阅...');
            showDebugToast('正在注册推送...', true);
            
            try {
                await registerServiceWorkerAndSubscribe();
                alert('✅ 推送订阅成功！请查看诊断面板确认状态。');
            } catch (err) {
                console.error('[Manual] 订阅失败:', err);
                alert('❌ 订阅失败: ' + err.message);
            }
        }

        // 页面加载初始化
        window.onload = async function() {
            await restoreDesktopOrder(); // 优先恢复桌面图标顺序
            await restoreSetting(); // 异步恢复DEXie数据
            await migrateAccountData(); // 迁移账号隔离数据
            initDesktopDrag(); // 初始化桌面拖拽
            syncPreview();
            
            // 请求通知权限（就像你之前的版本）
            if ('Notification' in window && Notification.permission === 'default') {
                console.log('[通知] 请求通知权限...');
                Notification.requestPermission().then(permission => {
                    console.log('[通知] 权限结果:', permission);
                    if (permission === 'granted') {
                        showDebugToast('✓ 通知权限已授予', true);
                    }
                });
            }
            
            // 初始化通知设置
            const notifEnabled = localStorage.getItem('notification_enabled') === 'true';
            document.getElementById('notif-switch').checked = notifEnabled;
            
            // 初始化调试模式设置
            const debugEnabled = localStorage.getItem('debug_mode_enabled') === 'true';
            document.getElementById('debug-switch').checked = debugEnabled;
            
            // 初始化强力保活设置
            const keepaliveEnabled = localStorage.getItem('keepalive_enabled') === 'true';
            document.getElementById('keepalive-switch').checked = keepaliveEnabled;
            
            // 如果保活已开启，等待用户交互后启动
            if (keepaliveEnabled) {
                console.log('[Init] 保活已启用，等待用户交互...');
                document.addEventListener('click', function initKeepAlive() {
                    startKeepAlive();
                    document.removeEventListener('click', initKeepAlive);
                }, { once: true });
            }
            
            // 初始化通知轮询 (15秒检查，更快响应后端触发)
            if (notifEnabled) {
                startNotificationLoop(15);
            }
            
            // ✅ 修复：页面加载时立即注册 Service Worker 和订阅推送
            // 不再等待 startAutoChatLoop，而是立即执行
            if (location.protocol === 'https:' || location.hostname === 'localhost') {
                console.log('[Init] 立即注册 Service Worker 和订阅推送...');
                await registerServiceWorkerAndSubscribe();
            } else {
                console.warn('[Init] 当前环境不支持 Service Worker (需要 HTTPS 或 localhost)');
            }
            
            // 启动主动聊天检测 (每分钟一次)
            startAutoChatLoop();
        }

        // --- 通知系统逻辑 ---
        // 自动检测环境：本地用localhost，部署用Zeabur域名
        const BACKEND_URL = location.hostname === 'localhost' 
            ? 'http://localhost:5000'
            : 'https://rime2713.zeabur.app'; // ✅ 你的Zeabur域名（请确认是https）
        const API_BASE = BACKEND_URL + '/api';
        const SOCKET_URL = BACKEND_URL; // WebSocket自动使用同一个地址
        
        console.log('[Config] BACKEND_URL:', BACKEND_URL);
        console.log('[Config] Current hostname:', location.hostname);
        
        let socket = null; // WebSocket连接 

        // 启动轮询
        function startNotificationLoop(seconds) {
            if (notifTimer) clearInterval(notifTimer);

            const loopTask = () => {
                fetchNotifications();
            };
            
            console.log(`[Notification] Polling started, checking every ${seconds}s`);
            showDebugToast(`通知轮询: 每${seconds}秒检查`, true);
            
            loopTask(); // 立即执行一次
            notifTimer = setInterval(loopTask, seconds * 1000);
        }

        // 切换通知权限
        function toggleNotification(checkbox) {
            const enabled = checkbox.checked;
            localStorage.setItem('notification_enabled', enabled);
            if (enabled) {
                // 请求浏览器系统通知权限
                if ("Notification" in window) {
                    Notification.requestPermission().then(permission => {
                        if (permission === "granted") {
                            new Notification("系统通知已开启", { body: "即使在后台，您也能收到新消息提醒了~" });
                        } else {
                            alert("请在浏览器弹窗中点击【允许】，否则无法收到系统通知哦！");
                        }
                    });
                }
                startNotificationLoop(15); // 15秒检查
            } else {
                if (notifTimer) clearInterval(notifTimer);
                document.getElementById('notif-badge').style.display = 'none';
            }
        }

        // 测试通知功能
        function testNotification() {
            console.log('[Test] Testing notification system...');
            console.log('[Test] Browser supports Notification:', "Notification" in window);
            console.log('[Test] Current permission:', Notification.permission);
            console.log('[Test] Page visibility:', document.visibilityState);
            console.log('[Test] Page hidden:', document.hidden);
            
            if (!("Notification" in window)) {
                alert("你的浏览器不支持系统通知功能");
                return;
            }
            
            if (Notification.permission === "denied") {
                alert("通知权限已被拒绝，请在浏览器设置中允许通知权限后刷新页面");
                return;
            }
            
            if (Notification.permission === "granted") {
                // 立即发送第一条通知
                new Notification("测试通知", {
                    body: "如果你能看到这条通知，说明系统通知功能正常！",
                    icon: 'https://img.heliar.top/file/1769158422909_无标题281_20251207015501_20260123165317.png'
                });
                showDebugToast("✓ 立即发送通知！5秒后再发一条", true);
                
                // 5秒后发送第二条通知
                setTimeout(() => {
                    new Notification("延迟测试通知", {
                        body: "这是5秒后发送的通知，如果在后台也能收到，说明后台推送正常！",
                        icon: 'https://img.heliar.top/file/1769158422909_无标题281_20251207015501_20260123165317.png',
                        tag: 'delayed-test'
                    });
                    showDebugToast("✓ 5秒延迟通知已发送！", true);
                    console.log('[Test] 5秒延迟通知已发送');
                }, 5000);
                
            } else {
                Notification.requestPermission().then(permission => {
                    console.log('[Test] Permission request result:', permission);
                    if (permission === "granted") {
                        new Notification("测试通知", {
                            body: "权限已授予！系统通知功能正常工作",
                            icon: 'https://img.heliar.top/file/1769158422909_无标题281_20251207015501_20260123165317.png'
                        });
                        showDebugToast("✓ 权限已授予！通知已发送", true);
                    } else {
                        alert("通知权限被拒绝，无法发送通知");
                    }
                });
            }
        }

        // 切换调试模式
        function toggleDebugMode(checkbox) {
            const enabled = checkbox.checked;
            localStorage.setItem('debug_mode_enabled', enabled);
            if (enabled) {
                showDebugToast('调试模式已开启');
            }
        }

        // --- 强力保活功能 ---
        let keepAliveAudio = null;

        // 切换保活功能
        function toggleKeepAlive(checkbox) {
            const enabled = checkbox.checked;
            localStorage.setItem('keepalive_enabled', enabled);
            
            if (enabled) {
                startKeepAlive();
            } else {
                stopKeepAlive();
            }
        }

        // 启动保活
        async function startKeepAlive() {
            if (!keepAliveAudio) {
                keepAliveAudio = document.getElementById('keepalive-audio');
            }
            
            try {
                // 设置音量为0（静音）
                keepAliveAudio.volume = 0;
                
                // 尝试播放
                await keepAliveAudio.play();
                console.log('[KeepAlive] ✓ 保活音频已启动');
                showDebugToast('✓ 强力保活已启动', true);
                addLog('success', '强力保活已启动');
                
                // 监听播放错误
                keepAliveAudio.onerror = (e) => {
                    console.error('[KeepAlive] 音频播放错误:', e);
                    showDebugToast('✗ 保活音频加载失败');
                    addLog('error', '保活音频加载失败', e);
                };
                
            } catch (err) {
                console.error('[KeepAlive] 启动失败:', err);
                showDebugToast('⚠️ 需要用户交互才能启动');
                addLog('warning', '保活启动失败，需要用户交互', err);
                
                // 等待用户点击后重试
                document.addEventListener('click', function retryKeepAlive() {
                    startKeepAlive();
                    document.removeEventListener('click', retryKeepAlive);
                }, { once: true });
            }
        }

        // 停止保活
        function stopKeepAlive() {
            if (keepAliveAudio) {
                keepAliveAudio.pause();
                keepAliveAudio.currentTime = 0;
                console.log('[KeepAlive] ✓ 保活已停止');
                showDebugToast('✓ 保活已停止');
                addLog('info', '强力保活已停止');
            }
        }

        // 显示调试Toast（在手机上可见）
        let toastTimer = null;
        function showDebugToast(message, forceShow = false) {
            // 检查是否开启调试模式（测试通知时强制显示）
            const debugEnabled = localStorage.getItem('debug_mode_enabled') === 'true';
            if (!debugEnabled && !forceShow) {
                return;
            }
            
            // 创建或获取toast元素
            let toast = document.getElementById('debug-toast');
            if (!toast) {
                toast = document.createElement('div');
                toast.id = 'debug-toast';
                toast.className = 'debug-toast';
                document.body.appendChild(toast);
            }
            
            // 清除之前的定时器
            if (toastTimer) clearTimeout(toastTimer);
            
            // 显示消息
            toast.innerText = message;
            toast.classList.add('show');
            
            // 3秒后隐藏
            toastTimer = setTimeout(() => {
                toast.classList.remove('show');
            }, 3000);
        }

        // 全局日志系统
        const systemLogs = [];
        const MAX_LOGS = 100;
        
        function addLog(type, message, data = null) {
            const log = {
                time: new Date().toLocaleTimeString(),
                type: type, // 'info', 'success', 'warning', 'error'
                message: message,
                data: data
            };
            systemLogs.unshift(log);
            if (systemLogs.length > MAX_LOGS) systemLogs.pop();
            
            // 如果诊断面板打开，实时更新
            const logContainer = document.getElementById('diagnostic-logs');
            if (logContainer) {
                renderLogs();
            }
        }
        
        function renderLogs() {
            const container = document.getElementById('diagnostic-logs');
            if (!container) return;
            
            container.innerHTML = systemLogs.map(log => {
                const colors = {
                    info: '#007aff',
                    success: '#34c759',
                    warning: '#ff9500',
                    error: '#ff3b30'
                };
                const icons = {
                    info: 'ℹ️',
                    success: '✅',
                    warning: '⚠️',
                    error: '❌'
                };
                
                return `
                    <div style="padding:8px; border-bottom:1px solid #eee; font-size:12px;">
                        <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                            <span style="color:${colors[log.type]}; font-weight:bold;">${icons[log.type]} ${log.type.toUpperCase()}</span>
                            <span style="color:#999;">${log.time}</span>
                        </div>
                        <div style="color:#333;">${log.message}</div>
                        ${log.data ? `<pre style="background:#f5f5f5; padding:4px; border-radius:4px; margin-top:4px; font-size:10px; overflow-x:auto;">${JSON.stringify(log.data, null, 2)}</pre>` : ''}
                    </div>
                `;
            }).join('');
        }
        
        // 显示诊断面板
        async function showDiagnosticPanel() {
            const panel = document.createElement('div');
            panel.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0,0,0,0.8);
                z-index: 9999;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
            `;
            
            const content = document.createElement('div');
            content.style.cssText = `
                background: white;
                border-radius: 12px;
                padding: 20px;
                max-width: 500px;
                width: 100%;
                max-height: 80vh;
                overflow-y: auto;
            `;
            
            // 获取诊断信息
            let diagnosticInfo = `<h2 style="margin-top:0; color:#333;">🔍 诊断信息</h2>`;
            
            // 1. User ID
            diagnosticInfo += `<div style="margin-bottom:20px; padding:10px; background:#f5f5f5; border-radius:8px;">
                <strong style="color:#007aff;">User ID:</strong><br>
                <code style="background:#fff; padding:5px; border-radius:4px; display:block; margin-top:5px; word-break:break-all;">${currentUserId}</code>
            </div>`;
            
            // 2. 检查 Service Worker
            let swStatus = '❌ 未注册';
            if ('serviceWorker' in navigator) {
                const registration = await navigator.serviceWorker.getRegistration();
                if (registration) {
                    swStatus = '✅ 已注册';
                    if (registration.active) {
                        swStatus += ' (激活)';
                    }
                }
            }
            diagnosticInfo += `<div style="margin-bottom:20px; padding:10px; background:#f5f5f5; border-radius:8px;">
                <strong style="color:#007aff;">Service Worker:</strong><br>
                <span style="margin-top:5px; display:block;">${swStatus}</span>
            </div>`;
            
            // 3. 推送订阅状态
            let subStatus = '❌ 未订阅';
            let subEndpoint = '无';
            if ('serviceWorker' in navigator && 'PushManager' in window) {
                const registration = await navigator.serviceWorker.getRegistration();
                if (registration) {
                    const subscription = await registration.pushManager.getSubscription();
                    if (subscription) {
                        subStatus = '✅ 已订阅';
                        subEndpoint = subscription.endpoint.substring(0, 50) + '...';
                    }
                }
            }
            diagnosticInfo += `<div style="margin-bottom:20px; padding:10px; background:#f5f5f5; border-radius:8px;">
                <strong style="color:#007aff;">推送订阅:</strong><br>
                <span style="margin-top:5px; display:block;">${subStatus}</span>
                <code style="background:#fff; padding:5px; border-radius:4px; display:block; margin-top:5px; font-size:10px; word-break:break-all;">${subEndpoint}</code>
            </div>`;
            
            // 4. 通知权限
            const notifPerm = Notification.permission;
            const permIcon = notifPerm === 'granted' ? '✅' : notifPerm === 'denied' ? '❌' : '⚠️';
            diagnosticInfo += `<div style="margin-bottom:20px; padding:10px; background:#f5f5f5; border-radius:8px;">
                <strong style="color:#007aff;">通知权限:</strong><br>
                <span style="margin-top:5px; display:block;">${permIcon} ${notifPerm}</span>
            </div>`;
            
            // 5. 环境信息
            diagnosticInfo += `<div style="margin-bottom:20px; padding:10px; background:#f5f5f5; border-radius:8px;">
                <strong style="color:#007aff;">环境信息:</strong><br>
                <span style="margin-top:5px; display:block;">协议: ${location.protocol}</span>
                <span style="display:block;">域名: ${location.hostname}</span>
                <span style="display:block;">后端: ${BACKEND_URL}</span>
            </div>`;
            
            // 6. 开启主动聊天的角色
            const autoChars = await db.characters
                .filter(c => c.auto_reply_enabled === true && c.auto_reply_interval > 0)
                .toArray();
            diagnosticInfo += `<div style="margin-bottom:20px; padding:10px; background:#f5f5f5; border-radius:8px;">
                <strong style="color:#007aff;">主动聊天角色:</strong><br>
                <span style="margin-top:5px; display:block;">${autoChars.length} 个角色已启用</span>
                ${autoChars.map(c => `<div style="margin-top:5px; padding:5px; background:#fff; border-radius:4px;">
                    ${c.name} (${c.auto_reply_interval}分钟)
                </div>`).join('')}
            </div>`;
            
            // 7. 实时日志区域
            diagnosticInfo += `<div style="margin-bottom:20px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                    <strong style="color:#007aff;">📋 实时日志 (最近${systemLogs.length}条)</strong>
                    <button onclick="systemLogs.length=0; renderLogs();" style="padding:4px 8px; background:#ff3b30; color:#fff; border:none; border-radius:4px; font-size:11px;">清空</button>
                </div>
                <div id="diagnostic-logs" style="max-height:300px; overflow-y:auto; background:#f9f9f9; border-radius:8px; padding:10px;">
                    ${systemLogs.length === 0 ? '<div style="text-align:center; color:#999; padding:20px;">暂无日志</div>' : ''}
                </div>
            </div>`;
            
            content.innerHTML = diagnosticInfo;
            
            // 渲染日志
            renderLogs();
            
            // 关闭按钮
            const closeBtn = document.createElement('button');
            closeBtn.innerText = '关闭';
            closeBtn.style.cssText = `
                width: 100%;
                padding: 12px;
                background: var(--ins-pink);
                color: white;
                border: none;
                border-radius: 8px;
                font-size: 16px;
                cursor: pointer;
                margin-top: 10px;
            `;
            closeBtn.onclick = () => document.body.removeChild(panel);
            content.appendChild(closeBtn);
            
            panel.appendChild(content);
            document.body.appendChild(panel);
            
            // 点击背景关闭
            panel.onclick = (e) => {
                if (e.target === panel) {
                    document.body.removeChild(panel);
                }
            };
        }

        // 显示设置页面
        function showSettingPage() {
            document.getElementById('setting-page').style.display = 'flex';
        }
        function hideSettingPage() {
            document.getElementById('setting-page').style.display = 'none';
        }

        // ===== 数据导入导出功能 =====
        
        // 导出所有数据
        async function exportAllData() {
            try {
                const exportData = {
                    version: '1.0',
                    exportTime: new Date().toISOString(),
                    data: {}
                };
                
                // 导出所有数据库表
                exportData.data.dexiData = await db.dexiData.toArray();
                exportData.data.lorebooks = await db.lorebooks.toArray();
                exportData.data.characters = await db.characters.toArray();
                exportData.data.sticker_categories = await db.sticker_categories.toArray();
                exportData.data.moments = await db.moments.toArray();
                exportData.data.friend_requests = await db.friend_requests.toArray();
                
                // 导出 localStorage 数据
                exportData.localStorage = {
                    user_id: localStorage.getItem('user_id'),
                    current_my_char_id: localStorage.getItem('current_my_char_id'),
                    notification_enabled: localStorage.getItem('notification_enabled'),
                    debug_mode: localStorage.getItem('debug_mode'),
                    keepalive_enabled: localStorage.getItem('keepalive_enabled')
                };
                
                // 转换为JSON字符串
                const jsonString = JSON.stringify(exportData, null, 2);
                
                // 创建下载链接
                const blob = new Blob([jsonString], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `wechat_data_backup_${new Date().getTime()}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                
                alert('数据导出成功！');
            } catch (error) {
                console.error('导出数据失败:', error);
                alert('导出数据失败: ' + error.message);
            }
        }
        
        // 导入所有数据
        async function importAllData(input) {
            const file = input.files[0];
            if (!file) return;
            
            // 确认对话框
            if (!confirm('导入数据将覆盖现有数据，是否继续？\n\n建议先导出当前数据作为备份。')) {
                input.value = ''; // 清空文件选择
                return;
            }
            
            try {
                const text = await file.text();
                const importData = JSON.parse(text);
                
                // 验证数据格式
                if (!importData.version || !importData.data) {
                    throw new Error('数据格式不正确');
                }
                
                // 清空现有数据
                await db.dexiData.clear();
                await db.lorebooks.clear();
                await db.characters.clear();
                await db.sticker_categories.clear();
                await db.moments.clear();
                await db.friend_requests.clear();
                
                // 导入数据库表数据
                if (importData.data.dexiData) {
                    await db.dexiData.bulkAdd(importData.data.dexiData);
                }
                if (importData.data.lorebooks) {
                    await db.lorebooks.bulkAdd(importData.data.lorebooks);
                }
                if (importData.data.characters) {
                    await db.characters.bulkAdd(importData.data.characters);
                }
                if (importData.data.sticker_categories) {
                    await db.sticker_categories.bulkAdd(importData.data.sticker_categories);
                }
                if (importData.data.moments) {
                    await db.moments.bulkAdd(importData.data.moments);
                }
                if (importData.data.friend_requests) {
                    await db.friend_requests.bulkAdd(importData.data.friend_requests);
                }
                
                // 导入 localStorage 数据
                if (importData.localStorage) {
                    Object.keys(importData.localStorage).forEach(key => {
                        const value = importData.localStorage[key];
                        if (value !== null) {
                            localStorage.setItem(key, value);
                        }
                    });
                }
                
                input.value = ''; // 清空文件选择
                alert('数据导入成功！页面即将刷新...');
                
                // 刷新页面以应用导入的数据
                setTimeout(() => {
                    window.location.reload();
                }, 500);
                
            } catch (error) {
                console.error('导入数据失败:', error);
                alert('导入数据失败: ' + error.message);
                input.value = '';
            }
        }
        
        // 清空所有数据
        async function clearAllDataConfirm() {
            const confirm1 = confirm('⚠️ 警告：此操作将删除所有数据！\n\n包括：\n- 所有角色和聊天记录\n- 所有世界书\n- 所有表情包\n- 所有朋友圈\n- API设置\n\n此操作不可恢复，确定要继续吗？');
            if (!confirm1) return;
            
            const confirm2 = prompt('请输入"确认删除"以继续：');
            if (confirm2 !== '确认删除') {
                alert('已取消操作');
                return;
            }
            
            try {
                // 清空所有数据库表
                await db.dexiData.clear();
                await db.lorebooks.clear();
                await db.characters.clear();
                await db.sticker_categories.clear();
                await db.moments.clear();
                await db.friend_requests.clear();
                
                // 清空 localStorage
                localStorage.clear();
                
                alert('所有数据已清空！页面即将刷新...');
                
                setTimeout(() => {
                    window.location.reload();
                }, 500);
                
            } catch (error) {
                console.error('清空数据失败:', error);
                alert('清空数据失败: ' + error.message);
            }
        }

        // 显示通知中心
        function showNotificationCenter() {
            const enabled = localStorage.getItem('notification_enabled') === 'true';
            if (!enabled) return; // 未开启不显示

            document.getElementById('notification-center').style.display = 'block';
            fetchNotifications(); // 打开时刷新一下
        }
        function hideNotificationCenter() {
            document.getElementById('notification-center').style.display = 'none';
        }

        // 获取通知
        async function fetchNotifications() {
            const enabled = localStorage.getItem('notification_enabled') === 'true';
            if (!enabled) return;

            try {
                const res = await fetch(`${API_BASE}/notifications?user_id=${currentUserId}`);
                if (!res.ok) return;
                const list = await res.json();
                renderNotifications(list);
            } catch (err) {
                console.error('获取通知失败:', err);
            }
        }

        // 渲染通知列表
        function renderNotifications(list) {
            const container = document.getElementById('notif-list');
            container.innerHTML = '';
            
            let unreadCount = 0;

            if (list.length === 0) {
                container.innerHTML = '<div class="empty-tip">暂无新通知</div>';
                latestNotification = null;
            } else {
                // 确保列表是按时间倒序的
                list.sort((a, b) => b.timestamp - a.timestamp);
                
                // 更新最新的一条通知缓存
                latestNotification = list[0];

                list.forEach(item => {
                    // 1. 统计未读
                    if (!item.is_read) unreadCount++;

                    // 2. 检查是否有新消息 (不在已知列表中，且非首次加载)
                    if (!knownNotifIds.has(item.id)) {
                        knownNotifIds.add(item.id);
                        
                        // 仅当非首次加载时弹窗，避免刷新页面时狂弹
                        if (!isFirstLoad) {
                            sendSystemNotification(item.title, item.content);
                        }
                    }

                    // 3. 渲染DOM
                    const div = document.createElement('div');
                    div.className = `notif-item ${!item.is_read ? 'unread' : ''}`;
                    // 格式化时间戳
                    const date = new Date(item.timestamp * 1000);
                    const timeStr = `${date.getMonth()+1}-${date.getDate()} ${date.getHours()}:${date.getMinutes().toString().padStart(2, '0')}`;
                    
                    div.innerHTML = `
                        <div class="notif-time">${timeStr}</div>
                        <div class="notif-content-title">${item.title}</div>
                        <div class="notif-desc">${item.content}</div>
                    `;
                    div.onclick = () => markRead(item.id, item.is_read);
                    container.appendChild(div);
                });
            }
            
            // 首次加载标记置为false
            isFirstLoad = false;

            // 更新红点
            const badge = document.getElementById('notif-badge');
            badge.style.display = unreadCount > 0 ? 'block' : 'none';
        }

        // 发送系统通知
        function sendSystemNotification(title, body) {
            console.log(`[Notification] ========================================`);
            console.log(`[Notification] 🔔 尝试发送通知: "${title}" - "${body}"`);
            addLog('info', `尝试发送通知: ${title}`, { body, caller: new Error().stack.split('\n')[2] });
            
            // 检查浏览器是否支持通知
            if (!("Notification" in window)) {
                console.error('[Notification] ✗ 浏览器不支持通知');
                addLog('error', '浏览器不支持通知');
                showDebugToast('浏览器不支持通知');
                return;
            }
            
            // 检查权限状态
            const permission = Notification.permission;
            console.log(`[Notification] 权限状态: ${permission}`);
            addLog('info', `通知权限状态: ${permission}`);
            
            if (permission === "granted") {
                try {
                    console.log(`[Notification] ✓ 权限已授予，立即发送通知...`);
                    const notification = new Notification(title, { 
                        body: body,
                        icon: 'https://img.heliar.top/file/1769158422909_无标题281_20251207015501_20260123165317.png',
                        badge: 'https://img.heliar.top/file/1769158422909_无标题281_20251207015501_20260123165317.png',
                        tag: 'chat-message-' + Date.now(), // 每次都用新tag，避免被替换
                        requireInteraction: false,
                        silent: false
                    });
                    
                    notification.onclick = function() {
                        window.focus();
                        this.close();
                    };
                    
                    console.log('[Notification] ✓✓✓ 通知已成功发送！');
                    showDebugToast(`✓ 通知: ${title}`);
                } catch (error) {
                    console.error('[Notification] ✗✗✗ 发送失败:', error);
                    showDebugToast(`✗ 通知失败: ${error.message}`);
                }
            } else if (permission === "default") {
                console.log('[Notification] 权限未设置，请求权限...');
                Notification.requestPermission().then(permission => {
                    console.log(`[Notification] 权限请求结果: ${permission}`);
                    if (permission === "granted") {
                        try {
                            new Notification(title, { 
                                body: body,
                                icon: 'https://img.heliar.top/file/1769158422909_无标题281_20251207015501_20260123165317.png'
                            });
                            console.log('[Notification] ✓ 通知已发送（权限授予后）');
                        } catch (error) {
                            console.error('[Notification] ✗ 发送失败:', error);
                        }
                    } else {
                        console.warn('[Notification] ✗ 权限被拒绝');
                    }
                });
            } else {
                console.error('[Notification] ✗✗✗ 权限已被拒绝，无法发送通知');
                console.error('[Notification] 请在浏览器设置中允许通知权限');
                showDebugToast('✗ 通知权限被拒绝，请在设置中允许');
            }
            
            console.log(`[Notification] ========================================`);
        }

        // 标记已读
        async function markRead(id, isRead) {
            if (isRead) return; // 已经是已读

            try {
                await fetch(`${API_BASE}/notifications/${id}/read`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ user_id: currentUserId })
                });
                // 重新获取刷新列表
                fetchNotifications();
            } catch (err) {
                console.error('标记已读失败:', err);
            }
        }

        // 核心：折叠展开切换
        function toggleExpand(id) {
            const expand = document.getElementById(id);
            const arrow = document.getElementById(`arrow${id.replace('expand','')}`);
            if (expand.style.display === 'flex') {
                expand.style.display = 'none';
                arrow.classList.remove('active');
                // arrow.innerText = '→'; // SVG旋转
            } else {
                expand.style.display = 'flex';
                arrow.classList.add('active');
                // arrow.innerText = '↑'; // SVG旋转
            }
        }

        // 同步预览区和输入框
        function syncPreview() {
            // 壁纸预览
            const bg = document.getElementById('desktop-body').style.backgroundImage;
            if (bg) {
                document.getElementById('wallpaper-preview').style.backgroundImage = bg;
                document.getElementById('wallpaper-preview').innerText = '';
            }
            // 小组件
            document.getElementById('widget-icon-preview').style.backgroundImage = document.getElementById('widget-icon').style.backgroundImage;
            document.getElementById('widget-title-input').value = document.getElementById('widget-title').innerText.replace(/\{|\}/g, '').trim();
            document.getElementById('widget-subtext-input').value = document.getElementById('widget-subtext').innerText.trim();
            // 拍立得
            document.getElementById('photo-left-preview').style.backgroundImage = document.getElementById('img-left').style.backgroundImage;
            document.getElementById('photo-right-preview').style.backgroundImage = document.getElementById('img-right').style.backgroundImage;
            // 头像
            document.getElementById('avatar1-preview').style.backgroundImage = document.getElementById('avatar-img-1').style.backgroundImage;
            document.getElementById('avatar2-preview').style.backgroundImage = document.getElementById('avatar-img-2').style.backgroundImage;
            document.getElementById('avatar1-bubble-input').value = document.getElementById('avatar-bubble1').innerText.trim();
            document.getElementById('avatar1-name-input').value = document.getElementById('avatar-name1').innerText.trim();
            document.getElementById('avatar2-bubble-input').value = document.getElementById('avatar-bubble2').innerText.trim();
            document.getElementById('avatar2-name-input').value = document.getElementById('avatar-name2').innerText.trim();
            // 倒数日
            document.getElementById('days-input').value = document.getElementById('days-text').innerText.trim();
            // 椭圆形颜色
            const capsuleColor = getComputedStyle(document.documentElement).getPropertyValue('--capsule-bg').trim() || '#FFF7FA';
            const bubbleColor = getComputedStyle(document.documentElement).getPropertyValue('--bubble-bg').trim() || '#FFF7FA';
            document.getElementById('capsule-color-input').value = capsuleColor;
            document.getElementById('bubble-color-input').value = bubbleColor;
        }

        // 页面切换
        function showCustomPage() {
            document.getElementById('home-page').style.display = 'none';
            document.getElementById('custom-main-page').style.display = 'flex';
            syncPreview();
        }
        function backHomePage() {
            document.getElementById('custom-main-page').style.display = 'none';
            document.getElementById('home-page').style.display = 'block';
        }

        // 各项自定义方法
        function setWallpaper(input) {
            const file = input.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = e => {
                    document.getElementById('desktop-body').style.backgroundImage = `url(${e.target.result})`;
                    document.getElementById('wallpaper-preview').style.backgroundImage = `url(${e.target.result})`;
                    document.getElementById('wallpaper-preview').innerText = '';
                };
                reader.readAsDataURL(file);
            }
            input.value = '';
        }
        function selectIcon(iconId) {
            currentSelectIcon = iconId;
            document.getElementById('custom-icon-input').click();
        }
        function setCustomIcon(input) {
            const file = input.files[0];
            if (file && currentSelectIcon) {
                const reader = new FileReader();
                reader.onload = e => {
                    let iconDom = document.getElementById(`icon-${currentSelectIcon}`)?.querySelector('.icon') || document.getElementById(`dock-${currentSelectIcon}`)?.querySelector('.icon');
                    if (iconDom) iconDom.style.backgroundImage = `url(${e.target.result})`;
                };
                reader.readAsDataURL(file);
            }
            input.value = '';
        }
        function setWidgetIcon(input) {
            const file = input.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = e => {
                    document.getElementById('widget-icon').style.backgroundImage = `url(${e.target.result})`;
                    document.getElementById('widget-icon-preview').style.backgroundImage = `url(${e.target.result})`;
                };
                reader.readAsDataURL(file);
            }
            input.value = '';
        }
        function setPhoto(pos, input) {
            const file = input.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = e => {
                    document.getElementById(`img-${pos}`).style.backgroundImage = `url(${e.target.result})`;
                    document.getElementById(`photo-${pos}-preview`).style.backgroundImage = `url(${e.target.result})`;
                };
                reader.readAsDataURL(file);
            }
            input.value = '';
        }
        function setAvatar(id, input) {
            const file = input.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = e => {
                    const img = document.getElementById(`avatar-img-${id}`);
                    img.style.backgroundImage = `url(${e.target.result})`;
                    img.classList.add('has-image');
                    document.getElementById(`avatar${id}-preview`).style.backgroundImage = `url(${e.target.result})`;
                };
                reader.readAsDataURL(file);
            }
            input.value = '';
        }

        // --- API 设置逻辑 (折叠版) ---
        function toggleApiSetting() {
            const body = document.getElementById('api-setting-body');
            const arrow = document.getElementById('api-setting-arrow');
            if (body.style.display === 'block') {
                body.style.display = 'none';
                arrow.classList.remove('expanded');
            } else {
                body.style.display = 'block';
                arrow.classList.add('expanded');
                loadAiConfig(); // 展开时加载
            }
        }

        function toggleKeyVis() {
            const input = document.getElementById('ai-key-input');
            const icon = document.querySelector('.eye-icon');
            if (input.type === 'password') {
                input.type = 'text';
                icon.innerText = '隐藏';
            } else {
                input.type = 'password';
                icon.innerText = '显示';
            }
        }

        function updateTempDisplay(val) {
            document.getElementById('temp-val-display').innerText = val;
        }
        
        // 加载 API 配置
        async function loadAiConfig() {
            try {
                const urlItem = await db.dexiData.get('aiBaseUrl');
                const keyItem = await db.dexiData.get('aiApiKey');
                const modelItem = await db.dexiData.get('aiCurrentModel');
                const listItem = await db.dexiData.get('aiModelList');
                const tempItem = await db.dexiData.get('aiTemperature');

                if (urlItem) document.getElementById('ai-url-input').value = urlItem.value;
                if (keyItem) document.getElementById('ai-key-input').value = keyItem.value;
                if (tempItem) {
                    document.getElementById('ai-temp-slider').value = tempItem.value;
                    updateTempDisplay(tempItem.value);
                }
                
                // 恢复下拉框
                const select = document.getElementById('ai-model-select');
                if (listItem && listItem.value) {
                    const models = JSON.parse(listItem.value);
                    select.innerHTML = '<option value="" disabled>请选择模型</option>';
                    models.forEach(m => {
                        const opt = document.createElement('option');
                        opt.value = m.id;
                        opt.text = m.id;
                        select.appendChild(opt);
                    });
                }
                
                if (modelItem) {
                    select.value = modelItem.value;
                }
            } catch (e) {
                console.error("加载 API 配置失败", e);
            }
        }

        // 自动保存 API 配置 (每次输入变更时)
        async function autoSaveApi() {
            const url = document.getElementById('ai-url-input').value.trim();
            const key = document.getElementById('ai-key-input').value.trim();
            const model = document.getElementById('ai-model-select').value;
            const temp = document.getElementById('ai-temp-slider').value;
            
            await db.dexiData.put({ key: 'aiBaseUrl', value: url });
            await db.dexiData.put({ key: 'aiApiKey', value: key });
            await db.dexiData.put({ key: 'aiCurrentModel', value: model });
            await db.dexiData.put({ key: 'aiTemperature', value: temp });
        }

        // 构造智能 URL (自动补全 /v1)
        function getSmartUrl(baseUrl, endpoint) {
            let url = baseUrl;
            if (url.endsWith('/')) url = url.slice(0, -1);
            // 如果用户没有写 /v1，且不是直接请求完整路径，自动补全 /v1
            if (!url.includes('/v1')) {
                url += '/v1';
            }
            return url + endpoint;
        }

        // 拉取模型列表
        async function fetchModels() {
            const url = document.getElementById('ai-url-input').value.trim();
            const key = document.getElementById('ai-key-input').value.trim();
            
            if (!url) {
                alert("请先填写反代地址");
                return;
            }

            const spinner = document.getElementById('fetch-spinner');
            const btnText = document.getElementById('fetch-text');
            spinner.style.display = 'inline-block';
            btnText.style.display = 'none';
            
            // 构造请求 URL: 自动补全 /v1/models
            const requestUrl = getSmartUrl(url, '/models');

            try {
                const res = await fetch(requestUrl, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${key}`,
                        'Content-Type': 'application/json'
                    }
                });
                
                if (!res.ok) {
                    throw new Error(`HTTP Error ${res.status}`);
                }
                
                const data = await res.json();
                let models = [];
                if (Array.isArray(data)) {
                    models = data;
                } else if (data.data && Array.isArray(data.data)) {
                    models = data.data;
                }
                
                const select = document.getElementById('ai-model-select');
                select.innerHTML = '<option value="" disabled selected>请选择模型</option>';
                models.forEach(m => {
                    const opt = document.createElement('option');
                    opt.value = m.id;
                    opt.text = m.id;
                    select.appendChild(opt);
                });
                
                await db.dexiData.put({ key: 'aiModelList', value: JSON.stringify(models) });
                alert(`成功获取 ${models.length} 个模型！`);
                
            } catch (err) {
                console.error(err);
                alert(`拉取失败: ${err.message}\n尝试请求: ${requestUrl}`);
            } finally {
                spinner.style.display = 'none';
                btnText.style.display = 'inline';
            }
        }

        // 测试连接
        async function testConnection() {
            const url = document.getElementById('ai-url-input').value.trim();
            const key = document.getElementById('ai-key-input').value.trim();
            const model = document.getElementById('ai-model-select').value;
            
            if (!url || !model) {
                alert("请先完善配置并选择模型");
                return;
            }

            const btn = document.querySelector('.test-btn');
            const originalText = document.getElementById('test-btn-text').innerText;
            document.getElementById('test-btn-text').innerText = "测试中...";
            btn.style.opacity = "0.7";

            // 构造简单的 Chat 请求
            const requestUrl = getSmartUrl(url, '/chat/completions');
            
            try {
                const res = await fetch(requestUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${key}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: model,
                        messages: [{ role: "user", content: "Hi" }],
                        max_tokens: 5
                    })
                });

                if (res.ok) {
                    alert("✅ 连接成功！API 配置有效。");
                } else {
                    const errText = await res.text();
                    alert(`❌ 连接失败 (${res.status}):\n${errText}`);
                }
            } catch (e) {
                alert(`❌ 网络错误: ${e.message}`);
            } finally {
                document.getElementById('test-btn-text').innerText = originalText;
                btn.style.opacity = "1";
            }
        }

        // 核心：保存所有设置到DEXie (保留原有逻辑，仅排除 AI 相关 key 防止覆盖)
        async function saveAllSetting() {
            // ... (AI配置独立保存，这里只负责个性化设置)
            // 整理所有要存储的数据
            const saveData = {
                wallpaper: document.getElementById('desktop-body').style.backgroundImage.replace(/url\(|\)|"/g, ''),
                widgetIcon: document.getElementById('widget-icon').style.backgroundImage.replace(/url\(|\)|"/g, ''),
                widgetTitle: document.getElementById('widget-title-input').value.trim() || '{`{ lovely Day ¸.*・~ ★`}',
                widgetSubtext: document.getElementById('widget-subtext-input').value.trim() || '世界破破烂烂小猫缝缝补补 🐾',
                photoLeft: document.getElementById('img-left').style.backgroundImage.replace(/url\(|\)|"/g, ''),
                photoRight: document.getElementById('img-right').style.backgroundImage.replace(/url\(|\)|"/g, ''),
                avatar1: document.getElementById('avatar-img-1').style.backgroundImage.replace(/url\(|\)|"/g, ''),
                avatar2: document.getElementById('avatar-img-2').style.backgroundImage.replace(/url\(|\)|"/g, ''),
                avatar1Bubble: document.getElementById('avatar1-bubble-input').value.trim() || '> .. <',
                avatar1Name: document.getElementById('avatar1-name-input').value.trim() || '> .. <',
                avatar2Bubble: document.getElementById('avatar2-bubble-input').value.trim() || 'gw..♡',
                avatar2Name: document.getElementById('avatar2-name-input').value.trim() || 'gw..♡',
                daysText: document.getElementById('days-input').value.trim() || '446 days'
            };
            
            // ... (后续逻辑不变，但注意 clear() 会清除 AI 配置，需要修改)
            
            // ★ 修改点：不能直接 db.dexiData.clear()，因为会删掉 AI 配置
            // 方案：只 put 更新这些 UI 相关的 key，不使用 clear
            
            // 存储应用图标
            const iconIds = ['setting','notes','remind','facetime','calendar','photo','camera'];
            iconIds.forEach(id => {
                saveData[`icon${id.charAt(0).toUpperCase() + id.slice(1)}`] = document.getElementById(`icon-${id}`).querySelector('.icon').style.backgroundImage.replace(/url\(|\)|"/g, '');
            });
            // 存储Dock图标
            const dockIds = ['setting','custom','message','music'];
            dockIds.forEach(id => {
                saveData[`dock${id.charAt(0).toUpperCase() + id.slice(1)}`] = document.getElementById(`dock-${id}`).querySelector('.icon').style.backgroundImage.replace(/url\(|\)|"/g, '');
            });

            // 保存椭圆形颜色
            const capsuleColor = document.getElementById('capsule-color-input').value;
            const bubbleColor = document.getElementById('bubble-color-input').value;
            saveData.capsuleColor = capsuleColor;
            saveData.bubbleColor = bubbleColor;

            // 循环保存
            for (const [key, value] of Object.entries(saveData)) {
                await db.dexiData.put({ key, value });
            }

            // 实时更新页面显示
            document.getElementById('widget-title').innerText = saveData.widgetTitle;
            document.getElementById('widget-subtext').innerText = saveData.widgetSubtext;
            document.getElementById('avatar-bubble1').innerText = saveData.avatar1Bubble;
            document.getElementById('avatar-name1').innerText = saveData.avatar1Name;
            document.getElementById('avatar-bubble2').innerText = saveData.avatar2Bubble;
            document.getElementById('avatar-name2').innerText = saveData.avatar2Name;
            document.getElementById('days-text').innerText = saveData.daysText;
            
            // 应用椭圆形颜色
            document.documentElement.style.setProperty('--capsule-bg', capsuleColor);
            document.documentElement.style.setProperty('--bubble-bg', bubbleColor);

            // 保存提示
            const tip = document.getElementById('save-tip');
            tip.style.display = 'block';
            setTimeout(() => tip.style.display = 'none', 1500);
        }

// --- 日历时间设定逻辑 (Premium Pink Pro) ---

const calendar = {
    date: new Date(),        // 当前浏览的日期（用于翻页）
    selectedDate: new Date(), // 用户选中的日期
    isSelectorOpen: false,   // 状态标识
    isInitialized: false,    // 是否已初始化

    elements: {},

    months: ["1月 · January", "2月 · February", "3月 · March", "4月 · April", "5月 · May", "6月 · June", "7月 · July", "8月 · August", "9月 · September", "10月 · October", "11月 · November", "12月 · December"],
    monthsShort: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],

    init() {
        if (this.isInitialized) return;
        
        this.elements = {
            // Containers
            calendarLayer: document.getElementById('cal-calendarLayer'),
            selectorLayer: document.getElementById('cal-selectorLayer'),
            
            // Display/Inputs
            headerBtn: document.getElementById('cal-headerTitleBtn'),
            headerText: document.getElementById('cal-monthYearText'),
            daysContainer: document.getElementById('cal-daysContainer'),
            monthGrid: document.getElementById('cal-monthGrid'),
            yearList: document.getElementById('cal-yearList'),
            
            // Buttons
            prevBtn: document.getElementById('cal-prevBtn'),
            nextBtn: document.getElementById('cal-nextBtn'),
            
            // Time
            hourInput: document.getElementById('cal-hourInput'),
            minuteInput: document.getElementById('cal-minuteInput'),
            confirmBtn: document.getElementById('cal-confirmBtn')
        };

        this.bindEvents();
        this.renderSelectorItems();
        this.isInitialized = true;
    },

    // 渲染日历网格
    render() {
        // 设置标题
        this.elements.headerText.innerHTML = `${this.months[this.date.getMonth()].split(' · ')[0]} <span style="font-weight:300; opacity:0.6; font-size:0.9em">${this.date.getFullYear()}</span>`;

        this.date.setDate(1);
        const lastDay = new Date(this.date.getFullYear(), this.date.getMonth() + 1, 0).getDate();
        const firstDayIndex = this.date.getDay(); // 0 is Sunday
        
        let daysHTML = "";

        // 空白占位
        for (let x = 0; x < firstDayIndex; x++) {
            daysHTML += `<div class="day fade"></div>`;
        }

        // 日期
        for (let i = 1; i <= lastDay; i++) {
            const isToday = i === new Date().getDate() && 
                          this.date.getMonth() === new Date().getMonth() && 
                          this.date.getFullYear() === new Date().getFullYear();
            
            const isSelected = i === this.selectedDate.getDate() &&
                             this.date.getMonth() === this.selectedDate.getMonth() &&
                             this.date.getFullYear() === this.selectedDate.getFullYear();

            let classes = "day";
            if (isToday) classes += " today";
            if (isSelected) classes += " selected";

            // 使用 onclick 字符串绑定可能会有问题，这里改用事件委托或直接生成HTML后绑定
            // 为了简单，我们使用全局函数 calendarSelectDay
            daysHTML += `<div class="${classes}" onclick="calendarSelectDay(${i})">${i}</div>`;
        }

        this.elements.daysContainer.innerHTML = daysHTML;
        
        // 更新选择器的高亮状态
        this.updateSelectorHighlights();
    },

    // 渲染选择器的内容（月份和年份列表）
    renderSelectorItems() {
        // 1. 渲染月份
        let mHtml = '';
        this.months.forEach((m, index) => {
            const ch = m.split(' · ')[0];
            const en = this.monthsShort[index];
            mHtml += `<div class="sel-month-item" onclick="calendarSetMonth(${index})">
                <span style="font-weight:700">${ch}</span> 
                <span style="font-size:0.8em; opacity:0.7">${en}</span>
            </div>`;
        });
        this.elements.monthGrid.innerHTML = mHtml;

        // 2. 渲染年份 (前后50年)
        const currentYear = new Date().getFullYear();
        let yHtml = '';
        for(let y = currentYear - 50; y <= currentYear + 50; y++) {
            yHtml += `<div class="sel-year-item" id="year-${y}" onclick="calendarSetYear(${y})">${y}</div>`;
        }
        this.elements.yearList.innerHTML = yHtml;
    },

    updateSelectorHighlights() {
        // 高亮月份
        const monthItems = this.elements.monthGrid.children;
        for(let item of monthItems) item.classList.remove('selected');
        if(monthItems[this.date.getMonth()]) monthItems[this.date.getMonth()].classList.add('selected');

        // 高亮年份并滚动
        const yearItems = this.elements.yearList.children;
        for(let item of yearItems) item.classList.remove('selected');
        
        const activeYearEl = document.getElementById(`year-${this.date.getFullYear()}`);
        if(activeYearEl) {
            activeYearEl.classList.add('selected');
            // 如果面板开着，才滚动，否则会在后台乱滚
            if(this.isSelectorOpen) {
                activeYearEl.scrollIntoView({block: "center", behavior: "smooth"});
            }
        }
    },

    toggleSelector() {
        this.isSelectorOpen = !this.isSelectorOpen;
        
        if(this.isSelectorOpen) {
            this.elements.calendarLayer.classList.remove('active');
            this.elements.selectorLayer.classList.add('active');
            this.elements.headerBtn.classList.add('active');
            
            this.elements.prevBtn.style.opacity = '0';
            this.elements.prevBtn.style.pointerEvents = 'none';
            this.elements.nextBtn.style.opacity = '0';
            this.elements.nextBtn.style.pointerEvents = 'none';

            setTimeout(() => {
                const activeYear = document.getElementById(`year-${this.date.getFullYear()}`);
                if(activeYear) activeYear.scrollIntoView({block: "center"});
            }, 100);

        } else {
            this.elements.selectorLayer.classList.remove('active');
            this.elements.calendarLayer.classList.add('active');
            this.elements.headerBtn.classList.remove('active');

            this.elements.prevBtn.style.opacity = '1';
            this.elements.prevBtn.style.pointerEvents = 'auto';
            this.elements.nextBtn.style.opacity = '1';
            this.elements.nextBtn.style.pointerEvents = 'auto';
        }
    },

    setMonth(index) {
        this.date.setMonth(index);
        this.render();
    },

    setYear(year) {
        this.date.setFullYear(year);
        this.render();
    },
    
    selectDay(day) {
        this.selectedDate = new Date(this.date.getFullYear(), this.date.getMonth(), day);
        // 保留当前的小时分钟
        const h = parseInt(this.elements.hourInput.value) || 0;
        const m = parseInt(this.elements.minuteInput.value) || 0;
        this.selectedDate.setHours(h);
        this.selectedDate.setMinutes(m);
        
        this.render();
    },

    updateTimeInputs() {
        const h = this.selectedDate.getHours().toString().padStart(2, '0');
        const m = this.selectedDate.getMinutes().toString().padStart(2, '0');
        this.elements.hourInput.value = h;
        this.elements.minuteInput.value = m;
    },

    bindEvents() {
        // 头部点击 -> 打开选择器
        this.elements.headerBtn.addEventListener('click', () => this.toggleSelector());

        // 左右导航
        this.elements.prevBtn.addEventListener('click', () => {
            this.date.setMonth(this.date.getMonth() - 1);
            this.render();
        });
        this.elements.nextBtn.addEventListener('click', () => {
            this.date.setMonth(this.date.getMonth() + 1);
            this.render();
        });

        // 时间输入及确认
        const formatTime = (e) => {
            let val = parseInt(e.target.value);
            const max = e.target.id === 'cal-hourInput' ? 23 : 59;
            if(isNaN(val) || val < 0) val = 0; if(val > max) val = max;
            e.target.value = val.toString().padStart(2, '0');
            
            // 更新 selectedDate
            if (e.target.id === 'cal-hourInput') this.selectedDate.setHours(val);
            else this.selectedDate.setMinutes(val);
        };

        this.elements.hourInput.addEventListener('change', formatTime);
        this.elements.minuteInput.addEventListener('change', formatTime);
        
        // 确认按钮逻辑
        this.elements.confirmBtn.addEventListener('click', () => {
            if (this.isSelectorOpen) {
                this.toggleSelector(); // 关闭选择器，回到日历视图
            } else {
                saveCalendarTime(); // 调用全局保存函数
            }
        });
    }
};

// 全局辅助函数供 onclick 调用
function calendarSelectDay(day) {
    calendar.selectDay(day);
}
function calendarSetMonth(index) {
    calendar.setMonth(index);
}
function calendarSetYear(year) {
    calendar.setYear(year);
}

// 主入口
async function showCalendarPage() {
    if (!currentChatCharId) {
        alert("请先选择一个聊天对象");
        return;
    }
    
    closeChatPanel();
    document.getElementById('calendar-page').style.display = 'flex';
    
    // 初始化日历 DOM 绑定
    calendar.init();
    
    // 获取角色时间
    const char = await db.characters.get(currentChatCharId);
    const now = Date.now();
    const offset = char.timeOffset || 0;
    const virtualTime = new Date(now + offset);
    
    // 设置日历初始状态
    calendar.selectedDate = new Date(virtualTime); // 复制一份
    calendar.date = new Date(virtualTime); // 浏览视图也设为当前时间
    
    calendar.updateTimeInputs(); // 更新输入框
    calendar.render(); // 渲染日历
}

function hideCalendarPage() {
    document.getElementById('calendar-page').style.display = 'none';
}

async function saveCalendarTime() {
    if (!currentChatCharId) return;
    
    // 从 calendar 对象获取最终时间
    const targetTime = calendar.selectedDate.getTime();
    const now = Date.now();
    const offset = targetTime - now;
    
    const char = await db.characters.get(currentChatCharId);
    char.timeOffset = offset;
    
    await db.characters.put(char);
    
    hideCalendarPage();
    alert("时间设定已更新");
}

// 辅助函数：获取格式化的虚拟时间字符串
function getFormattedVirtualTime(offset) {
    const now = Date.now();
    const virtualNow = new Date(now + (offset || 0));
    
    const year = virtualNow.getFullYear();
    const month = virtualNow.getMonth() + 1;
    const day = virtualNow.getDate();
    const hours = virtualNow.getHours().toString().padStart(2, '0');
    const mins = virtualNow.getMinutes().toString().padStart(2, '0');
    const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const week = weekDays[virtualNow.getDay()];
    
    return `${year}年${month}月${day}日 ${hours}:${mins} (${week})`;
}

// --- App Store 逻辑 ---
function showAppStorePage() {
    document.getElementById('appstore-page').style.display = 'flex';
    switchAppStoreTab('today');
}

// 信息页面数据
const messageChats = [
    { 
        id: 'welcome', 
        name: '欢迎小助手', 
        avatar: 'https://img.icons8.com/color/96/chat.png', 
        time: '刚刚', 
        preview: '欢迎使用这个网页！', 
        unread: false, 
        chatTimeLabel: '刚刚',
        messages: [
            { 
                type: 'received', 
                text: '欢迎使用这个网页！🎉\n\n这是一个仿 iOS 风格的信息应用，你可以在这里：\n\n• 查看和管理你的信息\n• 与好友聊天\n• 发送和接收消息\n\n希望你能喜欢这个设计！如有任何问题，随时告诉我。' 
            }
        ]
    }
];

// 渲染信息列表
function renderMessageList() {
    const listContainer = document.getElementById('message-chat-list-container');
    if (!listContainer) return;
    
    listContainer.innerHTML = '';
    messageChats.forEach(chat => {
        const unreadClass = chat.unread ? 'message-unread' : '';
        const unreadDot = chat.unread ? `<div class="message-unread-dot"></div>` : '';
        const html = `
            <div class="message-chat-item ${unreadClass}" onclick="openMessageChat('${chat.id}')">
                <div class="message-avatar">
                    <img src="${chat.avatar}" style="width:100%;height:100%;object-fit:cover;" onerror="this.src='https://img.icons8.com/color/96/user.png'">
                </div>
                <div class="message-chat-info">
                    <div class="message-chat-top">
                        <span class="message-chat-name">${chat.name}</span>
                        <div class="message-chat-time">
                            <span>${chat.time}</span>
                        </div>
                    </div>
                    <div class="message-chat-bottom">
                        <div class="message-chat-preview">${chat.preview}</div>
                        ${unreadDot}
                    </div>
                </div>
            </div>
        `;
        listContainer.insertAdjacentHTML('beforeend', html);
    });
}

// 打开聊天详情
function openMessageChat(id) {
    console.log('openMessageChat called with id:', id);
    const chat = messageChats.find(c => c.id === id);
    if (!chat) {
        console.error('Chat not found:', id);
        return;
    }
    
    // 隐藏列表页
    const listPage = document.getElementById('message-list-page');
    if (listPage) {
        listPage.style.display = 'none';
    }
    
    // 显示详情页
    const detailPage = document.getElementById('message-detail-page');
    if (!detailPage) {
        console.error('Detail page not found');
        return;
    }
    
    // 先设置 display，再添加 active 类触发动画
    detailPage.style.display = 'flex';
    // 使用 setTimeout 确保 display 设置后再触发动画
    setTimeout(() => {
        detailPage.classList.add('active');
    }, 10);
    
    // 设置聊天信息
    document.getElementById('message-detail-name').innerText = chat.name;
    const avatarEl = document.getElementById('message-detail-avatar');
    if (avatarEl) {
        avatarEl.src = chat.avatar;
        avatarEl.onerror = function() {
            this.src = 'https://img.icons8.com/color/96/user.png';
        };
    }
    
    // 渲染消息
    const msgContainer = document.getElementById('message-container');
    if (!msgContainer) {
        console.error('Message container not found');
        return;
    }
    
    let htmlContent = `<div class="message-ts-group"><span class="message-ts-label">iMessage</span><span class="message-ts-time">${chat.chatTimeLabel || '今天'}</span></div>`;
    
    chat.messages.forEach((msg, index) => {
        htmlContent += `<div class="message-wrapper"><div class="message-bubble ${msg.type === 'sent' ? 'message-sent' : 'message-received'}">${msg.text.replace(/\n/g, '<br>')}</div></div>`;
        if (msg.type === 'sent' && index === chat.messages.length - 1) {
            htmlContent += `<div class="message-delivery-text" style="opacity:1">已送达</div>`;
        }
    });
    
    msgContainer.innerHTML = htmlContent;
    
    // 滚动到底部
    setTimeout(() => {
        const scrollArea = document.getElementById('message-area-scroll');
        if (scrollArea) {
            scrollArea.scrollTo({ top: scrollArea.scrollHeight, behavior: 'instant' });
        }
    }, 10);
}

// 确保函数在全局作用域
window.openMessageChat = openMessageChat;

function showMessagePage() {
    document.getElementById('message-page').classList.add('active');
    // 默认显示列表页
    document.getElementById('message-list-page').style.display = 'flex';
    // 确保详情页和新建页隐藏
    const detailPage = document.getElementById('message-detail-page');
    if (detailPage) {
        detailPage.classList.remove('active');
        detailPage.style.display = 'none';
    }
    const composePage = document.getElementById('message-compose-page');
    if (composePage) {
        composePage.classList.remove('active');
        composePage.style.display = 'none';
    }
    // 渲染列表
    renderMessageList();
}

function hideMessagePage() {
    document.getElementById('message-page').classList.remove('active');
    document.getElementById('message-list-page').style.display = 'none';
    document.getElementById('message-detail-page').classList.remove('active');
    document.getElementById('message-compose-page').classList.remove('active');
}

function goBackMessageList() {
    const detailPage = document.getElementById('message-detail-page');
    if (detailPage) {
        detailPage.classList.remove('active');
        // 等待动画完成后再隐藏
        setTimeout(() => {
            detailPage.style.display = 'none';
        }, 400);
    }
    
    // 显示列表页
    const listPage = document.getElementById('message-list-page');
    if (listPage) {
        listPage.style.display = 'flex';
    }
}

function openComposeMessage() {
    document.getElementById('message-compose-page').classList.add('active');
}

function closeComposeMessage() {
    document.getElementById('message-compose-page').classList.remove('active');
}

function sendMessageDetail() {
    // 占位函数，后续可以添加发送消息的逻辑
    console.log('发送消息');
}

function sendNewMessageDetail() {
    // 占位函数，后续可以添加发送新消息的逻辑
    console.log('发送新消息');
}

        function hideAppStorePage() {
            const page = document.getElementById('appstore-page');
            page.style.transform = 'scale(0.95)';
            page.style.opacity = '0';
            setTimeout(() => {
                page.style.display = 'none';
                page.style.transform = ''; 
                page.style.opacity = '';
            }, 200);
        }

        // 模拟应用数据
        const appStoreData = {
            today: [
                { name: '微信读书', subtitle: '让阅读不再孤单', icon: 'https://img.icons8.com/color/96/book.png', rating: 4.8, downloads: '1000万+' },
                { name: '小红书', subtitle: '标记我的生活', icon: 'https://img.icons8.com/color/96/instagram-new.png', rating: 4.7, downloads: '5000万+' },
                { name: 'Notion', subtitle: '你的全能工作空间', icon: 'https://img.icons8.com/color/96/notion.png', rating: 4.9, downloads: '500万+' }
            ],
            games: [
                { name: '原神', subtitle: '开放世界冒险游戏', icon: 'https://img.icons8.com/color/96/controller.png', rating: 4.6, downloads: '1亿+' },
                { name: '王者荣耀', subtitle: '5v5公平竞技', icon: 'https://img.icons8.com/color/96/sword.png', rating: 4.5, downloads: '5亿+' },
                { name: '蛋仔派对', subtitle: '一起来玩吧', icon: 'https://img.icons8.com/color/96/party.png', rating: 4.7, downloads: '2亿+' }
            ],
            apps: [
                { name: '支付宝', subtitle: '生活好，支付宝', icon: 'https://img.icons8.com/color/96/alipay.png', rating: 4.8, downloads: '10亿+' },
                { name: '高德地图', subtitle: '出行导航必备', icon: 'https://img.icons8.com/color/96/map.png', rating: 4.7, downloads: '5亿+' },
                { name: 'QQ音乐', subtitle: '听我想听的歌', icon: 'https://img.icons8.com/color/96/music.png', rating: 4.6, downloads: '3亿+' }
            ],
            updates: [
                { name: '微信', subtitle: '版本 8.0.50 更新', icon: 'https://img.icons8.com/color/96/wechat.png', rating: 4.9, downloads: '已安装' },
                { name: 'QQ', subtitle: '版本 9.0.20 更新', icon: 'https://img.icons8.com/color/96/qq.png', rating: 4.7, downloads: '已安装' }
            ]
        };

        function switchAppStoreTab(type) {
            // 更新标签样式
            document.querySelectorAll('.appstore-tab').forEach(tab => {
                if (tab.dataset.tab === type) {
                    tab.classList.add('active');
                } else {
                    tab.classList.remove('active');
                }
            });

            // 渲染内容
            const container = document.getElementById('appstore-content');
            const apps = appStoreData[type] || [];
            
            if (apps.length === 0) {
                container.innerHTML = '<div style="text-align:center; color:#999; margin-top:60px;">暂无内容</div>';
                return;
            }

            container.innerHTML = apps.map(app => `
                <div class="app-card">
                    <div class="app-icon-large" style="background-image:url(${app.icon})"></div>
                    <div class="app-info">
                        <div>
                            <div class="app-name">${app.name}</div>
                            <div class="app-subtitle">${app.subtitle}</div>
                            <div class="app-rating">
                                <span class="app-stars">★★★★★</span>
                                <span>${app.rating}</span>
                                <span>·</span>
                                <span>${app.downloads}</span>
                            </div>
                        </div>
                        <button class="app-get-btn" onclick="alert('这是一个演示，无法真正下载哦~')">获取</button>
                    </div>
                </div>
            `).join('');
        }

        // 搜索功能
        document.addEventListener('DOMContentLoaded', function() {
            const searchInput = document.getElementById('appstore-search');
            if (searchInput) {
                searchInput.addEventListener('input', function(e) {
                    const keyword = e.target.value.toLowerCase();
                    if (!keyword) {
                        // 恢复当前标签内容
                        const activeTab = document.querySelector('.appstore-tab.active');
                        if (activeTab) {
                            switchAppStoreTab(activeTab.dataset.tab);
                        }
                        return;
                    }

                    // 搜索所有分类
                    const allApps = [...appStoreData.today, ...appStoreData.games, ...appStoreData.apps, ...appStoreData.updates];
                    const results = allApps.filter(app => 
                        app.name.toLowerCase().includes(keyword) || 
                        app.subtitle.toLowerCase().includes(keyword)
                    );

                    const container = document.getElementById('appstore-content');
                    if (results.length === 0) {
                        container.innerHTML = '<div style="text-align:center; color:#999; margin-top:60px;">未找到相关应用</div>';
                    } else {
                        container.innerHTML = results.map(app => `
                            <div class="app-card">
                                <div class="app-icon-large" style="background-image:url(${app.icon})"></div>
                                <div class="app-info">
                                    <div>
                                        <div class="app-name">${app.name}</div>
                                        <div class="app-subtitle">${app.subtitle}</div>
                                        <div class="app-rating">
                                            <span class="app-stars">★★★★★</span>
                                            <span>${app.rating}</span>
                                            <span>·</span>
                                            <span>${app.downloads}</span>
                                        </div>
                                    </div>
                                    <button class="app-get-btn" onclick="alert('这是一个演示，无法真正下载哦~')">获取</button>
                                </div>
                            </div>
                        `).join('');
                    }
                });
            }
        });

// --- 微信应用逻辑 ---
function showWechatPage() {
    // 确保聊天窗口被关闭
    const chatWindow = document.getElementById('chat-window');
    if (chatWindow && chatWindow.style.display !== 'none') {
        chatWindow.style.display = 'none';
        currentChatCharId = null;
        console.log('[WechatPage] Closed chat window, cleared currentChatCharId');
    }
    
    document.getElementById('wechat-page').style.display = 'flex';
    // 打开时自动切到第一个标签页并渲染
    switchWechatTab(0);
}

        function hideWechatPage() {
            const page = document.getElementById('wechat-page');
            page.style.transform = 'scale(0.95)';
            page.style.opacity = '0';
            setTimeout(() => {
                page.style.display = 'none';
                page.style.transform = ''; 
                page.style.opacity = '';
            }, 200);
        }

        async function switchWechatTab(index) {
            const tabs = document.querySelectorAll('.wechat-tab-item');
            tabs.forEach((tab, i) => {
                if (i === index) {
                    tab.classList.add('active');
                } else {
                    tab.classList.remove('active');
                }
            });
            
            const content = document.getElementById('wechat-content');
            const title = document.getElementById('wechat-main-title');

            if (index === 0) {
                title.innerText = "微信";
                await renderWechatList(content);
            } else if (index === 1) {
                title.innerText = "通讯录";
                await renderContactList(content);
            } else if (index === 2) {
                title.innerText = "发现";
                content.innerHTML = `
                    <div class="wechat-cell-group" style="margin-top:0;">
                        <div class="wechat-cell" onclick="showMomentsPage()">
                            <div class="wechat-cell-icon icon-moments">
                                <svg class="svg-icon" style="stroke:currentColor;" viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
                            </div>
                            <div class="wechat-cell-text">朋友圈</div>
                            <div class="wechat-cell-arrow">›</div>
                        </div>
                    </div>
                `;
            } else if (index === 3) {
                title.innerText = "我";
                await renderMePage(content);
            }
        }

        // 渲染“我”的页面
        async function renderMePage(container) {
            container.innerHTML = '';
            
            // 获取当前“我”的角色
            let myChar = null;
            if (currentMyCharId) {
                myChar = await db.characters.get(parseInt(currentMyCharId));
            }
            
            // 兜底：如果未设置，尝试找第一个 User 角色
            if (!myChar) {
                const users = await db.characters.where('type').equals('user').toArray();
                if (users.length > 0) {
                    myChar = users[0];
                    currentMyCharId = myChar.id;
                    localStorage.setItem('current_my_char_id', currentMyCharId);
                }
            }
            
            const avatarUrl = myChar && myChar.avatar ? myChar.avatar : '';
            const name = myChar ? myChar.name : '未登录';
            // 尝试获取虚拟微信号
            const account = myChar && myChar.identity && myChar.identity.account ? myChar.identity.account : (myChar ? `wxid_${myChar.id}` : '未设置');
            
            const profileHtml = `
                <div class="wechat-profile">
                    <div class="wechat-profile-avatar" style="${avatarUrl ? `background-image:url(${avatarUrl})` : ''}"></div>
                    <div class="wechat-profile-info">
                        <div class="wechat-profile-name">${name}</div>
                        <div class="wechat-profile-id">
                            <span>微信号：${account}</span>
                            <svg class="svg-icon wechat-qrcode-icon" viewBox="0 0 24 24" style="width:16px;height:16px;"><path d="M3 3h6v6H3zm2 2v2h2V5zm8-2h6v6h-6zm2 2v2h2V5zM3 13h6v6H3zm2 2v2h2v-2zm8-2h2v2h-2zm4 0h2v2h-2zm-4 4h2v2h-2zm2-2h2v2h-2zm2 2h2v2h-2z"/></svg>
                            <svg class="svg-icon" style="width:12px;height:12px;color:#ccc;margin-left:auto;" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"></polyline></svg>
                        </div>
                    </div>
                </div>
            `;
            
            const cellsHtml = `
                <div class="wechat-cell-group">
                    <div class="wechat-cell" onclick="showServicePage()">
                        <div class="wechat-cell-icon icon-service">
                            <svg class="svg-icon" style="stroke:currentColor;" viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
                        </div>
                        <div class="wechat-cell-text">服务</div>
                        <div class="wechat-cell-arrow">›</div>
                    </div>
                </div>
                <div class="wechat-cell-group">
                    <div class="wechat-cell">
                        <div class="wechat-cell-icon icon-collect">
                            <svg class="svg-icon" style="stroke:currentColor;" viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>
                        </div>
                        <div class="wechat-cell-text">收藏</div>
                        <div class="wechat-cell-arrow">›</div>
                    </div>
                    <div class="wechat-cell" data-action="showStickerPage">
                        <div class="wechat-cell-icon icon-emoji">
                            <svg class="svg-icon" style="stroke:currentColor;" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><path d="M8 14s1.5 2 4 2 4-2 4-2"></path><line x1="9" y1="9" x2="9.01" y2="9"></line><line x1="15" y1="9" x2="15.01" y2="9"></line></svg>
                        </div>
                        <div class="wechat-cell-text">表情</div>
                        <div class="wechat-cell-arrow">›</div>
                    </div>
                </div>
                <div class="wechat-cell-group">
                    <div class="wechat-cell" onclick="showSwitchAccountModal()">
                        <div class="wechat-cell-icon icon-settings">
                            <svg class="svg-icon" style="stroke:currentColor;" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                        </div>
                        <div class="wechat-cell-text">切换账号</div>
                        <div class="wechat-cell-arrow">›</div>
                    </div>
                </div>
            `;
            
            container.innerHTML = `<div class="wechat-me-container">${profileHtml}${cellsHtml}</div>`;
            
            // 使用事件委托绑定表情包点击事件（在父容器上绑定，确保动态元素也能响应）
            const meContainer = container.querySelector('.wechat-me-container');
            if (meContainer) {
                meContainer.addEventListener('click', function(e) {
                    // 检查点击的是否是表情包单元格或其子元素
                    const target = e.target.closest('[data-action="showStickerPage"]');
                    if (target) {
                        console.log('[Debug] Sticker cell clicked via event delegation!');
                        e.preventDefault();
                        e.stopPropagation();
                        console.log('[Debug] showStickerPage type:', typeof showStickerPage);
                        console.log('[Debug] window.showStickerPage type:', typeof window.showStickerPage);
                        if (typeof showStickerPage === 'function') {
                            console.log('[Debug] Calling showStickerPage()');
                            showStickerPage();
                        } else if (typeof window.showStickerPage === 'function') {
                            console.log('[Debug] Calling window.showStickerPage()');
                            window.showStickerPage();
                        } else {
                            console.error('[Debug] showStickerPage function not found, trying direct access');
                            // 尝试直接调用
                            try {
                                const page = document.getElementById('sticker-page');
                                if (page) {
                                    console.log('[Debug] Found sticker-page element, showing it directly');
                                    page.style.display = 'flex';
                                    if (typeof renderStickerCategories === 'function') {
                                        renderStickerCategories();
                                    }
                                } else {
                                    console.error('[Debug] sticker-page element not found in DOM');
                                }
                            } catch (err) {
                                console.error('[Debug] Error:', err);
                            }
                        }
                    }
                });
                console.log('[Debug] Event delegation listener added to wechat-me-container');
            } else {
                console.error('[Debug] wechat-me-container not found!');
            }
            
            // 也直接绑定一次作为备用
            const stickerCell = container.querySelector('[data-action="showStickerPage"]');
            console.log('[Debug] stickerCell found:', stickerCell);
            if (stickerCell) {
                stickerCell.style.cursor = 'pointer';
                stickerCell.addEventListener('click', function(e) {
                    console.log('[Debug] Sticker cell clicked (direct binding)!');
                    e.preventDefault();
                    e.stopPropagation();
                    if (typeof showStickerPage === 'function') {
                        showStickerPage();
                    } else if (typeof window.showStickerPage === 'function') {
                        window.showStickerPage();
                    }
                });
            }
        }

        async function showSwitchAccountModal() {
            const modal = document.getElementById('switch-account-modal');
            const list = document.getElementById('account-switch-list');
            list.innerHTML = '';
            
            // 获取所有 User 类型的角色
            const users = await db.characters.where('type').equals('user').toArray();
            
            if (users.length === 0) {
                list.innerHTML = '<div style="text-align:center; padding:20px; color:#999;">暂无账号，请去【角色档案】新建 User</div>';
            } else {
                users.forEach(u => {
                    const item = document.createElement('div');
                    item.className = 'account-item';
                    item.onclick = () => performSwitchAccount(u.id);
                    
                    const avatarStyle = u.avatar ? `background-image:url(${u.avatar})` : 'background-color:#eee';
                    const isCurrent = currentMyCharId && parseInt(currentMyCharId) === u.id;
                    
                    item.innerHTML = `
                        <div class="account-avatar" style="${avatarStyle}"></div>
                        <div style="flex:1;">
                            <div style="font-weight:500; color:#333;">${u.name}</div>
                            <div style="font-size:12px; color:#999;">${u.identity && u.identity.account ? u.identity.account : '无微信号'}</div>
                        </div>
                        ${isCurrent ? '<div style="color:var(--ins-pink);">✓</div>' : ''}
                    `;
                    list.appendChild(item);
                });
            }
            
            modal.style.display = 'flex';
        }

        // ========== 账号隔离辅助函数 ==========
        // 获取当前账号ID（用于数据隔离）
        function getCurrentAccountId() {
            return currentMyCharId ? String(currentMyCharId) : null;
        }

        // 获取角色的好友状态（按账号隔离）
        function getFriendStatus(char, accountId) {
            if (!accountId) return char.wechat_status || 'stranger';
            if (!char.wechat_status_by_user) {
                // 如果新结构不存在，尝试从旧结构迁移
                if (char.wechat_status) {
                    if (!char.wechat_status_by_user) char.wechat_status_by_user = {};
                    char.wechat_status_by_user[accountId] = char.wechat_status;
                }
            }
            return char.wechat_status_by_user?.[accountId] || 'stranger';
        }

        // 设置角色的好友状态（按账号隔离）
        async function setFriendStatus(char, accountId, status) {
            if (!accountId) {
                // 兼容旧代码：如果没有账号ID，使用旧结构
                char.wechat_status = status;
            } else {
                if (!char.wechat_status_by_user) char.wechat_status_by_user = {};
                char.wechat_status_by_user[accountId] = status;
            }
            await db.characters.put(char);
        }

        // 获取角色的聊天记录（按账号隔离）
        function getChatHistory(char, accountId) {
            if (!accountId) return char.chat_history || [];
            if (!char.chat_history_by_user) {
                // 如果新结构不存在，尝试从旧结构迁移
                if (char.chat_history && char.chat_history.length > 0) {
                    if (!char.chat_history_by_user) char.chat_history_by_user = {};
                    char.chat_history_by_user[accountId] = [...char.chat_history];
                }
            }
            return char.chat_history_by_user?.[accountId] || [];
        }

        // 设置角色的聊天记录（按账号隔离）
        async function setChatHistory(char, accountId, history) {
            if (!accountId) {
                // 兼容旧代码：如果没有账号ID，使用旧结构
                char.chat_history = history;
            } else {
                if (!char.chat_history_by_user) char.chat_history_by_user = {};
                char.chat_history_by_user[accountId] = history;
            }
            await db.characters.put(char);
        }

        // 数据迁移：将旧结构迁移到新结构（不影响现有数据）
        async function migrateAccountData() {
            const migrationKey = 'account_isolation_migrated';
            if (localStorage.getItem(migrationKey) === 'true') {
                return; // 已经迁移过
            }

            console.log('[Migration] 开始迁移账号隔离数据...');
            const allChars = await db.characters.toArray();
            let migratedCount = 0;

            for (const char of allChars) {
                let needSave = false;

                // 迁移好友状态：如果有旧的好友状态，为所有User账号创建映射
                if (char.wechat_status && !char.wechat_status_by_user) {
                    char.wechat_status_by_user = {};
                    // 为所有User账号复制当前状态
                    const allUsers = await db.characters.where('type').equals('user').toArray();
                    for (const user of allUsers) {
                        char.wechat_status_by_user[String(user.id)] = char.wechat_status;
                    }
                    needSave = true;
                }

                // 迁移聊天记录：如果有旧的聊天记录，为所有User账号创建映射
                if (char.chat_history && char.chat_history.length > 0 && !char.chat_history_by_user) {
                    char.chat_history_by_user = {};
                    // 为所有User账号复制当前聊天记录
                    const allUsers = await db.characters.where('type').equals('user').toArray();
                    for (const user of allUsers) {
                        char.chat_history_by_user[String(user.id)] = [...char.chat_history];
                    }
                    needSave = true;
                }

                if (needSave) {
                    await db.characters.put(char);
                    migratedCount++;
                }
            }

            localStorage.setItem(migrationKey, 'true');
            console.log(`[Migration] 迁移完成，共处理 ${migratedCount} 个角色`);
        }

        async function performSwitchAccount(id) {
            currentMyCharId = id;
            localStorage.setItem('current_my_char_id', id);
            
            closeModal('switch-account-modal');
            
            // 刷新所有相关页面
            const content = document.getElementById('wechat-content');
            if (content) {
                // 根据当前tab刷新对应内容
                const activeTab = document.querySelector('.wechat-tab-item.active');
                if (activeTab) {
                    const tabIndex = Array.from(document.querySelectorAll('.wechat-tab-item')).indexOf(activeTab);
                    switchWechatTab(tabIndex);
                } else {
                    await renderMePage(content);
                }
            }
            
            // 刷新钱包余额显示
            updateWalletBalanceDisplay();
            updateBalancePageDisplay();
        }

        // 渲染微信聊天列表
        async function renderWechatList(container) {
            const accountId = getCurrentAccountId();
            // 获取所有角色，然后按账号过滤好友（包括已删除的）
            let allChars = await db.characters.toArray();
            let friends = allChars.filter(c => {
                if (c.type === 'user') return false; // 排除User类型
                const status = getFriendStatus(c, accountId);
                return status === 'friend' || status === 'deleted'; // 包括已删除的好友
            });
            
            // 排序逻辑：置顶 > 最后消息时间 > 更新时间
            friends.sort((a, b) => {
                // 1. 置顶判断
                if (a.is_pinned && !b.is_pinned) return -1;
                if (!a.is_pinned && b.is_pinned) return 1;
                
                // 2. 时间判断
                const getLastTime = (char) => {
                    const history = getChatHistory(char, accountId);
                    if (history && history.length > 0) {
                        return history[history.length - 1].time;
                    }
                    return char.updated_at || 0;
                };
                
                const timeA = getLastTime(a);
                const timeB = getLastTime(b);
                
                return timeB - timeA; // 降序
            });
            
            if (friends.length === 0) {
                container.innerHTML = `
                    <div class="wechat-empty-state">
                        <svg class="svg-icon" style="width:48px; height:48px; stroke:#ccc;" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="8" y1="15" x2="16" y2="15"></line><line x1="9" y1="9" x2="9.01" y2="9"></line><line x1="15" y1="9" x2="15.01" y2="9"></line></svg>
                        <div>暂无好友</div>
                    </div>
                `;
                return;
            }

            container.innerHTML = '';
            const listDiv = document.createElement('div');
            listDiv.style.width = '100%';
            listDiv.style.background = '#fff';
            listDiv.style.overflowX = 'hidden';

            friends.forEach(f => {
                // 容器
                const itemContainer = document.createElement('div');
                itemContainer.className = 'wechat-list-item-container';
                
                // 背景操作按钮
                const actionsDiv = document.createElement('div');
                actionsDiv.className = 'wechat-item-actions';
                actionsDiv.innerHTML = `
                    <button class="wechat-action-btn btn-pin" onclick="togglePin(${f.id}, event)">${f.is_pinned ? '取消置顶' : '置顶'}</button>
                    <button class="wechat-action-btn btn-delete" onclick="deleteFriend(${f.id}, event)">删除</button>
                `;
                
                // 内容区域 (可滑动)
                const contentDiv = document.createElement('div');
                contentDiv.className = 'wechat-list-item-content';
                
                // 内容样式
                contentDiv.style.display = 'flex';
                contentDiv.style.padding = '12px 16px';
                contentDiv.style.borderBottom = '0.5px solid #f0f0f0';
                contentDiv.style.alignItems = 'center';
                contentDiv.style.gap = '12px';
                contentDiv.style.backgroundColor = f.is_pinned ? '#f8f8f8' : '#fff';

                // 点击进入聊天
                contentDiv.onclick = (e) => {
                    if (itemContainer.dataset.swiped === 'true') {
                        resetSwipe(contentDiv);
                        itemContainer.dataset.swiped = 'false';
                        return;
                    }
                    openChatWindow(f.id);
                };

                const avatarStyle = f.avatar ? `background-image:url(${f.avatar})` : 'background-color:#eee';
                
                // 检查是否是已删除的好友
                const isDeleted = getFriendStatus(f, accountId) === 'deleted';
                
                let lastMsg = '';
                let lastTimeStr = '';
                const history = getChatHistory(f, accountId);
                if (history && history.length > 0) {
                    const last = history[history.length - 1];
                    lastMsg = last.content;
                    if (lastMsg.startsWith('[img:')) lastMsg = '[图片]';
                    if (lastMsg.startsWith('[voice:')) lastMsg = '[语音]';
                    if (lastMsg.startsWith('[imgcard:')) lastMsg = '[卡片]';
                    
                    const d = new Date(last.time);
                    const now = new Date();
                    if (d.toDateString() === now.toDateString()) {
                        lastTimeStr = `${d.getHours()}:${d.getMinutes().toString().padStart(2,'0')}`;
                    } else {
                        lastTimeStr = `${d.getMonth()+1}/${d.getDate()}`;
                    }
                }
                
                // 如果是已删除的好友，添加标识
                const deletedBadge = isDeleted ? '<span style="background:#ff9500; color:#fff; font-size:10px; padding:2px 6px; border-radius:3px; margin-left:6px;">已删除</span>' : '';
                const textColor = isDeleted ? '#999' : '#333';

                contentDiv.innerHTML = `
                    <div style="width:48px; height:48px; border-radius:6px; ${avatarStyle}; background-size:cover; background-position:center; flex-shrink:0; ${isDeleted ? 'opacity:0.6;' : ''}"></div>
                    <div style="flex:1; min-width:0;">
                        <div style="display:flex; justify-content:space-between; margin-bottom:4px; align-items:center;">
                            <div style="display:flex; align-items:center;">
                                <div style="font-size:16px; font-weight:500; color:${textColor};">${f.name}</div>
                                ${deletedBadge}
                            </div>
                            <div style="font-size:12px; color:#999;">${lastTimeStr}</div>
                        </div>
                        <div style="font-size:14px; color:#999; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${lastMsg}</div>
                    </div>
                `;

                bindSwipeEvents(contentDiv, itemContainer);

                itemContainer.appendChild(actionsDiv);
                itemContainer.appendChild(contentDiv);
                listDiv.appendChild(itemContainer);
            });
            container.appendChild(listDiv);
        }

        // 滑动事件绑定
        function bindSwipeEvents(element, container) {
            let startX = 0;
            let currentX = 0;
            let isSwiping = false;
            const threshold = 30; // 触发阈值
            const maxSwipe = 160; // 两个按钮宽度

            element.addEventListener('touchstart', (e) => {
                startX = e.touches[0].clientX;
                // 复位其他项
                document.querySelectorAll('.wechat-list-item-content').forEach(el => {
                    if (el !== element && el.style.transform && el.style.transform !== 'translateX(0px)') {
                        el.style.transform = 'translateX(0px)';
                        el.parentElement.dataset.swiped = 'false';
                    }
                });
            }, {passive: true});

            element.addEventListener('touchmove', (e) => {
                currentX = e.touches[0].clientX;
                let diff = currentX - startX;
                
                if (diff < 0) {
                    if (Math.abs(diff) > 10) isSwiping = true;
                    let move = diff;
                    if (Math.abs(move) > maxSwipe) {
                        move = -maxSwipe - (Math.abs(move) - maxSwipe) * 0.2;
                    }
                    element.style.transform = `translateX(${move}px)`;
                } else if (container.dataset.swiped === 'true') {
                    let move = -maxSwipe + diff;
                    if (move > 0) move = 0;
                    element.style.transform = `translateX(${move}px)`;
                }
            }, {passive: true});

            element.addEventListener('touchend', (e) => {
                if (!isSwiping && container.dataset.swiped !== 'true') return;
                
                const diff = currentX - startX;
                if (diff < -threshold || (container.dataset.swiped === 'true' && diff < threshold && diff > -threshold)) {
                    element.style.transform = `translateX(-${maxSwipe}px)`;
                    container.dataset.swiped = 'true';
                } else {
                    element.style.transform = 'translateX(0px)';
                    container.dataset.swiped = 'false';
                }
                isSwiping = false;
            });
        }

        function resetSwipe(element) {
            element.style.transform = 'translateX(0px)';
        }

        async function togglePin(id, e) {
            e.stopPropagation();
            const char = await db.characters.get(id);
            if (char) {
                char.is_pinned = !char.is_pinned;
                await db.characters.put(char);
                renderWechatList(document.getElementById('wechat-content'));
            }
        }

        async function deleteFriend(id, e) {
            e.stopPropagation();
            if (confirm('确定要删除这位好友吗？\n(角色档案保留，仅删除好友关系)')) {
                const char = await db.characters.get(id);
                if (char) {
                    const accountId = getCurrentAccountId();
                    await setFriendStatus(char, accountId, 'stranger');
                    char.is_pinned = false;
                    await db.characters.put(char);
                    renderWechatList(document.getElementById('wechat-content'));
                }
            }
        }

        // 渲染通讯录列表
        async function renderContactList(container) {
            const accountId = getCurrentAccountId();
            // 获取所有角色，然后按账号过滤好友
            let allChars = await db.characters.toArray();
            const friends = allChars.filter(c => {
                if (c.type === 'user') return false; // 排除User类型
                const status = getFriendStatus(c, accountId);
                return status === 'friend';
            });
            
            container.innerHTML = '';
            const listDiv = document.createElement('div');
            listDiv.style.width = '100%';
            listDiv.style.background = '#fff';
            
            // 添加"新的好友"入口
            const allRequests = await db.friend_requests.toArray();
            const pendingRequests = allRequests.filter(req => 
                req.toCharId === parseInt(accountId) && req.status === 'pending'
            );
            const newFriendItem = document.createElement('div');
            newFriendItem.style.display = 'flex';
            newFriendItem.style.padding = '12px 16px';
            newFriendItem.style.borderBottom = '0.5px solid #f0f0f0';
            newFriendItem.style.alignItems = 'center';
            newFriendItem.style.gap = '12px';
            newFriendItem.style.cursor = 'pointer';
            newFriendItem.onclick = () => showNewFriendsPage();
            
            const badgeHtml = pendingRequests.length > 0 ? 
                `<div style="background:#ff3b30; color:#fff; font-size:12px; padding:2px 6px; border-radius:10px; min-width:18px; text-align:center;">${pendingRequests.length}</div>` : '';
            
            newFriendItem.innerHTML = `
                <div style="width:40px; height:40px; border-radius:4px; background:linear-gradient(135deg, #ffc2d1 0%, #ff8fab 100%); display:flex; align-items:center; justify-content:center;">
                    <svg class="svg-icon" style="width:24px; height:24px; stroke:#fff;" viewBox="0 0 24 24">
                        <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                        <circle cx="8.5" cy="7" r="4"></circle>
                        <line x1="20" y1="8" x2="20" y2="14"></line>
                        <line x1="23" y1="11" x2="17" y2="11"></line>
                    </svg>
                </div>
                <div style="flex:1; font-size:16px; font-weight:500; color:#333;">新的好友</div>
                ${badgeHtml}
            `;
            listDiv.appendChild(newFriendItem);
            
            if (friends.length === 0) {
                const emptyDiv = document.createElement('div');
                emptyDiv.style.textAlign = 'center';
                emptyDiv.style.padding = '40px 20px';
                emptyDiv.style.color = '#999';
                emptyDiv.innerHTML = `
                    <svg class="svg-icon" style="width:48px; height:48px; stroke:#ccc; margin-bottom:10px;" viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
                    <div>通讯录为空</div>
                `;
                listDiv.appendChild(emptyDiv);
            } else {
                friends.forEach(f => {
                    const item = document.createElement('div');
                    item.style.display = 'flex';
                    item.style.padding = '10px 16px';
                    item.style.borderBottom = '0.5px solid #f0f0f0';
                    item.style.alignItems = 'center';
                    item.style.gap = '12px';
                    item.onclick = () => openChatWindow(f.id);

                    const avatarStyle = f.avatar ? `background-image:url(${f.avatar})` : 'background-color:#eee';
                    
                    item.innerHTML = `
                        <div style="width:40px; height:40px; border-radius:4px; ${avatarStyle}; background-size:cover; background-position:center;"></div>
                        <div style="font-size:16px; font-weight:500; color:#333;">${f.name}</div>
                    `;
                    listDiv.appendChild(item);
                });
            }
            container.appendChild(listDiv);
        }

        // 菜单与弹窗逻辑
        function toggleWechatMenu() {
            const menu = document.getElementById('wechat-menu');
            menu.style.display = menu.style.display === 'flex' ? 'none' : 'flex';
            // 点击外部关闭 (简单处理)
            setTimeout(() => {
                document.addEventListener('click', closeMenuOutside);
            }, 0);
        }
        function closeMenuOutside(e) {
            const menu = document.getElementById('wechat-menu');
            if (!menu.contains(e.target) && !e.target.closest('.wechat-add')) {
                menu.style.display = 'none';
                document.removeEventListener('click', closeMenuOutside);
            }
        }

        function closeModal(id) {
            document.getElementById(id).style.display = 'none';
        }

        // 显示角色心声
        async function showCharacterThoughts(charId, messageIndex) {
            if (!charId) return;
            
            const char = await db.characters.get(charId);
            if (!char) return;
            
            const modal = document.getElementById('thoughts-modal');
            const title = document.getElementById('thoughts-modal-title');
            const content = document.getElementById('thoughts-content');
            
            title.textContent = `${char.name}的心声`;
            content.innerHTML = '';
            
            // 获取该消息对应的心声（根据messageIndex匹配）
            if (!char.thoughts || char.thoughts.length === 0) {
                content.innerHTML = '<div style="text-align:center; color:#999; padding:40px 20px;">暂无心声记录</div>';
            } else {
                // 找到与当前消息相关的心声（messageIndex匹配或最近的心声）
                let relevantThoughts = char.thoughts.filter(t => t.messageIndex === messageIndex);
                
                // 如果没有精确匹配，显示最近的心声
                if (relevantThoughts.length === 0) {
                    relevantThoughts = char.thoughts.slice(-5); // 显示最近5条
                }
                
                if (relevantThoughts.length === 0) {
                    content.innerHTML = '<div style="text-align:center; color:#999; padding:40px 20px;">暂无相关心声</div>';
                } else {
                    relevantThoughts.reverse().forEach(thought => {
                        const item = document.createElement('div');
                        item.style.cssText = 'padding:12px; margin-bottom:10px; background:#f5f5f5; border-radius:8px; border-left:3px solid var(--ins-pink);';
                        
                        const text = document.createElement('div');
                        text.textContent = thought.content;
                        text.style.cssText = 'font-size:14px; line-height:1.6; color:#333; margin-bottom:6px;';
                        
                        const time = document.createElement('div');
                        const timeStr = new Date(thought.time).toLocaleString('zh-CN', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                        });
                        time.textContent = timeStr;
                        time.style.cssText = 'font-size:12px; color:#999;';
                        
                        item.appendChild(text);
                        item.appendChild(time);
                        content.appendChild(item);
                    });
                }
            }
            
            modal.style.display = 'flex';
        }

        // 搜索好友
        function showAddFriendModal() {
            document.getElementById('search-friend-modal').style.display = 'flex';
            document.getElementById('wechat-menu').style.display = 'none';
            // 重置状态
            document.getElementById('search-account-input').value = '';
            document.getElementById('search-result-area').style.display = 'none';
            document.getElementById('apply-area').style.display = 'none';
            document.getElementById('search-cancel-btn').style.display = 'block';
        }

        let searchTargetChar = null;

        // 辅助：获取世界书上下文 (简单的关键词匹配)
        // 支持单个ID或ID数组
        async function getLorebookContext(lorebookIdOrIds, keywords) {
            if (!lorebookIdOrIds) return "";
            
            // 兼容旧数据：如果是单个ID，转换为数组
            const ids = Array.isArray(lorebookIdOrIds) ? lorebookIdOrIds : [lorebookIdOrIds];
            if (ids.length === 0) return "";
            
            let allContext = [];
            const checkText = keywords.toLowerCase();
            
            // 遍历所有世界书
            for (const id of ids) {
                const book = await db.lorebooks.get(id);
                if (!book || !book.content || !book.content.entries) continue;
                
                const entries = Object.values(book.content.entries);
                
                entries.forEach(entry => {
                    if (!entry.enabled) return;
                    // entry.key 可能是数组或字符串
                    const keys = Array.isArray(entry.key) ? entry.key : [entry.key];
                    
                    const isMatch = keys.some(k => {
                        if(!k) return false;
                        return checkText.includes(k.toLowerCase());
                    });
                    
                    if (isMatch) {
                        allContext.push(entry.content);
                    }
                });
            }
            
            if (allContext.length > 0) {
                // 简单截断，防止爆 Token
                const fullText = allContext.join('\n');
                const safeText = fullText.length > 10000 ? fullText.slice(0, 10000) + '...(已截断)' : fullText;
                return `【相关世界书设定】:\n${safeText}\n`;
            }
            return "";
        }

        async function searchAccount() {
            const acc = document.getElementById('search-account-input').value.trim();
            if(!acc) return;
            
            // 全表扫描匹配 identity.account
            const allChars = await db.characters.toArray();
            const target = allChars.find(c => c.identity && c.identity.account === acc);
            
            if (target) {
                searchTargetChar = target;
                document.getElementById('search-result-area').style.display = 'flex';
                document.getElementById('search-result-name').innerText = target.name;
                document.getElementById('search-result-id').innerText = "账号: " + acc;
                if(target.avatar) {
                    document.getElementById('search-result-avatar').style.backgroundImage = `url(${target.avatar})`;
                } else {
                    document.getElementById('search-result-avatar').style.backgroundImage = '';
                }
                
                // --- 新增：加载 User 列表供选择 ---
                const users = allChars.filter(c => c.type === 'user');
                const userSelect = document.getElementById('apply-user-select');
                userSelect.innerHTML = '';
                if(users.length === 0) {
                    const opt = document.createElement('option');
                    opt.value = "";
                    opt.text = "无 User 角色 (请先去角色档案新建)";
                    userSelect.appendChild(opt);
                } else {
                    users.forEach(u => {
                        const opt = document.createElement('option');
                        opt.value = u.id;
                        opt.text = u.name;
                        userSelect.appendChild(opt);
                    });
                }
                
                document.getElementById('apply-area').style.display = 'block';
                document.getElementById('search-cancel-btn').style.display = 'none';
            } else {
                alert("未找到该账号");
                searchTargetChar = null;
                document.getElementById('search-result-area').style.display = 'none';
                document.getElementById('apply-area').style.display = 'none';
            }
        }

        async function sendFriendRequest() {
            if(!searchTargetChar) return;
            
            const reason = document.getElementById('apply-reason').value.trim();
            const selectedUserId = document.getElementById('apply-user-select').value;
            
            if(!selectedUserId) {
                alert("请先选择一个 User 身份进行申请");
                return;
            }
            
            closeModal('search-friend-modal');
            alert("好友申请已发送，请稍候...");

            try {
                // 1. 获取 User 数据
                const userChar = await db.characters.get(parseInt(selectedUserId));
                
                // 2. 准备 Lorebook 匹配关键词 (User名 + Char名 + 申请理由)
                const keywords = `${userChar.name} ${searchTargetChar.name} ${reason}`;
                
                // 3. 获取双方 Lorebook 上下文（支持多个世界书）
                const userLorebookIds = userChar.lorebookIds || (userChar.lorebookId ? [userChar.lorebookId] : []);
                const charLorebookIds = searchTargetChar.lorebookIds || (searchTargetChar.lorebookId ? [searchTargetChar.lorebookId] : []);
                const userLore = await getLorebookContext(userLorebookIds, keywords);
                const charLore = await getLorebookContext(charLorebookIds, keywords);
                
                // 4. 构建 Prompt
                const prompt = `[场景: 微信好友申请]
【申请人信息】
名字: ${userChar.name}
设定: ${userChar.description || '无'}
虚拟账号: ${userChar.identity?.account || '未知'}

【被申请人(你)的信息】
名字: ${searchTargetChar.name}
设定: ${searchTargetChar.description || '无'}
虚拟账号: ${searchTargetChar.identity?.account || '未知'}

${userLore}
${charLore}

User(${userChar.name}) 向你发送了好友申请，附言：“${reason || '我是朋友'}”。

请以 ${searchTargetChar.name} 的身份，根据双方设定和世界书关系，决定是否通过好友申请。
要求：
1. 必须符合角色性格。如果是高冷/谨慎的角色，可能会拒绝陌生人；如果是外向/认识的角色，则会通过。
2. 仔细检查世界书和设定中是否有两人的关系描述。
3. 如果通过，请给出 2 到 3 条符合角色性格、线上聊天风格的回复。
   - **必须**使用分隔符 "|||" 来隔开每一条消息。
   - **严禁使用逗号**（包括中文逗号和英文逗号）。如果想表达停顿，请直接拆分成下一条消息，或者用空格代替。
   - 错误示例：你好，我是XXX，很高兴认识你
   - 正确示例：你好|||我是XXX|||很高兴认识你
4. 如果拒绝，请给出简短的心理活动或拒绝理由（作为 reply 返回）。

请严格返回 JSON 格式：
{
    "accepted": true, // 或 false
    "reply": "回复内容|||第二条内容"
}`;

                // 5. 调用 AI
                const resultStr = await callAI([
                    { role: "system", content: "你是一个只输出JSON的角色扮演辅助系统。" },
                    { role: "user", content: prompt }
                ]);
                
                let result = extractAndParseJSON(resultStr);
                
                if (!result) {
                    console.error("JSON提取/解析失败");
                    result = { accepted: true, reply: "你好呀|||我是新朋友(解析失败兜底)" }; 
                }

                if (result.accepted) {
                    // 更新数据库
                    const char = await db.characters.get(searchTargetChar.id);
                    const accountId = String(selectedUserId);
                    await setFriendStatus(char, accountId, 'friend');
                    // 绑定聊天用的 User ID (可选，如果以后支持多 User 切换)
                    // char.linked_user_id = userChar.id; 
                    
                    // 获取当前账号的聊天记录
                    let history = getChatHistory(char, accountId);
                    
                    // 1. 存入系统固定消息
                    history.push({
                        role: 'char', // 这里虽然是系统消息，但在微信里通常显示为中间的灰色小字，或者对方发的第一句话。
                        // 为了符合“第一条消息是对方同意了您的好友申请”的需求，这里模拟系统提示
                        // 但如果是作为对方发出的消息（气泡），则role='char'。
                        // 如果想要中间灰色小字，可能需要新的type，这里暂且用特殊内容或char角色发
                        // 根据需求"应该有第一条消息是对方同意了您的好友申请"，这里模拟微信的系统提示
                        role: 'char', 
                        content: '我通过了你的好友验证请求，现在我们可以开始聊天了',
                        time: Date.now()
                    });

                    // 2. 处理 AI 回复（清洗逗号 + 拆分）
                    let cleanReply = result.reply.replace(/[,，]/g, ' '); 
                    let segments = cleanReply.split('|||').map(s => s.trim()).filter(s => s);
                    
                    // 依次存入
                    for (let i = 0; i < segments.length; i++) {
                        history.push({
                            role: 'char',
                            content: segments[i],
                            time: Date.now() + (i + 1) * 500 // 稍微错开时间
                        });
                    }
                    
                    await setChatHistory(char, accountId, history);
                    
                    // 刷新列表
                    if (document.querySelector('.wechat-tab-item.active').innerText.includes('微信')) {
                        renderWechatList(document.getElementById('wechat-content'));
                    }

                    // 发送通知
                    const notifyText = segments.length > 0 ? segments[0] : '我通过了你的好友验证请求';
                    sendSystemNotification("微信", `${char.name} 通过了你的验证: ${notifyText}`);
                } else {
                    sendSystemNotification("微信", `${searchTargetChar.name} 拒绝了申请: ${result.reply}`);
                }

            } catch (err) {
                console.error(err);
                alert("请求处理失败: " + err.message);
            }
        }

        // 直接导入逻辑
        async function showDirectAddModal() {
            document.getElementById('direct-add-modal').style.display = 'flex';
            document.getElementById('wechat-menu').style.display = 'none';
            
            const list = document.getElementById('direct-add-list');
            list.innerHTML = '';
            
            // 获取非好友角色
            const accountId = getCurrentAccountId();
            const allChars = await db.characters.toArray();
            // 过滤掉已经是好友的，以及 type 为 'user' 的角色
            const candidates = allChars.filter(c => {
                if (c.type === 'user') return false;
                const status = getFriendStatus(c, accountId);
                return status !== 'friend';
            });
            
            if(candidates.length === 0) {
                list.innerHTML = '<div style="text-align:center;color:#999;margin-top:20px;">没有可添加的角色</div>';
                return;
            }
            
            candidates.forEach(c => {
                const item = document.createElement('div');
                item.style.display = 'flex';
                item.style.alignItems = 'center';
                item.style.justifyContent = 'space-between';
                item.style.padding = '10px';
                item.style.background = '#f9f9f9';
                item.style.borderRadius = '8px';
                
                item.innerHTML = `
                    <div style="font-weight:500;">${c.name}</div>
                    <button style="background:var(--ins-pink); color:#fff; border:none; padding:6px 12px; border-radius:4px; font-size:12px;" onclick="directAddFriend(${c.id})">添加</button>
                `;
                list.appendChild(item);
            });
        }

        async function directAddFriend(id) {
            const char = await db.characters.get(id);
            if(char) {
                const accountId = getCurrentAccountId();
                await setFriendStatus(char, accountId, 'friend');
                // 直接添加默认没有消息，或者可以加一条系统消息
                let history = getChatHistory(char, accountId);
                // history.push({ role: 'system', content: '你们已成为好友，开始聊天吧', time: Date.now() });
                await setChatHistory(char, accountId, history);
                closeModal('direct-add-modal');
                alert(`已将 ${char.name} 添加到通讯录`);
                
                // 刷新
                if (document.querySelector('.wechat-tab-item.active').innerText.includes('微信')) {
                    renderWechatList(document.getElementById('wechat-content'));
                }
            }
        }

        // --- 新的好友页面逻辑 ---
        async function showNewFriendsPage() {
            document.getElementById('new-friends-page').style.display = 'flex';
            await renderNewFriendsPage();
        }

        function hideNewFriendsPage() {
            document.getElementById('new-friends-page').style.display = 'none';
        }

        async function renderNewFriendsPage() {
            const accountId = getCurrentAccountId();
            if (!accountId) {
                document.getElementById('new-friends-content').innerHTML = `
                    <div style="text-align:center; padding:60px 20px; color:#999;">
                        请先切换到你的账号（User类型角色）
                    </div>
                `;
                return;
            }
            
            const container = document.getElementById('new-friends-content');
            
            // 获取所有相关的好友申请：发给我的 + 我发送的
            const allRequests = await db.friend_requests.toArray();
            const myRequests = allRequests.filter(req => 
                req.toCharId === parseInt(accountId) || req.fromCharId === parseInt(accountId)
            ).sort((a, b) => b.time - a.time);
            
            if (myRequests.length === 0) {
                container.innerHTML = `
                    <div style="text-align:center; padding:60px 20px; color:#999;">
                        <svg class="svg-icon" style="width:48px; height:48px; stroke:#ccc; margin-bottom:10px;" viewBox="0 0 24 24">
                            <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                            <circle cx="8.5" cy="7" r="4"></circle>
                            <line x1="20" y1="8" x2="20" y2="14"></line>
                            <line x1="23" y1="11" x2="17" y2="11"></line>
                        </svg>
                        <div>暂无好友申请</div>
                    </div>
                `;
                return;
            }
            
            container.innerHTML = '';
            const listDiv = document.createElement('div');
            listDiv.style.width = '100%';
            listDiv.style.background = '#fff';
            
            for (const req of myRequests) {
                const isReceived = req.toCharId === parseInt(accountId);
                const relatedCharId = isReceived ? req.fromCharId : req.toCharId;
                const relatedChar = await db.characters.get(relatedCharId);
                if (!relatedChar) continue;
                
                const item = document.createElement('div');
                item.style.display = 'flex';
                item.style.padding = '12px 16px';
                item.style.borderBottom = '0.5px solid #f0f0f0';
                item.style.alignItems = 'center';
                item.style.gap = '12px';
                
                const avatarStyle = relatedChar.avatar ? `background-image:url(${relatedChar.avatar})` : 'background-color:#eee';
                
                let buttons = '';
                let statusLabel = '';
                
                if (isReceived) {
                    // 收到的申请
                    if (req.status === 'pending') {
                        buttons = `
                            <button onclick="acceptFriendRequest(${req.id})" style="background:var(--ins-pink); color:#fff; border:none; padding:6px 16px; border-radius:4px; font-size:14px; margin-right:8px;">接受</button>
                            <button onclick="rejectFriendRequest(${req.id})" style="background:#f0f0f0; color:#666; border:none; padding:6px 16px; border-radius:4px; font-size:14px;">拒绝</button>
                        `;
                    } else if (req.status === 'accepted') {
                        statusLabel = '<div style="color:#999; font-size:12px;">已添加</div>';
                    } else {
                        statusLabel = '<div style="color:#999; font-size:12px;">已拒绝</div>';
                    }
                } else {
                    // 发送的申请
                    if (req.status === 'pending') {
                        statusLabel = '<div style="color:#999; font-size:12px;">等待验证</div>';
                    } else if (req.status === 'accepted') {
                        statusLabel = '<div style="color:#07c160; font-size:12px;">已接受</div>';
                    } else {
                        statusLabel = '<div style="color:#999; font-size:12px;">已拒绝</div>';
                    }
                }
                
                const messageText = isReceived ? (req.message || '请求添加你为好友') : `你已发送好友申请`;
                
                item.innerHTML = `
                    <div style="width:48px; height:48px; border-radius:4px; ${avatarStyle}; background-size:cover; background-position:center;"></div>
                    <div style="flex:1;">
                        <div style="font-size:16px; font-weight:500; color:#333; margin-bottom:4px;">${relatedChar.name}</div>
                        <div style="font-size:12px; color:#999;">${messageText}</div>
                    </div>
                    <div style="display:flex; align-items:center;">
                        ${buttons}${statusLabel}
                    </div>
                `;
                listDiv.appendChild(item);
            }
            
            container.appendChild(listDiv);
        }

        async function acceptFriendRequest(requestId) {
            const request = await db.friend_requests.get(requestId);
            if (!request) return;
            
            const char = await db.characters.get(request.fromCharId);
            if (!char) return;
            
            const accountId = getCurrentAccountId();
            
            // 更新好友状态
            await setFriendStatus(char, accountId, 'friend');
            
            // 更新申请状态
            request.status = 'accepted';
            await db.friend_requests.put(request);
            
            // 刷新页面
            await renderNewFriendsPage();
            
            // 如果当前在通讯录页面，也刷新通讯录
            const activeTab = document.querySelector('.wechat-tab-item.active');
            if (activeTab && activeTab.innerText.includes('通讯录')) {
                await renderContactList(document.getElementById('wechat-content'));
            }
            
            alert(`已添加 ${char.name} 为好友`);
        }

        async function rejectFriendRequest(requestId) {
            const request = await db.friend_requests.get(requestId);
            if (!request) return;
            
            // 更新申请状态
            request.status = 'rejected';
            await db.friend_requests.put(request);
            
            // 刷新页面
            await renderNewFriendsPage();
        }

        async function deleteFriendConfirm() {
            if (!currentChatCharId) return;
            
            const char = await db.characters.get(currentChatCharId);
            if (!char) return;
            
            if (confirm(`确定要删除好友 ${char.name} 吗？删除后将无法直接发送消息，需要重新发送好友申请。`)) {
                await deleteFriendAction(currentChatCharId);
            }
        }

        async function deleteFriendAction(charId) {
            const char = await db.characters.get(charId);
            if (!char) return;
            
            const accountId = getCurrentAccountId();
            
            // 将好友状态改为陌生人（不删除聊天记录）
            await setFriendStatus(char, accountId, 'deleted');
            
            // 初始化等待好友申请的设置
            if (!char.wait_friend_settings) {
                char.wait_friend_settings = {};
            }
            if (!char.wait_friend_settings[accountId]) {
                char.wait_friend_settings[accountId] = {
                    enabled: false,
                    interval: 60, // 默认60分钟
                    lastCheckTime: Date.now(),
                    nextCheckTime: null
                };
            }
            await db.characters.put(char);
            
            // 关闭聊天详情页但保持聊天窗口打开，显示等待界面
            hideChatDetail();
            
            // 刷新聊天窗口显示等待界面
            if (currentChatCharId === charId) {
                await renderChatBody(char);
            }
            
            // 刷新微信页面
            const activeTab = document.querySelector('.wechat-tab-item.active');
            if (activeTab) {
                const tabIndex = Array.from(document.querySelectorAll('.wechat-tab-item')).indexOf(activeTab);
                switchWechatTab(tabIndex);
            }
            
            alert(`已删除好友 ${char.name}，聊天记录已保留`);
        }

        async function sendFriendRequestTo(charId, message) {
            const accountId = getCurrentAccountId();
            if (!accountId) {
                alert('请先切换到你的账号（User类型角色）');
                return;
            }
            
            const targetChar = await db.characters.get(charId);
            if (!targetChar) return;
            
            // 检查是否已经发送过申请
            const existingRequest = await db.friend_requests
                .where({fromCharId: parseInt(accountId), toCharId: charId, status: 'pending'})
                .first();
            
            if (existingRequest) {
                alert('已发送过好友申请，请等待对方处理');
                return;
            }
            
            // 创建好友申请记录
            const requestId = await db.friend_requests.add({
                fromCharId: parseInt(accountId),
                toCharId: charId,
                message: message || '请求添加你为好友',
                status: 'pending',
                time: Date.now()
            });
            
            // 如果目标角色是Char或NPC类型（非User），自动接受申请
            if (targetChar.type !== 'user') {
                // 模拟自动接受
                setTimeout(async () => {
                    const request = await db.friend_requests.get(requestId);
                    if (request && request.status === 'pending') {
                        // 自动接受
                        request.status = 'accepted';
                        await db.friend_requests.put(request);
                        
                        // 添加为好友
                        await setFriendStatus(targetChar, accountId, 'friend');
                        
                        alert(`${targetChar.name} 已接受你的好友申请`);
                        
                        // 刷新界面
                        const activeTab = document.querySelector('.wechat-tab-item.active');
                        if (activeTab) {
                            const tabIndex = Array.from(document.querySelectorAll('.wechat-tab-item')).indexOf(activeTab);
                            switchWechatTab(tabIndex);
                        }
                    }
                }, 1000); // 1秒后自动接受
                
                alert('好友申请已发送，等待对方回应...');
            } else {
                alert('好友申请已发送，等待对方接受');
            }
        }
        
        async function showAddFriendToCurrentChat() {
            if (!currentChatCharId) return;
            
            const char = await db.characters.get(currentChatCharId);
            if (!char) return;
            
            const message = prompt(`发送好友申请给 ${char.name}\n\n请输入申请理由（可选）：`, '我是' + (await getCurrentUserName()));
            if (message !== null) {
                await sendFriendRequestTo(currentChatCharId, message);
            }
        }
        
        // ===== 等待好友申请相关功能 =====
        
        // 开启/关闭自动检测
        async function toggleWaitFriendCheck(charId) {
            const char = await db.characters.get(charId);
            if (!char) return;
            
            const accountId = getCurrentAccountId();
            if (!char.wait_friend_settings) char.wait_friend_settings = {};
            if (!char.wait_friend_settings[accountId]) {
                char.wait_friend_settings[accountId] = {
                    enabled: false,
                    interval: 60,
                    lastCheckTime: Date.now(),
                    nextCheckTime: null
                };
            }
            
            const settings = char.wait_friend_settings[accountId];
            settings.enabled = !settings.enabled;
            
            if (settings.enabled) {
                // 启用时设置下次检测时间
                settings.lastCheckTime = Date.now();
                settings.nextCheckTime = Date.now() + settings.interval * 60 * 1000;
                startWaitFriendTimer();
            } else {
                settings.nextCheckTime = null;
            }
            
            await db.characters.put(char);
            
            // 刷新界面
            if (currentChatCharId === charId) {
                await renderChatBody(char);
            }
        }
        
        // 保存检测间隔
        async function saveWaitFriendInterval(charId) {
            const char = await db.characters.get(charId);
            if (!char) return;
            
            const accountId = getCurrentAccountId();
            const intervalInput = document.getElementById('wait-friend-interval');
            const interval = parseInt(intervalInput.value) || 60;
            
            if (!char.wait_friend_settings) char.wait_friend_settings = {};
            if (!char.wait_friend_settings[accountId]) {
                char.wait_friend_settings[accountId] = {
                    enabled: false,
                    interval: interval,
                    lastCheckTime: Date.now(),
                    nextCheckTime: null
                };
            }
            
            char.wait_friend_settings[accountId].interval = interval;
            
            // 如果已启用，重新计算下次检测时间
            if (char.wait_friend_settings[accountId].enabled) {
                char.wait_friend_settings[accountId].nextCheckTime = 
                    char.wait_friend_settings[accountId].lastCheckTime + interval * 60 * 1000;
            }
            
            await db.characters.put(char);
            
            // 刷新界面
            if (currentChatCharId === charId) {
                await renderChatBody(char);
            }
        }
        
        // 快进检测
        async function fastForwardCheck(charId) {
            const minutes = prompt('快进多少分钟？', '60');
            if (minutes === null) return;
            
            const minutesNum = parseInt(minutes);
            if (isNaN(minutesNum) || minutesNum <= 0) {
                alert('请输入有效的分钟数');
                return;
            }
            
            await checkCharacterSendFriendRequest(charId, minutesNum);
        }
        
        // 手动发送好友申请（用户主动）
        async function manualSendFriendRequest(charId) {
            const char = await db.characters.get(charId);
            if (!char) return;
            
            const message = prompt(`发送好友申请给 ${char.name}\n\n请输入申请理由（可选）：`, '我是' + (await getCurrentUserName()));
            if (message !== null) {
                await sendFriendRequestTo(charId, message);
            }
        }
        
        // AI检测是否发送好友申请
        async function checkCharacterSendFriendRequest(charId, elapsedMinutes) {
            const char = await db.characters.get(charId);
            if (!char) return;
            
            const accountId = getCurrentAccountId();
            const myChar = await db.characters.get(parseInt(accountId));
            if (!myChar) return;
            
            // 获取聊天历史
            const history = getChatHistory(char, accountId);
            const recentMessages = history.slice(-10); // 最近10条消息
            
            // 构建提示词
            const chatContext = recentMessages.map(msg => {
                const role = msg.role === 'user' ? myChar.name : char.name;
                return `${role}: ${msg.content}`;
            }).join('\n');
            
            const prompt = `你是${char.name}。

你的人设：
${char.description || '（无详细人设）'}

你和${myChar.name}之前是好友，但${myChar.name}删除了你。你们之前的聊天记录：

${chatContext || '（没有聊天记录）'}

现在时间已经过去了${elapsedMinutes}分钟。

请根据你的性格、和${myChar.name}的关系、以及你们的聊天历史，决定你是否要主动发送好友申请给${myChar.name}。

请直接回答"是"或"否"，并简要说明理由（不超过50字）。

格式：是/否 | 理由`;

            // 显示加载提示
            const body = document.getElementById('chat-body');
            const loadingDiv = document.createElement('div');
            loadingDiv.style.cssText = 'position:fixed; top:50%; left:50%; transform:translate(-50%, -50%); background:rgba(0,0,0,0.8); color:#fff; padding:20px 30px; border-radius:8px; z-index:9999;';
            loadingDiv.textContent = 'AI思考中...';
            document.body.appendChild(loadingDiv);
            
            try {
                const response = await callAI([
                    { role: 'user', content: prompt }
                ]);
                
                document.body.removeChild(loadingDiv);
                
                // 解析AI回复
                const answer = response.trim();
                const isYes = answer.startsWith('是') || answer.toLowerCase().startsWith('yes');
                
                if (isYes) {
                    // 角色决定发送好友申请
                    const reasonMatch = answer.match(/[|｜]\s*(.+)$/);
                    const reason = reasonMatch ? reasonMatch[1].trim() : '想和你继续保持联系';
                    
                    // 创建好友申请（反向：从角色发给用户）
                    await db.friend_requests.add({
                        fromCharId: charId,
                        toCharId: parseInt(accountId),
                        message: reason,
                        status: 'pending',
                        time: Date.now()
                    });
                    
                    alert(`${char.name} 发送了好友申请！\n\n理由：${reason}\n\n请前往"新的好友"页面查看。`);
                    
                    // 更新最后检测时间
                    if (!char.wait_friend_settings) char.wait_friend_settings = {};
                    if (char.wait_friend_settings[accountId]) {
                        char.wait_friend_settings[accountId].lastCheckTime = Date.now();
                        if (char.wait_friend_settings[accountId].enabled) {
                            char.wait_friend_settings[accountId].nextCheckTime = 
                                Date.now() + char.wait_friend_settings[accountId].interval * 60 * 1000;
                        }
                        await db.characters.put(char);
                    }
                    
                    // 刷新通讯录红点
                    const activeTab = document.querySelector('.wechat-tab-item.active');
                    if (activeTab && activeTab.innerText.includes('通讯录')) {
                        await renderContactList(document.getElementById('wechat-content'));
                    }
                } else {
                    // 角色决定不发送
                    const reasonMatch = answer.match(/[|｜]\s*(.+)$/);
                    const reason = reasonMatch ? reasonMatch[1].trim() : answer;
                    
                    alert(`${char.name} 决定暂时不发送好友申请\n\n${reason}`);
                    
                    // 更新最后检测时间
                    if (!char.wait_friend_settings) char.wait_friend_settings = {};
                    if (char.wait_friend_settings[accountId]) {
                        char.wait_friend_settings[accountId].lastCheckTime = Date.now();
                        if (char.wait_friend_settings[accountId].enabled) {
                            char.wait_friend_settings[accountId].nextCheckTime = 
                                Date.now() + char.wait_friend_settings[accountId].interval * 60 * 1000;
                        }
                        await db.characters.put(char);
                    }
                }
                
                // 刷新界面
                if (currentChatCharId === charId) {
                    await renderChatBody(char);
                }
                
            } catch (error) {
                document.body.removeChild(loadingDiv);
                alert('AI调用失败：' + error.message);
            }
        }
        
        // 定时器：检查所有需要检测的角色
        let waitFriendCheckTimer = null;
        
        function startWaitFriendTimer() {
            if (waitFriendCheckTimer) return; // 已启动
            
            waitFriendCheckTimer = setInterval(async () => {
                const now = Date.now();
                const accountId = getCurrentAccountId();
                if (!accountId) return;
                
                // 获取所有角色
                const allChars = await db.characters.toArray();
                
                for (const char of allChars) {
                    const settings = char.wait_friend_settings?.[accountId];
                    if (!settings || !settings.enabled) continue;
                    
                    // 检查是否到达检测时间
                    if (settings.nextCheckTime && now >= settings.nextCheckTime) {
                        // 触发检测
                        await checkCharacterSendFriendRequest(char.id, settings.interval);
                    }
                }
            }, 60000); // 每分钟检查一次
        }
        
        // 初始化时启动定时器
        startWaitFriendTimer();

        // --- 聊天窗口逻辑 ---
        async function openChatWindow(charId) {
            currentChatCharId = charId;
            const char = await db.characters.get(charId);
            
            // 优先显示备注名
            document.getElementById('chat-title').innerText = char.remark || char.name;
            document.getElementById('chat-window').style.display = 'flex';
            
            // 缓存当前关联的 User ID
            currentChatUserId = char.linked_user_id || null;
            
            renderChatBody(char);
        }

        // --- 聊天详情页逻辑 ---
        async function showChatDetail() {
            if (!currentChatCharId) return;
            const char = await db.characters.get(currentChatCharId);
            if (!char) return;

            document.getElementById('chat-detail-page').style.display = 'flex';
            
            // 1. 回显基本信息
            document.getElementById('detail-char-remark').value = char.remark || '';
            document.getElementById('detail-char-realname').innerText = `原名: ${char.name}`;
            if (char.avatar) {
                document.getElementById('detail-char-avatar').style.backgroundImage = `url(${char.avatar})`;
            } else {
                document.getElementById('detail-char-avatar').style.backgroundImage = '';
            }

            // 2. 加载世界书列表（多选）
            const lorebooks = await db.lorebooks.toArray();
            const lbList = document.getElementById('detail-lorebook-list');
            lbList.innerHTML = '';
            
            // 兼容旧数据：如果lorebookId存在但lorebookIds不存在，转换为数组
            const selectedIds = char.lorebookIds || (char.lorebookId ? [char.lorebookId] : []);
            
            if (lorebooks.length === 0) {
                lbList.innerHTML = '<div style="padding:8px; color:#999; font-size:12px; text-align:center;">暂无世界书</div>';
            } else {
                lorebooks.forEach(lb => {
                    const label = document.createElement('label');
                    label.style.cssText = 'display:flex; align-items:center; padding:8px; cursor:pointer; border-radius:6px; margin-bottom:4px;';
                    label.style.background = selectedIds.includes(lb.id) ? '#f0f0f5' : 'transparent';
                    
                    const checkbox = document.createElement('input');
                    checkbox.type = 'checkbox';
                    checkbox.value = lb.id;
                    checkbox.checked = selectedIds.includes(lb.id);
                    checkbox.style.marginRight = '8px';
                    checkbox.onchange = () => {
                        label.style.background = checkbox.checked ? '#f0f0f5' : 'transparent';
                        updateLorebookCount();
                        saveChatDetail();
                    };
                    
                    const name = document.createElement('span');
                    name.textContent = lb.name;
                    name.style.fontSize = '14px';
                    name.style.color = '#333';
                    
                    label.appendChild(checkbox);
                    label.appendChild(name);
                    lbList.appendChild(label);
                });
            }
            
            updateLorebookCount();

            // 3. 加载 User 列表
            const users = await db.characters.where('type').equals('user').toArray();
            const userSelect = document.getElementById('detail-user-select');
            userSelect.innerHTML = '<option value="">默认 (系统)</option>';
            users.forEach(u => {
                const opt = document.createElement('option');
                opt.value = u.id;
                opt.text = u.name;
                if (char.linked_user_id && u.id == char.linked_user_id) opt.selected = true;
                userSelect.appendChild(opt);
            });
            handleUserChange(); // 刷新 User 头像预览显示

            // 4. 回显主动聊天设置
            document.getElementById('detail-auto-chat-switch').checked = !!char.auto_reply_enabled;
            document.getElementById('detail-auto-chat-interval').value = char.auto_reply_interval || '';
            
            // 5. 回显上下文条数设置（默认20条）
            document.getElementById('detail-context-count').value = char.context_message_count || 20;

            // 5. 加载挂载的表情包库
            updateMountedStickerCount();
        }

        function hideChatDetail() {
            document.getElementById('chat-detail-page').style.display = 'none';
        }

        function toggleLorebookList() {
            const list = document.getElementById('detail-lorebook-list');
            const toggle = document.getElementById('detail-lorebook-toggle');
            if (list.style.display === 'none' || !list.style.display) {
                list.style.display = 'block';
                toggle.textContent = '收起';
            } else {
                list.style.display = 'none';
                toggle.textContent = '展开';
            }
        }

        function updateLorebookCount() {
            const checkboxes = document.querySelectorAll('#detail-lorebook-list input[type="checkbox"]:checked');
            const count = checkboxes.length;
            document.getElementById('detail-lorebook-count').textContent = `${count}个`;
        }

async function saveChatDetail() {
    if (!currentChatCharId) return;
    const char = await db.characters.get(currentChatCharId);
    
    const remark = document.getElementById('detail-char-remark').value.trim();
    
    // 获取选中的世界书ID数组
    const checkboxes = document.querySelectorAll('#detail-lorebook-list input[type="checkbox"]:checked');
    const lorebookIds = Array.from(checkboxes).map(cb => parseInt(cb.value));
    
    // linked_user_id 在 handleUserChange 中处理，或者在这里统一保存
    const linkedUserId = document.getElementById('detail-user-select').value;
    
    // 主动聊天设置
    const autoEnabled = document.getElementById('detail-auto-chat-switch').checked;
    const autoInterval = parseInt(document.getElementById('detail-auto-chat-interval').value);
    
    // 上下文条数设置
    const contextCount = parseInt(document.getElementById('detail-context-count').value);

    char.remark = remark;
    char.lorebookIds = lorebookIds.length > 0 ? lorebookIds : null;
    // 保留旧字段以兼容，但优先使用lorebookIds
    if (lorebookIds.length > 0) {
        char.lorebookId = lorebookIds[0]; // 保留第一个作为兼容
    } else {
        char.lorebookId = null;
    }
    char.linked_user_id = linkedUserId ? parseInt(linkedUserId) : null;
    char.auto_reply_enabled = autoEnabled;
    char.auto_reply_interval = autoInterval > 0 ? autoInterval : null;
    char.context_message_count = contextCount > 0 ? contextCount : 20; // 默认20条
    
    await db.characters.put(char);
    
    // 实时更新聊天标题
    document.getElementById('chat-title').innerText = char.remark || char.name;
    // 刷新列表（如果此时微信列表可见）
    // ...
    
    // 更新缓存
    currentChatUserId = char.linked_user_id;
}

// 显示挂载表情包库弹窗
async function showMountStickerModal() {
    if (!currentChatCharId) return;
    
    const char = await db.characters.get(currentChatCharId);
    const mountedIds = char.mounted_sticker_categories || [];
    
    const modal = document.getElementById('mount-sticker-modal');
    const listContainer = document.getElementById('mount-sticker-list');
    
    if (!modal || !listContainer) {
        console.error('挂载表情包库弹窗元素未找到');
        return;
    }
    
    // 获取所有表情包分类
    const categories = await db.sticker_categories.toArray();
    
    if (categories.length === 0) {
        listContainer.innerHTML = '<div style="text-align:center; color:#999; padding:40px;">暂无表情包分类<br>请先去【我-表情】创建分类</div>';
    } else {
        listContainer.innerHTML = categories.map(cat => {
            const isMounted = mountedIds.includes(cat.id);
            const stickerCount = (cat.stickers || []).length;
            return `
                <label style="display:flex; align-items:center; padding:12px; background:${isMounted ? '#f0f0f5' : '#fff'}; border:1px solid #f0f0f0; border-radius:8px; cursor:pointer; transition:background 0.2s;">
                    <input type="checkbox" value="${cat.id}" ${isMounted ? 'checked' : ''} style="margin-right:12px; width:18px; height:18px; cursor:pointer;" onchange="this.parentElement.style.background = this.checked ? '#f0f0f5' : '#fff'">
                    <div style="flex:1;">
                        <div style="font-size:15px; font-weight:500; color:#333; margin-bottom:4px;">${cat.name}</div>
                        <div style="font-size:12px; color:#999;">${stickerCount} 个表情</div>
                    </div>
                </label>
            `;
        }).join('');
    }
    
    modal.style.display = 'flex';
    
    // 点击外部区域关闭弹窗
    modal.onclick = function(e) {
        if (e.target === modal) {
            hideMountStickerModal();
        }
    };
}

// 隐藏挂载表情包库弹窗
function hideMountStickerModal() {
    const modal = document.getElementById('mount-sticker-modal');
    if (modal) modal.style.display = 'none';
}

// 保存挂载的表情包分类
async function saveMountedStickers() {
    if (!currentChatCharId) return;
    
    const checkboxes = document.querySelectorAll('#mount-sticker-list input[type="checkbox"]:checked');
    const mountedIds = Array.from(checkboxes).map(cb => parseInt(cb.value));
    
    const char = await db.characters.get(currentChatCharId);
    char.mounted_sticker_categories = mountedIds.length > 0 ? mountedIds : null;
    await db.characters.put(char);
    
    updateMountedStickerCount();
    hideMountStickerModal();
    
    // 刷新表情包面板
    await updateChatStickerPanel();
}

// 更新挂载表情包数量显示
async function updateMountedStickerCount() {
    if (!currentChatCharId) return;
    
    const char = await db.characters.get(currentChatCharId);
    const mountedIds = char.mounted_sticker_categories || [];
    const countEl = document.getElementById('mounted-sticker-count');
    
    if (!countEl) return;
    
    if (mountedIds.length === 0) {
        countEl.innerText = '未挂载';
    } else {
        // 计算总表情数
        let totalStickers = 0;
        for (const catId of mountedIds) {
            const cat = await db.sticker_categories.get(catId);
            if (cat && cat.stickers) {
                totalStickers += cat.stickers.length;
            }
        }
        countEl.innerText = `${mountedIds.length}个分类 (${totalStickers}个表情)`;
    }
}

// 确保函数在全局作用域可访问
window.showMountStickerModal = showMountStickerModal;
window.hideMountStickerModal = hideMountStickerModal;
window.saveMountedStickers = saveMountedStickers;

        async function handleUserChange() {
            const userId = document.getElementById('detail-user-select').value;
            const avatarRow = document.getElementById('detail-user-avatar-row');
            const preview = document.getElementById('detail-user-avatar-preview');
            
            if (userId) {
                avatarRow.style.display = 'flex';
                const user = await db.characters.get(parseInt(userId));
                if (user && user.avatar) {
                    preview.style.backgroundImage = `url(${user.avatar})`;
                } else {
                    preview.style.backgroundImage = '';
                }
            } else {
                avatarRow.style.display = 'none';
            }
            saveChatDetail(); // 选完直接保存
        }

        async function setChatDetailAvatar(input) {
            const file = input.files[0];
            if (file && currentChatCharId) {
                const reader = new FileReader();
                reader.onload = async (e) => {
                    const base64 = e.target.result;
                    document.getElementById('detail-char-avatar').style.backgroundImage = `url(${base64})`;
                    
                    const char = await db.characters.get(currentChatCharId);
                    char.avatar = base64;
                    await db.characters.put(char);
                    
                    // 刷新聊天界面头像（如果在聊天中）
                    renderChatBody(char); 
                };
                reader.readAsDataURL(file);
            }
            input.value = '';
        }

        async function setChatDetailUserAvatar(input) {
            const file = input.files[0];
            const userId = document.getElementById('detail-user-select').value;
            
            if (file && userId) {
                const reader = new FileReader();
                reader.onload = async (e) => {
                    const base64 = e.target.result;
                    document.getElementById('detail-user-avatar-preview').style.backgroundImage = `url(${base64})`;
                    
                    const user = await db.characters.get(parseInt(userId));
                    user.avatar = base64;
                    await db.characters.put(user);
                    
                    // 刷新聊天界面头像
                    const char = await db.characters.get(currentChatCharId);
                    renderChatBody(char);
                };
                reader.readAsDataURL(file);
            }
            input.value = '';
        }

        function jumpToCharEditor() {
            if (!currentChatCharId) return;
            hideChatDetail();
            editCharacter(currentChatCharId);
        }

        async function clearChatHistory() {
            if (!currentChatCharId) return;
            if (confirm("确定要清空与该角色的聊天记录吗？")) {
                const char = await db.characters.get(currentChatCharId);
                const accountId = getCurrentAccountId();
                await setChatHistory(char, accountId, []);
                renderChatBody(char);
                alert("已清空");
            }
        }
        
        // --- 主动发消息逻辑（改为后端驱动）---
        let syncTimer = null; // 同步定时器
        
        // 同步角色配置到后端（让后端来检查）
        async function syncCharactersToBackend() {
            try {
                // 获取所有开启了主动发消息的角色
                const chars = await db.characters
                    .filter(c => c.auto_reply_enabled === true && c.auto_reply_interval > 0)
                    .toArray();
                
                if (chars.length === 0) {
                    console.log('[Sync] No characters to sync');
                    return;
                }
                
                // 准备同步数据
                const syncData = chars.map(c => ({
                    id: c.id,
                    name: c.name,
                    avatar: c.avatar,
                    auto_reply_enabled: c.auto_reply_enabled,
                    auto_reply_interval: c.auto_reply_interval,
                    last_message_time: (() => {
                        // 获取当前账号的聊天记录
                        const accountId = getCurrentAccountId();
                        const history = getChatHistory(c, accountId);
                        return history && history.length > 0 
                            ? history[history.length - 1].time 
                            : (c.updated_at || Date.now());
                    })(),
                    user_id: currentUserId
                }));
                
                console.log(`[Sync] ========================================`);
                console.log(`[Sync] 正在同步 ${syncData.length} 个角色到后端...`);
                console.log(`[Sync]   user_id: ${currentUserId}`);
                console.log(`[Sync]   user_id类型: ${typeof currentUserId}`);
                console.log(`[Sync]   角色列表:`, syncData.map(c => ({ name: c.name, user_id: c.user_id })));
                
                // 发送到后端
                const res = await fetch(`${API_BASE}/characters/sync`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ characters: syncData })
                });
                
                if (res.ok) {
                    const result = await res.json();
                    console.log(`[Sync] ✓✓✓ 同步成功！`);
                    console.log(`[Sync]   后端响应:`, result);
                    console.log(`[Sync] ========================================`);
                    showDebugToast(`✓ 已同步${syncData.length}个角色到后端`);
                } else {
                    const errorText = await res.text();
                    console.error('[Sync] ✗✗✗ 同步失败！');
                    console.error('[Sync]   状态码:', res.status);
                    console.error('[Sync]   错误信息:', errorText);
                    console.log(`[Sync] ========================================`);
                }
                
            } catch (err) {
                console.error('[Sync] Error:', err);
            }
        }
        
        // 注册 Service Worker 并订阅推送
        async function registerServiceWorkerAndSubscribe() {
            if (!('serviceWorker' in navigator)) {
                console.log('[SW] Not supported');
                showDebugToast('❌ 浏览器不支持Service Worker');
                return;
            }
            
            if (!('PushManager' in window)) {
                console.log('[Push] Not supported');
                showDebugToast('❌ 浏览器不支持推送通知');
                return;
            }
            
            try {
                // 注册 Service Worker（独立文件）
                const registration = await navigator.serviceWorker.register('./sw.js');
                console.log('[SW] Registered:', registration);
                showDebugToast('✓ Service Worker已注册');
                
                // 等待激活
                await navigator.serviceWorker.ready;
                console.log('[ServiceWorker] Ready');
                
                // 请求通知权限
                const permission = await Notification.requestPermission();
                if (permission !== 'granted') {
                    console.log('[Push] Permission denied');
                    showDebugToast('✗ 推送权限被拒绝');
                    return;
                }
                
                // 获取 VAPID 公钥
                console.log('[Push] Fetching VAPID public key...');
                const keyRes = await fetch(`${API_BASE}/push/public_key`);
                
                if (!keyRes.ok) {
                    throw new Error(`获取公钥失败: ${keyRes.status}`);
                }
                
                const keyData = await keyRes.json();
                console.log('[Push] Key data received:', keyData);
                
                const publicKey = keyData.public_key;
                
                // 验证公钥是否有效
                if (!publicKey) {
                    throw new Error('后端返回的公钥为空！请检查后端 VAPID 密钥是否正确生成。');
                }
                
                console.log('[Push] Public key:', publicKey.substring(0, 30) + '...');
                
                // 订阅推送
                const subscription = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(publicKey)
                });
                
                console.log('[Push] Subscribed:', subscription);
                
                // 发送订阅信息到后端
                console.log('[Push] ========================================');
                console.log('[Push] 🔔 正在发送订阅到后端...');
                console.log('[Push]   user_id:', currentUserId);
                console.log('[Push]   user_id类型:', typeof currentUserId);
                console.log('[Push]   subscription endpoint:', subscription.endpoint.substring(0, 50) + '...');
                
                const subscriptionData = {
                    user_id: currentUserId,
                    subscription: subscription.toJSON()
                };
                console.log('[Push]   发送数据:', JSON.stringify(subscriptionData).substring(0, 200) + '...');
                
                const subRes = await fetch(`${API_BASE}/push/subscribe`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(subscriptionData)
                });
                
                if (subRes.ok) {
                    const result = await subRes.json();
                    console.log('[Push] ✓✓✓ 订阅已保存到后端！');
                    console.log('[Push]   后端响应:', result);
                    console.log('[Push]   🎉 后台推送已激活！即使浏览器在后台也能收到通知！');
                    console.log('[Push] ========================================');
                    showDebugToast('🎉 后台推送已激活！', true);
                } else {
                    const errorText = await subRes.text();
                    console.error('[Push] ✗✗✗ 订阅保存失败！');
                    console.error('[Push]   状态码:', subRes.status);
                    console.error('[Push]   错误信息:', errorText);
                    console.log('[Push] ========================================');
                    showDebugToast('✗ 订阅保存失败: ' + errorText);
                }
                
            } catch (err) {
                console.error('[ServiceWorker] Error:', err);
                showDebugToast(`✗ Service Worker错误: ${err.message}`);
            }
        }
        
        // Base64 转 Uint8Array (用于 VAPID 公钥)
        function urlBase64ToUint8Array(base64String) {
            const padding = '='.repeat((4 - base64String.length % 4) % 4);
            const base64 = (base64String + padding)
                .replace(/\-/g, '+')
                .replace(/_/g, '/');
            
            const rawData = window.atob(base64);
            const outputArray = new Uint8Array(rawData.length);
            
            for (let i = 0; i < rawData.length; ++i) {
                outputArray[i] = rawData.charCodeAt(i);
            }
            return outputArray;
        }
        
        // 连接WebSocket接收实时推送
        function connectWebSocket() {
            console.log('[WebSocket] Initializing connection to:', SOCKET_URL);
            
            if (socket && socket.connected) {
                console.log('[WebSocket] Already connected');
                showDebugToast('WebSocket已连接');
                return;
            }
            
            try {
                console.log('[WebSocket] Creating io connection...');
                socket = io(SOCKET_URL, {
                    transports: ['websocket', 'polling'],
                    reconnection: true,
                    reconnectionDelay: 1000,
                    reconnectionAttempts: 10
                });
                
                socket.on('connect', () => {
                    console.log('[WebSocket] ✓✓✓ CONNECTED to server!');
                    console.log('[WebSocket] Socket ID:', socket.id);
                    showDebugToast('✓ WebSocket已连接！', true);
                });
                
                socket.on('disconnect', (reason) => {
                    console.log('[WebSocket] ✗ Disconnected:', reason);
                    showDebugToast(`✗ WebSocket断开: ${reason}`);
                });
                
                socket.on('connect_error', (error) => {
                    console.error('[WebSocket] Connection error:', error);
                    console.error('[WebSocket] 检查后端是否运行:', SOCKET_URL);
                    showDebugToast(`✗ 连接失败，检查后端${SOCKET_URL}`);
                });
                
                // 监听后端推送的触发事件
                socket.on('auto_chat_trigger', (data) => {
                    console.log('[WebSocket] ✓✓✓ Received auto_chat_trigger!');
                    console.log('[WebSocket] Data:', data);
                    showDebugToast(`🔥 收到WebSocket推送: ${data.char_name}`);
                    
                    // 查找对应角色并触发AI生成（会自动发送通知）
                    db.characters.get(data.char_id).then(char => {
                        if (char) {
                            console.log('[WebSocket] ✓ Found character, triggering AI...');
                            triggerAutoChat(char);
                        } else {
                            console.warn('[WebSocket] ✗ Character not found:', data.char_id);
                            showDebugToast(`✗ 找不到角色: ${data.char_id}`);
                        }
                    });
                });
                
                console.log('[WebSocket] Event listeners registered');
                
            } catch (err) {
                console.error('[WebSocket] ✗ Failed to initialize:', err);
                showDebugToast(`✗ WebSocket初始化失败: ${err.message}`);
            }
        }
        
        // 启动同步循环（每30秒同步一次配置）
        async function startAutoChatLoop() {
            if (syncTimer) clearInterval(syncTimer);
            
            console.log('[AutoChat] Starting real-time push mode...');
            console.log('[AutoChat] Current environment:', {
                protocol: location.protocol,
                hostname: location.hostname,
                href: location.href,
                serviceWorkerSupported: 'serviceWorker' in navigator,
                pushManagerSupported: 'PushManager' in window,
                notificationSupported: 'Notification' in window,
                notificationPermission: Notification.permission
            });
            showDebugToast('实时推送启动中...', true);
            
            // 1. 连接WebSocket（实时推送，前台生效）
            console.log('[AutoChat] Step 1: Connecting WebSocket...');
            connectWebSocket();
            
            // 2. 注册 Service Worker（后台推送，需要HTTPS或localhost）
            console.log('[AutoChat] Step 2: Registering Service Worker...');
            if (location.protocol === 'https:' || location.hostname === 'localhost') {
                console.log('[AutoChat] ✓ Environment supports Service Worker');
                await registerServiceWorkerAndSubscribe();
            } else {
                console.warn('[AutoChat] ✗ Service Worker NOT supported in this environment!');
                console.warn(`[AutoChat] Current: ${location.protocol}//${location.hostname}`);
                console.warn('[AutoChat] Required: https:// OR http://localhost');
                showDebugToast('⚠️ 需要HTTPS或localhost才有后台推送');
            }
            
            // 3. 立即同步一次配置到后端
            console.log('[AutoChat] Step 3: Syncing characters...');
            syncCharactersToBackend();
            
            // 4. 每30秒同步一次配置
            syncTimer = setInterval(() => {
                console.log('[Sync] Syncing characters to backend...');
                syncCharactersToBackend();
            }, 30 * 1000);
            
            // 5. 每15秒检查一次是否该发消息（立即触发，无后端轮询延迟）
            setInterval(() => {
                checkAutoChat(); // 前端主动检查
            }, 15 * 1000);
            
            // 立即检查一次
            checkAutoChat();
            
            // 6. 监听页面可见性变化，从后台切回时立即检查
            document.addEventListener('visibilitychange', function() {
                if (!document.hidden) {
                    console.log('[AutoChat] ✓ Page became visible, checking for pending messages...');
                    showDebugToast('✓ 返回前台，检查消息...');
                    
                    // 立即检查是否有该发的消息（可能在后台时错过了）
                    setTimeout(() => {
                        checkAutoChat();
                    }, 500);
                    
                    // 如果保活已开启且音频暂停，重新启动
                    const keepaliveEnabled = localStorage.getItem('keepalive_enabled') === 'true';
                    if (keepaliveEnabled && keepAliveAudio && keepAliveAudio.paused) {
                        console.log('[KeepAlive] 页面恢复可见，重新启动保活');
                        showDebugToast('✓ 重启保活音频...');
                        startKeepAlive();
                    }
                }
            });
            
            console.log('[AutoChat] ✓ Setup complete!');
            showDebugToast('✓ 实时推送已启动！', true);
        }

        async function checkAutoChat() {
            const now = Date.now();
            // 获取开启了主动聊天的角色
            const chars = await db.characters
                .filter(c => c.auto_reply_enabled === true && c.auto_reply_interval > 0)
                .toArray();

            if (chars.length > 0) {
                console.log(`[AutoChat] Check triggered at ${new Date().toLocaleTimeString()} for ${chars.length} enabled chars`);
            }

            const accountId = getCurrentAccountId();
            for (const char of chars) {
                // 如果是好友状态才触发（按账号检查）
                const status = getFriendStatus(char, accountId);
                if (status !== 'friend') continue;

                // 防止并发：如果这个角色正在生成中，跳过
                if (autoChatLocks.has(char.id)) {
                    console.log(`[AutoChat] Skipping ${char.name} (locked/generating)`);
                    continue;
                }

                // 检查上次消息时间（按账号）
                let lastTime = 0;
                const history = getChatHistory(char, accountId);
                if (history && history.length > 0) {
                    lastTime = history[history.length - 1].time;
                } else {
                    // 如果没有历史消息，以创建时间或更新时间为准
                    lastTime = char.updated_at || 0;
                }

                const diffMinutes = (now - lastTime) / (1000 * 60);
                
                // 宽容度 0.1 分钟（6秒），避免因为执行耗时导致刚好错过
                // 例如间隔1分钟，diff是 0.95分钟，也允许触发
                if (diffMinutes >= (char.auto_reply_interval - 0.1)) {
                    // 触发主动消息
                    console.log(`[AutoChat] ✓✓✓ Triggering for ${char.name} (Interval: ${char.auto_reply_interval}, Last msg: ${diffMinutes.toFixed(2)} mins ago)`);
                    
                    // 生成AI消息（内部会自动推送通知）
                    triggerAutoChat(char);
                }
            }
        }

        async function triggerAutoChat(char) {
            // 加锁
            autoChatLocks.add(char.id);

            try {
                // 1. 准备上下文
                let userDesc = "";
                let userName = "用户";
                if (char.linked_user_id) {
                    const user = await db.characters.get(char.linked_user_id);
                    if (user) {
                        userName = user.name;
                        userDesc = `\n\n【对话对象(User)信息】\n名字：${user.name}\n设定：${user.description || '无'}`;
                    }
                }
                
                const accountId = getCurrentAccountId();
                let loreContext = "";
                const lorebookIds = char.lorebookIds || (char.lorebookId ? [char.lorebookId] : []);
                if (lorebookIds.length > 0) {
                    const history = getChatHistory(char, accountId);
                    const recentText = (history || []).slice(-10).map(m => m.content).join(' ');
                    loreContext = await getLorebookContext(lorebookIds, `${char.name} ${userName} ${recentText}`);
                }

                // 计算虚拟时间
                const virtualTimeStr = getFormattedVirtualTime(char.timeOffset);

                // 2. 构建 Prompt
                const systemPrompt = `你正在进行角色扮演。
【当前时间】
${virtualTimeStr}

【角色(你)信息】
名字：${char.name}
${char.nick ? `昵称：${char.nick}` : ''}
设定：
${char.description || ''}

${userDesc}
${loreContext}

现在距离上次对话已经过去了一段时间。请根据角色性格，主动向 ${userName} 发起新的话题，或者延续之前未尽的话题。

【重要指令 - 必须严格遵守】
1. **必须**模拟微信连发消息的习惯：请生成 2 到 4 条短消息，不能只发一条！
2. **必须**使用分隔符 "|||" 来隔开每一条消息。
3. **严禁使用逗号**（包括中文逗号和英文逗号）。如果想表达停顿，请直接拆分成下一条消息，或者用空格代替。
   - 错误示例：嘿在吗？刚刚看到个好玩的视频，发给你看看
   - 正确示例：嘿在吗？|||刚刚看到个好玩的视频|||发给你看看
4. 每条消息要简短，5-15个字最佳，像真实微信聊天一样分多条发送。
5. 严禁只发送标点符号。每一条消息都必须有实际文字内容。
6. 语气要自然、口语化，符合人设。

请务必输出格式如：第一条消息内容|||第二条消息内容|||第三条消息内容

【重要】你需要同时生成两个内容：
1. **回复内容**：主动发送的消息（用|||分隔的多条消息）
2. **心声内容**：角色当前的心理活动、想法、感受或状态变化

请以JSON格式返回，格式如下：
{
  "reply": "第一条消息|||第二条消息|||第三条消息",
  "thought": "角色的心声/心理活动/想法"
}

请严格返回JSON格式，不要包含Markdown代码块标记。`;

                // 取最近 10 条历史记录作为参考（按账号）
                const history = getChatHistory(char, accountId);
                const recentHistory = (history || []).slice(-10)
                    .filter(m => m.content && m.content.trim()) // 过滤空消息
                    .map(m => ({
                        role: m.role === 'char' ? 'assistant' : 'user',
                        content: m.content
                    }));

                const messages = [
                    { role: 'system', content: systemPrompt },
                    ...recentHistory
                ];

                // 3. 调用 AI
                const aiResponse = await callAI(messages);
                
                let cleanReply = "";
                let thought = "";
                
                // 使用增强的提取函数
                const parsed = extractAndParseJSON(aiResponse);
                
                if (parsed) {
                    cleanReply = parsed.reply || parsed.content || parsed.message || "";
                    thought = parsed.thought || "";
                    
                    // 特殊处理：如果是转账对象且不在reply字段中，可能整个对象就是消息
                    if (!cleanReply && parsed.amount && parsed.status) {
                        cleanReply = JSON.stringify(parsed);
                    }
                }
                
                // 如果提取失败或没有内容，尝试原始解析或直接使用文本
                    if (!cleanReply) {
                    // 清理常见装饰字符
                    let cleanResponse = aiResponse.trim().replace(/[◇◆★☆●○■□▲△]/g, '');
                    
                    // 尝试简单的正则提取兜底
                    const replyMatch = cleanResponse.match(/"reply"\s*:\s*"([\s\S]*?)"/);
                    if (replyMatch) {
                        cleanReply = replyMatch[1]
                            .replace(/\\n/g, '\n')
                            .replace(/\\"/g, '"')
                            .replace(/\\t/g, '\t')
                            .replace(/\\\\/g, '\\');
                    } else {
                        cleanReply = cleanResponse || "(AI 返回为空)";
                    }
                    }
                    
                    // 存储心声到角色对象
                    if (thought && thought.trim()) {
                        const freshChar = await db.characters.get(char.id);
                        if (freshChar) {
                            if (!freshChar.thoughts) freshChar.thoughts = [];
                            const currentHistory = getChatHistory(freshChar, accountId);
                            freshChar.thoughts.push({
                                content: thought.trim(),
                                time: Date.now(),
                                messageIndex: currentHistory ? currentHistory.length : 0
                            });
                            // 只保留最近50条心声
                            if (freshChar.thoughts.length > 50) {
                                freshChar.thoughts = freshChar.thoughts.slice(-50);
                            }
                            await db.characters.put(freshChar);
                        }
                    }
                
                // ✅ 修复：清理末尾多余的 ]
                function cleanMessage(text) {
                    if (!text) return text;
                    // 删除末尾多余的 ]
                    return text.replace(/\]+$/, '');
                }
                
                // 清理回复内容
                let cleanReplyProcessed = cleanMessage(cleanReply);
                const replyText = cleanReplyProcessed;
                
                if (!cleanReplyProcessed || !cleanReplyProcessed.trim()) {
                    console.warn(`[AutoChat] AI returned empty reply for ${char.name}`);
                    return;
                }

                // ✅ 关键改动：在拆分前，先检测是否包含"指令型消息"（转账等）
                // 检测 ((TRANSFER: 金额, 备注)) 格式
                const transferMatch = cleanReply.match(/\(\(TRANSFER:\s*(\d+(\.\d+)?)(?:,\s*(.+?))?\)\)/i);
                
                if (transferMatch) {
                    // 提取转账信息
                    const amount = parseFloat(transferMatch[1]);
                    let note = transferMatch[3] || '转账';
                    // 限制备注长度，不超过10个字
                    if (note.length > 10) {
                        note = note.substring(0, 10);
                    }
                    
                    // 提取转账前面的文字内容（如果有）
                    const textBeforeTransfer = cleanMessage(cleanReplyProcessed.substring(0, transferMatch.index).trim());
                    
                    const freshChar = await db.characters.get(char.id);
                    if (freshChar) {
                        let history = getChatHistory(freshChar, accountId);
                        
                        // 1. 先发送文字消息（如果有）
                        if (textBeforeTransfer) {
                            const textMsg = {
                                role: 'char',
                                content: textBeforeTransfer,
                                time: Date.now()
                            };
                            history.push(textMsg);
                            await setChatHistory(freshChar, accountId, history);
                            
                            // 渲染文字消息
                            if (currentChatCharId === freshChar.id) {
                                appendMessageToUI('char', textBeforeTransfer, freshChar.avatar);
                            }
                            
                            // 稍微延时，让文字消息先显示
                            await new Promise(r => setTimeout(r, 500));
                        }
                        
                        // 2. 再发送转账卡片
                        const transferData = {
                            amount: amount.toFixed(2),
                            desc: note,
                            status: 'sent'
                        };
                        
                        const transferMsg = { 
                            role: 'char', 
                            type: 'transfer', // 明确标记为转账消息
                            content: JSON.stringify(transferData), 
                            time: Date.now(),
                            id: 'trans_' + Date.now()
                        };
                        
                        history.push(transferMsg);
                        await setChatHistory(freshChar, accountId, history);
                        
                        console.log(`[AutoChat] Sent transfer message for ${freshChar.name}`);
                        addLog('success', `角色发送转账: ${freshChar.name}`, { amount, note });
                        
                        // 渲染转账卡片
                        if (currentChatCharId === freshChar.id) {
                            // 直接刷新整个聊天界面（因为转账卡片需要特殊渲染）
                            renderChatBody(freshChar);
                        }
                        
                        // 发送通知
                        sendSystemNotification(freshChar.name, '[转账]');
                        
                        // 调用后端 API 发送推送
                        try {
                            await fetch(`${API_BASE}/trigger_push`, {
                                method: 'POST',
                                headers: {'Content-Type': 'application/json'},
                                body: JSON.stringify({
                                    user_id: currentUserId,
                                    char_id: freshChar.id,
                                    char_name: freshChar.name,
                                    message: '[转账]'
                                })
                            });
                        } catch (err) {
                            console.error(`[AutoChat] Backend push API failed:`, err);
                        }
                        
                        // 刷新微信列表
                        if (currentChatCharId !== freshChar.id) {
                            const wechatPage = document.getElementById('wechat-page');
                            if (wechatPage.style.display !== 'none' && 
                                document.querySelector('.wechat-tab-item.active .tab-name').innerText === '微信') {
                                renderWechatList(document.getElementById('wechat-content'));
                            }
                        }
                    }
                    return; // 转账处理完成，不再执行后续逻辑
                }
                
                // 兜底：检测是否是转账 JSON（兼容旧格式）
                let trimmedReply = cleanMessage(cleanReplyProcessed.trim());
                if (trimmedReply.startsWith('{') && trimmedReply.includes('"amount"')) {
                    try {
                        const parsed = JSON.parse(trimmedReply);
                        if (parsed.amount && parsed.desc !== undefined && parsed.status) {
                            const freshChar = await db.characters.get(char.id);
                            if (freshChar) {
                                let history = getChatHistory(freshChar, accountId);
                                
                                const newMsg = { 
                                    role: 'char', 
                                    type: 'transfer',
                                    content: trimmedReply, 
                                    time: Date.now(),
                                    id: 'trans_' + Date.now()
                                };
                                
                                history.push(newMsg);
                                await setChatHistory(freshChar, accountId, history);
                                
                                if (currentChatCharId === freshChar.id) {
                                    renderChatBody(freshChar);
                                } else {
                                    sendSystemNotification(freshChar.name, '[转账]');
                                }
                            }
                    return;
                        }
                    } catch(e) {
                        // 不是有效的 JSON，继续当普通消息
                    }
                }

                // 4. 普通消息：拆分逻辑 (增强版)
                let segments = [];
                console.log(`[AutoChat] Raw AI reply for ${char.name}: "${cleanReplyProcessed}"`);
                
                // 强制清洗逗号
                cleanReplyProcessed = cleanReplyProcessed.replace(/[,，]/g, ' ');

                // 优先尝试分隔符拆分
                if (cleanReplyProcessed.includes('|||')) {
                    segments = cleanReplyProcessed.split('|||').map(s => cleanMessage(s.trim())).filter(s => s.length > 0);
                    console.log(`[AutoChat] Split by ||| into ${segments.length} segments:`, segments);
                } else {
                    console.log(`[AutoChat] No ||| found, using splitMessage fallback`);
                    // 回退到标点拆分
                    segments = splitMessage(cleanReplyProcessed);
                    console.log(`[AutoChat] splitMessage result: ${segments.length} segments:`, segments);
                }
                
                // 过滤无效消息 (纯标点)
                const beforeFilter = segments.length;
                segments = segments.filter(seg => {
                    // 移除常见标点后，如果长度为0，说明全是标点
                    const textOnly = seg.replace(/[.,，。!?！？~…\s]/g, '');
                    return textOnly.length > 0;
                });
                
                if (beforeFilter !== segments.length) {
                    console.log(`[AutoChat] Filtered ${beforeFilter - segments.length} invalid segments (pure punctuation)`);
                }

                // 兜底：如果过滤后没了，或者本身就没拆出来，但原文本看着还行
                if (segments.length === 0 && cleanReplyProcessed.replace(/[.,，。!?！？~…\s]/g, '').length > 0) {
                     segments.push(cleanMessage(cleanReplyProcessed));
                     console.log(`[AutoChat] Fallback: using entire reply as single segment`);
                }

                if (segments.length === 0) {
                    console.warn(`[AutoChat] All segments filtered out as invalid for ${char.name}`);
                    return;
                }
                
                console.log(`[AutoChat] Final segments to send (${segments.length}):`, segments);

                for (let i = 0; i < segments.length; i++) {
                    let seg = segments[i];
                    
                    // ✅ 修复：清理每个分段末尾多余的 ]
                    seg = cleanMessage(seg);
                    
                    // 延时：第一条稍快，后续模拟打字
                    if (i > 0) {
                        const delay = 500 + Math.min(seg.length * 80, 2000);
                        await new Promise(r => setTimeout(r, delay));
                    } else {
                        // 第一条也稍微给点延时，感觉更自然
                        await new Promise(r => setTimeout(r, 500));
                    }

                    // 重新获取最新的 char 数据
                    const freshChar = await db.characters.get(char.id);
                    let history = getChatHistory(freshChar, accountId);
                    
                    const newMsg = { 
                        role: 'char', 
                        content: seg, 
                        time: Date.now() 
                    };
                    
                    history.push(newMsg);
                    await setChatHistory(freshChar, accountId, history);

                    console.log(`[AutoChat] Sent part ${i+1}/${segments.length} for ${freshChar.name}: ${seg}`);
                    addLog('success', `角色消息已存入DB: ${freshChar.name}`, { segment: i+1, total: segments.length, message: seg });

                    // 5. 更新 UI（如果正在查看）
                    if (currentChatCharId === freshChar.id) {
                        console.log(`[AutoChat] User is viewing ${freshChar.name}'s chat, appending to UI`);
                        addLog('info', `正在查看聊天，更新UI: ${freshChar.name}`);
                        appendMessageToUI('char', seg, freshChar.avatar);
                    } else {
                        addLog('warning', `不在聊天窗口，应发送通知: ${freshChar.name}`, { currentChatCharId });
                    }
                    
                    // 6. 无论是否在查看，都发送通知（重要！）
                    console.log(`[AutoChat] Sending notification for ${freshChar.name}: ${seg}`);
                    addLog('info', `调用sendSystemNotification: ${freshChar.name}`, { message: seg });
                    sendSystemNotification(freshChar.name, seg);
                    
                    // 7. 【关键修复】立即调用后端API发送Web Push推送
                    try {
                        await fetch(`${API_BASE}/trigger_push`, {
                            method: 'POST',
                            headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify({
                                user_id: currentUserId,
                                char_id: freshChar.id,
                                char_name: freshChar.name,
                                message: seg
                            })
                        });
                        console.log(`[AutoChat] ✓ Backend push API called for ${freshChar.name}`);
                    } catch (err) {
                        console.error(`[AutoChat] ✗ Backend push API failed:`, err);
                    }
                    
                    // 7. 如果在微信列表页，刷新列表以更新最后一条消息预览
                    if (currentChatCharId !== freshChar.id) {
                        const wechatPage = document.getElementById('wechat-page');
                        if (wechatPage.style.display !== 'none' && 
                            document.querySelector('.wechat-tab-item.active .tab-name').innerText === '微信') {
                            renderWechatList(document.getElementById('wechat-content'));
                        }
                    }
                }

            } catch (err) {
                console.error(`[AutoChat] Failed for ${char.name}:`, err);
                // 发送错误通知，让用户知道为什么没触发
                sendSystemNotification("系统提示", `主动聊天触发失败(${char.name}): ${err.message}`);
            } finally {
                // 解锁
                autoChatLocks.delete(char.id);
            }
        }

        // --- 表情包逻辑 ---
        async function renderStickerList(stickers) {
            const container = document.getElementById('detail-sticker-list');
            // 保留最后一个添加按钮
            const addBtn = container.querySelector('.sticker-add');
            container.innerHTML = '';
            
            document.getElementById('sticker-count').innerText = `${stickers.length}/20`;
            
            stickers.forEach((s, index) => {
                const div = document.createElement('div');
                div.className = 'sticker-item';
                div.style.backgroundImage = `url(${s})`;
                div.innerHTML = `<div class="sticker-del" onclick="removeSticker(${index}, event)">
                    <svg style="width:10px; height:10px; stroke:#fff; stroke-width:2;" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </div>`;
                container.appendChild(div);
            });
            
            container.appendChild(addBtn);
        }

        async function addStickers(input) {
            if (!currentChatCharId) return;
            const files = input.files;
            if (!files || files.length === 0) return;
            
            const char = await db.characters.get(currentChatCharId);
            if (!char.custom_stickers) char.custom_stickers = [];
            
            if (char.custom_stickers.length + files.length > 20) {
                alert("最多只能添加 20 个表情包哦");
                return;
            }

            // 并行读取
            const promises = Array.from(files).map(file => {
                return new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onload = e => resolve(e.target.result);
                    reader.readAsDataURL(file);
                });
            });
            
            const newStickers = await Promise.all(promises);
            char.custom_stickers.push(...newStickers);
            await db.characters.put(char);
            
            renderStickerList(char.custom_stickers);
            input.value = '';
        }

        async function removeSticker(index, e) {
            e.stopPropagation();
            if (!currentChatCharId) return;
            if (!confirm("删除这个表情？")) return;
            
            const char = await db.characters.get(currentChatCharId);
            char.custom_stickers.splice(index, 1);
            await db.characters.put(char);
            
            renderStickerList(char.custom_stickers);
        }

        function handleChatInputKey(e) {
            if (e.key === 'Enter') {
                sendMessage();
            }
        }

        async function sendMessage() {
            const input = document.getElementById('chat-input-box');
            const text = input.value.trim();
            if (!text || !currentChatCharId) return;

            // 1. 获取当前角色
            const char = await db.characters.get(currentChatCharId);
            if (!char) return;
            
            const accountId = getCurrentAccountId();
            
            // 检查好友状态
            const friendStatus = getFriendStatus(char, accountId);
            if (friendStatus !== 'friend') {
                // 不是好友，不能发送消息
                if (confirm(`你还不是 ${char.name} 的好友，是否发送好友申请？`)) {
                    const message = prompt('请输入申请理由（可选）：', '我是' + (await getCurrentUserName()));
                    if (message !== null) {
                        await sendFriendRequestTo(currentChatCharId, message);
                    }
                }
                return;
            }

            input.value = ''; 
            handleChatInputChange(input); // 重置按钮状态
            closeChatPanel(); // 发送时关闭面板

            let history = getChatHistory(char, accountId);

            // 2. 追加并显示用户消息
            const userMsg = { role: 'user', content: text, time: Date.now() };
            history.push(userMsg);
            await setChatHistory(char, accountId, history); 
            
            // 刷新全量列表以确保索引正确，或者这里也可以优化为只追加 DOM 并绑定事件
            // 为简单起见，我们重新渲染
            renderChatBody(char);
            
            // ✅ 不再自动触发 AI 回复，需要用户点击"接受回复"按钮
            // triggerAiReply(); 
        }
        
        async function getCurrentUserName() {
            const accountId = getCurrentAccountId();
            if (!accountId) return '我';
            const myChar = await db.characters.get(parseInt(accountId));
            return myChar ? myChar.name : '我';
        }

        function hideChatWindow() {
            const win = document.getElementById('chat-window');
            win.style.transform = 'translateX(100%)';
            setTimeout(() => {
                win.style.display = 'none';
                win.style.transform = '';
            }, 300);
            currentChatCharId = null;
            
            // 退出多选模式
            if (isSelectionMode) exitSelectionMode();
        }

        // 辅助：获取 User 头像 URL
        async function getUserAvatarUrl(userId) {
            if (!userId) {
                // 默认头像 (提取 avatar-img-1 的背景图)
                const dom = document.getElementById('avatar-img-1');
                if (dom) {
                    const bg = dom.style.backgroundImage;
                    if (bg && bg !== 'none') return bg.replace(/url\(|\)|"/g, '');
                }
                return '';
            }
            const user = await db.characters.get(userId);
            return (user && user.avatar) ? user.avatar : '';
        }

        // ✅ 核心函数1：判断是否是图片URL
        function isImageUrl(text) {
            if (!text || typeof text !== 'string') return false;
            const clean = text.trim();
            // 检查是否是图片URL（支持常见图片格式）
            return /\.(png|jpg|jpeg|gif|webp|bmp|svg)(\?.*)?$/i.test(clean) || 
                   /^https?:\/\/.*\.(png|jpg|jpeg|gif|webp|bmp|svg)(\?.*)?$/i.test(clean);
        }

        // ✅ 核心函数2：清理消息内容（删除末尾多余的]和开头的[，以及img:前缀）
        function sanitizeMessage(text) {
            if (!text || typeof text !== 'string') return text;
            let cleaned = text.trim();
            // 🔥 核心修复：先去掉 img: 前缀（防止 ERR_UNKNOWN_URL_SCHEME）
            cleaned = cleaned.replace(/^img:/, '');
            // 去掉方括号
            cleaned = cleaned.replace(/\]+$/, '');   // 干掉结尾所有 ]
            cleaned = cleaned.replace(/^\[+/, '');   // 干掉开头 [
            // 如果还有 img: 前缀（可能在方括号去掉后出现），再次清理
            cleaned = cleaned.replace(/^img:/, '');
            return cleaned;
        }

        // ✅ 核心函数3：统一的消息内容渲染函数
        function renderMessageContent(text) {
            if (!text || typeof text !== 'string') return '';
            
            // 先清理消息（去掉img:前缀、方括号等）
            const clean = sanitizeMessage(text);
            
            // 🔥 额外保护：如果清理后还有img:前缀，再次清理（防止边缘情况）
            const finalClean = clean.replace(/^img:/, '');
            
            // 如果整个消息就是一个图片URL，直接渲染为图片
            if (isImageUrl(finalClean)) {
                return `<img src="${finalClean}" class="chat-image" onerror="this.style.display='none';" />`;
            }
            
            // 检查是否包含[img:...]格式的图片标记
            const imgMatches = finalClean.matchAll(/\[img:([^\]]+)\]/g);
            const images = Array.from(imgMatches);
            
            if (images.length > 0) {
                // 包含图片标记，需要混合显示
                let html = '';
                let lastIndex = 0;
                
                images.forEach((match) => {
                    // 添加图片前的文字
                    if (match.index > lastIndex) {
                        const textBefore = finalClean.substring(lastIndex, match.index);
                        if (textBefore.trim()) {
                            html += `<span>${escapeHtml(textBefore)}</span>`;
                        }
                    }
                    
                    // 添加图片（使用chat-image类，确保去掉img:前缀）
                    let imgUrl = sanitizeMessage(match[1]);
                    // 🔥 额外保护：再次确保没有img:前缀
                    imgUrl = imgUrl.replace(/^img:/, '');
                    html += `<img src="${imgUrl}" class="chat-image" onerror="this.style.display='none';" />`;
                    
                    lastIndex = match.index + match[0].length;
                });
                
                // 添加最后一段文字（如果有）
                if (lastIndex < finalClean.length) {
                    const textAfter = finalClean.substring(lastIndex);
                    if (textAfter.trim()) {
                        html += `<span>${escapeHtml(textAfter)}</span>`;
                    }
                }
                
                return html;
            }
            
            // 检查是否包含普通URL（http://或https://）
            const urlRegex = /(https?:\/\/[^\s]+)/g;
            const hasUrl = urlRegex.test(finalClean);
            
            if (hasUrl) {
                // 包含URL，转换为HTML并保护URL
                return finalClean.replace(urlRegex, (url) => {
                    let cleanUrl = sanitizeMessage(url);
                    // 🔥 额外保护：再次确保没有img:前缀
                    cleanUrl = cleanUrl.replace(/^img:/, '');
                    // 检查是否是图片URL
                    if (isImageUrl(cleanUrl)) {
                        return `<img src="${cleanUrl}" class="chat-image" onerror="this.style.display='none';" />`;
                    } else {
                        // 普通链接
                        return `<a href="${cleanUrl}" target="_blank" style="color:#007aff; word-break:break-all;">${escapeHtml(cleanUrl)}</a>`;
                    }
                });
            }
            
            // 纯文本，转义HTML防止XSS
            return `<span>${escapeHtml(finalClean)}</span>`;
        }

        // 辅助函数：转义HTML
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        // 格式化时间戳
        function formatMessageTime(timestamp, prevTimestamp) {
            if (!timestamp) return '';
            
            const msgTime = new Date(timestamp);
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const msgDate = new Date(msgTime.getFullYear(), msgTime.getMonth(), msgTime.getDate());
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
            
            let timeStr = '';
            if (msgDate.getTime() === today.getTime()) {
                // 今天：显示时间
                timeStr = `${msgTime.getHours()}:${msgTime.getMinutes().toString().padStart(2, '0')}`;
            } else if (msgDate.getTime() === yesterday.getTime()) {
                // 昨天
                timeStr = `昨天 ${msgTime.getHours()}:${msgTime.getMinutes().toString().padStart(2, '0')}`;
            } else if (now.getTime() - msgTime.getTime() < 7 * 24 * 60 * 60 * 1000) {
                // 一周内：显示星期
                const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
                timeStr = `${weekdays[msgTime.getDay()]} ${msgTime.getHours()}:${msgTime.getMinutes().toString().padStart(2, '0')}`;
            } else {
                // 更早：显示日期
                timeStr = `${msgTime.getMonth() + 1}/${msgTime.getDate()} ${msgTime.getHours()}:${msgTime.getMinutes().toString().padStart(2, '0')}`;
            }
            
            return timeStr;
        }
        
        // 判断是否需要显示时间戳（两条消息间隔超过5分钟才显示）
        function shouldShowTimestamp(currentTime, prevTime) {
            if (!prevTime) return true; // 第一条消息显示时间
            const diff = currentTime - prevTime;
            return diff > 5 * 60 * 1000; // 超过5分钟
        }

        // 构造消息 DOM
        function createMessageElement(msg, index, charAvatar, userAvatar, prevMsgTime) {
            const row = document.createElement('div');
            row.className = `message-row ${msg.role === 'user' ? 'self' : 'other'}`;
            row.dataset.index = index;

            // 复选框 (多选模式用)
            const checkbox = document.createElement('div');
            checkbox.className = 'msg-checkbox';
            row.appendChild(checkbox);

            // 头像
            const avatar = document.createElement('div');
            avatar.className = 'message-avatar';
            
            if (msg.role === 'char') {
                if (charAvatar) avatar.style.backgroundImage = `url(${charAvatar})`;
                // 给角色头像添加点击事件，显示心声
                avatar.style.cursor = 'pointer';
                avatar.onclick = async (e) => {
                    e.stopPropagation(); // 阻止冒泡，避免触发消息选择
                    await showCharacterThoughts(currentChatCharId, index);
                };
            } else {
                if (userAvatar) {
                    avatar.style.backgroundImage = `url(${userAvatar})`;
                } else {
                    avatar.style.backgroundColor = '#eee';
                }
            }

            // 内容气泡
            const content = document.createElement('div');
            content.className = 'message-content';
            
            // 检测转账消息 - 支持 type='transfer' 或 content 为转账JSON格式
            let isTransferMsg = false;
            let transferData = {};
            
            if (msg.type === 'transfer') {
                isTransferMsg = true;
                try {
                    transferData = JSON.parse(msg.content);
                } catch(e) {
                    transferData = { amount: '0.00', desc: '解析错误', status: 'sent' };
                }
            } else if (msg.content) {
                // 尝试解析为转账JSON - trim空格后检查
                const trimmed = msg.content.trim();
                if (trimmed.startsWith('{') && trimmed.includes('"amount"') && !trimmed.startsWith('[')) {
                    try {
                        const parsed = JSON.parse(trimmed);
                        if (parsed.amount && parsed.desc !== undefined && parsed.status) {
                            isTransferMsg = true;
                            transferData = parsed;
                            // 补充ID（如果没有）
                            if (!msg.id) msg.id = 'trans_' + msg.time;
                        }
                    } catch(e) {
                        // 不是有效的转账JSON，按普通消息处理
                    }
                }
            }
            
            // 处理转账消息
            if (isTransferMsg) {
                // 去除默认背景和padding，完全交给 transfer-card
                content.style.padding = '0';
                content.style.background = 'transparent';
                content.style.boxShadow = 'none';
                
                const isSelf = msg.role === 'user';
                const isDone = transferData.status === 'received';
                const isReturned = transferData.status === 'returned';
                
                let statusText = '转账';
                if (isSelf) statusText = '已发送';
                if (isDone) statusText = '已收款';
                if (isReturned) statusText = '已退回';
                
                content.innerHTML = `
                    <div class="transfer-card ${isDone ? 'done' : ''} ${isReturned ? 'returned' : ''}" onclick="showTransferConfirm('${msg.id}', ${isSelf}, '${transferData.status}')">
                        <div class="t-amount">¥ ${transferData.amount}</div>
                        <div class="t-desc">${transferData.desc}</div>
                        <div class="t-line"></div>
                        <div class="t-footer">
                            <span class="t-footer-text">${statusText}</span>
                            <span class="t-dot"></span>
                        </div>
                    </div>
                `;
            }
            // 处理撤回消息
            else if (msg.isRecalled) {
                content.innerHTML = "<span>已撤回</span>";
                content.classList.add('recalled-msg');
            } 
            // 处理语音消息
            else if (msg.content.startsWith('[voice:')) {
                let voiceText = sanitizeMessage(msg.content.substring(7, msg.content.length - 1));
                
                // 检查语音文本中是否包含图片链接
                const imgMatch = voiceText.match(/\[img:([^\]]+)\]/);
                let hasImage = false;
                let imgUrl = '';
                let cleanVoiceText = voiceText;
                
                if (imgMatch) {
                    hasImage = true;
                    imgUrl = sanitizeMessage(imgMatch[1]);
                    // 从语音文本中移除图片标记
                    cleanVoiceText = voiceText.replace(/\[img:[^\]]+\]/g, '').trim();
                }
                
                const duration = Math.ceil(cleanVoiceText.length / 5); // 模拟时长：每5个字1秒
                
                // 创建语音气泡容器（使用纯CSS波纹动画）
                content.className = 'voice-bubble';
                let voiceHtml = `
                    <div class="voice-bubble-header">
                        <div class="voice-icon">
                            <i></i>
                            <i></i>
                            <i></i>
                        </div>
                        <div class="voice-duration">${duration}"</div>
                    </div>
                    <div class="voice-text-content">${escapeHtml(cleanVoiceText)}</div>
                `;
                
                // 如果包含图片，在语音气泡下方添加图片（使用chat-image类）
                if (hasImage) {
                    voiceHtml += `<div style="margin-top:8px;"><img src="${imgUrl}" class="chat-image" onerror="this.style.display='none';" /></div>`;
                }
                
                content.innerHTML = voiceHtml;
                
                // 点击展开/收起文字
                content.onclick = (e) => {
                    // 如果点击的是图片，不触发展开/收起
                    if (e.target.tagName === 'IMG') {
                        e.stopPropagation();
                        return;
                    }
                    e.stopPropagation();
                    content.classList.toggle('expanded');
                };
            }
            // 处理图片卡片消息
            else if (msg.content.startsWith('[imgcard:')) {
                const cardText = sanitizeMessage(msg.content.substring(9, msg.content.length - 1));
                
                content.className = 'img-card-bubble';
                content.dataset.text = cardText; // 存储文字内容
                content.dataset.expanded = 'false'; // 初始状态：未展开
                
                // 默认显示卡片状态
                content.innerHTML = `
                    <div class="img-card-placeholder">
                        <svg class="img-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                            <circle cx="8.5" cy="8.5" r="1.5"></circle>
                            <polyline points="21 15 16 10 5 21"></polyline>
                        </svg>
                        <div class="img-card-hint">点击查看文字</div>
                    </div>
                `;
                
                // 点击切换展开/收起
                content.onclick = (e) => {
                    e.stopPropagation();
                    const isExpanded = content.dataset.expanded === 'true';
                    
                    if (isExpanded) {
                        // 收起：显示卡片
                        content.innerHTML = `
                            <div class="img-card-placeholder">
                                <svg class="img-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                                    <circle cx="8.5" cy="8.5" r="1.5"></circle>
                                    <polyline points="21 15 16 10 5 21"></polyline>
                                </svg>
                                <div class="img-card-hint">点击查看文字</div>
                            </div>
                        `;
                        content.dataset.expanded = 'false';
                    } else {
                        // 展开：显示文字
                        content.innerHTML = `<div class="img-card-text">${cardText}</div>`;
                        content.dataset.expanded = 'true';
                    }
                };
            }
            // 处理图片消息（纯图片，或以图片开头）
            else if (msg.content.startsWith('[img:')) {
                const imgUrl = sanitizeMessage(msg.content.substring(5, msg.content.length - 1));
                content.innerHTML = `<img src="${imgUrl}" class="chat-image" onerror="this.style.display='none';" />`;
                content.style.padding = '4px';
                content.style.background = 'transparent';
                content.style.boxShadow = 'none';
            } 
            // ✅ 普通文本 - 使用统一的渲染函数
            else {
                // 先清理消息内容
                const cleanedContent = sanitizeMessage(msg.content);
                // 使用统一的渲染函数
                content.innerHTML = renderMessageContent(cleanedContent);
            }

            // 事件绑定
            if (!msg.isRecalled) { // 已撤回消息不可操作
                bindMessageEvents(content, index);
                // 整个行点击事件 (用于多选)
                row.onclick = (e) => handleRowClick(index, e);
            }

            row.appendChild(avatar);
            row.appendChild(content);
            
            return row;
        }

        async function renderChatBody(char) {
            const body = document.getElementById('chat-body');
            body.innerHTML = '';
            
            // 切换多选模式样式
            if (isSelectionMode) {
                body.classList.add('selection-mode');
            } else {
                body.classList.remove('selection-mode');
            }
            
            const accountId = getCurrentAccountId();
            
            // 检查好友状态
            const friendStatus = getFriendStatus(char, accountId);
            if (friendStatus === 'deleted') {
                // 已删除好友，显示等待好友申请界面
                const settings = char.wait_friend_settings?.[accountId] || {
                    enabled: false,
                    interval: 60,
                    lastCheckTime: Date.now(),
                    nextCheckTime: null
                };
                
                const nextCheckText = settings.enabled && settings.nextCheckTime ? 
                    `下次检测: ${new Date(settings.nextCheckTime).toLocaleTimeString()}` : '未启用';
                
                body.innerHTML = `
                    <div style="display:flex; flex-direction:column; height:100%; padding:20px;">
                        <div style="text-align:center; padding:20px 0; border-bottom:1px solid #f0f0f0;">
                            <div style="width:60px; height:60px; border-radius:8px; background-image:url(${char.avatar}); background-size:cover; background-position:center; margin:0 auto 12px;"></div>
                            <div style="font-size:16px; font-weight:600; margin-bottom:6px; color:#333;">${char.name}</div>
                            <div style="font-size:13px; color:#999;">你已删除该好友</div>
                        </div>
                        
                        <div style="flex:1; overflow-y:auto; padding:16px 0;">
                            <div style="background:#f9f9f9; border-radius:8px; padding:16px; margin-bottom:16px;">
                                <div style="font-size:14px; font-weight:600; margin-bottom:12px; color:#333;">⏰ 等待好友申请</div>
                                <div style="font-size:12px; color:#666; line-height:1.6; margin-bottom:12px;">
                                    可以设置定时检测，AI将根据角色性格和你们的聊天历史，决定是否主动发送好友申请。
                                </div>
                                
                                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; padding:8px 0;">
                                    <div style="font-size:13px; color:#333;">启用自动检测</div>
                                    <label class="ios-switch" style="transform:scale(0.8);">
                                        <input type="checkbox" id="wait-friend-enabled" ${settings.enabled ? 'checked' : ''} onchange="toggleWaitFriendCheck(${char.id})">
                                        <span class="slider"></span>
                                    </label>
                                </div>
                                
                                <div style="display:flex; align-items:center; margin-bottom:8px;">
                                    <div style="font-size:13px; color:#333; margin-right:12px;">检测间隔</div>
                                    <input type="number" id="wait-friend-interval" value="${settings.interval}" min="1" max="1440" 
                                           style="flex:1; padding:6px 10px; border:1px solid #ddd; border-radius:4px; font-size:13px;" 
                                           onchange="saveWaitFriendInterval(${char.id})">
                                    <div style="font-size:13px; color:#666; margin-left:8px;">分钟</div>
                                </div>
                                
                                <div style="font-size:12px; color:#999; margin-top:8px;">${nextCheckText}</div>
                            </div>
                            
                            <button onclick="fastForwardCheck(${char.id})" style="width:100%; padding:12px; background:#fff; border:1px solid var(--ins-pink); color:var(--ins-pink); border-radius:8px; font-size:14px; font-weight:600; margin-bottom:12px;">
                                ⏩ 快进检测
                            </button>
                            
                            <button onclick="manualSendFriendRequest(${char.id})" style="width:100%; padding:12px; background:var(--ins-pink); color:#fff; border:none; border-radius:8px; font-size:14px; font-weight:600;">
                                主动发送好友申请
                            </button>
                        </div>
                    </div>
                `;
                return;
            } else if (friendStatus === 'stranger') {
                // 陌生人，显示发送好友申请界面
                body.innerHTML = `
                    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; padding:40px 20px; text-align:center;">
                        <div style="width:80px; height:80px; border-radius:8px; background-image:url(${char.avatar}); background-size:cover; background-position:center; margin-bottom:20px;"></div>
                        <div style="font-size:18px; font-weight:600; margin-bottom:10px; color:#333;">${char.name}</div>
                        <div style="font-size:14px; color:#999; margin-bottom:30px;">你还不是对方的好友，无法发送消息</div>
                        <button onclick="showAddFriendToCurrentChat()" style="background:var(--ins-pink); color:#fff; border:none; padding:12px 40px; border-radius:8px; font-size:16px; font-weight:600;">发送好友申请</button>
                    </div>
                `;
                return;
            } else if (friendStatus !== 'friend') {
                // 其他状态，显示默认提示
                body.innerHTML = `
                    <div style="display:flex; align-items:center; justify-content:center; height:100%; padding:40px 20px; text-align:center;">
                        <div style="font-size:14px; color:#999;">无法发送消息</div>
                    </div>
                `;
                return;
            }
            
            const history = getChatHistory(char, accountId);
            if (!history || history.length === 0) return;

            const userAvatarUrl = await getUserAvatarUrl(char.linked_user_id);

            history.forEach((msg, index) => {
                const prevMsgTime = index > 0 ? history[index - 1].time : null;
                
                // 如果需要显示时间戳，先添加时间戳行
                if (shouldShowTimestamp(msg.time, prevMsgTime)) {
                    const timeStamp = document.createElement('div');
                    timeStamp.className = 'message-timestamp';
                    timeStamp.textContent = formatMessageTime(msg.time, prevMsgTime);
                    body.appendChild(timeStamp);
                }
                
                const row = createMessageElement(msg, index, char.avatar, userAvatarUrl, prevMsgTime);
                
                // 如果在多选模式，恢复选中状态
                if (isSelectionMode) {
                    const cb = row.querySelector('.msg-checkbox');
                    if (selectedIndices.has(index)) {
                        cb.classList.add('checked');
                    }
                }
                
                body.appendChild(row);
            });
            
            // 滚动到底部 (如果在多选模式，可能不需要滚到底部？这里暂且保持滚动)
            if (!isSelectionMode) {
                setTimeout(() => {
                    body.scrollTop = body.scrollHeight;
                }, 0);
            }
        }

        // 追加单条消息 (主要用于 AI 回复时的流式输出，不重绘整个列表)
        // 注意：追加的消息需要重新绑定事件，且此时通常不在多选模式
        async function appendMessageToUI(role, content, charAvatar, elemId) {
            const body = document.getElementById('chat-body');
            
            // ✅ 修复：在构造消息前先清理内容
            const cleanedContent = sanitizeMessage(content);
            
            // 构造临时 msg 对象
            const msg = { role, content: cleanedContent, time: Date.now() };
            // 获取当前最新 index (假设已同步到 DB 且是最后一个)
            // 这里有个小问题：appendMessageToUI 调用时，DB 可能刚 push 完，所以 index 是 length-1
            // 但如果并发可能有问题。简单起见，我们重新获取一次 char length
            const char = await db.characters.get(currentChatCharId);
            const accountId = getCurrentAccountId();
            const history = getChatHistory(char, accountId);
            const index = history.length - 1;
            const userAvatarUrl = await getUserAvatarUrl(char.linked_user_id); // 或者是 currentChatUserId
            
            // 获取前一条消息的时间
            const prevMsgTime = index > 0 && history[index - 1] ? history[index - 1].time : null;
            
            // 如果需要显示时间戳，先添加时间戳行
            if (shouldShowTimestamp(msg.time, prevMsgTime)) {
                const timeStamp = document.createElement('div');
                timeStamp.className = 'message-timestamp';
                timeStamp.textContent = formatMessageTime(msg.time, prevMsgTime);
                body.appendChild(timeStamp);
            }

            const row = createMessageElement(msg, index, charAvatar, userAvatarUrl, prevMsgTime);
            if (elemId) row.id = elemId;
            
            body.appendChild(row);
            body.scrollTop = body.scrollHeight;
        }

        // --- 核心交互：长按与菜单 ---
        function bindMessageEvents(element, index) {
            const startHandler = (e) => {
                if (isSelectionMode) return; // 多选模式下禁用长按
                isLongPress = false;
                longPressTimer = setTimeout(() => {
                    isLongPress = true;
                    showContextMenu(e, index, element);
                }, 500); // 500ms 长按触发
            };

            const cancelHandler = () => {
                if (longPressTimer) {
                    clearTimeout(longPressTimer);
                    longPressTimer = null;
                }
            };
            
            const endHandler = (e) => {
                cancelHandler();
                if (isLongPress) {
                    e.preventDefault(); // 阻止默认点击
                    e.stopPropagation();
                }
            };

            // 触摸设备
            element.addEventListener('touchstart', startHandler, {passive: true});
            element.addEventListener('touchmove', cancelHandler, {passive: true});
            element.addEventListener('touchend', endHandler);
            
            // PC 鼠标
            element.addEventListener('mousedown', startHandler);
            element.addEventListener('mousemove', cancelHandler); // 移动算取消
            element.addEventListener('mouseup', endHandler);
            // 禁用右键默认菜单
            element.addEventListener('contextmenu', (e) => e.preventDefault());
        }

        function showContextMenu(event, index, element) {
            // 震动反馈 (Android)
            if (navigator.vibrate) navigator.vibrate(50);
            
            activeMsgIndex = index;
            element.classList.add('active'); // 高亮

            const menu = document.getElementById('msg-context-menu');
            const overlay = document.getElementById('menu-overlay');
            
            // 计算坐标
            let clientX, clientY;
            if (event.touches && event.touches.length > 0) {
                clientX = event.touches[0].clientX;
                clientY = event.touches[0].clientY;
            } else {
                clientX = event.clientX;
                clientY = event.clientY;
            }

            // 简单的边界检测
            const winWidth = window.innerWidth;
            const winHeight = window.innerHeight;
            let menuX = clientX;
            let menuY = clientY;

            menu.style.display = 'flex'; // 先显示以获取 offsetWidth
            
            if (menuX + menu.offsetWidth > winWidth) {
                menuX = winWidth - menu.offsetWidth - 10;
            }
            if (menuY + menu.offsetHeight > winHeight) {
                menuY = winHeight - menu.offsetHeight - 10;
            }

            menu.style.left = menuX + 'px';
            menu.style.top = menuY + 'px';
            
            overlay.style.display = 'block';
        }

        function hideContextMenu() {
            const menu = document.getElementById('msg-context-menu');
            const overlay = document.getElementById('menu-overlay');
            menu.style.display = 'none';
            overlay.style.display = 'none';
            
            // 移除高亮
            document.querySelectorAll('.message-content.active').forEach(el => el.classList.remove('active'));
        }

        // --- 菜单功能实现 ---
        
        // 1. 编辑
        async function handleMsgEdit() {
            hideContextMenu();
            if (activeMsgIndex === -1 || !currentChatCharId) return;
            
            const char = await db.characters.get(currentChatCharId);
            const accountId = getCurrentAccountId();
            let history = getChatHistory(char, accountId);
            const msg = history[activeMsgIndex];
            
            // 简单使用 prompt，也可以做自定义 UI
            // 如果是图片消息，提示无法编辑或只编辑URL
            if (msg.content.startsWith('[img:')) {
                alert("图片消息暂不支持编辑");
                return;
            }

            const newContent = prompt("编辑消息", msg.content);
            if (newContent !== null && newContent.trim() !== "") {
                msg.content = newContent.trim();
                history[activeMsgIndex] = msg; // 更新
                await setChatHistory(char, accountId, history);
                renderChatBody(char);
            }
        }

        // 2. 撤回
        async function handleMsgRecall() {
            hideContextMenu();
            if (activeMsgIndex === -1 || !currentChatCharId) return;
            
            if (!confirm("确定要撤回这条消息吗？")) return;

            const char = await db.characters.get(currentChatCharId);
            const accountId = getCurrentAccountId();
            let history = getChatHistory(char, accountId);
            // 标记为已撤回，而不是物理删除（通常做法）
            // 或者如果您想做成"删除但留痕"，可以修改内容
            history[activeMsgIndex].isRecalled = true;
            history[activeMsgIndex].content = ""; // 清空内容
            
            await setChatHistory(char, accountId, history);
            renderChatBody(char);
        }

        // 3. 删除 (单条)
        async function handleMsgDelete() {
            hideContextMenu();
            if (activeMsgIndex === -1 || !currentChatCharId) return;
            
            if (!confirm("删除这条消息？")) return;

            const char = await db.characters.get(currentChatCharId);
            const accountId = getCurrentAccountId();
            let history = getChatHistory(char, accountId);
            history.splice(activeMsgIndex, 1);
            
            await db.characters.put(char);
            renderChatBody(char);
        }

        // --- 多选模式 ---
        function enterSelectionMode() {
            hideContextMenu();
            if (!currentChatCharId) return;
            
            isSelectionMode = true;
            selectedIndices.clear();
            
            // 切换 UI
            document.getElementById('chat-body').classList.add('selection-mode');
            document.getElementById('selection-bar').style.display = 'flex';
            document.getElementById('chat-footer').style.display = 'none'; // 隐藏输入框
            
            // 更新按钮文字
            updateDeleteBtn();
            
            // 重绘显示 Checkbox
            // 注意：这里需要重新从 DB 拿数据渲染，或者直接操作 DOM 显示
            // 为了简单稳妥，重新渲染
            db.characters.get(currentChatCharId).then(char => {
                renderChatBody(char);
            });
        }

        function exitSelectionMode() {
            isSelectionMode = false;
            selectedIndices.clear();
            
            document.getElementById('chat-body').classList.remove('selection-mode');
            document.getElementById('selection-bar').style.display = 'none';
            document.getElementById('chat-footer').style.display = 'flex'; // 恢复输入框
            
            // 重绘隐藏 Checkbox
            if (currentChatCharId) {
                db.characters.get(currentChatCharId).then(char => {
                    renderChatBody(char);
                });
            }
        }

        function handleRowClick(index, e) {
            if (!isSelectionMode) return;
            
            // 切换选中状态
            const row = e.currentTarget; // .message-row
            const checkbox = row.querySelector('.msg-checkbox');
            
            if (selectedIndices.has(index)) {
                selectedIndices.delete(index);
                checkbox.classList.remove('checked');
            } else {
                selectedIndices.add(index);
                checkbox.classList.add('checked');
            }
            
            updateDeleteBtn();
        }

        function updateDeleteBtn() {
            const count = selectedIndices.size;
            const btn = document.getElementById('btn-batch-delete');
            btn.innerText = `删除 (${count})`;
            btn.style.opacity = count > 0 ? '1' : '0.5';
        }

        async function deleteSelectedMsgs() {
            if (selectedIndices.size === 0) return;
            if (!currentChatCharId) return;
            
            if (!confirm(`确定要删除选中的 ${selectedIndices.size} 条消息吗？`)) return;

            const char = await db.characters.get(currentChatCharId);
            const accountId = getCurrentAccountId();
            const history = getChatHistory(char, accountId);
            
            // 过滤掉被选中的索引
            // 技巧：创建一个保留的新数组
            const newHistory = history.filter((_, idx) => !selectedIndices.has(idx));
            
            await setChatHistory(char, accountId, newHistory);
            await db.characters.put(char);
            
            exitSelectionMode(); // 删除后自动退出多选
        }

        // --- 新增：聊天交互逻辑 (面板/输入/AI触发) ---
        let activePanel = null;
        const emojis = ["😀","😁","😂","🤣","😃","😄","😅","😆","😉","😊","😋","😎","😍","😘","🥰","😗","😙","😚","🙂","🤗","🤩","🤔","🤨","😐","😑","😶","🙄","😏","😣","😥","😮","🤐","😯","😪","😫","😴","😌","😛","😜","😝","🤤","😒","😓","😔","😕","🙃","🤑","😲","☹️","🙁","😖","😞","😟","😤","😢","😭","😦","😧","😨","😩","🤯","😬","😰","😱","🥵","🥶","😳","🤪","😵","😡","😠","🤬","😷","🤒","🤕","🤢","🤮","🤧","😇","🥳","🥺","🤠","🤡","🤥","🤫","🤭","🧐","🤓","😈","👿","👹","👺","💀","👻","👽","🤖","💩","😺","😸","😹","😻","😼","😽","🙀","😿","😾"];

        function initEmojiPanel() {
            const panel = document.getElementById('emoji-panel');
            if (panel.children.length > 0) return; 
            panel.innerHTML = emojis.map(e => `<div class="emoji-item" onclick="insertEmoji('${e}')">${e}</div>`).join('');
        }

        async function switchEmojiTab(type) {
            const tabs = document.querySelectorAll('#emoji-tab-bar .wechat-tab-item');
            const emojiPanel = document.getElementById('emoji-panel');
            const stickerPanel = document.getElementById('sticker-panel');

            if (type === 'emoji') {
                tabs[0].classList.add('active');
                tabs[1].classList.remove('active');
                emojiPanel.style.display = 'grid';
                stickerPanel.style.display = 'none';
            } else {
                tabs[0].classList.remove('active');
                tabs[1].classList.add('active');
                emojiPanel.style.display = 'none';
                stickerPanel.style.display = 'grid';
                
                // 加载全局表情包
                await updateChatStickerPanel();
            }
        }
        
        async function sendSticker(base64) {
            // 发送图片消息
            const msgContent = `[img:${base64}]`;
            
            if (!currentChatCharId) return;
            const char = await db.characters.get(currentChatCharId);
            const accountId = getCurrentAccountId();
            let history = getChatHistory(char, accountId);
            
            history.push({
                role: 'user',
                content: msgContent,
                time: Date.now()
            });
            
            await setChatHistory(char, accountId, history);
            appendMessageToUI('user', msgContent);
            closeChatPanel();
            
            // 可以在这里触发 AI 对表情包的反应（如果需要）
            // triggerAiReply(); 
        }

        // 显示图片类型选择弹窗
        function showImageTypeModal() {
            // 关闭更多面板
            closeChatPanel();
            
            const modal = document.createElement('div');
            modal.id = 'image-type-modal';
            modal.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0,0,0,0.4);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10000;
                backdrop-filter: blur(5px);
            `;
            
            modal.innerHTML = `
                <div style="background: white; border-radius: 16px; padding: 24px; width: 85%; max-width: 320px; box-shadow: 0 10px 40px rgba(0,0,0,0.15);">
                    <h3 style="margin: 0 0 24px 0; text-align: center; color: #333; font-size: 18px; font-weight: 600;">选择图片类型</h3>
                    <div style="display: flex; flex-direction: column; gap: 12px;">
                        <button onclick="selectRealImage()" style="padding: 16px; background: #f5f5f5; color: #333; border: none; border-radius: 12px; font-size: 16px; font-weight: 500; cursor: pointer; transition: all 0.2s; display:flex; align-items:center; justify-content:center; gap:8px;">
                            <svg class="svg-icon" style="width:20px; height:20px;" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                            <span>真实图片</span>
                        </button>
                        <button onclick="selectTextImageCard()" style="padding: 16px; background: #f5f5f5; color: #333; border: none; border-radius: 12px; font-size: 16px; font-weight: 500; cursor: pointer; transition: all 0.2s; display:flex; align-items:center; justify-content:center; gap:8px;">
                            <svg class="svg-icon" style="width:20px; height:20px;" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                            <span>文字图片卡片</span>
                        </button>
                        <button onclick="closeImageTypeModal()" style="padding: 14px; background: white; color: #999; border: 1px solid #e8e8e8; border-radius: 12px; font-size: 15px; cursor: pointer; margin-top: 8px;">
                            取消
                        </button>
                    </div>
                </div>
            `;
            
            document.body.appendChild(modal);
        }

        function closeImageTypeModal() {
            const modal = document.getElementById('image-type-modal');
            if (modal) modal.remove();
        }

        // 选择真实图片
        function selectRealImage() {
            closeImageTypeModal();
            document.getElementById('chat-image-input').click();
        }

        // 选择文字图片卡片
        function selectTextImageCard() {
            closeImageTypeModal();
            
            const modal = document.createElement('div');
            modal.id = 'text-image-card-modal';
            modal.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0,0,0,0.5);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10000;
            `;
            
            modal.innerHTML = `
                <div style="background: white; border-radius: 12px; padding: 20px; width: 85%; max-width: 350px;">
                    <h3 style="margin: 0 0 15px 0; color: #333;">输入卡片文字</h3>
                    <textarea id="imgcard-text-input" placeholder="输入要转换为图片卡片的文字..." style="width: 100%; height: 120px; padding: 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 14px; resize: none; box-sizing: border-box;"></textarea>
                    <div style="display: flex; gap: 10px; margin-top: 15px;">
                        <button onclick="sendImageCard()" style="flex: 1; padding: 12px; background: var(--ins-pink); color: white; border: none; border-radius: 8px; font-size: 15px;">
                            发送
                        </button>
                        <button onclick="closeTextImageCardModal()" style="flex: 1; padding: 12px; background: #f0f0f0; color: #666; border: none; border-radius: 8px; font-size: 15px;">
                            取消
                        </button>
                    </div>
                </div>
            `;
            
            document.body.appendChild(modal);
            document.getElementById('imgcard-text-input').focus();
        }

        function closeTextImageCardModal() {
            const modal = document.getElementById('text-image-card-modal');
            if (modal) modal.remove();
        }

        async function sendImageCard() {
            const text = document.getElementById('imgcard-text-input').value.trim();
            if (!text) {
                alert('请输入内容');
                return;
            }
            
            closeTextImageCardModal();
            
            // 发送图片卡片消息（格式：[imgcard:文字内容]）
            const msgContent = `[imgcard:${text}]`;
            
            if (!currentChatCharId) return;
            const char = await db.characters.get(currentChatCharId);
            const accountId = getCurrentAccountId();
            let history = getChatHistory(char, accountId);
            
            history.push({
                role: 'user',
                content: msgContent,
                time: Date.now()
            });
            
            await setChatHistory(char, accountId, history);
            renderChatBody(char);
        }

        // 发送真实图片消息
        async function sendImageMessage(input) {
            const file = input.files[0];
            if (!file || !currentChatCharId) return;
            
            const reader = new FileReader();
            reader.onload = async (e) => {
                const base64 = e.target.result;
                const msgContent = `[img:${base64}]`;
                
                const char = await db.characters.get(currentChatCharId);
                const accountId = getCurrentAccountId();
                let history = getChatHistory(char, accountId);
                
                history.push({
                    role: 'user',
                    content: msgContent,
                    time: Date.now()
                });
                
                await setChatHistory(char, accountId, history);
                renderChatBody(char);
            };
            
            reader.readAsDataURL(file);
            input.value = '';
        }

        function insertEmoji(e) {
            const input = document.getElementById('chat-input-box');
            input.value += e;
            handleChatInputChange(input);
        }

        // 语音输入功能
        function showVoiceInputModal() {
            // 关闭更多面板
            closeChatPanel();
            
            // 显示语音模式选择弹窗
            const modal = document.createElement('div');
            modal.id = 'voice-mode-modal';
            modal.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0,0,0,0.5);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10000;
            `;
            
            modal.innerHTML = `
                <div style="background: white; border-radius: 12px; padding: 20px; width: 80%; max-width: 300px;">
                    <h3 style="margin: 0 0 20px 0; text-align: center; color: #333;">选择语音模式</h3>
                    <div style="display: flex; flex-direction: column; gap: 12px;">
                        <button onclick="startRealVoiceInput()" style="padding: 15px; background: var(--ins-pink); color: white; border: none; border-radius: 8px; font-size: 16px; display:flex; align-items:center; justify-content:center; gap:8px;">
                            <svg class="svg-icon" style="width:20px; height:20px; stroke:#fff;" viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
                            <span>真实语音识别</span>
                        </button>
                        <button onclick="startTextToVoice()" style="padding: 15px; background: #34c759; color: white; border: none; border-radius: 8px; font-size: 16px; display:flex; align-items:center; justify-content:center; gap:8px;">
                            <svg class="svg-icon" style="width:20px; height:20px; stroke:#fff;" viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
                            <span>文字转语音气泡</span>
                        </button>
                        <button onclick="closeVoiceModal()" style="padding: 12px; background: #f0f0f0; color: #666; border: none; border-radius: 8px; font-size: 14px;">
                            取消
                        </button>
                    </div>
                </div>
            `;
            
            document.body.appendChild(modal);
        }

        function closeVoiceModal() {
            const modal = document.getElementById('voice-mode-modal');
            if (modal) modal.remove();
        }

        // 真实语音识别 - 改进版：识别后以语音气泡形式发送
        function startRealVoiceInput() {
            closeVoiceModal();
            
            if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
                alert('抱歉，您的浏览器不支持语音识别功能');
                return;
            }
            
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            const recognition = new SpeechRecognition();
            
            recognition.lang = 'zh-CN';
            recognition.continuous = false;
            recognition.interimResults = false;
            
            // 显示录音中提示
            const toast = document.createElement('div');
            toast.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: rgba(0,0,0,0.8);
                color: white;
                padding: 20px 30px;
                border-radius: 12px;
                z-index: 10001;
                font-size: 16px;
            `;
            toast.innerHTML = '🎤 正在录音...';
            document.body.appendChild(toast);
            
            recognition.onresult = async (event) => {
                const text = event.results[0][0].transcript;
                toast.innerHTML = '✓ 识别成功！';
                
                // 延迟500ms后发送语音气泡
                setTimeout(async () => {
                    toast.remove();
                    
                    // 以语音气泡格式发送
                    const msgContent = `[voice:${text}]`;
                    
                    if (!currentChatCharId) return;
                    const char = await db.characters.get(currentChatCharId);
                    if (!char.chat_history) char.chat_history = [];
                    
                    char.chat_history.push({
                        role: 'user',
                        content: msgContent,
                        time: Date.now()
                    });
                    
                    await db.characters.put(char);
                    renderChatBody(char);
                    
                    // ✅ 不再自动触发 AI 回复，需要用户点击"接受回复"按钮
                    // triggerAiReply();
                }, 500);
            };
            
            recognition.onerror = (event) => {
                console.error('语音识别错误:', event.error);
                toast.innerHTML = '❌ 识别失败';
                setTimeout(() => toast.remove(), 1500);
            };
            
            recognition.onend = () => {
                setTimeout(() => {
                    if (toast.parentNode) toast.remove();
                }, 500);
            };
            
            recognition.start();
        }

        // 文字转语音气泡
        function startTextToVoice() {
            closeVoiceModal();
            
            const modal = document.createElement('div');
            modal.id = 'text-to-voice-modal';
            modal.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0,0,0,0.5);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10000;
            `;
            
            modal.innerHTML = `
                <div style="background: white; border-radius: 12px; padding: 20px; width: 85%; max-width: 350px;">
                    <h3 style="margin: 0 0 15px 0; color: #333;">输入语音内容</h3>
                    <textarea id="voice-text-input" placeholder="输入要转换为语音气泡的文字..." style="width: 100%; height: 120px; padding: 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 14px; resize: none; box-sizing: border-box;"></textarea>
                    <div style="display: flex; gap: 10px; margin-top: 15px;">
                        <button onclick="sendVoiceBubble()" style="flex: 1; padding: 12px; background: var(--ins-pink); color: white; border: none; border-radius: 8px; font-size: 15px;">
                            发送
                        </button>
                        <button onclick="closeTextToVoiceModal()" style="flex: 1; padding: 12px; background: #f0f0f0; color: #666; border: none; border-radius: 8px; font-size: 15px;">
                            取消
                        </button>
                    </div>
                </div>
            `;
            
            document.body.appendChild(modal);
            document.getElementById('voice-text-input').focus();
        }

        function closeTextToVoiceModal() {
            const modal = document.getElementById('text-to-voice-modal');
            if (modal) modal.remove();
        }

        async function sendVoiceBubble() {
            const text = document.getElementById('voice-text-input').value.trim();
            if (!text) {
                alert('请输入内容');
                return;
            }
            
            closeTextToVoiceModal();
            
            // 发送语音气泡消息（格式：[voice:文字内容]）
            const msgContent = `[voice:${text}]`;
            
            if (!currentChatCharId) return;
            const char = await db.characters.get(currentChatCharId);
            const accountId = getCurrentAccountId();
            let history = getChatHistory(char, accountId);
            
            history.push({
                role: 'user',
                content: msgContent,
                time: Date.now()
            });
            
            await setChatHistory(char, accountId, history);
            renderChatBody(char);
            
            // ✅ 移除自动触发AI回复
            // triggerAiReply();
        }

        function toggleChatPanel(type) {
            const container = document.getElementById('chat-panel-container');
            const footer = document.getElementById('chat-footer');
            const emojiPanel = document.getElementById('emoji-panel');
            const actionPanel = document.getElementById('action-panel');
            
            // 如果是表情面板，先初始化
            if (type === 'emoji') initEmojiPanel();

            if (activePanel === type) {
                // 关闭当前
                closeChatPanel();
            } else {
                // 打开或切换
                if (!activePanel) {
                    container.classList.add('open');
                    footer.classList.add('panel-open');
                }
                activePanel = type;
                
                // 默认切回 Emoji Tab
                if (type === 'emoji') {
                    document.getElementById('emoji-tab-bar').style.display = 'flex';
                    switchEmojiTab('emoji');
                    actionPanel.style.display = 'none';
                } else {
                    document.getElementById('emoji-tab-bar').style.display = 'none';
                    document.getElementById('emoji-panel').style.display = 'none';
                    document.getElementById('sticker-panel').style.display = 'none';
                    actionPanel.style.display = 'grid';
                }
                
                // 滚动到底部，确保能看到面板
                setTimeout(() => {
                    const body = document.getElementById('chat-body');
                    body.scrollTop = body.scrollHeight;
                }, 100);
            }
        }

        function closeChatPanel() {
            if (!activePanel) return;
            const container = document.getElementById('chat-panel-container');
            const footer = document.getElementById('chat-footer');
            
            container.classList.remove('open');
            footer.classList.remove('panel-open');
            activePanel = null;
            
            // 等待动画结束隐藏内容
            setTimeout(() => {
                if (!activePanel) {
                    document.getElementById('emoji-panel').style.display = 'none';
                    document.getElementById('action-panel').style.display = 'none';
                }
            }, 300);
        }

        function handleChatInputChange(input) {
            const hasText = input.value.trim().length > 0;
            const btnMore = document.getElementById('btn-more');
            const btnSend = document.getElementById('btn-send');
            
            if (hasText) {
                btnMore.style.display = 'none';
                btnSend.style.display = 'flex';
            } else {
                btnMore.style.display = 'flex';
                btnSend.style.display = 'none';
            }
        }

        // 显示快进时间选择弹窗
        function showFastForwardModal() {
            closeChatPanel();
            document.getElementById('fast-forward-modal').style.display = 'flex';
        }

        // 确认快进逻辑
        async function confirmFastForward() {
            const amount = parseInt(document.getElementById('ff-amount').value);
            const unit = document.getElementById('ff-unit').value;
            
            if (isNaN(amount) || amount <= 0) {
                alert("请输入有效的时间数值");
                return;
            }
            
            closeModal('fast-forward-modal');
            
            // 1. 计算毫秒数并更新虚拟时间
            let ms = 0;
            let unitText = '';
            if (unit === 'minute') {
                ms = amount * 60 * 1000;
                unitText = amount + '分钟';
            } else if (unit === 'hour') {
                ms = amount * 60 * 60 * 1000;
                unitText = amount + '小时';
            } else if (unit === 'day') {
                ms = amount * 24 * 60 * 60 * 1000;
                unitText = amount + '天';
            }
            
            if (currentChatCharId) {
                const char = await db.characters.get(currentChatCharId);
                // 更新虚拟时间偏移
                if (!char.timeOffset) char.timeOffset = 0;
                char.timeOffset += ms;
                await db.characters.put(char);
                console.log(`[FastForward] Updated time offset by +${ms}ms (${unitText})`);
            }
            
            // 2. 触发 AI 回复，带上时间流逝的系统提示
            await triggerAiReply(`时间过去了 ${unitText}`);
        }
        
        // 拟人化分句辅助函数
        function splitMessage(text) {
            if (!text) return [];
            
            // ✅ 修复：先保护URL不被拆分
            const urlRegex = /(https?:\/\/[^\s]+)/g;
            const urlPlaceholders = [];
            let placeholderIndex = 0;
            
            // 用占位符替换所有URL
            let temp = text.replace(urlRegex, (match) => {
                const placeholder = `###URL_PLACEHOLDER_${placeholderIndex}###`;
                urlPlaceholders[placeholderIndex] = match;
                placeholderIndex++;
                return placeholder;
            });
            
            // 保护省略号 (将2个以上点替换为中文省略号)
            temp = temp.replace(/\.{2,}/g, '…');
            // 标记去除标点：句号（但不在URL占位符内）
            temp = temp.replace(/([。\.])/g, '###DROP###');
            // 标记保留标点：感叹、问号、波浪、省略号
            temp = temp.replace(/([！!？\?~…]+)/g, '$1###KEEP###');
            // 标记换行
            temp = temp.replace(/(\n+)/g, '###KEEP###');
            
            // 拆分消息
            let segments = temp.split(/###(?:DROP|KEEP)###/).map(s => s.trim()).filter(s => s.length > 0);
            
            // 恢复URL占位符为原始URL
            segments = segments.map(seg => {
                return seg.replace(/###URL_PLACEHOLDER_(\d+)###/g, (match, index) => {
                    return urlPlaceholders[parseInt(index)] || match;
                });
            });
            
            return segments;
        }

        async function triggerAiReply(additionalSystemInfo = null) {
            console.log('[triggerAiReply] ⚡ 触发 AI 回复');
            if (!currentChatCharId) return;
            const targetCharId = currentChatCharId; // 锁定目标ID
            const char = await db.characters.get(targetCharId);
            if (!char) return;
            
            const accountId = getCurrentAccountId();
            console.log('[triggerAiReply] 当前账号 ID:', accountId);
            console.log('[triggerAiReply] 角色名称:', char.name);
            
            // 获取聊天历史并打印
            const fullHistory = getChatHistory(char, accountId);
            console.log('[triggerAiReply] 📚 完整聊天历史条数:', fullHistory.length);
            if (fullHistory.length > 0) {
                console.log('[triggerAiReply] 最近5条消息:');
                fullHistory.slice(-5).forEach((msg, idx) => {
                    console.log(`  [${fullHistory.length - 5 + idx}] ${msg.role}: ${msg.content}`);
                });
            } else {
                console.warn('[triggerAiReply] ⚠️ 聊天历史为空！');
            }

            // 修改标题为正在输入
            const chatTitleEl = document.getElementById('chat-title');
            // 防止重复获取"正在输入"作为标题
            let originalTitle = char.remark || char.name;
            if (chatTitleEl && chatTitleEl.innerText !== "对方正在输入中...") {
                originalTitle = chatTitleEl.innerText;
            }
            if (chatTitleEl) chatTitleEl.innerText = "对方正在输入中...";

            try {
                // 1. 获取关联数据 (User 和 Lorebook)
                console.log('[triggerAiReply] 📖 开始加载上下文信息...');
                
                let userDesc = "";
                let userName = "用户";
                if (char.linked_user_id) {
                    console.log('[triggerAiReply] 👤 检测到关联的用户 ID:', char.linked_user_id);
                    const user = await db.characters.get(char.linked_user_id);
                    if (user) {
                        userName = user.name;
                        userDesc = `\n\n【对话对象(User)信息】\n名字：${user.name}\n设定：${user.description || '无'}`;
                        console.log('[triggerAiReply] ✅ 用户人设已加载:');
                        console.log('  - 用户名:', userName);
                        console.log('  - 用户设定:', user.description || '无');
                    } else {
                        console.warn('[triggerAiReply] ⚠️ 未找到关联的用户数据');
                    }
                } else {
                    console.log('[triggerAiReply] ℹ️ 未设置关联用户');
                }
                
                let loreContext = "";
                const lorebookIds = char.lorebookIds || (char.lorebookId ? [char.lorebookId] : []);
                console.log('[triggerAiReply] 📚 关联的世界书 ID:', lorebookIds);
                if (lorebookIds.length > 0) {
                    // 获取最近对话用于关键词匹配（使用正确的聊天历史）
                    const recentText = fullHistory.slice(-10).map(m => m.content).join(' ');
                    console.log('[triggerAiReply] 🔍 用于匹配世界书的关键词文本（前100字）:', recentText.substring(0, 100));
                    loreContext = await getLorebookContext(lorebookIds, `${char.name} ${userName} ${recentText}`);
                    if (loreContext) {
                        console.log('[triggerAiReply] ✅ 世界书内容已加载（长度）:', loreContext.length);
                        console.log('[triggerAiReply] 世界书内容预览:', loreContext.substring(0, 200) + '...');
                    } else {
                        console.log('[triggerAiReply] ℹ️ 没有匹配到世界书条目');
                    }
                } else {
                    console.log('[triggerAiReply] ℹ️ 未设置世界书');
                }

                // 计算虚拟时间
                const virtualTimeStr = getFormattedVirtualTime(char.timeOffset);

                // 2. 准备 Context
                 let systemPrompt = `你正在进行角色扮演。
【当前时间】
${virtualTimeStr}`;

                // 如果有额外系统信息（如时间流逝），插入到 Prompt
                if (additionalSystemInfo) {
                    systemPrompt += `\n\n【系统提示】\n${additionalSystemInfo}\n请根据这个情况（例如时间流逝后的变化、刚刚发生的事件）进行回复。`;
                }

                systemPrompt += `

【角色(你)信息】
名字：${char.name}
${char.nick ? `昵称：${char.nick}` : ''}
设定：
${char.description || ''}

${char.identity ? `虚拟身份信息：
账号：${char.identity.account || '未知'}
手机：${char.identity.phone || '未知'}
住址：${char.identity.address || '未知'}
` : ''}
${userDesc}
${loreContext}

请完全沉浸在角色中，用符合角色性格的语气回复。
回复简短自然，像微信聊天一样。
请注意：不要重复输出名字前缀，直接输出回复内容。

【消息格式说明】
- 普通文字消息：直接输出文字内容（最常用）
- 语音消息：使用格式 [voice:语音内容文字]，例如：[voice:嘿，在干嘛呢？]
- 图片消息：使用格式 [img:图片URL]（暂不支持AI生成）
- **转账消息**：使用格式 ((TRANSFER: 金额, 备注))，例如：((TRANSFER: 520, 给夫人的零花钱))
  **重要**：转账备注必须简短（不超过10个字），只用于简单说明转账用途。如果有其他话要说，请先发送普通文字消息，然后再发送转账。不要将长句子放在转账备注中。

【重要】消息类型选择原则：
1. **普通文字消息**：默认选择，适用于日常对话、闲聊、问答等绝大多数场景
2. **语音消息**：适合以下场景：
   - 表达强烈情绪时（兴奋、生气、撒娇等）
   - 说悄悄话或私密内容
   - 想要更亲密的交流感觉
   - 内容较长不方便打字时
3. **转账消息**：**仅在特殊场景使用，不要频繁使用**，适合以下情况：
   - 特殊节日或纪念日（生日、情人节、节日等）
   - 角色人设中明确有金钱往来习惯（如包养关系、定期给零花钱等）
   - 用户明确提到需要钱、缺钱等话题时
   - 表达重大歉意或感谢时
   - 符合角色人设的特定金钱场景（如老板给员工发奖金、家长给孩子零花钱等）
   
**转账备注规则**：
- 备注必须简短，不超过10个字，只用于简单说明转账用途（如："零花钱"、"生日礼物"、"生活费"等）
- 如果有其他话要说，必须先发送普通文字消息，然后再发送转账
- 严禁将长句子、完整对话或详细说明放在转账备注中
- 示例：正确做法是发送 "给你转点零花钱，记得买点好吃的" 作为文字消息，然后转账备注写 "零花钱"
   
**注意**：转账是特殊功能，不是每轮对话都需要。大部分对话应该使用普通文字或语音消息。只有在符合上述特殊场景且符合角色人设时，才考虑使用转账。

【重要回复规则 - 必须严格遵守】
1. **必须**模拟微信连发消息的习惯：请生成 2 到 4 条短消息，不能只发一条！
2. **必须**使用分隔符 "|||" 来隔开每一条消息。
3. **严禁使用逗号**（包括中文逗号和英文逗号）。如果想表达停顿，请直接拆分成下一条消息，或者用空格代替。
   - 错误示例：嘿在吗？刚刚看到个好玩的视频，发给你看看
   - 正确示例：嘿在吗？|||刚刚看到个好玩的视频|||发给你看看
4. 每条消息要简短，5-15个字最佳，像真实微信聊天一样分多条发送。
5. 严禁只发送标点符号。每一条消息都必须有实际文字内容。
6. 语气要自然、口语化，符合人设。

【重要】你需要同时生成两个内容：
1. **回复内容**：对用户消息的回复（可以是文字、语音格式，或转账指令 ((TRANSFER: 金额, 备注))）
2. **心声内容**：角色当前的心理活动、想法、感受或状态变化（可以是内心独白、情绪变化、想法等）

请以JSON格式返回，格式如下：
{
  "reply": "你的回复内容|||第二条内容",
  "thought": "角色的心声/心理活动/想法"
}

请严格返回JSON格式，不要包含Markdown代码块标记。`;

                // 显示 System Prompt 的关键信息
                console.log('[triggerAiReply] 📝 System Prompt 构建完成');
                console.log('[triggerAiReply] - 角色名称:', char.name);
                console.log('[triggerAiReply] - 角色设定长度:', (char.description || '').length);
                console.log('[triggerAiReply] - 用户人设:', userName, userDesc ? '✅已包含' : '❌未包含');
                console.log('[triggerAiReply] - 世界书:', loreContext ? `✅已包含(${loreContext.length}字)` : '❌未包含');
                console.log('[triggerAiReply] - System Prompt 总长度:', systemPrompt.length);

                // 取最近 N 条历史记录（使用自定义的上下文条数，默认20条）
                const contextCount = char.context_message_count || 20;
                console.log('[triggerAiReply] 📊 上下文消息数配置:', contextCount);
                
                // ❌ BUG 发现：这里使用的是 char.chat_history，而不是前面获取的 getChatHistory(char, accountId)
                // 应该使用 fullHistory 而不是 char.chat_history
                const recentHistory = fullHistory.slice(-contextCount)
                    .map(m => {
                        let content = m.content || '';
                        // 如果有图片描述，拼接在后面给 AI 看
                        if (m.imageDescription) {
                            content += `\n(图片描述: ${m.imageDescription})`;
                        }
                        return {
                            role: m.role === 'char' ? 'assistant' : 'user',
                            content: content
                        };
                    })
                    .filter(m => m.content && m.content.trim()); // 过滤空消息
                    
                console.log('[triggerAiReply] 📝 处理后的历史消息数:', recentHistory.length);

                const messages = [
                    { role: 'system', content: systemPrompt },
                    ...recentHistory
                ];
                
                // 添加详细日志查看发送给 AI 的完整消息
                console.log('='.repeat(80));
                console.log('[triggerAiReply] 📤 准备发送给 AI - 完整信息汇总');
                console.log('='.repeat(80));
                console.log('【上下文信息】');
                console.log(`  ✅ 聊天历史: ${recentHistory.length} 条消息（配置: ${contextCount} 条）`);
                console.log(`  ${userDesc ? '✅' : '❌'} 用户人设: ${userName}${userDesc ? ` (${(userDesc).length}字)` : ' (未设置)'}`);
                console.log(`  ${loreContext ? '✅' : '❌'} 世界书: ${loreContext ? `已加载 (${loreContext.length}字)` : '未设置或未匹配'}`);
                console.log(`  ✅ 角色设定: ${char.name} (${(char.description || '').length}字)`);
                console.log('');
                console.log('【发送的消息结构】');
                console.log(`  - System Prompt: ${systemPrompt.length} 字符`);
                console.log(`  - 历史消息: ${recentHistory.length} 条`);
                console.log('');
                console.log('【最近的对话内容】');
                recentHistory.slice(-3).forEach((msg, index) => {
                    const displayContent = msg.content.substring(0, 100) + (msg.content.length > 100 ? '...' : '');
                    console.log(`  ${msg.role === 'user' ? '👤' : '🤖'} ${msg.role}: ${displayContent}`);
                });
                console.log('='.repeat(80));

                // 2. 调用 AI（已经是防御式解析，直接拿到内容）
                const aiResponse = await callAI(messages);
                
                // ✅ 修复：清理末尾多余的 ]
                function cleanMessage(text) {
                    if (!text) return text;
                    // 删除末尾多余的 ]
                    return text.replace(/\]+$/, '');
                }
                
                // 3. 尝试解析为结构化数据（reply + thought），失败就直接用原始内容
                let replyText = "";
                let thought = "";
                
                // 使用增强的提取函数
                const parsed = extractAndParseJSON(aiResponse);
                
                if (parsed) {
                    // 检测是否是转账格式
                    if (parsed.amount && parsed.desc !== undefined && parsed.status && !parsed.reply) {
                        // 转账消息，保持 JSON 格式
                        replyText = JSON.stringify(parsed);
                        thought = "";
                    } else {
                        // 标准回复格式
                        replyText = parsed.reply || parsed.content || parsed.message || "";
                        thought = parsed.thought || "";
                    }
                }
                
                // 如果还是没有内容，直接使用原始响应（降级处理）
                if (!replyText) {
                    // 清理常见装饰字符
                    let cleanResponse = aiResponse.trim().replace(/[◇◆★☆●○■□▲△]/g, '');
                    
                    // 尝试简单的正则提取兜底
                    const replyMatch = cleanResponse.match(/"reply"\s*:\s*"([\s\S]*?)"/);
                        if (replyMatch) {
                        replyText = replyMatch[1]
                            .replace(/\\n/g, '\n')
                            .replace(/\\"/g, '"')
                            .replace(/\\t/g, '\t')
                            .replace(/\\\\/g, '\\');
                    } else {
                        replyText = cleanResponse || aiResponse || "(AI 返回为空)";
                    }
                    thought = "";
                    }
                
                // ✅ 修复：清理末尾多余的 ]
                replyText = cleanMessage(replyText);
                    
                    // 存储心声到角色对象
                    if (thought && thought.trim()) {
                        const freshChar = await db.characters.get(targetCharId);
                        if (freshChar) {
                            if (!freshChar.thoughts) freshChar.thoughts = [];
                            freshChar.thoughts.push({
                                content: thought.trim(),
                                time: Date.now(),
                                messageIndex: freshChar.chat_history ? freshChar.chat_history.length : 0
                            });
                            // 只保留最近50条心声
                            if (freshChar.thoughts.length > 50) {
                                freshChar.thoughts = freshChar.thoughts.slice(-50);
                            }
                            await db.characters.put(freshChar);
                        }
                    }

                // 3. 恢复标题
                if (chatTitleEl) chatTitleEl.innerText = originalTitle;
                
                // ✅ 关键改动：在拆分前，先检测是否包含"指令型消息"（转账等）
                // 检测 ((TRANSFER: 金额, 备注)) 格式
                const transferMatch = replyText.match(/\(\(TRANSFER:\s*(\d+(\.\d+)?)(?:,\s*(.+?))?\)\)/i);
                
                if (transferMatch) {
                    // 提取转账信息
                    const amount = parseFloat(transferMatch[1]);
                    let note = transferMatch[3] || '转账';
                    // 限制备注长度，不超过10个字
                    if (note.length > 10) {
                        note = note.substring(0, 10);
                    }
                    
                    // 提取转账前面的文字内容（如果有）
                    const textBeforeTransfer = replyText.substring(0, transferMatch.index).trim();
                    
                    const freshChar = await db.characters.get(targetCharId);
                    if (freshChar) {
                        let history = getChatHistory(freshChar, accountId);
                        
                        // 1. 先发送文字消息（如果有）
                        if (textBeforeTransfer) {
                            const textMsg = {
                                role: 'char',
                                content: textBeforeTransfer,
                                time: Date.now()
                            };
                            history.push(textMsg);
                            await setChatHistory(freshChar, accountId, history);
                            
                            // 渲染文字消息
                            if (currentChatCharId === targetCharId) {
                                appendMessageToUI('char', textBeforeTransfer, freshChar.avatar);
                            }
                            
                            // 稍微延时，让文字消息先显示
                            await new Promise(r => setTimeout(r, 300));
                        }
                        
                            // 2. 再发送转账卡片
                        const transferData = {
                            amount: amount.toFixed(2),
                            desc: note,
                            status: 'sent'
                        };
                        
                        const transferMsg = { 
                            role: 'char', 
                            type: 'transfer', // 明确标记为转账消息
                            content: JSON.stringify(transferData), 
                            time: Date.now(),
                            id: 'trans_' + Date.now()
                        };
                        
                        // 重新获取最新的历史记录（因为刚才可能插入了文字消息）
                        history = getChatHistory(freshChar, accountId);
                        history.push(transferMsg);
                        await setChatHistory(freshChar, accountId, history);
                        
                        // 渲染转账卡片
                        if (currentChatCharId === targetCharId) {
                            // 直接刷新整个聊天界面（因为转账卡片需要特殊渲染）
                            renderChatBody(freshChar);
                        } else {
                            sendSystemNotification(freshChar.name, '[转账]');
                        }
                    }
                    return; // 转账处理完成，不再执行后续逻辑
                }
                
                // 兜底：检测是否是转账 JSON（兼容旧格式）
                let trimmedReply = replyText.trim();
                if (trimmedReply.startsWith('{') && trimmedReply.includes('"amount"')) {
                    try {
                        const parsed = JSON.parse(trimmedReply);
                        if (parsed.amount && parsed.desc !== undefined && parsed.status) {
                            const freshChar = await db.characters.get(targetCharId);
                            if (freshChar) {
                                let history = getChatHistory(freshChar, accountId);
                                
                                const newMsg = { 
                                    role: 'char', 
                                    type: 'transfer',
                                    content: trimmedReply, 
                                    time: Date.now(),
                                    id: 'trans_' + Date.now()
                                };
                                
                                history.push(newMsg);
                                await setChatHistory(freshChar, accountId, history);
                                
                                if (currentChatCharId === targetCharId) {
                                    renderChatBody(freshChar);
                                } else {
                                    sendSystemNotification(freshChar.name, '[转账]');
                                }
                            }
                            return;
                        }
                    } catch(e) {
                        // 不是有效的 JSON，继续当普通消息
                    }
                }
                
                // 4. 普通消息：强制清洗逗号 + 拆分
                let cleanText = replyText.replace(/[,，]/g, ' ');
                let segments = [];
                
                // 优先使用 ||| 拆分
                if (cleanText.includes('|||')) {
                    segments = cleanText.split('|||').map(s => cleanMessage(s.trim())).filter(s => s);
                } else {
                    // 回退到标点拆分逻辑 (但逗号已经被干掉了)
                    segments = splitMessage(cleanText);
                }
                
                // 兜底：如果没拆出来，但有内容，就当成一条
                if (segments.length === 0 && cleanText.trim()) {
                    segments.push(cleanMessage(cleanText.trim()));
                }

                for (let i = 0; i < segments.length; i++) {
                    let seg = segments[i];
                    
                    // 延时：第一条直接发(前面loading已经是等待了)，后续模拟打字
                    if (i > 0) {
                        // 基础 500ms + 每字 80ms
                        const delay = 500 + Math.min(seg.length * 80, 3000);
                        await new Promise(r => setTimeout(r, delay));
                    }

                    // 始终存入 DB
                    const freshChar = await db.characters.get(targetCharId);
                    if (freshChar) {
                        let history = getChatHistory(freshChar, accountId);
                        
                        const newMsg = { 
                            role: 'char', 
                            content: seg, 
                            time: Date.now()
                        };
                        
                        history.push(newMsg);
                        await setChatHistory(freshChar, accountId, history);
                        
                        // 只有在当前窗口匹配时才渲染 UI
                        if (currentChatCharId === targetCharId) {
                            console.log(`[AiReply] User is viewing ${freshChar.name}'s chat, appending to UI`);
                            showDebugToast(`AI回复: 正在查看${freshChar.name}，显示在UI`);
                            appendMessageToUI('char', seg, freshChar.avatar);
                        } else {
                            // 不在当前窗口时，发送系统通知
                            console.log(`[AiReply] User is NOT viewing ${freshChar.name}'s chat (current: ${currentChatCharId}), sending notification`);
                            showDebugToast(`AI回复: 不在${freshChar.name}聊天中(当前:${currentChatCharId})，发送通知`);
                            sendSystemNotification(freshChar.name, seg);
                        }
                    }
                }
                
            } catch (err) {
                console.error("AI 回复失败", err);
                if (chatTitleEl) chatTitleEl.innerText = originalTitle;
                
                // 显示错误消息
                await appendMessageToUI('char', `[触发失败] ${err.message}`, char.avatar);
                const lastContent = document.querySelector('#chat-body .message-row:last-child .message-content');
                if (lastContent) lastContent.style.color = 'red';
            }
        }

        // 重新生成回复（删除上一次AI回复的所有消息并重新生成，不删除用户消息）
        async function regenerateLastReply() {
            if (!currentChatCharId) return;
            
            const char = await db.characters.get(currentChatCharId);
            const accountId = getCurrentAccountId();
            const history = getChatHistory(char, accountId);
            
            if (!char || !history || history.length === 0) {
                // 没有聊天记录，无法重新生成
                return;
            }
            
            // 找到上一次AI回复的所有消息（从最后往前找，直到遇到用户消息）
            let lastAiMessageStartIndex = -1;
            let lastAiMessageEndIndex = -1;
            
            // 从后往前找最后一条AI消息
            for (let i = history.length - 1; i >= 0; i--) {
                if (history[i].role === 'char') {
                    lastAiMessageEndIndex = i;
                    break;
                }
            }
            
            // 如果没有AI回复，直接生成新的
            if (lastAiMessageEndIndex === -1) {
                closeChatPanel();
                await triggerAiReply();
                return;
            }
            
            // 从最后一条AI消息往前找，找到连续的所有AI消息
            lastAiMessageStartIndex = lastAiMessageEndIndex;
            for (let i = lastAiMessageEndIndex - 1; i >= 0; i--) {
                if (history[i].role === 'user') {
                    // 遇到用户消息，停止
                    break;
                }
                // 还是AI的消息，继续往前
                lastAiMessageStartIndex = i;
            }
            
            // 删除所有连续的AI消息（不删除用户消息）
            const deleteCount = lastAiMessageEndIndex - lastAiMessageStartIndex + 1;
            history.splice(lastAiMessageStartIndex, deleteCount);
            await setChatHistory(char, accountId, history);
            await db.characters.put(char);
            
            // 重新渲染聊天界面（移除AI回复消息）
            renderChatBody(char);
            
            // 关闭面板
            closeChatPanel();
            
            // 重新生成回复（基于删除后的历史记录，用户消息还在）
            await triggerAiReply();
        }

// --- 角色档案 (Character) 逻辑 ---
function showCharacterPage() {
    document.getElementById('character-page').style.display = 'flex';
    loadCharacterList();
}

        function hideCharacterPage() {
            const page = document.getElementById('character-page');
            page.style.transform = 'scale(0.95)';
            page.style.opacity = '0';
            setTimeout(() => {
                page.style.display = 'none';
                page.style.transform = ''; 
                page.style.opacity = '';
            }, 200);
        }

        function switchCharacterTab(type) {
            currentCharacterType = type;
            
            // 更新底部样式
            ['char', 'npc', 'user'].forEach(t => {
                const el = document.getElementById(`tab-${t}`);
                if (t === type) {
                    el.style.color = 'var(--ins-pink)';
                } else {
                    el.style.color = '#999';
                }
            });
            
            loadCharacterList();
        }

        async function loadCharacterList() {
            const container = document.getElementById('character-list');
            container.innerHTML = '';
            
            // 从数据库获取指定类型的角色
            const list = await db.characters.where('type').equals(currentCharacterType).toArray();
            
            if (list.length === 0) {
                container.innerHTML = `
                    <div style="grid-column: span 2; text-align:center; color:#999; margin-top:60px; display:flex; flex-direction:column; align-items:center; gap:10px;">
                        <svg class="svg-icon" style="width:40px; height:40px; stroke:#ccc;" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="8" y1="15" x2="16" y2="15"></line><line x1="9" y1="9" x2="9.01" y2="9"></line><line x1="15" y1="9" x2="15.01" y2="9"></line></svg>
                        <div>这里还没人哦</div>
                    </div>
                `;
                return;
            }

            list.forEach(char => {
                const div = document.createElement('div');
                div.className = 'char-card';
                div.onclick = () => editCharacter(char.id);
                
                // 默认头像
                let bgStyle = 'background-color: #eee;';
                if (char.avatar) {
                    bgStyle = `background-image: url(${char.avatar});`;
                }
                
                div.innerHTML = `
                    <div class="char-card-img" style="${bgStyle}"></div>
                    <div class="char-card-info">
                        <div class="char-name">${char.name || '未命名'}</div>
                        <div class="char-nick">${char.nick || ''}</div>
                    </div>
                `;
                container.appendChild(div);
            });
        }

        function createNewCharacter() {
            editingCharId = null;
            document.getElementById('char-editor-title').innerText = "新建角色";
            document.getElementById('char-name').value = '';
            document.getElementById('char-nick').value = '';
            document.getElementById('char-desc').value = '';
            document.getElementById('char-type').value = currentCharacterType; // 默认选中当前 Tab 类型
            document.getElementById('char-avatar-preview').style.backgroundImage = '';
            document.getElementById('char-avatar-placeholder').style.display = 'flex';
            
            // 清空虚拟身份信息
            document.getElementById('char-identity-account').value = '';
            document.getElementById('char-identity-password').value = '';
            document.getElementById('char-identity-phone').value = '';
            document.getElementById('char-identity-address').value = '';
            document.getElementById('char-identity-id').value = '';
            document.getElementById('char-identity-bank').value = '';
            document.getElementById('char-identity-bank-pass').value = '';

            document.getElementById('character-editor-page').style.display = 'flex';
        }

        async function editCharacter(id) {
            editingCharId = id;
            const char = await db.characters.get(id);
            if (!char) return;
            
            document.getElementById('char-editor-title').innerText = "编辑角色";
            document.getElementById('char-name').value = char.name || '';
            document.getElementById('char-nick').value = char.nick || '';
            document.getElementById('char-desc').value = char.description || '';
            document.getElementById('char-type').value = char.type || 'char';
            
            // 回显虚拟身份信息
            const idData = char.identity || {};
            document.getElementById('char-identity-account').value = idData.account || '';
            document.getElementById('char-identity-password').value = idData.password || '';
            document.getElementById('char-identity-phone').value = idData.phone || '';
            document.getElementById('char-identity-address').value = idData.address || '';
            document.getElementById('char-identity-id').value = idData.id_card || '';
            document.getElementById('char-identity-bank').value = idData.bank_card || '';
            document.getElementById('char-identity-bank-pass').value = idData.bank_password || '';

            if (char.avatar) {
                document.getElementById('char-avatar-preview').style.backgroundImage = `url(${char.avatar})`;
                document.getElementById('char-avatar-placeholder').style.display = 'none';
            } else {
                document.getElementById('char-avatar-preview').style.backgroundImage = '';
                document.getElementById('char-avatar-placeholder').style.display = 'flex';
            }
            
            // 渲染关系列表
            renderRelationList(char);

            document.getElementById('character-editor-page').style.display = 'flex';
        }

        // 渲染编辑页的关系列表
        async function renderRelationList(char) {
            const container = document.getElementById('char-relation-list');
            container.innerHTML = '';
            
            if (!char.relationships || char.relationships.length === 0) {
                container.innerHTML = '<div style="text-align:center; color:#ccc; font-size:12px; padding:10px;">暂无关系记录</div>';
                return;
            }

            // relationships: [{ targetId, targetName, relation, desc }]
            for (const rel of char.relationships) {
                // 尝试获取最新的头像
                let avatarUrl = '';
                if (rel.targetId) {
                    const target = await db.characters.get(rel.targetId);
                    if (target && target.avatar) avatarUrl = target.avatar;
                }
                
                const item = document.createElement('div');
                item.className = 'relation-item';
                item.innerHTML = `
                    <div class="relation-avatar" style="${avatarUrl ? `background-image:url(${avatarUrl})` : ''}"></div>
                    <div class="relation-info">
                        <div class="relation-name">${rel.targetName} <span class="relation-tag">${rel.relation}</span></div>
                        <div class="relation-desc">${rel.desc}</div>
                    </div>
                `;
                container.appendChild(item);
            }
        }

        // 显示生成 NPC 弹窗
        function showNpcGenModal() {
            if (!editingCharId) {
                alert("请先保存当前角色后再生成关联 NPC");
                return;
            }
            document.getElementById('npc-gen-modal').style.display = 'flex';
        }

        // 执行生成逻辑
        async function doGenerateNpcs() {
            const count = document.getElementById('gen-count-range').value;
            const req = document.getElementById('gen-prompt-req').value.trim();
            const btn = document.getElementById('btn-do-gen');
            
            // 获取源角色信息
            const sourceChar = await db.characters.get(editingCharId);
            if (!sourceChar) return;

            btn.innerText = "生成中...";
            btn.disabled = true;

            try {
                // 1. 构建 Prompt
                let loreContext = "";
                let entriesCount = 0;
                const sourceLorebookIds = sourceChar.lorebookIds || (sourceChar.lorebookId ? [sourceChar.lorebookId] : []);
                if (sourceLorebookIds.length > 0) {
                    // 合并多个世界书的所有词条
                    let allEntries = [];
                    for (const bookId of sourceLorebookIds) {
                        const book = await db.lorebooks.get(bookId);
                        if (book && book.content && book.content.entries) {
                            const bookEntries = Object.values(book.content.entries)
                                .filter(e => e.enabled)
                                .map(e => `[词条: ${e.key}]\n${e.content}`);
                            allEntries = allEntries.concat(bookEntries);
                        }
                    }
                    
                    entriesCount = allEntries.length;
                    if (entriesCount > 0) {
                        // 为了防止Token溢出，按长度截断（假设约 12000 字符为安全区，留给 Response 和 Prompt）
                        const entriesText = allEntries.join('\n\n');
                        loreContext = `【世界观背景 (Lorebook - 共${entriesCount}条设定)】\n${entriesText.slice(0, 12000)}\n`;
                        if (entriesText.length > 12000) loreContext += `\n...(部分设定因过长已省略)`;
                    }
                }

                const prompt = `你是一个专业的TRPG/小说角色设计助手。请根据以下【主角信息】和【世界观背景】，深度创作 ${count} 个相关的 NPC 角色。
${req ? `>>> 特别剧情要求：${req} <<<` : ''}

【主角信息】
名字：${sourceChar.name}
设定：${sourceChar.description}

${loreContext}

【生成要求】
1. **深度关联**：NPC 必须与世界观（Lorebook）紧密结合。请引用世界书中的地名、组织、种族或历史事件。
2. **细节丰富**：请详细描写外貌（衣着、特征）、性格（口癖、心理）和背景故事。拒绝空洞的描述。
3. **多样性**：生成的角色性格和身份应各不相同，除非【特别剧情要求】另有指定。

请返回一个 JSON 数组，每个对象包含：
- name: 名字
- nickname: 昵称 (可选)
- gender: 性别 (男/女/未知)
- appearance: 外貌描写 (详细，如发色、瞳色、服装风格)
- personality: 性格特征 (详细，如高冷、热血、腹黑)
- background: 背景故事 (结合世界观的个人经历)
- identity_job: 职业或身份
- relation: 与主角的关系类型
- relation_desc: 关系详情描述 (具体的互动模式)

请严格返回 JSON 格式，不要包含 Markdown 代码块标记。`;

                // 2. 调用 AI
                const resultStr = await callAI([
                    { role: "system", content: "你是一个只输出 JSON 数组的辅助系统。" },
                    { role: "user", content: prompt }
                ]);

                // 3. 解析 JSON
                const npcs = extractAndParseJSON(resultStr);
                if (!Array.isArray(npcs)) throw new Error("AI 返回格式错误 (不是数组) 或解析失败");

                // 4. 批量写入 DB 并建立关系
                let newCount = 0;
                for (const npcData of npcs) {
                    // 整合详细描述
                    const fullDesc = `【外貌】\n${npcData.appearance || '无'}\n\n【性格】\n${npcData.personality || '无'}\n\n【背景】\n${npcData.background || npcData.description || '无'}`;
                    
                    // 构造 NPC 数据
                    const newNpc = {
                        name: npcData.name,
                        nick: npcData.nickname || '',
                        description: fullDesc, // 存入整合后的详细描述
                        type: 'npc', // 默认为 NPC 类型
                        avatar: '', // 暂时留空
                        lorebookIds: sourceLorebookIds.length > 0 ? sourceLorebookIds : null, // 继承多个世界书
                        lorebookId: sourceLorebookIds.length > 0 ? sourceLorebookIds[0] : null, // 兼容字段
                        identity: {
                            // 基础身份占位
                            job: npcData.identity_job
                        },
                        relationships: [
                            // 写入指向主角的关系
                            {
                                targetId: sourceChar.id,
                                targetName: sourceChar.name,
                                relation: "关联主角", // 相对关系，或者让AI生成反向关系比较复杂，这里简化
                                desc: "生成来源"
                            }
                        ],
                        updated_at: Date.now()
                    };
                    
                    const newId = await db.characters.add(newNpc);
                    newCount++;

                    // 5. 更新主角的关系列表
                    if (!sourceChar.relationships) sourceChar.relationships = [];
                    sourceChar.relationships.push({
                        targetId: newId,
                        targetName: newNpc.name,
                        relation: npcData.relation,
                        desc: npcData.relation_desc
                    });
                }
                
                // 保存主角更新
                await db.characters.put(sourceChar);

                // 6. 刷新界面
                alert(`✅ 成功生成 ${newCount} 个 NPC！`);
                closeModal('npc-gen-modal');
                // 刷新编辑页的关系列表
                renderRelationList(sourceChar);
                // 刷新外部列表 (如果在列表页的话，虽然现在在弹窗里)
                loadCharacterList();

            } catch (err) {
                console.error(err);
                alert("生成失败: " + err.message);
            } finally {
                btn.innerText = "开始生成";
                btn.disabled = false;
            }
        }

        function hideCharacterEditor() {
            document.getElementById('character-editor-page').style.display = 'none';
            editingCharId = null;
        }

        function setCharAvatar(input) {
            const file = input.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = e => {
                    document.getElementById('char-avatar-preview').style.backgroundImage = `url(${e.target.result})`;
                    document.getElementById('char-avatar-placeholder').style.display = 'none';
                };
                reader.readAsDataURL(file);
            }
        }

        async function saveCharacter() {
            const name = document.getElementById('char-name').value.trim();
            const nick = document.getElementById('char-nick').value.trim();
            const desc = document.getElementById('char-desc').value;
            const type = document.getElementById('char-type').value;
            
            // 获取虚拟身份数据
            const identity = {
                account: document.getElementById('char-identity-account').value.trim(),
                password: document.getElementById('char-identity-password').value.trim(),
                phone: document.getElementById('char-identity-phone').value.trim(),
                address: document.getElementById('char-identity-address').value.trim(),
                id_card: document.getElementById('char-identity-id').value.trim(),
                bank_card: document.getElementById('char-identity-bank').value.trim(),
                bank_password: document.getElementById('char-identity-bank-pass').value.trim()
            };

            // 获取头像 Base64
            let avatar = '';
            const bgImage = document.getElementById('char-avatar-preview').style.backgroundImage;
            if (bgImage && bgImage !== 'none') {
                avatar = bgImage.replace(/url\(|\)|"/g, '');
            }
            
            if (!name) {
                alert("请输入角色名字");
                return;
            }
            
            // 如果是更新，先获取旧数据以保留 lorebookId 等字段
            let oldData = {};
            if (editingCharId) {
                oldData = await db.characters.get(editingCharId);
            }

            const charData = {
                ...oldData, // 保留原有的 lorebookId, original_data 等
                name,
                nick,
                description: desc,
                type,
                avatar,
                identity, // 保存身份信息
                updated_at: Date.now()
            };
            
            if (editingCharId) {
                await db.characters.put(charData); // 使用 put 覆盖完整对象
            } else {
                await db.characters.add(charData);
            }
            
            hideCharacterEditor();
            // 如果修改了类型，可能需要跳转到对应 Tab 才能看到，或者直接刷新当前 Tab
            if (type !== currentCharacterType) {
                switchCharacterTab(type);
            } else {
                loadCharacterList();
            }
        }

        // 提取并解析 JSON 的通用辅助函数 (增强鲁棒性)
        function extractAndParseJSON(text) {
            if (!text) return null;
            let str = text.trim();
            
            // 1. 尝试提取最外层的 { ... } 或 [ ... ]
            // 这能有效忽略前后的杂质（如用户的 ]{...} 情况）
            const firstBrace = str.indexOf('{');
            const firstBracket = str.indexOf('[');
            
            let startIdx = -1;
            let isArray = false;
            
            // 确定是对象还是数组开始得更早
            if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
                startIdx = firstBrace;
            } else if (firstBracket !== -1) {
                startIdx = firstBracket;
                isArray = true;
            }
            
            if (startIdx !== -1) {
                const endChar = isArray ? ']' : '}';
                const endIdx = str.lastIndexOf(endChar);
                
                if (endIdx !== -1 && endIdx > startIdx) {
                    const jsonCandidate = str.substring(startIdx, endIdx + 1);
                    try {
                        return JSON.parse(jsonCandidate);
                    } catch (e) {
                        // console.warn("[extractJSON] 提取片段解析失败:", e);
                    }
                }
            }
            
            // 2. 如果提取失败，尝试清理 Markdown 标记后直接解析
            const cleanStr = str.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '');
            try {
                return JSON.parse(cleanStr);
            } catch (e) {
                return null;
            }
        }

        // 通用 AI 调用函数
        async function callAI(messages) {
            const url = await db.dexiData.get('aiBaseUrl');
            const key = await db.dexiData.get('aiApiKey');
            const model = await db.dexiData.get('aiCurrentModel');
            
            if (!url || !key || !model) {
                throw new Error("请先在设置中配置 API 地址、密钥并选择模型");
            }
            
            // 验证配置值
            const apiKeyValue = key.value ? key.value.trim() : '';
            const modelValue = model.value ? model.value.trim() : '';
            
            if (!apiKeyValue) {
                throw new Error("API 密钥不能为空，请在设置中配置");
            }
            
            if (!modelValue) {
                throw new Error("模型名称不能为空，请在设置中选择模型");
            }
            
            // 检查 API Key 格式（基本检查）
            if (apiKeyValue.length < 10) {
                console.warn('[callAI] API Key 长度异常，可能无效:', apiKeyValue.length);
            }

            // 获取温度配置
            const tempItem = await db.dexiData.get('aiTemperature');
            let temperature = tempItem ? parseFloat(tempItem.value) : 0.7;
            
            // 验证温度值
            if (isNaN(temperature) || temperature < 0 || temperature > 2) {
                console.warn('[callAI] 温度值无效:', temperature, '，使用默认值 0.7');
                temperature = 0.7;
            }

            const requestUrl = getSmartUrl(url.value, '/chat/completions');
            
            // ✅ 全局防御：清洗 messages，防止空内容或非法格式导致 400 错误
            const cleanMessages = messages.map(m => {
                // 验证 role 字段
                let role = m.role;
                if (!role || !['system', 'user', 'assistant'].includes(role)) {
                    console.warn('[callAI] 无效的 role:', role, '，使用 user');
                    role = 'user';
                }
                
                // 确保 content 是字符串
                let content = m.content;
                if (content === null || content === undefined) content = "";
                if (typeof content !== 'string') content = String(content);
                
                return {
                    role: role,
                    content: content.trim()
                };
            }).filter(m => m.content.length > 0); // 再次过滤空消息

            // 如果过滤后只剩下 system 消息，有些模型可能会报错，但大多数支持。
            // 这里我们不做 System 的强制检查，只要不为空即可。
            if (cleanMessages.length === 0) {
                throw new Error("请求中止：没有有效的消息内容（可能是因为消息被撤回或为空）");
            }
            
            // 验证是否至少有一条非 system 消息
            const hasNonSystemMessage = cleanMessages.some(m => m.role !== 'system');
            if (!hasNonSystemMessage) {
                console.warn('[callAI] 只有 system 消息，添加一个占位 user 消息');
                cleanMessages.push({
                    role: 'user',
                    content: '请继续对话'
                });
            }

            let rawText = '';
            
            // 构建请求体
            const requestBody = {
                apiUrl: requestUrl,
                apiKey: apiKeyValue,
                model: modelValue,
                messages: cleanMessages,
                temperature: temperature
            };
            
            // 添加详细的调试日志
            console.log('[callAI] 🚀 准备发送请求');
            console.log('[callAI] API URL:', requestUrl);
            console.log('[callAI] Model:', modelValue);
            console.log('[callAI] API Key length:', apiKeyValue.length);
            console.log('[callAI] Temperature:', temperature);
            console.log('[callAI] Messages count:', cleanMessages.length);
            console.log('[callAI] Messages preview:', cleanMessages.map(m => ({
                role: m.role,
                content: m.content.substring(0, 100) + (m.content.length > 100 ? '...' : '')
            })));
            
            // 使用后端代理发送请求 - 采用防御式解析
            try {
                const res = await fetch(`${API_BASE}/chat/proxy`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(requestBody)
                });

                if (!res.ok) {
                    const errText = await res.text();
                    console.error('[callAI] ❌ API 请求失败');
                    console.error('[callAI] 状态码:', res.status);
                    console.error('[callAI] 错误响应:', errText);
                    
                    try {
                        const errJson = JSON.parse(errText);
                        console.error('[callAI] 解析后的错误:', errJson);
                        if (errJson.error) {
                            const errorMsg = `AI请求失败 (${res.status}): ${errJson.error}${errJson.details ? '\n详情: ' + errJson.details : ''}`;
                            throw new Error(errorMsg);
                        }
                    } catch(parseErr) {
                        // 如果不是 JSON 格式的错误
                        if (parseErr instanceof SyntaxError) {
                            console.error('[callAI] 错误响应不是 JSON 格式');
                        }
                    }
                    
                    throw new Error(`API 请求失败: ${res.status} - ${errText.substring(0, 200)}`);
                }

                // ✅ 关键改动：先获取原始文本，而不是直接 .json()
                rawText = await res.text();
                
                // 尝试解析为 JSON
                let data;
                try {
                    data = JSON.parse(rawText);
                } catch (parseErr) {
                    // 返回的不是 JSON（可能是 HTML 错误页、纯文本等）
                    console.warn('[callAI] 返回内容不是有效的 JSON，直接使用原始文本');
                    console.log('[callAI] 原始返回:', rawText.substring(0, 500));
                    
                    // 直接返回原始文本（去除 HTML 标签和特殊字符）
                    return rawText
                        .replace(/<[^>]*>/g, '') // 移除 HTML 标签
                        .replace(/[◇◆★☆●○■□▲△]/g, '') // 移除装饰字符
                        .trim();
                }
                
                // ✅ 兼容多种返回路径
                const content = 
                    data?.choices?.[0]?.message?.content ??  // OpenAI 标准格式
                    data?.choices?.[0]?.text ??              // 一些旧版 API
                    data?.output_text ??                     // 一些自定义格式
                    data?.message ??                         // 简化格式
                    data?.content ??                         // 直接返回内容
                    data?.reply ??                           // 自定义字段
                    '';
                
                if (!content) {
                    // 如果所有路径都没有内容，尝试直接使用原始文本
                    console.warn('[callAI] 无法从标准路径提取内容，尝试使用原始返回');
                    console.log('[callAI] 解析后的数据结构:', JSON.stringify(data).substring(0, 300));
                    
                    // 如果data本身就是字符串，直接返回
                    if (typeof data === 'string') {
                        return data;
                    }
                    
                    // 否则返回清理后的原始文本
                    return rawText
                        .replace(/<[^>]*>/g, '')
                        .replace(/[◇◆★☆●○■□▲△]/g, '')
                        .trim() || '(AI 返回为空)';
                }
                
                return content;
                
            } catch (err) {
                console.error("[callAI] 错误详情:", err);
                console.log("[callAI] 原始返回内容:", rawText.substring(0, 500));
                throw err;
            }
        }

        // 生成虚拟身份
        async function generateIdentity() {
            const name = document.getElementById('char-name').value;
            const desc = document.getElementById('char-desc').value;
            
            if (!name) {
                alert("请先输入角色名字");
                return;
            }

            const btnText = document.getElementById('gen-btn-text');
            const spinner = document.getElementById('gen-spinner');
            btnText.style.display = 'none';
            spinner.style.display = 'block';

            try {
                const prompt = `你是一个角色卡辅助工具。请根据角色【${name}】的设定（${desc || '暂无详细描述'}），为他/她生成一套虚拟的现代社会身份信息。
请严格返回纯 JSON 格式数据（不要包含 Markdown 代码块标记），包含以下字段：
- account: 虚拟社交账号（英文+数字）
- password: 登录密码（复杂一点）
- phone: 手机号（必须严格为 7 位数字）
- address: 家庭住址（符合角色背景的虚构地址）
- id_card: 身份证号（必须严格为 9 位数字）
- bank_card: 银行卡号（必须严格为 8 位数字）
- bank_password: 银行卡密码（必须严格为 4 位数字）`;

                const content = await callAI([
                    { role: "system", content: "你是一个只输出 JSON 的数据生成助手。" },
                    { role: "user", content: prompt }
                ]);

                const data = extractAndParseJSON(content);
                if (!data) throw new Error("无法解析 AI 返回的 JSON 数据");
                
                // 填入表单
                document.getElementById('char-identity-account').value = data.account || '';
                document.getElementById('char-identity-password').value = data.password || '';
                document.getElementById('char-identity-phone').value = data.phone || '';
                document.getElementById('char-identity-address').value = data.address || '';
                document.getElementById('char-identity-id').value = data.id_card || '';
                document.getElementById('char-identity-bank').value = data.bank_card || '';
                document.getElementById('char-identity-bank-pass').value = data.bank_password || '';

            } catch (err) {
                console.error(err);
                alert("生成失败: " + err.message);
            } finally {
                btnText.style.display = 'inline';
                spinner.style.display = 'none';
            }
        }

        async function deleteCharacter() {
            if (!editingCharId) return;
            if (confirm("确定要删除这个角色吗？")) {
                await db.characters.delete(editingCharId);
                hideCharacterEditor();
                loadCharacterList();
            }
        }

        // 辅助函数：自动导入内嵌的世界书
        async function importCharacterBook(bookData, charName) {
            if (!bookData) return null;
            
            try {
                const bookName = bookData.name || `${charName}的世界书`;
                
                // 存入 lorebooks 表
                const id = await db.lorebooks.add({
                    name: bookName,
                    content: bookData,
                    created_at: Date.now()
                });
                
                return id;
            } catch (e) {
                console.error("导入世界书失败", e);
                return null;
            }
        }

        // 导入角色 (JSON 或 PNG)
        function importCharacterFile(input) {
            const file = input.files[0];
            if (!file) return;
            
            if (file.type.includes('image') || file.name.endsWith('.png')) {
                // 处理 PNG
                const reader = new FileReader();
                reader.onload = async (e) => {
                    try {
                        // 1. 先尝试当做图片读取显示
                        const avatarBase64 = e.target.result;
                        
                        // 2. 解析 PNG 元数据中的 JSON
                        const arrayBuffer = await file.arrayBuffer();
                        const jsonStr = extractPngText(new Uint8Array(arrayBuffer));
                        
                        if (!jsonStr) {
                            alert("未在这张图片中找到角色数据 (tEXt chunk)");
                            createNewCharacter();
                            document.getElementById('char-avatar-preview').style.backgroundImage = `url(${avatarBase64})`;
                            document.getElementById('char-avatar-placeholder').style.display = 'none';
                            input.value = '';
                            return;
                        }
                        
                        const json = JSON.parse(jsonStr);
                        // 处理不同格式 (TavernAI V1/V2)
                        let charData = {};
                        if (json.data) {
                            // V2 spec
                            charData = json.data;
                        } else {
                            // V1 或直接结构
                            charData = json;
                        }
                        
                        // 尝试导入世界书
                        let lorebookId = null;
                        if (charData.character_book) {
                             lorebookId = await importCharacterBook(charData.character_book, charData.name);
                        }
                        
                        // 存入 DB
                        await db.characters.add({
                            name: charData.name || '未命名',
                            nick: charData.nickname || '', 
                            description: charData.description || charData.personality || '', 
                            type: currentCharacterType, 
                            avatar: avatarBase64,
                            original_data: json,
                            lorebookIds: lorebookId ? [lorebookId] : null, // 关联世界书ID数组
                            lorebookId: lorebookId, // 兼容字段
                            updated_at: Date.now()
                        });
                        
                        let msg = `✅ 成功导入角色: ${charData.name}`;
                        if (lorebookId) msg += `\n📚 并自动导入了世界书`;
                        alert(msg);
                        loadCharacterList();
                        
                    } catch (err) {
                        console.error(err);
                        alert("解析 PNG 失败: " + err.message);
                    }
                };
                reader.readAsDataURL(file);
                
            } else {
                // 处理 JSON
                const reader = new FileReader();
                reader.onload = async (e) => {
                    try {
                        const json = JSON.parse(e.target.result);
                        // 兼容性处理
                        let charData = json;
                        if (json.data) charData = json.data; // Spec V2
                        
                        // 尝试导入世界书
                        let lorebookId = null;
                        if (charData.character_book) {
                             lorebookId = await importCharacterBook(charData.character_book, charData.name);
                        }
                        
                        await db.characters.add({
                            name: charData.name || '未命名',
                            nick: charData.nickname || '',
                            description: charData.description || charData.personality || '',
                            type: currentCharacterType,
                            avatar: '', 
                            original_data: json,
                            lorebookId: lorebookId, // 关联世界书ID
                            updated_at: Date.now()
                        });
                        
                        let msg = `✅ 成功导入角色: ${charData.name}`;
                        if (lorebookId) msg += `\n📚 并自动导入了世界书`;
                        alert(msg);
                        loadCharacterList();
                    } catch (err) {
                        alert("JSON 解析失败: " + err.message);
                    }
                };
                reader.readAsText(file);
            }
            input.value = '';
        }

        // 简易 PNG tEXt 提取器 (修复中文乱码版)
        function extractPngText(uint8Array) {
            // PNG Header: 89 50 4E 47 0D 0A 1A 0A
            let offset = 8;
            const textDecoder = new TextDecoder();
            
            while (offset < uint8Array.length) {
                // 读取 Chunk Length (4 bytes, Big Endian)
                const length = (uint8Array[offset] << 24) | (uint8Array[offset+1] << 16) | (uint8Array[offset+2] << 8) | uint8Array[offset+3];
                offset += 4;
                
                // 读取 Chunk Type (4 bytes)
                const type = String.fromCharCode(...uint8Array.slice(offset, offset + 4));
                offset += 4;
                
                if (type === 'tEXt') {
                    const data = uint8Array.slice(offset, offset + length);
                    // tEXt 格式: Keyword + null separator + Text string
                    // 查找 null separator (0x00)
                    let nullIndex = -1;
                    for (let i = 0; i < length; i++) {
                        if (data[i] === 0) {
                            nullIndex = i;
                            break;
                        }
                    }
                    
                    if (nullIndex > -1) {
                        const keyword = textDecoder.decode(data.slice(0, nullIndex));
                        const textBytes = data.slice(nullIndex + 1);
                        const text = textDecoder.decode(textBytes);
                        
                        if (keyword === 'chara') {
                            // TavernAI 格式通常是 Base64 编码的 JSON
                            try {
                                // 修复乱码的关键步骤：
                                // 1. atob 解码 base64 -> binary string
                                const binaryString = atob(text);
                                // 2. binary string -> Uint8Array
                                const bytes = new Uint8Array(binaryString.length);
                                for (let i = 0; i < binaryString.length; i++) {
                                    bytes[i] = binaryString.charCodeAt(i);
                                }
                                // 3. TextDecoder 解码 utf-8
                                const decoded = new TextDecoder('utf-8').decode(bytes);
                                return decoded;
                            } catch (e) {
                                // 也许不是 Base64，或者解码失败，直接返回原始文本
                                return text;
                            }
                        }
                    }
                }
                
                // 跳过 Data 和 CRC (4 bytes)
                offset += length + 4;
                
                if (type === 'IEND') break;
            }
            return null;
        }

        // --- 世界书 (Lorebook) 逻辑 ---
function showLorebookPage() {
    document.getElementById('lorebook-page').style.display = 'flex';
    loadLorebookList();
}

        function hideLorebookPage() {
            const page = document.getElementById('lorebook-page');
            page.style.transform = 'scale(0.95)';
            page.style.opacity = '0';
            setTimeout(() => {
                page.style.display = 'none';
                page.style.transform = ''; 
                page.style.opacity = '';
            }, 200);
        }

        async function loadLorebookList() {
            const list = await db.lorebooks.toArray();
            const container = document.getElementById('lorebook-list');
            container.innerHTML = '';
            
            if (list.length === 0) {
                container.innerHTML = `
                    <div style="text-align:center; color:#999; margin-top:40px; font-size:14px; display:flex; flex-direction:column; align-items:center; gap:10px;">
                        <svg class="svg-icon" style="width:40px; height:40px; stroke:#ccc;" viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
                        <div>空空如也<br>点击上方导入或新建</div>
                    </div>
                `;
                return;
            }

            list.forEach(book => {
                const count = book.content && book.content.entries ? Object.keys(book.content.entries).length : 0;
                
                const div = document.createElement('div');
                div.className = 'lorebook-card';
                div.innerHTML = `
                    <div class="lorebook-info">
                        <h3>${book.name}</h3>
                        <p>${count} 个词条</p>
                    </div>
                    <div class="lorebook-actions">
                        <div class="lorebook-btn lb-edit" onclick="editLorebook(${book.id})">编辑</div>
                        <div class="lorebook-btn lb-del" onclick="deleteLorebook(${book.id})">删除</div>
                    </div>
                `;
                container.appendChild(div);
            });
        }

        // 导入 SillyTavern 格式 JSON
        function importLorebookFile(input) {
            const file = input.files[0];
            if (!file) return;
            
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const json = JSON.parse(e.target.result);
                    // 简单的格式校验：通常有 entries
                    if (!json.entries && !Array.isArray(json)) {
                        if(!confirm("这似乎不是标准的 SillyTavern 格式，确定要导入吗？")) {
                            input.value = '';
                            return;
                        }
                    }
                    
                    // 提取名字：文件名去后缀，或者 json 里的 name 字段
                    let name = file.name.replace('.json', '');
                    if (json.name) name = json.name;

                    await db.lorebooks.add({
                        name: name,
                        content: json,
                        created_at: Date.now()
                    });
                    
                    alert(`✅ 成功导入: ${name}`);
                    loadLorebookList();
                } catch (err) {
                    alert('❌ JSON 解析失败: ' + err.message);
                }
            };
            reader.readAsText(file);
            input.value = '';
        }

        async function createNewLorebook() {
            const name = prompt("请输入新世界书名称：", "新世界书");
            if (!name) return;
            
            // 初始化空结构
            const newBook = {
                entries: {}
            };
            
            await db.lorebooks.add({
                name: name,
                content: newBook,
                created_at: Date.now()
            });
            loadLorebookList();
        }

        async function deleteLorebook(id) {
            if (confirm("确定要删除这本世界书吗？此操作无法撤销。")) {
                await db.lorebooks.delete(id);
                loadLorebookList();
            }
        }

        // 全局变量：当前操作的世界书ID和词条ID
        let currentBookId = null;
        let currentEntryId = null;

        function editLorebook(id) {
            showLorebookDetail(id);
        }

        // 显示世界书详情 (词条列表)
        async function showLorebookDetail(id) {
            currentBookId = id;
            const book = await db.lorebooks.get(id);
            if (!book) return;

            document.getElementById('lb-detail-title').innerText = book.name;
            document.getElementById('lb-detail-page').style.display = 'flex';
            
            renderEntryList(book.content.entries);
        }

        function hideLorebookDetail() {
            const page = document.getElementById('lb-detail-page');
            page.style.display = 'none';
            currentBookId = null;
        }

        // 渲染词条列表
        function renderEntryList(entries) {
            const container = document.getElementById('lb-entry-list');
            container.innerHTML = '';
            
            if (!entries || Object.keys(entries).length === 0) {
                container.innerHTML = `<div style="text-align:center; color:#999; margin-top:40px;">暂无词条</div>`;
                return;
            }

            // 按 key 排序 (通常是数字索引，但也可能是随机字符串)
            const keys = Object.keys(entries).sort((a,b) => parseInt(a) - parseInt(b));

            keys.forEach(key => {
                const entry = entries[key];
                const title = entry.comment || entry.key?.join(', ') || `词条 #${key}`;
                const keysText = entry.key ? entry.key.join(', ') : '无关键字';
                
                const div = document.createElement('div');
                div.className = 'lb-entry-item';
                div.onclick = () => showEntryEditor(currentBookId, key);
                div.innerHTML = `
                    <div style="flex:1; overflow:hidden;">
                        <div class="lb-entry-title">${title}</div>
                        <div class="lb-entry-keys">${keysText}</div>
                    </div>
                    <div style="color:#c7c7cc;">›</div>
                `;
                container.appendChild(div);
            });
        }

        // 显示词条编辑器
        async function showEntryEditor(bookId, entryId) {
            currentEntryId = entryId;
            const page = document.getElementById('lb-entry-page');
            const titleDom = document.getElementById('lb-entry-title');
            const keysInput = document.getElementById('entry-keys');
            const contentInput = document.getElementById('entry-content');
            
            // 清空输入
            keysInput.value = '';
            contentInput.value = '';

            if (entryId !== null) {
                // 编辑现有词条
                titleDom.innerText = "编辑词条";
                const book = await db.lorebooks.get(bookId);
                const entry = book.content.entries[entryId];
                if (entry) {
                    keysInput.value = entry.key ? entry.key.join(', ') : '';
                    contentInput.value = entry.content || '';
                }
            } else {
                // 新建词条
                titleDom.innerText = "新建词条";
            }

            page.style.display = 'flex';
        }

        function hideEntryEditor() {
            document.getElementById('lb-entry-page').style.display = 'none';
            currentEntryId = null;
        }

        // 保存词条
        async function saveEntry() {
            if (!currentBookId) return;

            const keysStr = document.getElementById('entry-keys').value.trim();
            const content = document.getElementById('entry-content').value;
            
            // 简单的校验
            if (!content && !keysStr) {
                alert("请填写内容或关键字");
                return;
            }

            // 处理关键字数组
            const keys = keysStr.split(/[,，]/).map(k => k.trim()).filter(k => k);

            try {
                const book = await db.lorebooks.get(currentBookId);
                if (!book) return;

                // 确保 entries 对象存在
                if (!book.content.entries) book.content.entries = {};

                let entryId = currentEntryId;
                if (entryId === null) {
                    // 生成新ID：找到最大ID + 1
                    const existingIds = Object.keys(book.content.entries).map(k => parseInt(k)).filter(n => !isNaN(n));
                    const maxId = existingIds.length > 0 ? Math.max(...existingIds) : -1;
                    entryId = (maxId + 1).toString();
                }

                // 构造词条对象 (保留其他未修改字段如果存在)
                const oldEntry = book.content.entries[entryId] || {};
                book.content.entries[entryId] = {
                    ...oldEntry,
                    uid: oldEntry.uid !== undefined ? oldEntry.uid : entryId, // SillyTavern 常用 uid
                    key: keys,
                    content: content,
                    comment: keys[0] || `词条 #${entryId}`, // 用第一个关键字做注释名
                    enabled: true
                };

                await db.lorebooks.put(book);
                
                // 刷新列表并关闭编辑器
                renderEntryList(book.content.entries);
                hideEntryEditor();

            } catch (err) {
                alert("保存失败: " + err.message);
            }
        }

        // 删除词条
        async function deleteEntry() {
            if (!currentBookId || currentEntryId === null) return;
            
            if (!confirm("确定要删除此词条吗？")) return;

            try {
                const book = await db.lorebooks.get(currentBookId);
                if (book && book.content.entries) {
                    delete book.content.entries[currentEntryId];
                    await db.lorebooks.put(book);
                    
                    renderEntryList(book.content.entries);
                    hideEntryEditor();
                }
            } catch (err) {
                alert("删除失败: " + err.message);
            }
        }

        async function exportLorebook(id) {
            const book = await db.lorebooks.get(id);
            if (!book) return;
            
            const blob = new Blob([JSON.stringify(book.content, null, 2)], {type: 'application/json'});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${book.name}.json`;
            a.click();
            URL.revokeObjectURL(url);
        }

        // 核心：从DEXie恢复所有设置
        async function restoreSetting() {
            // 获取所有存储的数据
            const allData = await db.dexiData.toArray();
            const dataMap = {};
            allData.forEach(item => {
                dataMap[item.key] = item.value;
            });
            
            // API 配置无需在首页显示，只在展开时加载

            // 恢复壁纸
            if (dataMap.wallpaper) document.getElementById('desktop-body').style.backgroundImage = `url(${dataMap.wallpaper})`;
            // 恢复小组件
            if (dataMap.widgetIcon) document.getElementById('widget-icon').style.backgroundImage = `url(${dataMap.widgetIcon})`;
            if (dataMap.widgetTitle) document.getElementById('widget-title').innerText = dataMap.widgetTitle;
            if (dataMap.widgetSubtext) document.getElementById('widget-subtext').innerText = dataMap.widgetSubtext;
            // 恢复拍立得
            if (dataMap.photoLeft) document.getElementById('img-left').style.backgroundImage = `url(${dataMap.photoLeft})`;
            if (dataMap.photoRight) document.getElementById('img-right').style.backgroundImage = `url(${dataMap.photoRight})`;
            // 恢复头像
            if (dataMap.avatar1) {
                const img1 = document.getElementById('avatar-img-1');
                img1.style.backgroundImage = `url(${dataMap.avatar1})`;
                img1.classList.add('has-image');
            }
            if (dataMap.avatar2) {
                const img2 = document.getElementById('avatar-img-2');
                img2.style.backgroundImage = `url(${dataMap.avatar2})`;
                img2.classList.add('has-image');
            }
            if (dataMap.avatar1Bubble) document.getElementById('avatar-bubble1').innerText = dataMap.avatar1Bubble;
            if (dataMap.avatar1Name) document.getElementById('avatar-name1').innerText = dataMap.avatar1Name;
            if (dataMap.avatar2Bubble) document.getElementById('avatar-bubble2').innerText = dataMap.avatar2Bubble;
            if (dataMap.avatar2Name) document.getElementById('avatar-name2').innerText = dataMap.avatar2Name;
            // 恢复倒数日
            if (dataMap.daysText) document.getElementById('days-text').innerText = dataMap.daysText;
            // 恢复应用图标
            const iconIds = ['setting','notes','remind','facetime','calendar','photo','camera'];
            iconIds.forEach(id => {
                const key = `icon${id.charAt(0).toUpperCase() + id.slice(1)}`;
                if (dataMap[key]) document.getElementById(`icon-${id}`).querySelector('.icon').style.backgroundImage = `url(${dataMap[key]})`;
            });
            // 恢复Dock图标
            const dockIds = ['setting','custom','message','music'];
            dockIds.forEach(id => {
                const key = `dock${id.charAt(0).toUpperCase() + id.slice(1)}`;
                if (dataMap[key]) document.getElementById(`dock-${id}`).querySelector('.icon').style.backgroundImage = `url(${dataMap[key]})`;
            });
            
        // 恢复椭圆形颜色
        if (dataMap.capsuleColor) {
            document.documentElement.style.setProperty('--capsule-bg', dataMap.capsuleColor);
        }
        if (dataMap.bubbleColor) {
            document.documentElement.style.setProperty('--bubble-bg', dataMap.bubbleColor);
        }
    }

// --- 全局表情包管理逻辑 ---
function showStickerPage() {
    console.log('[showStickerPage] Function called');
    const page = document.getElementById('sticker-page');
    console.log('[showStickerPage] sticker-page element:', page);
    if (!page) {
        console.error('[showStickerPage] sticker-page element not found');
        return;
    }
    console.log('[showStickerPage] Setting display to flex and ensuring position fixed');
    // 确保页面是 fixed 定位并显示
    page.style.position = 'fixed';
    page.style.top = '0';
    page.style.left = '0';
    page.style.width = '100vw';
    page.style.height = '100vh';
    page.style.zIndex = '200';
    page.style.display = 'flex';
    console.log('[showStickerPage] Calling renderStickerCategories');
    // 确保显示列表视图
    const listView = document.getElementById('sticker-list-view');
    const detailView = document.getElementById('sticker-detail-view');
    if (listView) listView.style.display = 'block';
    if (detailView) detailView.style.display = 'none';
    currentStickerCategoryId = null;
    renderStickerCategories();
    console.log('[showStickerPage] Done');
}
// 确保函数在全局作用域可访问
window.showStickerPage = showStickerPage;

function hideStickerPage() {
    const page = document.getElementById('sticker-page');
    if (!page) {
        console.error('sticker-page element not found');
        return;
    }
    page.style.transform = 'scale(0.95)';
    page.style.opacity = '0';
    setTimeout(() => {
        page.style.display = 'none';
        page.style.transform = ''; 
        page.style.opacity = '';
    }, 200);
}
// 确保函数在全局作用域可访问
window.hideStickerPage = hideStickerPage;

async function renderStickerCategories() {
    const list = await db.sticker_categories.toArray();
    const listContainer = document.getElementById('sticker-category-list');
    
    if (!listContainer) {
        console.error('sticker-category-list element not found');
        return;
    }
    
    // 如果没有分类，显示空状态
    if (list.length === 0) {
        listContainer.innerHTML = `
            <div class="sticker-empty-state">
                <svg class="svg-icon" style="width:64px; height:64px; stroke:#e5e5ea;" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><path d="M8 14s1.5 2 4 2 4-2 4-2"></path><line x1="9" y1="9" x2="9.01" y2="9"></line><line x1="15" y1="9" x2="15.01" y2="9"></line></svg>
                <div style="color:#999; margin-top:16px;">暂无表情包分类</div>
                <button onclick="showCreateCategoryModal()" style="margin-top:20px; padding:8px 20px; background:var(--ins-pink); color:#fff; border:none; border-radius:20px; font-size:14px;">新建分类</button>
                <div style="margin-top:10px;">
                    <input type="file" id="import-sticker-json" accept=".json" style="display:none" onchange="importStickerCategory(this)">
                    <button onclick="document.getElementById('import-sticker-json').click()" style="padding:8px 20px; background:#f2f2f7; color:#333; border:none; border-radius:20px; font-size:14px;">导入配置</button>
                </div>
            </div>
        `;
        return;
    }

    // 渲染分类列表
    listContainer.innerHTML = list.map(cat => {
        const stickerCount = (cat.stickers || []).length;
        return `
            <div class="sticker-category-item" onclick="openStickerCategoryDetail(${cat.id})">
                <div style="flex:1;">
                    <div style="font-size:16px; font-weight:500; color:#333; margin-bottom:4px;">${cat.name}</div>
                    <div style="font-size:12px; color:#999;">${stickerCount} 个表情</div>
                </div>
                <div style="display:flex; gap:8px; align-items:center;">
                    <div class="sticker-category-action" onclick="event.stopPropagation(); exportStickerCategory(${cat.id})" style="padding:6px 12px; background:var(--ins-pink-light); color:var(--ins-pink); border-radius:6px; font-size:12px;">导出</div>
                    <div class="sticker-category-action" onclick="event.stopPropagation(); deleteStickerCategory(${cat.id})" style="padding:6px 12px; background:#ffe5e5; color:#ff3b30; border-radius:6px; font-size:12px;">删除</div>
                    <svg class="svg-icon" style="width:16px; height:16px; color:#ccc;" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"></polyline></svg>
                </div>
            </div>
        `;
    }).join('');
}

// 打开分类详情页
async function openStickerCategoryDetail(id) {
    currentStickerCategoryId = id;
    const listView = document.getElementById('sticker-list-view');
    const detailView = document.getElementById('sticker-detail-view');
    
    if (listView) listView.style.display = 'none';
    if (detailView) detailView.style.display = 'block';
    
    await renderStickerCategoryDetail();
}

// 返回分类列表
function backToStickerList() {
    const listView = document.getElementById('sticker-list-view');
    const detailView = document.getElementById('sticker-detail-view');
    
    if (listView) listView.style.display = 'block';
    if (detailView) detailView.style.display = 'none';
    
    currentStickerCategoryId = null;
    renderStickerCategories();
}

// 渲染分类详情
async function renderStickerCategoryDetail() {
    if (!currentStickerCategoryId) return;
    
    const cat = await db.sticker_categories.get(currentStickerCategoryId);
    if (!cat) return;
    
    const titleEl = document.getElementById('sticker-detail-title');
    const contentEl = document.getElementById('sticker-detail-content');
    
    if (titleEl) titleEl.innerText = cat.name;
    if (!contentEl) return;
    
    contentEl.innerHTML = `
        <div style="padding: 16px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; padding:12px; background:#f9f9f9; border-radius:12px;">
                <div>
                    <div style="font-size:14px; color:#999; margin-bottom:4px;">表情数量</div>
                    <div style="font-size:20px; font-weight:600; color:#333;">${(cat.stickers || []).length}</div>
                </div>
                <div style="display:flex; gap:10px; flex-wrap:wrap;">
                    <button onclick="exportStickerCategory(${cat.id})" style="padding:8px 16px; background:var(--ins-pink-light); color:var(--ins-pink); border:none; border-radius:8px; font-size:14px; font-weight:500;">导出</button>
                    <input type="file" id="import-sticker-json-detail" accept=".json" style="display:none" onchange="importStickerCategory(this)">
                    <button onclick="document.getElementById('import-sticker-json-detail').click()" style="padding:8px 16px; background:#f2f2f7; color:#666; border:none; border-radius:8px; font-size:14px; font-weight:500;">导入</button>
                    <input type="file" id="batch-import-sticker-txt" accept=".txt,.text,.md" style="display:none" onchange="batchImportStickersFromText(this)">
                    <button onclick="document.getElementById('batch-import-sticker-txt').click()" style="padding:8px 16px; background:#e8f5e9; color:#2e7d32; border:none; border-radius:8px; font-size:14px; font-weight:500;" title="支持.txt/.md文件，格式：描述：图片链接">批量导入</button>
                </div>
            </div>
            
            <div class="sticker-grid-view">
                <!-- 添加按钮 -->
                <div class="sticker-grid-item add-btn" onclick="showAddStickerModal()">
                    <svg class="svg-icon" style="width:24px; height:24px;" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    <div style="font-size:12px; color:#999; margin-top:8px;">添加表情</div>
                </div>
                ${(cat.stickers || []).map((s, idx) => `
                    <div class="sticker-grid-item" onclick="previewSticker(${idx})">
                        <div class="sticker-img" style="background-image:url(${s.url})"></div>
                        ${s.description ? `<div class="sticker-desc-tag">AI可识</div>` : ''}
                        <div class="sticker-del-btn" onclick="deleteSticker(${idx}, event)">
                            <svg style="width:12px; height:12px; stroke:#fff; stroke-width:2;" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

// 显示创建分类弹窗
function showCreateCategoryModal() {
    const name = prompt("请输入分类名称", "我的表情");
    if (name && name.trim()) {
        createNewStickerCategory(name.trim());
    }
}

async function createNewStickerCategory(name) {
    try {
        const id = await db.sticker_categories.add({
            name: name,
            stickers: []
        });
        renderStickerCategories();
    } catch (err) {
        console.error('创建分类失败:', err);
        alert('创建分类失败，请重试');
    }
}

async function deleteStickerCategory(id) {
    if (confirm("确定要删除这个分类吗？删除后无法恢复！")) {
        try {
            await db.sticker_categories.delete(id);
            if (currentStickerCategoryId === id) {
                // 如果删除的是当前查看的分类，返回列表
                backToStickerList();
            } else {
                renderStickerCategories();
            }
        } catch (err) {
            console.error('删除分类失败:', err);
            alert('删除失败，请重试');
        }
    }
}

    // 显示添加表情弹窗
    function showAddStickerModal() {
        const modal = document.createElement('div');
        modal.className = 'sticker-modal-overlay';
        modal.id = 'add-sticker-modal';
        modal.innerHTML = `
            <div class="sticker-modal-box">
                <h3 style="text-align:center; margin-bottom:20px;">添加表情</h3>
                
                <div style="margin-bottom:16px;">
                    <label style="display:block; color:#666; font-size:14px; margin-bottom:8px;">图片来源</label>
                    <div style="display:flex; gap:10px;">
                        <button onclick="document.getElementById('sticker-file-input').click()" style="flex:1; padding:10px; background:#f5f5f5; border:1px solid #eee; border-radius:8px;">本地上传</button>
                        <input type="file" id="sticker-file-input" accept="image/*" style="display:none" onchange="handleStickerFileSelect(this)">
                    </div>
                    <div id="sticker-preview-area" style="margin-top:10px; height:100px; background:#f9f9f9; border-radius:8px; display:none; align-items:center; justify-content:center; background-size:contain; background-repeat:no-repeat; background-position:center;"></div>
                </div>

                <div style="margin-bottom:16px;">
                    <label style="display:block; color:#666; font-size:14px; margin-bottom:8px;">图片链接 (可选)</label>
                    <input type="text" id="sticker-url-input" placeholder="https://..." style="width:100%; padding:10px; border:1px solid #eee; border-radius:8px; outline:none;" oninput="handleStickerUrlInput(this)">
                </div>

                <div style="margin-bottom:20px;">
                    <label style="display:block; color:#666; font-size:14px; margin-bottom:8px;">描述 (AI识别用)</label>
                    <input type="text" id="sticker-desc-input" placeholder="例如：一只惊讶的白猫" style="width:100%; padding:10px; border:1px solid #eee; border-radius:8px; outline:none;">
                </div>

                <div style="display:flex; gap:10px;">
                    <button onclick="document.getElementById('add-sticker-modal').remove()" style="flex:1; padding:12px; background:#f2f2f7; border:none; border-radius:8px;">取消</button>
                    <button onclick="confirmAddSticker()" style="flex:1; padding:12px; background:var(--ins-pink); color:#white; border:none; border-radius:8px; color:#fff;">添加</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    let tempStickerData = null; // 临时存储上传的 base64 或 URL

    function handleStickerFileSelect(input) {
        const file = input.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = e => {
                tempStickerData = e.target.result;
                const preview = document.getElementById('sticker-preview-area');
                preview.style.display = 'flex';
                preview.style.backgroundImage = `url(${tempStickerData})`;
                document.getElementById('sticker-url-input').value = ''; // 清空URL输入
            };
            reader.readAsDataURL(file);
        }
    }

    function handleStickerUrlInput(input) {
        const url = input.value.trim();
        if (url) {
            tempStickerData = url;
            const preview = document.getElementById('sticker-preview-area');
            preview.style.display = 'flex';
            preview.style.backgroundImage = `url(${url})`;
        }
    }

    async function confirmAddSticker() {
        const desc = document.getElementById('sticker-desc-input').value.trim();
        
        if (!tempStickerData) {
            alert("请先上传图片或输入链接");
            return;
        }
        
        if (!desc) {
             if(!confirm("未填写描述，AI可能无法准确理解这个表情。确定要继续吗？")) return;
        }

        const cat = await db.sticker_categories.get(currentStickerCategoryId);
        if (cat) {
            cat.stickers.push({
                url: tempStickerData,
                description: desc,
                created_at: Date.now()
            });
            await db.sticker_categories.put(cat);
            renderStickerCategoryDetail();
            document.getElementById('add-sticker-modal').remove();
            tempStickerData = null;
        }
    }

async function deleteSticker(index, e) {
    e.stopPropagation();
    if (confirm("删除这张表情？")) {
        const cat = await db.sticker_categories.get(currentStickerCategoryId);
        cat.stickers.splice(index, 1);
        await db.sticker_categories.put(cat);
        renderStickerCategoryDetail();
    }
}

// 预览表情详情（可编辑描述）
async function previewSticker(index) {
    const cat = await db.sticker_categories.get(currentStickerCategoryId);
    const sticker = cat.stickers[index];
    
    const newDesc = prompt("编辑描述 (AI识别用)", sticker.description || "");
    if (newDesc !== null) {
        sticker.description = newDesc;
        await db.sticker_categories.put(cat);
        renderStickerCategoryDetail();
    }
}

    // 导出分类
    async function exportStickerCategory(id) {
        const cat = await db.sticker_categories.get(id);
        const blob = new Blob([JSON.stringify(cat, null, 2)], {type: 'application/json'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `表情包-${cat.name}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

// 导入分类
function importStickerCategory(input) {
    const file = input.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const json = JSON.parse(e.target.result);
            // 简单的格式校验
            if (!json.name || !Array.isArray(json.stickers)) {
                throw new Error("格式不正确");
            }
            
            // 如果当前在详情页，询问是导入为新分类还是替换当前分类
            if (currentStickerCategoryId) {
                const action = confirm(`导入方式：\n确定 = 替换当前分类\n取消 = 创建新分类`);
                if (action) {
                    // 替换当前分类
                    const cat = await db.sticker_categories.get(currentStickerCategoryId);
                    if (cat) {
                        cat.name = json.name;
                        cat.stickers = json.stickers;
                        await db.sticker_categories.put(cat);
                        alert(`成功导入并替换分类：${json.name}`);
                        renderStickerCategoryDetail();
                    }
                } else {
                    // 创建新分类
                    delete json.id;
                    await db.sticker_categories.add(json);
                    alert(`成功导入为新分类：${json.name}`);
                    backToStickerList();
                }
            } else {
                // 在列表页，创建新分类
                delete json.id;
                await db.sticker_categories.add(json);
                alert(`成功导入分类：${json.name}`);
                renderStickerCategories();
            }
        } catch (err) {
            alert("导入失败: " + err.message);
        }
        // 清空input，允许重复导入同一文件
        input.value = '';
    };
    reader.readAsText(file);
}
// 批量导入表情包（从文本文件）
async function batchImportStickersFromText(input) {
    const file = input.files[0];
    if (!file) return;
    
    if (!currentStickerCategoryId) {
        alert('请先选择一个分类');
        input.value = '';
        return;
    }
    
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const text = e.target.result;
            const lines = text.split(/\r?\n/).filter(line => line.trim());
            
            if (lines.length === 0) {
                alert('文件为空或格式不正确');
                input.value = '';
                return;
            }
            
            const stickers = [];
            let successCount = 0;
            let failCount = 0;
            const errors = [];
            
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;
                
                // 解析格式：描述：url 或 描述:url（支持中文和英文冒号）
                const match = line.match(/^(.+?)[：:]\s*(.+)$/);
                if (match) {
                    const description = match[1].trim();
                    const url = match[2].trim();
                    
                    // 验证URL格式
                    if (url && (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:image'))) {
                        stickers.push({
                            url: url,
                            description: description,
                            created_at: Date.now()
                        });
                        successCount++;
                    } else {
                        failCount++;
                        errors.push(`第${i+1}行：URL格式不正确 - ${line}`);
                    }
                } else {
                    // 如果没有冒号，尝试作为纯URL处理
                    if (line.startsWith('http://') || line.startsWith('https://') || line.startsWith('data:image')) {
                        stickers.push({
                            url: line,
                            description: '',
                            created_at: Date.now()
                        });
                        successCount++;
                    } else {
                        failCount++;
                        errors.push(`第${i+1}行：格式不正确 - ${line}`);
                    }
                }
            }
            
            if (stickers.length === 0) {
                alert('未能解析出任何表情包。\n格式应为：描述：图片链接\n例如：一只猫：https://example.com/cat.jpg');
                input.value = '';
                return;
            }
            
            // 添加到分类
            const cat = await db.sticker_categories.get(currentStickerCategoryId);
            if (!cat) {
                alert('分类不存在');
                input.value = '';
                return;
            }
            
            if (!cat.stickers) cat.stickers = [];
            cat.stickers.push(...stickers);
            await db.sticker_categories.put(cat);
            
            // 显示结果
            let message = `✅ 成功导入 ${successCount} 个表情包`;
            if (failCount > 0) {
                message += `\n❌ 失败 ${failCount} 个`;
                if (errors.length <= 5) {
                    message += '\n\n错误详情：\n' + errors.join('\n');
                } else {
                    message += `\n\n前5个错误：\n${errors.slice(0, 5).join('\n')}\n...还有${errors.length - 5}个错误`;
                }
                message += '\n\n提示：格式应为"描述：图片链接"，例如：\n一只猫：https://example.com/cat.jpg';
            }
            
            // 使用更友好的提示方式
            if (failCount === 0) {
                alert(message);
            } else {
                // 如果有错误，使用confirm让用户选择是否查看详情
                const showDetails = confirm(message + '\n\n是否查看详细错误信息？');
                if (showDetails && errors.length > 0) {
                    alert('详细错误信息：\n\n' + errors.join('\n'));
                }
            }
            
            // 刷新页面
            renderStickerCategoryDetail();
            input.value = '';
        } catch (err) {
            console.error('批量导入失败:', err);
            alert('导入失败: ' + err.message);
            input.value = '';
        }
    };
    reader.readAsText(file, 'UTF-8');
}

// 确保函数在全局作用域可访问
window.importStickerCategory = importStickerCategory;
window.openStickerCategoryDetail = openStickerCategoryDetail;
window.backToStickerList = backToStickerList;
window.showCreateCategoryModal = showCreateCategoryModal;
window.batchImportStickersFromText = batchImportStickersFromText;

// 更新聊天面板中的表情列表（在打开面板时调用）
// 注意：用户可以看到所有表情包，但角色只能使用挂载的
async function updateChatStickerPanel() {
    const stickerPanel = document.getElementById('sticker-panel');
    if (!stickerPanel) return;
    
    let html = '';
    
    // 获取所有表情包分类（用户可以看到所有）
    const allCategories = await db.sticker_categories.toArray();
    
    if (allCategories.length === 0) {
        stickerPanel.innerHTML = `<div style="text-align:center; grid-column:span 4; color:#999; margin-top:20px;">暂无表情包<br>请去【我-表情】添加</div>`;
        return;
    }
    
    // 获取当前角色挂载的分类ID（用于限制发送）
    let mountedIds = [];
    if (currentChatCharId) {
        const char = await db.characters.get(currentChatCharId);
        mountedIds = char.mounted_sticker_categories || [];
    }
    
    // 显示所有分类，用户可以看到所有，但标记哪些是挂载的（用于角色发送限制）
    for (const cat of allCategories) {
        if (cat.stickers && cat.stickers.length > 0) {
            const isMounted = mountedIds.includes(cat.id);
            const mountTag = isMounted ? '<span style="font-size:10px; color:#2e7d32; margin-left:4px;">✓已挂载</span>' : '<span style="font-size:10px; color:#999; margin-left:4px;">未挂载</span>';
            html += `<div style="grid-column:1/-1; font-size:12px; color:#999; margin:10px 0 5px; font-weight:500;">${cat.name}${mountTag}</div>`;
            cat.stickers.forEach(s => {
                const safeUrl = s.url.replace(/'/g, "\\'").replace(/"/g, '&quot;');
                // 用户发送：所有表情包都可以点击发送（不限制）
                html += `<div class="emoji-item" onclick="sendGlobalSticker(${cat.id}, '${safeUrl}')" style="background-image:url(${s.url}); background-size:cover; background-position:center; width:60px; height:60px; border-radius:8px; cursor:pointer;"></div>`;
            });
        }
    }
    
    if (html === '') {
        stickerPanel.innerHTML = `<div style="text-align:center; grid-column:span 4; color:#999; margin-top:20px;">暂无表情包<br>请去【我-表情】添加</div>`;
    } else {
        stickerPanel.innerHTML = html;
    }
}

async function sendGlobalSticker(catId, url) {
    // 用户发送表情包：可以发送所有表情包，不需要检查挂载
    // 角色发送表情包：只能发送挂载的（这个限制在角色自动回复时检查）
    if (!currentChatCharId) {
        alert('请先选择一个聊天对象');
        return;
    }
    
    let char = await db.characters.get(currentChatCharId);
    
    // 查找描述
    let desc = '';
    const cat = await db.sticker_categories.get(catId);
    if (cat) {
        const s = cat.stickers.find(sticker => sticker.url === url);
        if (s) desc = s.description;
    }
    
    // 发送逻辑
    const msgContent = `[img:${url}]`; // 图片显示内容
    // 我们需要把 description 附带在消息里吗？
    // 标准做法：User 发送图片，AI 只能看到 [img:...]
    // 为了让 AI 识别，我们可以把 description 作为 system prompt 的一部分，或者 hidden text
    // 方案：在 msgContent 里增加 hidden tag，例如 [img:url|desc:描述]
    // 但渲染时要去掉。
    // 或者，我们在 chat_history 存对象时，增加一个字段 `imageDescription`
    
    // 发送消息
    if (!char.chat_history) char.chat_history = [];
    
    char.chat_history.push({
        role: 'user',
        content: msgContent,
        imageDescription: desc, // 新增字段：图片描述
        time: Date.now()
    });
    
    await db.characters.put(char);
    appendMessageToUI('user', msgContent);
    closeChatPanel();
    
    // ✅ 不再自动触发 AI 回复，需要用户点击"接受回复"按钮
    // triggerAiReply();
}

// --- 桌面图标拖拽逻辑 ---
let desktopSortable = null;

function initDesktopDrag() {
    const grid = document.getElementById('app-grid');
    if (!grid) return;

    // 检测是否是移动设备
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

    desktopSortable = new Sortable(grid, {
        animation: 350, // 动画时长，毫秒 - 稍慢一点更像iOS
        delay: isTouchDevice ? 150 : 0, // 触摸设备长按150ms触发（优化：从300ms缩短到150ms，更灵敏）
        delayOnTouchOnly: true, // 仅在触摸时启用延迟
        touchStartThreshold: 8, // 手指移动超过8px取消长按判定（优化：从5px增加到8px，减少误触取消）
        
        // 关键：使用非原生拖拽，实现更丝滑的 JS 模拟效果
        forceFallback: true, 
        fallbackTolerance: 3, // 鼠标按下移动3px才算拖拽
        fallbackOnBody: true, // 将拖拽元素追加到 body，避免 overflow 问题
        
        ghostClass: 'sortable-ghost', // 占位符样式类 (拖拽原位置的虚影)
        dragClass: 'sortable-drag',   // 拖拽中元素样式类 (跟随鼠标的那个)
        chosenClass: 'sortable-chosen', // 选中项样式
        
        easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", // iOS 风格缓动

        // 滚动配置优化
        scroll: true, 
        scrollSensitivity: 60, // 距离边缘多少像素开始滚动
        scrollSpeed: 15, // 滚动速度
        
        onStart: function (evt) {
            // 震动反馈
            if (navigator.vibrate) navigator.vibrate(50);
            // 拖拽开始时，给 body 添加类以便控制全局光标
            document.body.classList.add('dragging-mode');
        },
        onEnd: function (evt) {
            saveDesktopOrder();
            document.body.classList.remove('dragging-mode');
        }
    });
}

async function saveDesktopOrder() {
    const grid = document.getElementById('app-grid');
    // 获取当前顺序的所有子元素ID
    const order = Array.from(grid.children)
        .map(child => child.id)
        .filter(id => id); // 过滤掉没有ID的元素
    
    // 保存到 Dexie
    try {
        await db.dexiData.put({ key: 'desktopOrder', value: JSON.stringify(order) });
        console.log('[Desktop] Order saved');
    } catch (e) {
        console.error('[Desktop] Failed to save order', e);
    }
}

async function restoreDesktopOrder() {
    try {
        const record = await db.dexiData.get('desktopOrder');
        if (!record || !record.value) return;
        
        const order = JSON.parse(record.value);
        const grid = document.getElementById('app-grid');
        if (!grid) return;
        
        // 创建现有元素的映射
        const elements = {};
        Array.from(grid.children).forEach(el => {
            if (el.id) elements[el.id] = el;
        });
        
        // 创建文档片段以优化性能
        const fragment = document.createDocumentFragment();
        
        // 按保存的顺序重新添加
        order.forEach(id => {
            const el = elements[id];
            if (el) {
                fragment.appendChild(el);
                delete elements[id]; // 标记已处理
            }
        });
        
        // 添加剩余的元素（如果有新增的图标）
        Object.values(elements).forEach(el => {
            fragment.appendChild(el);
        });
        
        grid.appendChild(fragment);
        console.log('[Desktop] Order restored');
    } catch (e) {
        console.error('[Desktop] Failed to restore desktop order', e);
    }
}

/* =================
   服务页面逻辑 (优化动画版)
   ================= */

function showServicePage() {
    const page = document.getElementById('service-main-page');
    page.style.display = 'flex';
    page.offsetHeight; 
    page.classList.add('slide-in');
}

function hideServicePage() {
    const page = document.getElementById('service-main-page');
    page.classList.remove('slide-in');
}

// --- 朋友圈逻辑 ---
let momentsScrollInit = false;

async function showMomentsPage() {
    const page = document.getElementById('moments-page');
    page.style.display = 'block'; // 朋友圈页面是 block 布局
    page.offsetHeight; 
    page.classList.add('slide-in');
    
    // 初始化滚动监听
    if (!momentsScrollInit) {
        initMomentsScroll();
        momentsScrollInit = true;
    }
    
    // 渲染用户信息和封面
    await renderMomentsUserInfo();
    
    // 渲染列表
    await renderMomentsList();
}

function hideMomentsPage() {
    const page = document.getElementById('moments-page');
    page.classList.remove('slide-in');
    setTimeout(() => {
        page.style.display = 'none';
    }, 300);
}

function initMomentsScroll() {
    const page = document.getElementById('moments-page');
    const navBar = document.getElementById('moments-nav-bar');
    
    page.addEventListener('scroll', () => {
        if (page.scrollTop > 200) {
            navBar.classList.add('scrolled');
        } else {
            navBar.classList.remove('scrolled');
        }
    });
}

async function renderMomentsUserInfo() {
    // 获取当前 User
    let user = null;
    if (currentMyCharId) {
        user = await db.characters.get(parseInt(currentMyCharId));
    }
    
    // 如果没有 User，尝试找一个
    if (!user) {
        const users = await db.characters.where('type').equals('user').toArray();
        if (users.length > 0) user = users[0];
    }
    
    const nameEl = document.getElementById('moments-user-name');
    const avatarEl = document.getElementById('moments-user-avatar');
    const coverEl = document.getElementById('moments-cover-area');
    
    if (user) {
        nameEl.innerText = user.name;
        if (user.avatar) {
            avatarEl.style.backgroundImage = `url(${user.avatar})`;
        } else {
            avatarEl.style.backgroundColor = '#eee';
        }
        
        // 封面图 (只读取当前账号的数据，实现隔离)
        const cover = user.identity?.cover;
        if (cover) {
            coverEl.style.backgroundImage = `url(${cover})`;
        } else {
            // 如果没设置，显示默认灰色，清空可能存在的旧图
            coverEl.style.backgroundImage = ''; 
        }
    } else {
        nameEl.innerText = "未登录";
        // 未登录时清除封面和头像
        avatarEl.style.backgroundImage = '';
        coverEl.style.backgroundImage = '';
    }
}

async function renderMomentsList() {
    const container = document.getElementById('moments-list');
    container.innerHTML = '';
    
    // 获取当前账号ID
    const currentAccountId = currentMyCharId ? parseInt(currentMyCharId) : null;
    if (!currentAccountId) {
        container.innerHTML = `<div style="text-align:center; color:#ccc; margin-top:100px; font-size:14px;">请先登录账号</div>`;
        return;
    }

    // 获取当前账号的动态（数据隔离）
    let moments = await db.moments
        .filter(m => m.ownerUserId === currentAccountId)
        .toArray();
    
    // 按时间倒序
    moments.sort((a, b) => b.time - a.time);
    
    if (moments.length === 0) {
        container.innerHTML = `<div style="text-align:center; color:#ccc; margin-top:100px; font-size:14px;">暂无动态</div>`;
        return;
    }
    
    // 获取所有角色信息缓存，避免循环查询
    const chars = await db.characters.toArray();
    const charMap = {};
    chars.forEach(c => charMap[c.id] = c);
    
    for (const m of moments) {
        const char = charMap[m.userId]; // userId 可能是 number 或 string
        if (!char) continue;
        
        const div = document.createElement('div');
        div.className = 'moment-item';
        
        // 图片网格 HTML
        let imagesHtml = '';
        if (m.images && m.images.length > 0) {
            let gridClass = 'cols-3';
            if (m.images.length === 1) gridClass = 'cols-1';
            else if (m.images.length === 2 || m.images.length === 4) gridClass = 'cols-2';
            
            imagesHtml = `<div class="moment-grid ${gridClass}">
                ${m.images.map(img => `<div class="moment-img" style="background-image:url(${img})" onclick="previewImage('${img}')"></div>`).join('')}
            </div>`;
        }
        
        // 时间格式化
        const date = new Date(m.time);
        const timeStr = `${date.getMonth()+1}月${date.getDate()}日 ${date.getHours()}:${date.getMinutes().toString().padStart(2,'0')}`;
        
        // 删除按钮 (如果是自己发的)
        const isSelf = (currentMyCharId && parseInt(currentMyCharId) == m.userId);
        const delBtn = isSelf ? `<span class="moment-delete" onclick="deleteMoment(${m.id})">删除</span>` : '';

        // 处理点赞显示
        let likesHtml = '';
        // 检查我是否点赞
        // likes: [{userId, name}]
        const myLikeIndex = (m.likes || []).findIndex(l => l.userId == currentMyCharId);
        const isLiked = myLikeIndex !== -1;
        
        if (m.likes && m.likes.length > 0) {
            const names = m.likes.map(l => l.name);
            likesHtml = names.join('，');
        }

        // 处理评论显示
        let commentsHtml = '';
        if (m.comments && m.comments.length > 0) {
            commentsHtml = m.comments.map(c => `
                <div class="comment-item">
                    <span class="comment-user">${c.name}</span>：<span class="comment-content">${escapeHtml(c.content)}</span>
                </div>
            `).join('');
        }

        const hasLikes = m.likes && m.likes.length > 0;
        const hasComments = m.comments && m.comments.length > 0;
        
        div.innerHTML = `
            <div class="moment-avatar" style="background-image:url(${char.avatar})"></div>
            <div class="moment-content">
                <div class="moment-name">${char.name}</div>
                <div class="moment-text">${escapeHtml(m.content || '')}</div>
                ${imagesHtml}
                <div class="moment-meta">
                    <div style="display:flex; align-items:center;">
                        <span class="moment-time">${timeStr}</span>
                        ${delBtn}
                    </div>
                    <div class="moment-action-area">
                        <!-- 弹出菜单 -->
                        <div class="moment-popup-menu ins-style" id="moment-menu-${m.id}">
                            <div class="moment-menu-item" onclick="likeMoment(${m.id})">
                                <svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"></path></svg>
                                <span>${isLiked ? '取消' : '赞'}</span>
                            </div>
                            <div class="moment-menu-divider"></div>
                            <div class="moment-menu-item" onclick="commentMoment(${m.id})">
                                <svg viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
                                <span>评论</span>
                            </div>
                        </div>
                        <div class="moment-action-btn" onclick="toggleMomentMenu(${m.id}, event)">
                            <div class="moment-action-dot"></div>
                            <div class="moment-action-dot"></div>
                        </div>
                    </div>
                </div>
                <!-- 互动区 -->
                <div class="moment-interactions" style="display: ${hasLikes || hasComments ? 'block' : 'none'}">
                    <div class="moment-likes" style="display: ${hasLikes ? 'flex' : 'none'}">
                        <svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"></path></svg>
                        <span>${likesHtml}</span>
                    </div>
                    <div class="moment-comments" style="display: ${hasComments ? 'block' : 'none'}">
                        ${commentsHtml}
                    </div>
                </div>
            </div>
        `;
        container.appendChild(div);
    }
}

// 封面更换
function changeMomentsCover() {
    document.getElementById('moments-cover-input').click();
}

function handleCoverChange(input) {
    const file = input.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = async (e) => {
        const base64 = e.target.result;
        document.getElementById('moments-cover-area').style.backgroundImage = `url(${base64})`;
        
        // 保存到当前 User
        if (currentMyCharId) {
            const user = await db.characters.get(parseInt(currentMyCharId));
            if (user) {
                if (!user.identity) user.identity = {};
                user.identity.cover = base64;
                await db.characters.put(user);
            }
        }
        // 同时也存一份本地缓存，作为兜底
        localStorage.setItem('moments_cover', base64);
    };
    reader.readAsDataURL(file);
    input.value = '';
}

// 发布动态逻辑
function showMomentsPublish() {
    document.getElementById('moments-publish-page').style.display = 'block';
    // 清空
    document.getElementById('moments-pub-text').value = '';
    const grid = document.getElementById('moments-pub-grid');
    // 保留添加按钮，移除图片
    Array.from(grid.children).forEach(child => {
        if (!child.classList.contains('moments-add-btn')) {
            child.remove();
        }
    });
    window.tempPubImages = [];
}

function hideMomentsPublish() {
    document.getElementById('moments-publish-page').style.display = 'none';
}

function handlePubImages(input) {
    const files = input.files;
    if (!files || files.length === 0) return;
    
    if (!window.tempPubImages) window.tempPubImages = [];
    
    const grid = document.getElementById('moments-pub-grid');
    const addBtn = grid.querySelector('.moments-add-btn');
    
    Array.from(files).forEach(file => {
        const reader = new FileReader();
        reader.onload = e => {
            const base64 = e.target.result;
            window.tempPubImages.push(base64);
            
            const div = document.createElement('div');
            div.className = 'moments-pub-img';
            div.style.backgroundImage = `url(${base64})`;
            div.innerHTML = `<div class="moments-pub-img-del" onclick="removePubImage(this, '${base64}')">×</div>`;
            
            grid.insertBefore(div, addBtn);
        };
        reader.readAsDataURL(file);
    });
    
    input.value = '';
}

function removePubImage(el, base64) {
    el.parentElement.remove();
    const idx = window.tempPubImages.indexOf(base64);
    if (idx > -1) window.tempPubImages.splice(idx, 1);
}

async function doPublishMoment() {
    if (!currentMyCharId) {
        alert("请先设置 User 身份");
        return;
    }
    
    const text = document.getElementById('moments-pub-text').value.trim();
    const images = window.tempPubImages || [];
    
    if (!text && images.length === 0) {
        alert("写点什么吧...");
        return;
    }
    
    await db.moments.add({
        userId: parseInt(currentMyCharId),
        content: text,
        images: images,
        time: Date.now(),
        ownerUserId: parseInt(currentMyCharId), // 标记所属账号
        likes: [],
        comments: []
    });
    
    hideMomentsPublish();
    renderMomentsList();
    
    // 滚动到顶部
    document.getElementById('moments-page').scrollTop = 0;
}

async function deleteMoment(id) {
    if (confirm("确定删除这条动态吗？")) {
        await db.moments.delete(id);
        renderMomentsList();
    }
}

// 简单的预览图片
function previewImage(url) {
    // 简单全屏预览
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.9);z-index:9999;display:flex;align-items:center;justify-content:center;';
    div.innerHTML = `<img src="${url}" style="max-width:100%;max-height:100%;">`;
    div.onclick = () => div.remove();
    document.body.appendChild(div);
}

// 朋友圈交互逻辑
let activeMomentMenuId = null;

function toggleMomentMenu(id, e) {
    e.stopPropagation(); // 阻止冒泡
    
    // 如果已经打开了别的，先关闭别的
    if (activeMomentMenuId && activeMomentMenuId !== id) {
        const prev = document.getElementById(`moment-menu-${activeMomentMenuId}`);
        if (prev) prev.classList.remove('show');
    }
    
    const menu = document.getElementById(`moment-menu-${id}`);
    if (menu) {
        if (menu.classList.contains('show')) {
            menu.classList.remove('show');
            activeMomentMenuId = null;
        } else {
            menu.classList.add('show');
            activeMomentMenuId = id;
            
            // 绑定一次性全局点击事件来关闭菜单
            document.addEventListener('click', closeMomentMenuOutside, { once: true });
        }
    }
}

function closeMomentMenuOutside(e) {
    if (activeMomentMenuId) {
        const menu = document.getElementById(`moment-menu-${activeMomentMenuId}`);
        if (menu && !menu.contains(e.target)) {
            menu.classList.remove('show');
            activeMomentMenuId = null;
        }
    }
}

async function likeMoment(id) {
    // 立即关闭菜单
    const menu = document.getElementById(`moment-menu-${id}`);
    if (menu) menu.classList.remove('show');
    activeMomentMenuId = null;

    if (!currentMyCharId) return;
    
    const user = await db.characters.get(parseInt(currentMyCharId));
    const moment = await db.moments.get(id);
    
    if (user && moment) {
        if (!moment.likes) moment.likes = [];
        
        const idx = moment.likes.findIndex(l => l.userId == user.id);
        if (idx > -1) {
            // 取消点赞
            moment.likes.splice(idx, 1);
        } else {
            // 点赞
            moment.likes.push({ userId: user.id, name: user.name });
        }
        
        await db.moments.put(moment);
        renderMomentsList(); // 刷新列表
    }
}

async function commentMoment(id) {
    // 立即关闭菜单
    const menu = document.getElementById(`moment-menu-${id}`);
    if (menu) menu.classList.remove('show');
    activeMomentMenuId = null;

    if (!currentMyCharId) return;
    
    // 使用 setTimeout 让菜单先关闭，再弹出 prompt
    setTimeout(async () => {
        const content = prompt("请输入评论内容：");
        if (content && content.trim()) {
            const user = await db.characters.get(parseInt(currentMyCharId));
            const moment = await db.moments.get(id);
            
            if (user && moment) {
                if (!moment.comments) moment.comments = [];
                
                moment.comments.push({
                    userId: user.id,
                    name: user.name,
                    content: content.trim(),
                    time: Date.now()
                });
                
                await db.moments.put(moment);
                renderMomentsList(); // 刷新列表
            }
        }
    }, 50);
}

function showWalletPage() {
    const walletPage = document.getElementById('wallet-page');
    walletPage.style.display = 'flex';
    walletPage.offsetHeight; 
    walletPage.classList.add('active');
    
    // 更新显示的余额 (从 currentMyCharId 获取)
    updateWalletBalanceDisplay();
}

function hideWalletPage() {
    const walletPage = document.getElementById('wallet-page');
    walletPage.classList.remove('active');
    setTimeout(() => {
        walletPage.style.display = 'none';
    }, 350);
}

function showBalancePage() {
    const balancePage = document.getElementById('balance-page');
    balancePage.style.display = 'flex';
    balancePage.offsetHeight; 
    balancePage.classList.add('active');
    
    // 更新大字余额
    updateBalancePageDisplay();
}

function hideBalancePage() {
    const balancePage = document.getElementById('balance-page');
    balancePage.classList.remove('active');
    setTimeout(() => {
        balancePage.style.display = 'none';
    }, 350);
    
    // 返回时同时也更新一下钱包页的余额显示，以防刚才生成了新的
    updateWalletBalanceDisplay();
}

// 更新钱包页的小余额显示
async function updateWalletBalanceDisplay() {
    if (!currentMyCharId) return;
    const user = await db.characters.get(parseInt(currentMyCharId));
    if (user && user.identity && user.identity.balance !== undefined) {
        // 假设 identity.balance 存储的是数字或字符串
        document.querySelector('#wallet-page .item-right span').innerText = `¥${user.identity.balance}`;
        // 同时更新服务页的余额
        const serviceBalance = document.querySelector('.header-item .item-subtitle');
        if (serviceBalance) serviceBalance.style.display = 'none'; // 隐藏余额
    } else {
         document.querySelector('#wallet-page .item-right span').innerText = `¥0.00`;
         const serviceBalance = document.querySelector('.header-item .item-subtitle');
         if (serviceBalance) serviceBalance.style.display = 'none'; // 隐藏余额
    }
}

// 更新零钱页的大余额显示
async function updateBalancePageDisplay() {
    if (!currentMyCharId) return;
    const user = await db.characters.get(parseInt(currentMyCharId));
    const amountDisplay = document.getElementById('balance-amount-display');
    if (user && user.identity && user.identity.balance !== undefined) {
        amountDisplay.innerText = `¥${user.identity.balance}`;
    } else {
        amountDisplay.innerText = `¥0.00`;
    }
}

// AI生成余额逻辑
async function generateUserBalance() {
    if (!currentMyCharId) {
        alert("请先选择一个 User 身份");
        return;
    }

    const user = await db.characters.get(parseInt(currentMyCharId));
    if (!user) return;
    
    const btn = document.querySelector('.btn-generate');
    const originalText = btn.innerHTML;
    btn.innerHTML = `<div class="loading-spinner" style="display:inline-block; border-color:var(--ins-pink); border-top-color:transparent;"></div> 生成中...`;
    btn.disabled = true;

    try {
        const systemPrompt = `你是一个辅助生成角色详细设定的AI。当前角色是：${user.name}。
        角色描述：${user.desc || '暂无描述'}。
        请根据角色的背景、职业、性格，合理推断TA微信钱包里的"零钱"余额。
        
        要求：
        1. 只返回一个具体的数字金额，保留两位小数。
        2. 不要返回任何其他文字。
        3. 金额要符合人设（例如学生可能几百几千，富二代可能几万，普通打工人可能几千）。
        4. 如果是古代/架空背景，请自动换算成合理的现代货币数值。`;

        const amountStr = await callAI([
            { role: "system", content: systemPrompt },
            { role: "user", content: "请生成余额" }
        ]);

        // 提取数字
        const match = amountStr.match(/[\d,]+\.\d{2}/) || amountStr.match(/\d+/);
        let balance = "0.00";
        if (match) {
            balance = match[0];
        } else {
            // 兜底尝试清理非数字字符
             balance = amountStr.replace(/[^\d.]/g, '');
        }

        // 保存到数据库
        if (!user.identity) user.identity = {};
        user.identity.balance = balance;
        await db.characters.put(user);

        // 更新界面
        document.getElementById('balance-amount-display').innerText = `¥${balance}`;
        updateWalletBalanceDisplay(); // 同步更新上一页

        // 简易 Toast
        const tip = document.getElementById('save-tip');
        tip.innerText = "余额已生成";
        tip.style.display = 'block';
        setTimeout(() => { 
            tip.style.display = 'none'; 
            tip.innerText = "保存成功！"; // 还原默认文本
        }, 1500);

    } catch (e) {
        console.error(e);
        const tip = document.getElementById('save-tip');
        tip.innerText = "生成失败";
        tip.style.display = 'block';
        setTimeout(() => { tip.style.display = 'none'; }, 1500);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}


/* =================
   转账功能逻辑
   ================= */

// 简易Toast函数 (如果没有定义的话)
function showToast(message) {
    const tip = document.getElementById('save-tip');
    if (tip) {
        tip.innerText = message;
        tip.style.display = 'block';
        setTimeout(() => { 
            tip.style.display = 'none'; 
            tip.innerText = "保存成功！"; // 还原默认文本
        }, 1500);
    } else {
        alert(message);
    }
}

// 打开转账页面
async function showTransferPage() {
    if (!currentChatCharId) {
        showToast("请先进入聊天");
        return;
    }
    
    // 获取当前聊天对象信息
    const chatChar = await db.characters.get(currentChatCharId);
    if (!chatChar) return;
    
    document.getElementById('t-target-name').innerText = chatChar.name;
    document.getElementById('t-target-avatar').style.backgroundImage = 'url(' + chatChar.avatar + ')';
    
    // 重置输入
    document.getElementById('t-amount-input').value = '';
    document.getElementById('t-note-input').value = '';
    document.getElementById('btn-do-transfer').disabled = true;
    
    const page = document.getElementById('transfer-page');
    page.style.display = 'flex';
}

function hideTransferPage() {
    document.getElementById('transfer-page').style.display = 'none';
}

// 检查金额输入，控制按钮状态
function checkTransferAmount(input) {
    const btn = document.getElementById('btn-do-transfer');
    const val = parseFloat(input.value);
    if (!isNaN(val) && val > 0) {
        btn.disabled = false;
    } else {
        btn.disabled = true;
    }
}

// 执行转账
async function doTransfer() {
    const amountVal = parseFloat(document.getElementById('t-amount-input').value);
    const noteVal = document.getElementById('t-note-input').value || '转账给对方';
    
    if (isNaN(amountVal) || amountVal <= 0) return;
    
    // 1. 检查余额
    if (!currentMyCharId) {
        showToast("请先在详情页设置User身份");
        return;
    }
    const user = await db.characters.get(parseInt(currentMyCharId));
    
    // 确保有余额字段
    let currentBalance = 0;
    if (user && user.identity && user.identity.balance) {
        currentBalance = parseFloat(user.identity.balance.toString().replace(/,/g, ''));
    }
    
    if (currentBalance < amountVal) {
        showToast('余额不足 (当前: ¥' + currentBalance.toFixed(2) + ')');
        return;
    }
    
    // 2. 扣款
    const newBalance = currentBalance - amountVal;
    user.identity.balance = newBalance.toFixed(2);
    await db.characters.put(user);
    
    // 3. 发送消息 - 存入chat_history（按账号）
    const chatChar = await db.characters.get(currentChatCharId);
    if (!chatChar) {
        showToast("聊天对象不存在");
        return;
    }
    
    const accountId = getCurrentAccountId();
    let history = getChatHistory(chatChar, accountId);
    
    const msgId = 'trans_' + Date.now();
    const msg = {
        id: msgId,
        role: 'user',
        type: 'transfer',
        content: JSON.stringify({
            amount: amountVal.toFixed(2),
            desc: noteVal,
            status: 'sent'
        }), 
        time: Date.now()
    };
    
    history.push(msg);
    await setChatHistory(chatChar, accountId, history);
    
    // 刷新聊天界面
    renderChatBody(chatChar);
    
    hideTransferPage();
    showToast("转账成功");
    
    // 关闭更多面板
    document.getElementById('action-panel').style.display = 'none';
    document.getElementById('chat-panel-container').classList.remove('open');
}

/* =================
   转账确认/详情逻辑
   ================= */

// 点击卡片触发
async function showTransferConfirm(msgId, isSelf, status) {
    if (status !== 'sent') {
        return; 
    }
    
    if (isSelf) {
        return;
    }
    
    // 从chat_history中查找消息
    const char = await db.characters.get(currentChatCharId);
    if (!char || !char.chat_history) return;
    
    const msg = char.chat_history.find(m => {
        // 精确匹配ID，或者根据时间戳生成的ID匹配
        if (m.id === msgId) return true;
        if (!m.id && msgId === 'trans_' + m.time) return true;
        return false;
    });
    if (!msg) return;
    
    // 解析转账数据
    let data = {};
    try {
        data = JSON.parse(msg.content);
    } catch(e) {
        return;
    }
    
    document.getElementById('t-confirm-desc').innerText = '收到转账 ¥' + data.amount;
    
    window.currentTransferMsgId = msgId;
    window.currentTransferMsgTime = msg.time; // 保存时间戳用于查找
    
    document.getElementById('transfer-confirm-modal').style.display = 'flex';
}

async function handleTransferAction(action) {
    const modal = document.getElementById('transfer-confirm-modal');
    modal.style.display = 'none';
    
    const msgId = window.currentTransferMsgId;
    const msgTime = window.currentTransferMsgTime;
    if (!msgId || !currentChatCharId) return;
    
    const char = await db.characters.get(currentChatCharId);
    const accountId = getCurrentAccountId();
    let history = getChatHistory(char, accountId);
    if (!history || history.length === 0) return;
    
    const msgIndex = history.findIndex(m => {
        // 精确匹配ID，或者根据时间戳生成的ID匹配
        if (m.id === msgId) return true;
        if (!m.id && msgId === 'trans_' + m.time) return true;
        if (msgTime && m.time === msgTime) return true; // 使用时间戳匹配
        return false;
    });
    if (msgIndex === -1) return;
    
    const msg = history[msgIndex];
    let data = {};
    try {
        data = JSON.parse(msg.content);
    } catch(e) {
        return;
    }
    
    if (action === 'accept') {
        data.status = 'received';
        msg.content = JSON.stringify(data);
        
        // 如果消息没有type字段，补充上
        if (!msg.type) msg.type = 'transfer';
        // 如果消息没有id，补充上
        if (!msg.id) msg.id = 'trans_' + msg.time;
        
        if (currentMyCharId) {
             const user = await db.characters.get(parseInt(currentMyCharId));
             if (user) {
                 let currentBalance = 0;
                 if (user.identity && user.identity.balance) {
                     currentBalance = parseFloat(user.identity.balance.toString().replace(/,/g, ''));
                 }
                 let addAmount = parseFloat(data.amount);
                 let newBalance = currentBalance + addAmount;
                 
                 if (!user.identity) user.identity = {};
                 user.identity.balance = newBalance.toFixed(2);
                 await db.characters.put(user);
                 
                 showToast('已收款 ¥' + data.amount);
             }
        }
        
    } else {
        data.status = 'returned';
        msg.content = JSON.stringify(data);
        
        if (!msg.type) msg.type = 'transfer';
        if (!msg.id) msg.id = 'trans_' + msg.time;
        
        showToast('已退回转账');
    }
    
    history[msgIndex] = msg;
    await setChatHistory(char, accountId, history);
    
    renderChatBody(char);
}
