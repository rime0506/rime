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
// 版本71：兼容已存在的高版本数据库
db.version(71).stores({
    dexiData: 'key, value',
    lorebooks: '++id, name',
    characters: '++id, name, type',
    sticker_categories: '++id, name',
    moments: '++id, userId, time, ownerUserId',
    friend_requests: '++id, fromCharId, toAccountId, status, time'
});
// 版本72：添加群聊表
db.version(72).stores({
    dexiData: 'key, value',
    lorebooks: '++id, name',
    characters: '++id, name, type',
    sticker_categories: '++id, name',
    moments: '++id, userId, time, ownerUserId',
    friend_requests: '++id, fromCharId, toAccountId, status, time',
    group_chats: '++id, name, ownerAccountId, created_at' // 群聊表：id自增，名称，创建者账号ID，创建时间
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
            await loadWardrobeCharacter(); // 加载衣柜人物形象
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
            : 'https://rime-fsv3.onrender.com'; // ✅ Render 部署地址
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
            // 找到对应的eye-icon（在同一个api-input-group中）
            const inputGroup = input.closest('.api-input-group');
            const icon = inputGroup ? inputGroup.querySelector('.eye-icon') : null;
            if (input && icon) {
                if (input.type === 'password') {
                    input.type = 'text';
                    icon.textContent = '隐藏';
                } else {
                    input.type = 'password';
                    icon.textContent = '显示';
                }
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

        // NovelAI 设置相关函数
        function toggleNovelAISettings() {
            const body = document.getElementById('novelai-setting-body');
            const arrow = document.getElementById('novelai-setting-arrow');
            if (body.style.display === 'none') {
                body.style.display = 'block';
                arrow.textContent = '▲';
                loadNovelAIConfig(); // 展开时加载
            } else {
                body.style.display = 'none';
                arrow.textContent = '▼';
            }
        }

        // 切换NovelAI密钥显示
        function toggleNovelAIKeyVis() {
            const input = document.getElementById('novelai-api-key');
            const inputGroup = input.closest('.api-input-group');
            const icon = inputGroup ? inputGroup.querySelector('.eye-icon') : null;
            if (input && icon) {
                if (input.type === 'password') {
                    input.type = 'text';
                    icon.textContent = '隐藏';
                } else {
                    input.type = 'password';
                    icon.textContent = '显示';
                }
            }
        }

        // 更新NovelAI采样步数显示
        function updateNovelAIStepsDisplay(val) {
            const display = document.getElementById('novelai-steps-value');
            if (display) display.textContent = val;
        }

        // 更新NovelAI引导强度显示
        function updateNovelAIScaleDisplay(val) {
            const display = document.getElementById('novelai-scale-value');
            if (display) display.textContent = val;
        }

        // 加载 NovelAI 配置
        async function loadNovelAIConfig() {
            try {
                const apiKeyItem = await db.dexiData.get('novelaiApiKey');
                const proxyUrlItem = await db.dexiData.get('novelaiProxyUrl');
                const modelItem = await db.dexiData.get('novelaiModel');
                const stepsItem = await db.dexiData.get('novelaiSteps');
                const scaleItem = await db.dexiData.get('novelaiScale');
                const samplerItem = await db.dexiData.get('novelaiSampler');
                const sizeItem = await db.dexiData.get('novelaiSize');
                const systemPromptItem = await db.dexiData.get('novelaiSystemPrompt');
                const negativePromptItem = await db.dexiData.get('novelaiNegativePrompt');

                if (apiKeyItem) document.getElementById('novelai-api-key').value = apiKeyItem.value;
                if (proxyUrlItem) document.getElementById('novelai-proxy-url').value = proxyUrlItem.value;
                if (modelItem) document.getElementById('novelai-model').value = modelItem.value;
                if (stepsItem) {
                    document.getElementById('novelai-steps').value = stepsItem.value;
                    updateNovelAIStepsDisplay(stepsItem.value);
                }
                if (scaleItem) {
                    document.getElementById('novelai-scale').value = scaleItem.value;
                    updateNovelAIScaleDisplay(scaleItem.value);
                }
                if (samplerItem) document.getElementById('novelai-sampler').value = samplerItem.value;
                if (sizeItem) document.getElementById('novelai-size').value = sizeItem.value;
                if (systemPromptItem) document.getElementById('novelai-system-prompt').value = systemPromptItem.value;
                if (negativePromptItem) document.getElementById('novelai-negative-prompt').value = negativePromptItem.value;
            } catch (e) {
                console.error("加载 NovelAI 配置失败", e);
            }
        }

        // 自动保存 NovelAI 配置
        async function autoSaveNovelAI() {
            const apiKey = document.getElementById('novelai-api-key').value.trim();
            const proxyUrl = document.getElementById('novelai-proxy-url').value.trim();
            const model = document.getElementById('novelai-model').value;
            const steps = document.getElementById('novelai-steps').value;
            const scale = document.getElementById('novelai-scale').value;
            const sampler = document.getElementById('novelai-sampler').value;
            const size = document.getElementById('novelai-size').value;
            const systemPrompt = document.getElementById('novelai-system-prompt').value.trim();
            const negativePrompt = document.getElementById('novelai-negative-prompt').value.trim();

            await db.dexiData.put({ key: 'novelaiApiKey', value: apiKey });
            await db.dexiData.put({ key: 'novelaiProxyUrl', value: proxyUrl });
            await db.dexiData.put({ key: 'novelaiModel', value: model });
            await db.dexiData.put({ key: 'novelaiSteps', value: steps });
            await db.dexiData.put({ key: 'novelaiScale', value: scale });
            await db.dexiData.put({ key: 'novelaiSampler', value: sampler });
            await db.dexiData.put({ key: 'novelaiSize', value: size });
            await db.dexiData.put({ key: 'novelaiSystemPrompt', value: systemPrompt });
            await db.dexiData.put({ key: 'novelaiNegativePrompt', value: negativePrompt });
        }

        // 测试 NovelAI 连接
        async function testNovelAIConnection() {
            const apiKey = document.getElementById('novelai-api-key').value.trim();
            const proxyUrl = document.getElementById('novelai-proxy-url').value.trim();
            const resultDiv = document.getElementById('novelai-test-result');
            const btnText = document.getElementById('test-novelai-btn-text');

            if (!apiKey) {
                resultDiv.textContent = '❌ 请先输入 NovelAI API Key';
                resultDiv.style.color = '#ff3b30';
                return;
            }

            btnText.textContent = '测试中...';
            resultDiv.textContent = '⏳ 正在测试连接...';
            resultDiv.style.color = '#999';

            try {
                const testUrl = proxyUrl || 'https://image.novelai.net/ai/generate-image';
                
                // 构造测试请求（使用最小参数）
                const testPayload = {
                    input: 'test',
                    model: 'nai-diffusion-3',
                    action: 'generate',
                    parameters: {
                        width: 512,
                        height: 512,
                        scale: 7,
                        sampler: 'k_euler_ancestral',
                        steps: 1,
                        n_samples: 1,
                        seed: 0
                    }
                };

                const response = await fetch(testUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(testPayload)
                });

                if (response.ok) {
                    resultDiv.textContent = '✅ NovelAI 连接成功！';
                    resultDiv.style.color = '#34C759';
                } else {
                    const errorText = await response.text();
                    resultDiv.textContent = `❌ 连接失败 (${response.status}): ${errorText.substring(0, 100)}`;
                    resultDiv.style.color = '#ff3b30';
                }
            } catch (err) {
                resultDiv.textContent = `❌ 连接错误: ${err.message}`;
                resultDiv.style.color = '#ff3b30';
            } finally {
                btnText.textContent = '测试 NovelAI 连接';
            }
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
            const iconIds = ['setting','notes','remind','facetime','photo','camera'];
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
// 显示衣柜页面
function showWardrobePage() {
    closeChatPanel();
    const wardrobePage = document.getElementById('wardrobe-page');
    if (wardrobePage) {
        wardrobePage.style.display = 'flex';
        // 加载保存的人物形象
        loadWardrobeCharacter();
    }
}

// 隐藏衣柜页面
function hideWardrobePage() {
    const wardrobePage = document.getElementById('wardrobe-page');
    if (wardrobePage) {
        wardrobePage.style.display = 'none';
    }
}

// 衣柜生成图片相关函数
let wardrobeGenerateType = 'character';
let wardrobeGender = 'female'; // 默认女生

function openWardrobeGenerateModal() {
    const modal = document.getElementById('wardrobe-generate-modal');
    if (modal) {
        modal.style.display = 'flex';
        wardrobeGenerateType = 'character';
        wardrobeGender = 'female';
        selectWardrobeGenerateType('character', document.getElementById('wardrobe-btn-character'));
        selectWardrobeGender('female', document.getElementById('wardrobe-gender-female'));
        document.getElementById('wardrobe-generate-prompt').value = '';
    }
}

function closeWardrobeGenerateModal() {
    const modal = document.getElementById('wardrobe-generate-modal');
    if (modal) {
        modal.style.display = 'none';
        document.getElementById('wardrobe-generate-loading').style.display = 'none';
    }
}

function selectWardrobeGenerateType(type, element) {
    wardrobeGenerateType = type;
    // 更新按钮样式
    const allBtns = document.querySelectorAll('#wardrobe-btn-character, #wardrobe-btn-clothes');
    allBtns.forEach(btn => {
        btn.style.border = '2px solid #eee';
        btn.style.background = '#fff';
        btn.style.color = '#666';
    });
    element.style.border = '2px solid var(--ins-pink)';
    element.style.background = '#fff0f5';
    element.style.color = 'var(--ins-pink)';
    
    // 控制性别选择的显示（只在人物形象时显示）
    const genderSelect = document.getElementById('wardrobe-gender-select');
    if (genderSelect) {
        genderSelect.style.display = type === 'character' ? 'block' : 'none';
    }
}

// 性别选择函数
function selectWardrobeGender(gender, element) {
    wardrobeGender = gender;
    // 更新按钮样式
    const allBtns = document.querySelectorAll('.wardrobe-gender-btn');
    allBtns.forEach(btn => {
        btn.style.border = '2px solid #eee';
        btn.style.background = '#fff';
        btn.style.color = '#666';
    });
    
    if (gender === 'female') {
        element.style.border = '2px solid #ff69b4';
        element.style.background = '#fff0f5';
        element.style.color = '#ff69b4';
    } else {
        element.style.border = '2px solid #4a90e2';
        element.style.background = '#f0f7ff';
        element.style.color = '#4a90e2';
    }
}

async function generateWardrobeImage() {
    const prompt = document.getElementById('wardrobe-generate-prompt').value.trim();
    if (!prompt) {
        alert('请输入生成要求');
        return;
    }

    // 显示加载状态
    const loadingDiv = document.getElementById('wardrobe-generate-loading');
    const confirmBtn = document.querySelector('.generate-confirm-btn');
    loadingDiv.style.display = 'block';
    confirmBtn.disabled = true;
    confirmBtn.textContent = '生成中...';

    try {
        // 获取NovelAI配置
        const apiKeyItem = await db.dexiData.get('novelaiApiKey');
        const proxyUrlItem = await db.dexiData.get('novelaiProxyUrl');
        const modelItem = await db.dexiData.get('novelaiModel');
        const stepsItem = await db.dexiData.get('novelaiSteps');
        const scaleItem = await db.dexiData.get('novelaiScale');
        const samplerItem = await db.dexiData.get('novelaiSampler');
        const sizeItem = await db.dexiData.get('novelaiSize');

        if (!apiKeyItem || !apiKeyItem.value) {
            throw new Error('请先在设置中配置 NovelAI API Key');
        }

        const apiKey = apiKeyItem.value;
        const proxyUrl = proxyUrlItem ? proxyUrlItem.value : 'https://image.novelai.net/ai/generate-image';
        const model = modelItem ? modelItem.value : 'nai-diffusion-4-5-full';
        const steps = stepsItem ? parseInt(stepsItem.value) : 28;
        const scale = scaleItem ? parseFloat(scaleItem.value) : 11;
        const sampler = samplerItem ? samplerItem.value : 'k_euler_ancestral';
        const size = sizeItem ? sizeItem.value : '832x1216';
        // 解析尺寸
        const [width, height] = size.split('x').map(Number);

        // 获取参考图（用于图生图）
        let referenceImageBase64 = null;
        let cleanImage = null; // 去除前缀后的纯 base64 数据
        
        if (wardrobeGenerateType === 'clothes') {
            // 生成衣服时，获取当前人物形象作为参考图
            const charImg = document.getElementById('wardrobe-char-base');
            if (charImg && charImg.src && !charImg.src.includes('character.png')) {
                try {
                    // 将图片转换为 base64
                    referenceImageBase64 = await imageToBase64(charImg.src);
                    // 关键修复：去除 base64 的头 (data:image/png;base64,)
                    cleanImage = referenceImageBase64.replace(/^data:image\/\w+;base64,/, "");
                    console.log('已获取参考图，准备进行图生图，纯 base64 长度:', cleanImage.length);
                } catch (e) {
                    console.warn('获取参考图失败，将使用纯文生图:', e);
                }
            }
            
            // 如果没有参考图，提示用户
            if (!cleanImage) {
                alert('请先生成人物形象后再换装');
                loadingDiv.style.display = 'none';
                confirmBtn.disabled = false;
                confirmBtn.textContent = '生成';
                return;
            }
        }
        
        // 构建完整的prompt
        let fullPrompt = '';
        let wardrobeNegativePrompt = '';
        
        if (wardrobeGenerateType === 'character') {
            // 人物形象：根据选择的性别添加对应标签
            if (wardrobeGender === 'male') {
                // 男生：将 prompt (你的输入) 放在最最前面！
                fullPrompt = prompt + ', 1boy, male, full body, standing, solo, masterpiece, best quality, highly detailed';
                wardrobeNegativePrompt = 'girl, female, woman, 1girl, feminine, worst quality, low quality, blurry, watermark, signature, cropped, cut off, half body, upper body, close-up, portrait, multiple views, background scenery, complex background, landscape, text, logo';
            } else {
                // 女生：将 prompt (你的输入) 放在最最前面！
                fullPrompt = prompt + ', 1girl, female, full body, standing, solo, masterpiece, best quality, highly detailed';
                wardrobeNegativePrompt = 'boy, male, man, 1boy, masculine, worst quality, low quality, blurry, watermark, signature, cropped, cut off, half body, upper body, close-up, portrait, multiple views, background scenery, complex background, landscape, text, logo';
            }
        } else {
            // 换装模式：必须带上性别和基础质量词，把用户的衣服描述(prompt)放在最前面
            const genderTags = wardrobeGender === 'male' ? '1boy, male' : '1girl, female';
            fullPrompt = prompt + ', ' + genderTags + ', full body, standing, solo, masterpiece, best quality, highly detailed';
            wardrobeNegativePrompt = 'worst quality, low quality, blurry, watermark, text, logo, nsfw';
        }

        // 判断模型版本
        const isV4 = model.includes('nai-diffusion-4');
        
        // 根据模型版本选择正确的端点
        const isCustomProxy = proxyUrl && proxyUrl !== 'https://image.novelai.net/ai/generate-image' && proxyUrl !== 'https://image.novelai.net/ai/generate-image-stream';
        let apiUrl;
        if (isCustomProxy) {
            apiUrl = proxyUrl;
        } else {
            apiUrl = isV4 ? 'https://image.novelai.net/ai/generate-image-stream' : 'https://image.novelai.net/ai/generate-image';
        }

        // 构建请求体
        let requestBody;
        if (isV4) {
            // V4/V4.5 使用新格式
            requestBody = {
                input: fullPrompt, // V4 需要 input 字段
                model: model,
                action: 'generate',
                parameters: {
                    width: width,
                    height: height,
                    scale: scale,
                    sampler: sampler,
                    steps: steps,
                    seed: Math.floor(Math.random() * 9999999999),
                    n_samples: 1,
                    ucPreset: 0,
                    qualityToggle: true,
                    sm: false,
                    sm_dyn: false,
                    dynamic_thresholding: false,
                    controlnet_strength: 1,
                    legacy: false,
                    add_original_image: false,
                    cfg_rescale: 0,
                    noise_schedule: 'native',
                    negative_prompt: wardrobeNegativePrompt
                }
            };
            
            // 如果是换装模式，添加图生图参数
            if (cleanImage) {
                console.log('启用图生图模式 (V4 img2img)');
                // 明确告诉 API 这是图生图
                requestBody.action = 'img2img';
                // 使用去除了前缀的图片数据
                requestBody.parameters.image = cleanImage;
                // 重绘幅度：0.7 左右能在保持姿势的同时换衣服
                requestBody.parameters.strength = 0.7;
                // 稍微加一点噪点增加细节
                requestBody.parameters.noise = 0.1;
                requestBody.parameters.extra_noise_seed = requestBody.parameters.seed;
                
                console.log('参考图 base64 长度:', cleanImage.length);
            }
        } else {
            // V3 使用旧格式
            requestBody = {
                input: fullPrompt,
                model: model,
                action: 'generate',
                parameters: {
                    width: width,
                    height: height,
                    scale: scale,
                    sampler: sampler,
                    steps: steps,
                    seed: Math.floor(Math.random() * 9999999999),
                    n_samples: 1,
                    ucPreset: 0,
                    qualityToggle: true,
                    negative_prompt: wardrobeNegativePrompt
                }
            };
            
            // 如果是换装模式，添加图生图参数（V3）
            if (cleanImage) {
                console.log('启用图生图模式 (V3 img2img)');
                requestBody.action = 'img2img';
                requestBody.parameters.image = cleanImage;
                requestBody.parameters.strength = 0.7;
                requestBody.parameters.noise = 0.1;
                requestBody.parameters.extra_noise_seed = requestBody.parameters.seed;
                
                console.log('参考图 base64 长度:', cleanImage.length);
            }
        }

        // 发送请求
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`生成失败: ${response.status} ${errorText.substring(0, 200)}`);
        }

        // 处理响应
        const contentType = response.headers.get('content-type');
        let imageUrl;
        
        if (contentType && contentType.includes('text/event-stream')) {
            // SSE 流式响应（V4）
            const text = await response.text();
            console.log('SSE 响应前 500 字符:', text.substring(0, 500));
            const lines = text.trim().split('\n');
            let base64Data = null;
            
            // 从后往前查找最后一个包含图片数据的行
            for (let i = lines.length - 1; i >= 0; i--) {
                const line = lines[i].trim();
                if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                    const dataContent = line.substring(6);
                    try {
                        const jsonData = JSON.parse(dataContent);
                        console.log('解析到 JSON 数据:', jsonData);
                        
                        // 检查是否是错误事件
                        if (jsonData.event_type === 'error' || jsonData.event === 'error') {
                            const errorMsg = jsonData.message || jsonData.error || 'NovelAI 生成失败';
                            console.error('NovelAI 错误:', jsonData);
                            throw new Error(`NovelAI API 错误: ${errorMsg}`);
                        }
                        
                        // 尝试各种可能的字段
                        if (jsonData.event_type === 'final' && jsonData.image) {
                            base64Data = jsonData.image;
                            console.log('找到图片数据 (final.image)');
                            break;
                        }
                        if (jsonData.final && jsonData.final.image) {
                            base64Data = jsonData.final.image;
                            console.log('找到图片数据 (final.image nested)');
                            break;
                        }
                        if (jsonData.data && typeof jsonData.data === 'string') {
                            base64Data = jsonData.data;
                            console.log('找到图片数据 (data)');
                            break;
                        }
                        if (jsonData.image) {
                            base64Data = jsonData.image;
                            console.log('找到图片数据 (image)');
                            break;
                        }
                        // NovelAI V4.5 可能直接返回 base64
                        if (typeof jsonData === 'string' && jsonData.length > 100) {
                            base64Data = jsonData;
                            console.log('找到图片数据 (直接字符串)');
                            break;
                        }
                    } catch (e) {
                        // 如果不是 JSON，可能直接是 base64
                        if (dataContent.length > 100) {
                            base64Data = dataContent;
                            console.log('找到图片数据 (非 JSON 字符串)');
                            break;
                        }
                    }
                }
            }
            
            if (!base64Data) {
                console.error('无法提取图片数据，响应内容:', text.substring(0, 1000));
                throw new Error('无法从 SSE 响应中提取图片数据。请检查控制台日志。');
            }
            
            console.log('提取到的 base64 数据长度:', base64Data.length);
            
            // 检查是否为图片的base64
            const isPNG = base64Data.startsWith('iVBORw0KGgo');
            const isJPEG = base64Data.startsWith('/9j/');
            
            if (isPNG || isJPEG) {
                imageUrl = `data:${isPNG ? 'image/png' : 'image/jpeg'};base64,${base64Data}`;
            } else {
                // 可能是ZIP的base64，需要解压
                const binaryString = atob(base64Data);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                const zipBlob = new Blob([bytes]);
                imageUrl = await extractImageFromZip(zipBlob);
            }
        } else {
            // ZIP 文件响应（V3）
            const zipBlob = await response.blob();
            imageUrl = await extractImageFromZip(zipBlob);
        }

        if (!imageUrl) {
            throw new Error('无法解析图像数据');
        }

        // 显示生成的图片
        if (wardrobeGenerateType === 'character') {
            // 生成人物形象：直接更新
            const charImg = document.getElementById('wardrobe-char-base');
            if (charImg) {
                charImg.src = imageUrl;
                // 保存到 Dexie
                await saveWardrobeCharacter(imageUrl);
            }
        } else {
            // 生成衣服 - 图生图换装
            // 图生图模式：更新当前人物形象（换装效果）
            const charImg = document.getElementById('wardrobe-char-base');
            if (charImg) {
                charImg.src = imageUrl;
                // 保存更新后的人物形象到 Dexie
                await saveWardrobeCharacter(imageUrl);
            }
            alert('换装成功！人物衣服已更新');
        }

        // 显示成功提示（图生图模式已经有专门提示，这里只提示其他情况）
        if (wardrobeGenerateType === 'character' || !referenceImageBase64) {
            alert('图片生成成功！');
        }
        closeWardrobeGenerateModal();

    } catch (error) {
        console.error('生成图片失败:', error);
        alert('生成失败: ' + error.message);
    } finally {
        loadingDiv.style.display = 'none';
        confirmBtn.disabled = false;
        confirmBtn.textContent = '生成';
    }
}

// 衣柜Tab切换函数
function switchWardrobeTab(category, element) {
    // 更新Tab样式
    document.querySelectorAll('.wardrobe-tab-item').forEach(tab => {
        tab.classList.remove('active');
        tab.style.color = '#999';
        tab.style.fontWeight = 'normal';
        const span = tab.querySelector('span');
        if (span) span.remove();
    });
    element.classList.add('active');
    element.style.color = '#333';
    element.style.fontWeight = 'bold';
    const indicator = document.createElement('span');
    indicator.style.cssText = 'position:absolute; bottom:0; left:50%; transform:translateX(-50%); width:20px; height:3px; background:#d4a5ff; border-radius:3px;';
    element.appendChild(indicator);

    // 更新列表显示
    document.querySelectorAll('.wardrobe-list').forEach(list => {
        list.style.display = 'none';
    });
    const targetList = document.getElementById('wardrobe-list-' + category);
    if (targetList) {
        targetList.style.display = 'flex';
    }
}

// 将图片URL转换为base64
async function imageToBase64(imageUrl) {
    return new Promise((resolve, reject) => {
        // 如果已经是 base64，直接返回
        if (imageUrl.startsWith('data:')) {
            resolve(imageUrl);
            return;
        }
        
        // 如果是 blob URL，需要先转换
        if (imageUrl.startsWith('blob:')) {
            fetch(imageUrl)
                .then(response => response.blob())
                .then(blob => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                })
                .catch(reject);
            return;
        }
        
        // 普通 URL，使用 canvas 转换
        const img = new Image();
        img.crossOrigin = 'anonymous'; // 解决跨域问题
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                const base64 = canvas.toDataURL('image/png');
                resolve(base64);
            } catch (e) {
                reject(e);
            }
        };
        img.onerror = reject;
        img.src = imageUrl;
    });
}

// 保存衣柜人物形象到 Dexie
async function saveWardrobeCharacter(imageUrl) {
    try {
        await db.dexiData.put({ key: 'wardrobeCharacter', value: imageUrl });
        // 同时保存当前选择的性别，换装时需要用到
        await db.dexiData.put({ key: 'wardrobeCharacterGender', value: wardrobeGender });
        console.log('人物形象已保存，性别:', wardrobeGender);
    } catch (error) {
        console.error('保存人物形象失败:', error);
    }
}

// 加载衣柜人物形象
async function loadWardrobeCharacter() {
    try {
        const item = await db.dexiData.get('wardrobeCharacter');
        const genderItem = await db.dexiData.get('wardrobeCharacterGender');
        
        if (item && item.value) {
            const charImg = document.getElementById('wardrobe-char-base');
            if (charImg) {
                charImg.src = item.value;
                console.log('人物形象已加载');
            }
        }
        
        // 恢复性别设置
        if (genderItem && genderItem.value) {
            wardrobeGender = genderItem.value;
            console.log('人物性别已恢复:', wardrobeGender);
        }
    } catch (error) {
        console.error('加载人物形象失败:', error);
    }
}

// 从ZIP文件中提取图片
async function extractImageFromZip(zipBlob) {
    // 检查是否有JSZip库
    if (typeof JSZip === 'undefined') {
        // 如果没有JSZip，尝试直接读取为图片
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(zipBlob);
        });
    }
    
    try {
        const zip = await JSZip.loadAsync(zipBlob);
        let imageFile = null;
        
        // 查找第一个图片文件
        for (const filename in zip.files) {
            if (filename.match(/\.(png|jpg|jpeg|webp)$/i)) {
                imageFile = zip.files[filename];
                break;
            }
        }
        
        if (!imageFile) {
            throw new Error('ZIP文件中未找到图片');
        }
        
        const imageBlob = await imageFile.async('blob');
        
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(imageBlob);
        });
    } catch (error) {
        console.error('解压ZIP失败:', error);
        // 降级处理：直接作为图片读取
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(zipBlob);
        });
    }
}

// 添加衣服项到列表
function addWardrobeClothesItem(category, imageUrl, name) {
    const listId = 'wardrobe-list-' + category;
    const list = document.getElementById(listId);
    if (!list) return;

    const item = document.createElement('div');
    item.className = 'wardrobe-clothes-item';
    item.style.cssText = 'display:inline-block; flex-shrink:0; width:90px; height:110px; border:1px solid #f0f0f0; border-radius:12px; margin-right:12px; background:#fff; cursor:pointer; text-align:center; padding:6px; transition:all 0.2s;';
    item.innerHTML = `
        <img src="${imageUrl}" alt="${name}" style="width:100%; height:75px; object-fit:contain; margin-bottom:5px;">
        <div class="wardrobe-clothes-name" style="font-size:11px; color:#888; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${name.substring(0, 10)}${name.length > 10 ? '...' : ''}</div>
    `;
    item.onmouseenter = function() {
        this.style.borderColor = '#e0b0ff';
        this.style.background = '#faf4ff';
        this.style.transform = 'translateY(-2px)';
    };
    item.onmouseleave = function() {
        this.style.borderColor = '#f0f0f0';
        this.style.background = '#fff';
        this.style.transform = 'translateY(0)';
    };
    list.appendChild(item);
}

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
// 应用安装状态管理
const installedAppsDb = new Dexie('InstalledAppsDB');
installedAppsDb.version(1).stores({
    apps: 'appId, installed, installDate'
});

// 检查应用是否已安装
async function isAppInstalled(appId) {
    try {
        const app = await installedAppsDb.apps.get(appId);
        return app ? app.installed : false;
    } catch (error) {
        console.error('检查应用安装状态失败:', error);
        return false;
    }
}

// 安装应用
async function installApp(appId, desktopIconId, showFunction) {
    try {
        await installedAppsDb.apps.put({
            appId: appId,
            installed: true,
            installDate: new Date()
        });
        
        // 显示桌面图标
        if (desktopIconId) {
            const icon = document.getElementById(desktopIconId);
            if (icon) {
                icon.style.display = 'flex';
            }
        }
        
        // 保存到 localStorage 作为备份
        const installedApps = JSON.parse(localStorage.getItem('installedApps') || '{}');
        installedApps[appId] = {
            installed: true,
            installDate: new Date().toISOString(),
            desktopIconId: desktopIconId,
            showFunction: showFunction
        };
        localStorage.setItem('installedApps', JSON.stringify(installedApps));
        
        return true;
    } catch (error) {
        console.error('安装应用失败:', error);
        return false;
    }
}

// 卸载应用
async function uninstallApp(appId, desktopIconId) {
    try {
        await installedAppsDb.apps.delete(appId);
        
        // 隐藏桌面图标
        if (desktopIconId) {
            const icon = document.getElementById(desktopIconId);
            if (icon) {
                icon.style.display = 'none';
            }
        }
        
        // 从 localStorage 删除
        const installedApps = JSON.parse(localStorage.getItem('installedApps') || '{}');
        delete installedApps[appId];
        localStorage.setItem('installedApps', JSON.stringify(installedApps));
        
        return true;
    } catch (error) {
        console.error('卸载应用失败:', error);
        return false;
    }
}

// 初始化已安装应用的桌面图标显示
async function initInstalledApps() {
    try {
        // 从 IndexedDB 加载
        const installedApps = await installedAppsDb.apps.toArray();
        installedApps.forEach(app => {
            if (app.installed) {
                // 从应用商店数据中找到对应的应用
                const allApps = [...appStoreData.today, ...appStoreData.games, ...appStoreData.apps, ...appStoreData.updates];
                const appData = allApps.find(a => a.appId === app.appId);
                if (appData && appData.desktopIconId) {
                    const icon = document.getElementById(appData.desktopIconId);
                    if (icon) {
                        icon.style.display = 'flex';
                    }
                }
            }
        });
        
        // 从 localStorage 恢复（兼容旧数据）
        const localApps = JSON.parse(localStorage.getItem('installedApps') || '{}');
        Object.keys(localApps).forEach(appId => {
            const appInfo = localApps[appId];
            if (appInfo.installed && appInfo.desktopIconId) {
                const icon = document.getElementById(appInfo.desktopIconId);
                if (icon) {
                    icon.style.display = 'flex';
                }
                // 同步到 IndexedDB
                installedAppsDb.apps.put({
                    appId: appId,
                    installed: true,
                    installDate: appInfo.installDate ? new Date(appInfo.installDate) : new Date()
                });
            }
        });
    } catch (error) {
        console.error('初始化已安装应用失败:', error);
    }
}

// 下载/安装应用
async function downloadApp(appId) {
    const allApps = [...appStoreData.today, ...appStoreData.games, ...appStoreData.apps, ...appStoreData.updates];
    const app = allApps.find(a => a.appId === appId);
    
    if (!app) {
        alert('应用不存在');
        return;
    }
    
    // 检查是否已安装
    const isInstalled = await isAppInstalled(appId);
    if (isInstalled) {
        // 如果已安装，直接打开应用
        if (app.showFunction && typeof window[app.showFunction] === 'function') {
            window[app.showFunction]();
            hideAppStorePage();
        }
        return;
    }
    
    // 显示下载进度
    showToast('正在下载 ' + app.name + '...', 2000);
    
    // 模拟下载过程
    setTimeout(async () => {
        const success = await installApp(appId, app.desktopIconId, app.showFunction);
        if (success) {
            showToast(app.name + ' 已安装', 2000);
            // 刷新应用商店显示
            const activeTab = document.querySelector('.appstore-tab.active');
            if (activeTab) {
                switchAppStoreTab(activeTab.dataset.tab);
            }
        } else {
            showToast('安装失败，请重试', 2000);
        }
    }, 1500);
}

function showAppStorePage() {
    document.getElementById('appstore-page').style.display = 'flex';
    switchAppStoreTab('today');
}

function hideAppStorePage() {
    const page = document.getElementById('appstore-page');
    if (page) {
        page.style.display = 'none';
    }
}

function showMusicAppPage() {
    document.getElementById('musicAppPage').classList.add('active');
}

function closeMusicApp() {
    document.getElementById('musicAppPage').classList.remove('active');
}

// 网易云音乐播放器功能
// ============================================

// 初始化音乐播放器Dexie数据库
const wyyDb = new Dexie('WYYMusicPlayerDB');
wyyDb.version(1).stores({
    userSettings: 'id',
    playlistCards: 'id',
    songs: '++id, name, singer, dateAdded',
    songFiles: '++id, songId, type, data',
    lyrics: '++id, songId, data'
});
wyyDb.version(2).stores({
    userSettings: 'id',
    playlistCards: 'id',
    songs: '++id, name, singer, dateAdded, playlistId',
    songFiles: '++id, songId, type, data',
    lyrics: '++id, songId, data',
    playlists: '++id, name, desc, cover, dateCreated'
});

// 音乐播放器元素
const wyyPlayBtn = document.getElementById('wyyPlayBtn');
const wyyPlayerPlayBtn = document.getElementById('wyyPlayerPlayBtn');
const wyyRecordCover = document.getElementById('wyyRecordCover');
const wyyCurrentRecordContainer = document.getElementById('wyyCurrentRecordContainer');
const wyyAlbumArtLarge = document.getElementById('wyyAlbumArtLarge');
const wyyCurrentSongName = document.getElementById('wyyCurrentSongName');
const wyyCurrentSingerName = document.getElementById('wyyCurrentSingerName');
const wyyPlayerSongName = document.getElementById('wyyPlayerSongName');
const wyyPlayerSingerName = document.getElementById('wyyPlayerSingerName');
const wyyPlaylistBtn = document.getElementById('wyyPlaylistBtn');
const wyyPlaylistModal = document.getElementById('wyyPlaylistModal');
const wyySongsList = document.getElementById('wyySongsList');
const wyyEmptyPlaylist = document.getElementById('wyyEmptyPlaylist');
const wyyAddSongBtn = document.getElementById('wyyAddSongBtn');
const wyyClearAllBtn = document.getElementById('wyyClearAllBtn');
const wyyProgressBar = document.getElementById('wyyProgressBar');
const wyyProgress = document.getElementById('wyyProgress');
const wyyCurrentTime = document.getElementById('wyyCurrentTime');
const wyyTotalTime = document.getElementById('wyyTotalTime');
const wyyPrevBtn = document.getElementById('wyyPrevBtn');
const wyyNextBtn = document.getElementById('wyyNextBtn');
const wyyPlayBar = document.getElementById('wyyPlayBar');
const wyyBackBtn = document.getElementById('wyyBackBtn');
const wyyMainPage = document.getElementById('wyyMainPage');
const wyyPlayerPage = document.getElementById('wyyPlayerPage');

// 歌曲输入元素
const wyySongNameInput = document.getElementById('wyySongNameInput');
const wyySingerNameInput = document.getElementById('wyySingerNameInput');
const wyySongUrlInput = document.getElementById('wyySongUrlInput');
const wyyLyricUrlInput = document.getElementById('wyyLyricUrlInput');

// 上传选项按钮
const wyyUrlOptionBtn = document.getElementById('wyyUrlOptionBtn');
const wyyFileOptionBtn = document.getElementById('wyyFileOptionBtn');
const wyyUrlUploadSection = document.getElementById('wyyUrlUploadSection');
const wyyFileUploadSection = document.getElementById('wyyFileUploadSection');

const wyyLyricUrlOptionBtn = document.getElementById('wyyLyricUrlOptionBtn');
const wyyLyricFileOptionBtn = document.getElementById('wyyLyricFileOptionBtn');
const wyyLyricUrlUploadSection = document.getElementById('wyyLyricUrlUploadSection');
const wyyLyricFileUploadSection = document.getElementById('wyyLyricFileUploadSection');

// 文件上传按钮
const wyyUploadCoverBtn = document.getElementById('wyyUploadCoverBtn');
const wyyCoverFileInput = document.getElementById('wyyCoverFileInput');
const wyySongCoverPreview = document.getElementById('wyySongCoverPreview');
const wyyUploadSongFileBtn = document.getElementById('wyyUploadSongFileBtn');
const wyySongFileInput = document.getElementById('wyySongFileInput');
const wyyUploadLyricFileBtn = document.getElementById('wyyUploadLyricFileBtn');
const wyyLyricFileInput = document.getElementById('wyyLyricFileInput');

let wyyAudio = null;
let wyyProgressUpdateInterval = null;

// 播放列表数据
let wyyPlaylist = [];
let wyyCurrentSongIndex = 0;
let wyyCurrentPlaylistId = null; // 当前选中的歌单ID

// 播放模式：'order' 顺序播放, 'single' 单曲循环
let wyyPlayMode = 'order';

// 歌词显示状态：false 显示封面, true 显示歌词
let wyyShowLyrics = false;

// 当前歌词数据
let wyyCurrentLyrics = [];

// 临时存储上传的文件
let wyyTempSongCover = null;
let wyyTempSongFile = null;
let wyyTempLyricFile = null;

// 页面切换功能
if (wyyPlayBar) {
    wyyPlayBar.addEventListener('click', (e) => {
        if (!e.target.closest('.wyy-play-controls')) {
            wyyMainPage.classList.remove('active');
            wyyPlayerPage.classList.add('active');
            wyyUpdatePlayerPage();
        }
    });
}

if (wyyBackBtn) {
    wyyBackBtn.addEventListener('click', () => {
        wyyPlayerPage.classList.remove('active');
        wyyMainPage.classList.add('active');
    });
}

// 初始化播放列表
async function wyyInitPlaylist() {
    try {
        let songs;
        if (wyyCurrentPlaylistId) {
            // 加载指定歌单的歌曲
            songs = await wyyDb.songs.where('playlistId').equals(wyyCurrentPlaylistId).toArray();
            // 在内存中按日期排序
            songs.sort((a, b) => {
                const dateA = a.dateAdded ? new Date(a.dateAdded).getTime() : 0;
                const dateB = b.dateAdded ? new Date(b.dateAdded).getTime() : 0;
                return dateA - dateB;
            });
        } else {
            // 如果没有选中歌单，加载所有歌曲（兼容旧数据）
            songs = await wyyDb.songs.orderBy('dateAdded').toArray();
        }
        
        if (songs.length > 0) {
            wyyPlaylist = songs;
            
            // 加载每首歌曲的文件数据
            for (let i = 0; i < wyyPlaylist.length; i++) {
                const song = wyyPlaylist[i];
                
                // 加载歌曲文件
                const songFile = await wyyDb.songFiles.where({ songId: song.id }).first();
                if (songFile) {
                    song.hasLocalFile = true;
                    song.localFileData = songFile.data;
                    song.fileType = songFile.type;
                }
                
                // 加载歌词文件
                const lyric = await wyyDb.lyrics.where({ songId: song.id }).first();
                if (lyric) {
                    song.hasLocalLyric = true;
                    song.localLyricData = lyric.data;
                }
            }
            
            wyyUpdatePlaylistDisplay();
        } else {
            // 空歌单
            wyyPlaylist = [];
            wyyUpdatePlaylistDisplay();
        }
        
        // 设置当前播放的歌曲
        if (wyyPlaylist.length > 0) {
            await wyyLoadSong(wyyCurrentSongIndex);
        }
    } catch (error) {
        console.error('初始化播放列表失败:', error);
    }
}

// 更新播放列表显示
function wyyUpdatePlaylistDisplay() {
    if (!wyySongsList) return;
    
    if (wyyPlaylist.length === 0) {
        if (wyyEmptyPlaylist) wyyEmptyPlaylist.style.display = 'block';
        wyySongsList.innerHTML = '<div class="wyy-empty-playlist">暂无歌曲，请添加歌曲</div>';
        return;
    }
    
    if (wyyEmptyPlaylist) wyyEmptyPlaylist.style.display = 'none';
    
    let songsHTML = '';
    wyyPlaylist.forEach((song, index) => {
        const isActive = index === wyyCurrentSongIndex;
        const hasCover = song.cover && song.cover !== '';
        songsHTML += `
            <div class="wyy-song-item ${isActive ? 'active' : ''}" data-index="${index}">
                <div class="wyy-song-item-icon ${!hasCover ? 'default' : ''}" style="${hasCover ? `background-image: url(${song.cover})` : ''}">
                    ${!hasCover ? (isActive ? '<i class="fa fa-play"></i>' : (index + 1)) : ''}
                </div>
                <div class="wyy-song-item-info">
                    <div class="wyy-song-item-name">${song.name}</div>
                    <div class="wyy-song-item-singer">${song.singer}</div>
                </div>
                <div class="wyy-song-item-actions" style="display: flex; gap: 5px; align-items: center;">
                    <button class="wyy-song-item-add" data-song-id="${song.id}" title="添加到歌单">
                        <i class="fa fa-plus"></i>
                    </button>
                    <button class="wyy-song-item-remove" data-index="${index}">
                        <i class="fa fa-times"></i>
                    </button>
                </div>
            </div>
        `;
    });
    
    wyySongsList.innerHTML = songsHTML;
    
    // 添加歌曲点击事件
    document.querySelectorAll('.wyy-song-item').forEach(item => {
        item.addEventListener('click', function(e) {
            if (!e.target.closest('.wyy-song-item-remove') && !e.target.closest('.wyy-song-item-add') && !e.target.closest('.wyy-song-item-actions')) {
                const index = parseInt(this.getAttribute('data-index'));
                wyyPlaySong(index);
                if (wyyPlaylistModal) wyyPlaylistModal.style.display = 'none';
            }
        });
    });
    
    // 添加"添加到歌单"按钮点击事件
    document.querySelectorAll('.wyy-song-item-add').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            const songId = parseInt(this.getAttribute('data-song-id'));
            wyyShowAddToPlaylistModal(songId);
        });
    });
    
    // 添加删除按钮点击事件
    document.querySelectorAll('.wyy-song-item-remove').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            const index = parseInt(this.getAttribute('data-index'));
            wyyRemoveSong(index);
        });
    });
}

// 更新播放器页面
function wyyUpdatePlayerPage() {
    if (wyyPlaylist.length === 0 || wyyCurrentSongIndex >= wyyPlaylist.length) return;
    
    const song = wyyPlaylist[wyyCurrentSongIndex];
    if (wyyPlayerSongName) wyyPlayerSongName.textContent = song.name;
    if (wyyPlayerSingerName) wyyPlayerSingerName.textContent = song.singer;
    
    if (wyyAlbumArtLarge) {
        if (song.cover && song.cover !== '') {
            wyyAlbumArtLarge.style.backgroundImage = `url(${song.cover})`;
        } else {
            wyyAlbumArtLarge.style.backgroundImage = '';
            wyyAlbumArtLarge.style.backgroundColor = '#f5f5f5';
        }
    }
    
    if (wyyAudio) {
        if (wyyTotalTime) wyyTotalTime.textContent = wyyFormatTime(wyyAudio.duration || 299);
        wyyStartProgressUpdate();
    }
    
    // 更新歌词显示状态
    const wyyLyricsContainer = document.getElementById('wyyLyricsContainer');
    if (wyyShowLyrics) {
        if (wyyAlbumArtLarge) wyyAlbumArtLarge.classList.add('hidden');
        if (wyyLyricsContainer) wyyLyricsContainer.classList.add('active');
        wyyUpdateLyricsDisplay();
    } else {
        if (wyyAlbumArtLarge) wyyAlbumArtLarge.classList.remove('hidden');
        if (wyyLyricsContainer) wyyLyricsContainer.classList.remove('active');
    }
}

// 播放指定索引的歌曲
async function wyyPlaySong(index) {
    if (index >= 0 && index < wyyPlaylist.length) {
        wyyCurrentSongIndex = index;
        await wyyLoadSong(index);
        wyyPlayCurrentSong();
        wyyUpdatePlaylistDisplay();
        wyyUpdatePlayerPage();
    }
}

// 加载歌曲
async function wyyLoadSong(index) {
    const song = wyyPlaylist[index];
    
    // 停止当前播放
    if (wyyAudio) {
        wyyAudio.pause();
        wyyStopProgressUpdate();
        if (wyyRecordCover) wyyRecordCover.classList.remove('playing');
        if (wyyPlayBtn) wyyPlayBtn.innerHTML = '<i class="fa fa-play"></i>';
        if (wyyPlayerPlayBtn) wyyPlayerPlayBtn.innerHTML = '<i class="fa fa-play"></i>';
        
        // 释放之前的对象URL
        if (wyyAudio.src && wyyAudio.src.startsWith('blob:')) {
            URL.revokeObjectURL(wyyAudio.src);
        }
    }
    
    // 创建新的音频对象
    try {
        if (song.hasLocalFile && song.localFileData) {
            // 将Base64转换为Blob并创建对象URL
            const audioData = wyyBase64ToBlob(song.localFileData, song.fileType || 'audio/mpeg');
            const audioUrl = URL.createObjectURL(audioData);
            wyyAudio = new Audio(audioUrl);
        } else if (song.url) {
            // 处理网易云音乐URL（可能需要特殊处理）
            let audioUrl = song.url;
            // 如果是网易云的外链，尝试添加参数
            if (audioUrl.includes('music.163.com')) {
                // 网易云外链可能需要特殊处理
                console.log('检测到网易云音乐URL，可能需要特殊处理');
            }
            
            wyyAudio = new Audio(audioUrl);
            // 添加跨域支持
            wyyAudio.crossOrigin = 'anonymous';
            // 设置加载策略
            wyyAudio.load();
        } else {
            console.error('没有有效的歌曲文件');
            alert('无法加载歌曲文件，请检查文件格式');
            return;
        }
        
        wyyAudio.loop = false;
        wyyAudio.preload = 'auto';
        
        // 错误处理
        wyyAudio.addEventListener('error', (e) => {
            console.error('音频加载错误:', e);
            const error = wyyAudio.error;
            let errorMsg = '音频加载失败';
            if (error) {
                switch(error.code) {
                    case error.MEDIA_ERR_ABORTED:
                        errorMsg = '音频加载被中止';
                        break;
                    case error.MEDIA_ERR_NETWORK:
                        errorMsg = '网络错误，请检查网络连接';
                        break;
                    case error.MEDIA_ERR_DECODE:
                        errorMsg = '音频解码失败，可能格式不支持';
                        break;
                    case error.MEDIA_ERR_SRC_NOT_SUPPORTED:
                        errorMsg = '音频格式不支持，请尝试其他格式';
                        break;
                }
            }
            console.error(errorMsg);
        });
        
        // 更新音频事件监听
        wyyAudio.addEventListener('ended', wyyHandleSongEnded);
        wyyAudio.addEventListener('loadedmetadata', () => {
            if (wyyAudio.duration && !isNaN(wyyAudio.duration) && isFinite(wyyAudio.duration)) {
                if (wyyTotalTime) wyyTotalTime.textContent = wyyFormatTime(wyyAudio.duration);
                console.log('音频时长:', wyyAudio.duration, '秒');
            } else {
                console.warn('无法获取音频时长');
            }
            wyyUpdateProgress();
        });
        wyyAudio.addEventListener('canplay', () => {
            console.log('音频可以开始播放');
        });
        wyyAudio.addEventListener('canplaythrough', () => {
            console.log('音频完全加载，可以流畅播放');
        });
        wyyAudio.addEventListener('loadeddata', () => {
            console.log('音频数据加载完成');
        });
        wyyAudio.addEventListener('progress', () => {
            if (wyyAudio.buffered.length > 0) {
                const bufferedEnd = wyyAudio.buffered.end(wyyAudio.buffered.length - 1);
                const duration = wyyAudio.duration;
                if (duration > 0) {
                    const bufferedPercent = (bufferedEnd / duration) * 100;
                    console.log('音频缓冲进度:', bufferedPercent.toFixed(1) + '%');
                }
            }
        });
        wyyAudio.addEventListener('stalled', () => {
            console.warn('音频加载停滞');
        });
        wyyAudio.addEventListener('suspend', () => {
            console.warn('音频加载暂停');
        });
        wyyAudio.addEventListener('timeupdate', () => {
            wyyUpdateProgress();
            if (wyyShowLyrics) {
                wyyUpdateLyricsDisplay();
            }
        });
        
        // 更新显示
        if (wyyCurrentSongName) wyyCurrentSongName.textContent = song.name;
        if (wyyCurrentSingerName) wyyCurrentSingerName.textContent = song.singer;
        
        // 更新唱片封面
        if (wyyCurrentRecordContainer) {
            if (song.cover && song.cover !== '') {
                wyyCurrentRecordContainer.style.backgroundImage = `url(${song.cover})`;
            } else {
                wyyCurrentRecordContainer.style.backgroundImage = '';
                wyyCurrentRecordContainer.style.backgroundColor = '#cccccc';
            }
        }
        
        // 加载歌词
        if (song.hasLocalLyric && song.localLyricData) {
            wyyLoadLyricsFromText(song.localLyricData);
        } else if (song.lyricUrl) {
            wyyLoadLyricsFromUrl(song.lyricUrl);
        } else if (song.lyricText) {
            wyyLoadLyricsFromText(song.lyricText);
        }
    } catch (error) {
        console.error('加载歌曲失败:', error);
        alert('加载歌曲失败，请检查文件');
    }
}

// Base64转Blob
function wyyBase64ToBlob(base64, contentType = '') {
    const byteCharacters = atob(base64.split(',')[1]);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: contentType });
}

// 播放当前歌曲
async function wyyPlayCurrentSong() {
    if (!wyyAudio) return;
    
    try {
        // 等待音频可以播放
        if (wyyAudio.readyState < 2) {
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('音频加载超时'));
                }, 10000);
                
                const checkReady = () => {
                    if (wyyAudio.readyState >= 2) {
                        clearTimeout(timeout);
                        resolve();
                    } else {
                        setTimeout(checkReady, 100);
                    }
                };
                
                wyyAudio.addEventListener('canplay', () => {
                    clearTimeout(timeout);
                    resolve();
                }, { once: true });
                
                checkReady();
            });
        }
        
        await wyyAudio.play();
        if (wyyPlayBtn) wyyPlayBtn.innerHTML = '<i class="fa fa-pause"></i>';
        if (wyyPlayerPlayBtn) wyyPlayerPlayBtn.innerHTML = '<i class="fa fa-pause"></i>';
        if (wyyRecordCover) wyyRecordCover.classList.add('playing');
        wyyStartProgressUpdate();
        console.log('播放成功');
    } catch (err) {
        console.error('播放失败:', err);
        let errorMsg = '播放失败';
        if (err.name === 'NotAllowedError') {
            errorMsg = '浏览器阻止了自动播放，请手动点击播放按钮';
        } else if (err.name === 'NotSupportedError') {
            errorMsg = '音频格式不支持，请尝试其他格式';
        } else if (err.message === '音频加载超时') {
            errorMsg = '音频加载超时，请检查网络连接或文件';
        } else {
            errorMsg = '播放失败：' + err.message;
        }
        alert(errorMsg);
    }
}

// 处理歌曲结束
function wyyHandleSongEnded() {
    if (wyyPlaylist.length > 0) {
        if (wyyPlayMode === 'single') {
            // 单曲循环：重新播放当前歌曲
            wyyAudio.currentTime = 0;
            wyyPlayCurrentSong();
        } else {
            // 顺序播放：播放下一首
            wyyCurrentSongIndex = (wyyCurrentSongIndex + 1) % wyyPlaylist.length;
            wyyLoadSong(wyyCurrentSongIndex);
            wyyPlayCurrentSong();
            wyyUpdatePlaylistDisplay();
            wyyUpdatePlayerPage();
        }
    } else {
        if (wyyPlayBtn) wyyPlayBtn.innerHTML = '<i class="fa fa-play"></i>';
        if (wyyPlayerPlayBtn) wyyPlayerPlayBtn.innerHTML = '<i class="fa fa-play"></i>';
        if (wyyRecordCover) wyyRecordCover.classList.remove('playing');
        wyyStopProgressUpdate();
    }
}

// 添加上传歌曲
async function wyyAddSong() {
    if (!wyySongNameInput || !wyySingerNameInput) return;
    
    const name = wyySongNameInput.value.trim();
    const singer = wyySingerNameInput.value.trim();
    const url = wyySongUrlInput ? wyySongUrlInput.value.trim() : '';
    const lyricUrl = wyyLyricUrlInput ? wyyLyricUrlInput.value.trim() : '';
    
    if (!name || !singer) {
        alert('请填写歌曲名称和歌手');
        return;
    }
    
    // 检查是否有歌曲文件
    if (!wyyTempSongFile && !url) {
        alert('请上传歌曲文件或输入歌曲URL');
        return;
    }
    
    // 检查是否选中了歌单
    if (!wyyCurrentPlaylistId) {
        alert('请先选择一个歌单或创建新歌单');
        return;
    }
    
    try {
        const songData = {
            name,
            singer,
            cover: wyyTempSongCover || '',
            lyricUrl: '',
            playlistId: wyyCurrentPlaylistId,
            hasLocalFile: false,
            hasLocalLyric: false,
            dateAdded: new Date()
        };
        
        // 保存歌曲基本信息
        const songId = await wyyDb.songs.add(songData);
        
        // 处理歌曲文件
        if (wyyTempSongFile) {
            await wyyDb.songFiles.add({
                songId: songId,
                type: wyyTempSongFile.type,
                data: wyyTempSongFile.data
            });
            
            songData.hasLocalFile = true;
            songData.localFileData = wyyTempSongFile.data;
            songData.fileType = wyyTempSongFile.type;
        } else if (url) {
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                alert('请提供有效的歌曲URL（以http://或https://开头）');
                return;
            }
            songData.url = url;
            await wyyDb.songs.update(songId, { url: url });
        }
        
        // 处理歌词文件
        if (wyyTempLyricFile) {
            await wyyDb.lyrics.add({
                songId: songId,
                data: wyyTempLyricFile.data
            });
            
            songData.hasLocalLyric = true;
            songData.localLyricData = wyyTempLyricFile.data;
        } else if (lyricUrl) {
            songData.lyricUrl = lyricUrl;
            await wyyDb.songs.update(songId, { lyricUrl: lyricUrl });
        }
        
        // 处理封面
        if (wyyTempSongCover) {
            await wyyDb.songs.update(songId, { cover: wyyTempSongCover });
        }
        
        songData.id = songId;
        wyyPlaylist.push(songData);
        
        // 清空输入框和临时数据
        wyySongNameInput.value = '';
        wyySingerNameInput.value = '';
        if (wyySongUrlInput) wyySongUrlInput.value = '';
        if (wyyLyricUrlInput) wyyLyricUrlInput.value = '';
        if (wyySongCoverPreview) wyySongCoverPreview.style.backgroundImage = '';
        wyyTempSongCover = null;
        wyyTempSongFile = null;
        wyyTempLyricFile = null;
        
        wyyUpdatePlaylistDisplay();
        
        // 如果是第一首歌曲，设置为当前播放
        if (wyyPlaylist.length === 1) {
            wyyCurrentSongIndex = 0;
            await wyyLoadSong(0);
        }
        
        alert('歌曲添加成功！');
    } catch (error) {
        console.error('添加歌曲失败:', error);
        alert('添加歌曲失败，请重试');
    }
}

// 删除歌曲
async function wyyRemoveSong(index) {
    if (index >= 0 && index < wyyPlaylist.length) {
        const song = wyyPlaylist[index];
        
        try {
            // 从数据库中删除
            await wyyDb.songs.delete(song.id);
            await wyyDb.songFiles.where({ songId: song.id }).delete();
            await wyyDb.lyrics.where({ songId: song.id }).delete();
            
            // 释放对象URL
            if (song.hasLocalFile && wyyAudio && wyyAudio.src && wyyAudio.src.startsWith('blob:')) {
                URL.revokeObjectURL(wyyAudio.src);
            }
            
            wyyPlaylist.splice(index, 1);
            
            // 如果删除的是当前播放的歌曲
            if (index === wyyCurrentSongIndex) {
                if (wyyPlaylist.length > 0) {
                    wyyCurrentSongIndex = Math.min(wyyCurrentSongIndex, wyyPlaylist.length - 1);
                    await wyyLoadSong(wyyCurrentSongIndex);
                    if (wyyAudio && !wyyAudio.paused) {
                        wyyPlayCurrentSong();
                    }
                } else {
                    if (wyyAudio) {
                        wyyAudio.pause();
                    }
                    if (wyyCurrentSongName) wyyCurrentSongName.textContent = '暂无歌曲';
                    if (wyyCurrentSingerName) wyyCurrentSingerName.textContent = '';
                    if (wyyPlayerSongName) wyyPlayerSongName.textContent = '暂无歌曲';
                    if (wyyPlayerSingerName) wyyPlayerSingerName.textContent = '';
                    if (wyyCurrentRecordContainer) {
                        wyyCurrentRecordContainer.style.backgroundImage = '';
                        wyyCurrentRecordContainer.style.backgroundColor = '#cccccc';
                    }
                    if (wyyAlbumArtLarge) {
                        wyyAlbumArtLarge.style.backgroundImage = '';
                        wyyAlbumArtLarge.style.backgroundColor = '#f5f5f5';
                    }
                    if (wyyPlayBtn) wyyPlayBtn.innerHTML = '<i class="fa fa-play"></i>';
                    if (wyyPlayerPlayBtn) wyyPlayerPlayBtn.innerHTML = '<i class="fa fa-play"></i>';
                    if (wyyRecordCover) wyyRecordCover.classList.remove('playing');
                    wyyStopProgressUpdate();
                }
            } else if (index < wyyCurrentSongIndex) {
                wyyCurrentSongIndex--;
            }
            
            wyyUpdatePlaylistDisplay();
            wyyUpdatePlayerPage();
        } catch (error) {
            console.error('删除歌曲失败:', error);
        }
    }
}

// 清空列表
async function wyyClearAllSongs() {
    if (wyyPlaylist.length > 0 && confirm('确定要清空所有歌曲吗？')) {
        try {
            // 释放所有对象URL
            wyyPlaylist.forEach(song => {
                if (song.hasLocalFile && wyyAudio && wyyAudio.src && wyyAudio.src.startsWith('blob:')) {
                    URL.revokeObjectURL(wyyAudio.src);
                }
            });
            
            // 清空数据库
            await wyyDb.songs.clear();
            await wyyDb.songFiles.clear();
            await wyyDb.lyrics.clear();
            
            wyyPlaylist = [];
            if (wyyAudio) {
                wyyAudio.pause();
            }
            if (wyyCurrentSongName) wyyCurrentSongName.textContent = '暂无歌曲';
            if (wyyCurrentSingerName) wyyCurrentSingerName.textContent = '';
            if (wyyPlayerSongName) wyyPlayerSongName.textContent = '暂无歌曲';
            if (wyyPlayerSingerName) wyyPlayerSingerName.textContent = '';
            if (wyyCurrentRecordContainer) {
                wyyCurrentRecordContainer.style.backgroundImage = '';
                wyyCurrentRecordContainer.style.backgroundColor = '#cccccc';
            }
            if (wyyAlbumArtLarge) {
                wyyAlbumArtLarge.style.backgroundImage = '';
                wyyAlbumArtLarge.style.backgroundColor = '#f5f5f5';
            }
            if (wyyPlayBtn) wyyPlayBtn.innerHTML = '<i class="fa fa-play"></i>';
            if (wyyPlayerPlayBtn) wyyPlayerPlayBtn.innerHTML = '<i class="fa fa-play"></i>';
            if (wyyRecordCover) wyyRecordCover.classList.remove('playing');
            wyyStopProgressUpdate();
            
            wyyUpdatePlaylistDisplay();
            wyyUpdatePlayerPage();
        } catch (error) {
            console.error('清空列表失败:', error);
        }
    }
}

// 加载歌词
function wyyLoadLyricsFromUrl(url) {
    if (!url) {
        wyyCurrentLyrics = [];
        wyyUpdateLyricsDisplay();
        return;
    }
    
    fetch(url)
        .then(response => response.text())
        .then(text => {
            wyyLoadLyricsFromText(text);
        })
        .catch(error => {
            console.log('歌词加载失败:', error);
            wyyCurrentLyrics = [];
            wyyUpdateLyricsDisplay();
        });
}

// 解析LRC歌词
function wyyParseLyrics(text) {
    if (!text) return [];
    
    const lines = text.split('\n');
    const lyrics = [];
    
    for (let line of lines) {
        line = line.trim();
        if (!line) continue;
        
        // 匹配时间标签 [mm:ss.xx] 或 [mm:ss]
        const timeRegex = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/g;
        const matches = [...line.matchAll(timeRegex)];
        
        if (matches.length > 0) {
            const lyricText = line.replace(timeRegex, '').trim();
            if (!lyricText) continue;
            
            for (let match of matches) {
                const minutes = parseInt(match[1]);
                const seconds = parseInt(match[2]);
                const milliseconds = match[3] ? parseInt(match[3].padEnd(3, '0')) : 0;
                const time = minutes * 60 + seconds + milliseconds / 1000;
                
                lyrics.push({
                    time: time,
                    text: lyricText
                });
            }
        }
    }
    
    // 按时间排序
    lyrics.sort((a, b) => a.time - b.time);
    return lyrics;
}

function wyyLoadLyricsFromText(text) {
    if (!text) {
        wyyCurrentLyrics = [];
        wyyUpdateLyricsDisplay();
        return;
    }
    
    // 如果是Base64编码，先解码
    let lyricText = text;
    if (text.startsWith('data:text/plain;base64,')) {
        try {
            const base64Data = text.split(',')[1];
            lyricText = atob(base64Data);
        } catch (e) {
            console.error('歌词解码失败:', e);
        }
    }
    
    wyyCurrentLyrics = wyyParseLyrics(lyricText);
    wyyUpdateLyricsDisplay();
}

// 更新歌词显示
function wyyUpdateLyricsDisplay() {
    const lyricsContent = document.getElementById('wyyLyricsContent');
    if (!lyricsContent) return;
    
    if (wyyCurrentLyrics.length === 0) {
        lyricsContent.innerHTML = '<div style="opacity: 0.6;">暂无歌词</div>';
        return;
    }
    
    // 如果正在播放，高亮当前歌词
    if (wyyAudio && !wyyAudio.paused) {
        const currentTime = wyyAudio.currentTime;
        let activeIndex = -1;
        
        for (let i = wyyCurrentLyrics.length - 1; i >= 0; i--) {
            if (currentTime >= wyyCurrentLyrics[i].time) {
                activeIndex = i;
                break;
            }
        }
        
        let html = '';
        wyyCurrentLyrics.forEach((lyric, index) => {
            const isActive = index === activeIndex;
            html += `<div style="margin: 10px 0; ${isActive ? 'color: #fff; font-weight: bold; font-size: 18px;' : 'opacity: 0.6;'}">${lyric.text}</div>`;
        });
        
        lyricsContent.innerHTML = html;
        
        // 滚动到当前歌词
        if (activeIndex >= 0) {
            const activeElement = lyricsContent.children[activeIndex];
            if (activeElement) {
                activeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    } else {
        // 未播放时显示所有歌词
        let html = '';
        wyyCurrentLyrics.forEach(lyric => {
            html += `<div style="margin: 10px 0; opacity: 0.6;">${lyric.text}</div>`;
        });
        lyricsContent.innerHTML = html;
    }
}

// 播放按钮事件
if (wyyPlayBtn) {
    wyyPlayBtn.addEventListener('click', async () => {
        if (wyyPlaylist.length === 0) {
            alert('请先添加歌曲');
            return;
        }
        
        if (!wyyAudio) {
            await wyyLoadSong(wyyCurrentSongIndex);
        }
        
        if (wyyAudio && wyyAudio.paused) {
            await wyyPlayCurrentSong();
        } else if (wyyAudio) {
            wyyAudio.pause();
            wyyPlayBtn.innerHTML = '<i class="fa fa-play"></i>';
            if (wyyPlayerPlayBtn) wyyPlayerPlayBtn.innerHTML = '<i class="fa fa-play"></i>';
            if (wyyRecordCover) wyyRecordCover.classList.remove('playing');
            wyyStopProgressUpdate();
        }
    });
}

if (wyyPlayerPlayBtn) {
    wyyPlayerPlayBtn.addEventListener('click', async () => {
        if (wyyPlaylist.length === 0) {
            alert('请先添加歌曲');
            return;
        }
        
        if (!wyyAudio) {
            await wyyLoadSong(wyyCurrentSongIndex);
        }
        
        if (wyyAudio && wyyAudio.paused) {
            await wyyPlayCurrentSong();
        } else if (wyyAudio) {
            wyyAudio.pause();
            if (wyyPlayBtn) wyyPlayBtn.innerHTML = '<i class="fa fa-play"></i>';
            wyyPlayerPlayBtn.innerHTML = '<i class="fa fa-play"></i>';
            if (wyyRecordCover) wyyRecordCover.classList.remove('playing');
            wyyStopProgressUpdate();
        }
    });
}

// 上一首/下一首
if (wyyPrevBtn) {
    wyyPrevBtn.addEventListener('click', () => {
        if (wyyPlaylist.length === 0) return;
        
        wyyCurrentSongIndex = (wyyCurrentSongIndex - 1 + wyyPlaylist.length) % wyyPlaylist.length;
        wyyPlaySong(wyyCurrentSongIndex);
    });
}

if (wyyNextBtn) {
    wyyNextBtn.addEventListener('click', () => {
        if (wyyPlaylist.length === 0) return;
        
        wyyCurrentSongIndex = (wyyCurrentSongIndex + 1) % wyyPlaylist.length;
        wyyPlaySong(wyyCurrentSongIndex);
    });
}

// 循环模式切换
const wyyLoopModeBtn = document.getElementById('wyyLoopModeBtn');
const wyyLoopIcon = document.getElementById('wyyLoopIcon');

if (wyyLoopModeBtn && wyyLoopIcon) {
    wyyLoopModeBtn.addEventListener('click', () => {
        if (wyyPlayMode === 'order') {
            // 切换到单曲循环
            wyyPlayMode = 'single';
            wyyLoopIcon.className = 'fa fa-repeat';
            wyyLoopModeBtn.classList.add('wyy-loop-mode-single');
            if (wyyAudio) {
                wyyAudio.loop = false; // 使用自定义循环逻辑
            }
        } else {
            // 切换到顺序播放
            wyyPlayMode = 'order';
            wyyLoopIcon.className = 'fa fa-list';
            wyyLoopModeBtn.classList.remove('wyy-loop-mode-single');
            if (wyyAudio) {
                wyyAudio.loop = false;
            }
        }
    });
}

// 播放列表按钮事件（主页面）
if (wyyPlaylistBtn) {
    wyyPlaylistBtn.addEventListener('click', () => {
        if (wyyPlaylistModal) wyyPlaylistModal.style.display = 'flex';
    });
}

// 播放器详情页面的播放列表按钮（打开播放列表）
const wyyPlayerPlaylistBtn = document.getElementById('wyyPlayerPlaylistBtn');
const wyyLyricsContainer = document.getElementById('wyyLyricsContainer');

if (wyyPlayerPlaylistBtn) {
    wyyPlayerPlaylistBtn.addEventListener('click', () => {
        if (wyyPlaylistModal) wyyPlaylistModal.style.display = 'flex';
    });
}

// 封面点击切换歌词
if (wyyAlbumArtLarge) {
    wyyAlbumArtLarge.addEventListener('click', () => {
        wyyShowLyrics = !wyyShowLyrics;
        
        if (wyyShowLyrics) {
            wyyAlbumArtLarge.classList.add('hidden');
            if (wyyLyricsContainer) wyyLyricsContainer.classList.add('active');
            wyyUpdateLyricsDisplay();
        } else {
            wyyAlbumArtLarge.classList.remove('hidden');
            if (wyyLyricsContainer) wyyLyricsContainer.classList.remove('active');
        }
    });
}

// 进度条功能
function wyyStartProgressUpdate() {
    wyyStopProgressUpdate();
    wyyProgressUpdateInterval = setInterval(wyyUpdateProgress, 1000);
    wyyUpdateProgress();
}

function wyyStopProgressUpdate() {
    if (wyyProgressUpdateInterval) {
        clearInterval(wyyProgressUpdateInterval);
        wyyProgressUpdateInterval = null;
    }
}

function wyyUpdateProgress() {
    if (!wyyAudio || !wyyAudio.duration) return;
    
    const percent = (wyyAudio.currentTime / wyyAudio.duration) * 100;
    if (wyyProgress) wyyProgress.style.width = percent + '%';
    if (wyyCurrentTime) wyyCurrentTime.textContent = wyyFormatTime(wyyAudio.currentTime);
    if (wyyTotalTime) wyyTotalTime.textContent = wyyFormatTime(wyyAudio.duration);
}

function wyyFormatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

if (wyyProgressBar) {
    wyyProgressBar.addEventListener('click', (e) => {
        if (!wyyAudio) return;
        
        const rect = wyyProgressBar.getBoundingClientRect();
        const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        wyyAudio.currentTime = percent * wyyAudio.duration;
        wyyUpdateProgress();
    });
}

// 添加上传选项切换功能
if (wyyUrlOptionBtn && wyyFileOptionBtn && wyyUrlUploadSection && wyyFileUploadSection) {
    wyyUrlOptionBtn.addEventListener('click', () => {
        wyyUrlOptionBtn.classList.add('active');
        wyyFileOptionBtn.classList.remove('active');
        wyyUrlUploadSection.classList.add('active');
        wyyFileUploadSection.classList.remove('active');
    });

    wyyFileOptionBtn.addEventListener('click', () => {
        wyyFileOptionBtn.classList.add('active');
        wyyUrlOptionBtn.classList.remove('active');
        wyyFileUploadSection.classList.add('active');
        wyyUrlUploadSection.classList.remove('active');
    });
}

if (wyyLyricUrlOptionBtn && wyyLyricFileOptionBtn && wyyLyricUrlUploadSection && wyyLyricFileUploadSection) {
    wyyLyricUrlOptionBtn.addEventListener('click', () => {
        wyyLyricUrlOptionBtn.classList.add('active');
        wyyLyricFileOptionBtn.classList.remove('active');
        wyyLyricUrlUploadSection.classList.add('active');
        wyyLyricFileUploadSection.classList.remove('active');
    });

    wyyLyricFileOptionBtn.addEventListener('click', () => {
        wyyLyricFileOptionBtn.classList.add('active');
        wyyLyricUrlOptionBtn.classList.remove('active');
        wyyLyricFileUploadSection.classList.add('active');
        wyyLyricUrlUploadSection.classList.remove('active');
    });
}

// 上传封面按钮
if (wyyUploadCoverBtn && wyyCoverFileInput) {
    wyyUploadCoverBtn.addEventListener('click', () => {
        wyyCoverFileInput.click();
    });

    wyyCoverFileInput.addEventListener('change', function(event) {
        const file = event.target.files[0];
        if (file) {
            if (!file.type.match('image.*')) {
                alert('请选择图片文件！');
                return;
            }
            
            if (file.size > 2 * 1024 * 1024) {
                alert('图片大小不能超过2MB！');
                return;
            }
            
            const reader = new FileReader();
            reader.onload = function(e) {
                if (wyySongCoverPreview) wyySongCoverPreview.style.backgroundImage = `url(${e.target.result})`;
                wyyTempSongCover = e.target.result;
            };
            reader.readAsDataURL(file);
        }
    });
}

// 上传歌曲文件按钮
if (wyyUploadSongFileBtn && wyySongFileInput) {
    wyyUploadSongFileBtn.addEventListener('click', () => {
        wyySongFileInput.click();
    });

    wyySongFileInput.addEventListener('change', function(event) {
        const file = event.target.files[0];
        if (file) {
            const validAudioTypes = [
                'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave', 'audio/x-wav',
                'audio/ogg', 'audio/oga', 'audio/x-m4a', 'audio/mp4', 'audio/flac',
                'audio/x-flac', 'audio/aac', 'audio/aacp'
            ];
            
            const validExtensions = ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac'];
            const fileName = file.name.toLowerCase();
            const isValidExtension = validExtensions.some(ext => fileName.endsWith(ext));
            
            if (!validAudioTypes.includes(file.type) && !isValidExtension) {
                alert('请选择有效的音频文件（MP3、WAV、OGG、M4A、FLAC、AAC等格式）！');
                return;
            }
            
            if (file.size > 50 * 1024 * 1024) {
                alert('音频文件大小不能超过50MB！');
                return;
            }
            
            const reader = new FileReader();
            reader.onload = function(e) {
                wyyTempSongFile = {
                    data: e.target.result,
                    type: file.type || 'audio/mpeg',
                    name: file.name
                };
                alert(`已选择歌曲文件: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
            };
            reader.readAsDataURL(file);
        }
    });
}

// 上传歌词文件按钮
if (wyyUploadLyricFileBtn && wyyLyricFileInput) {
    wyyUploadLyricFileBtn.addEventListener('click', () => {
        wyyLyricFileInput.click();
    });

    wyyLyricFileInput.addEventListener('change', function(event) {
        const file = event.target.files[0];
        if (file) {
            const validTypes = ['.lrc', '.txt'];
            const fileName = file.name.toLowerCase();
            const isValidType = validTypes.some(type => fileName.endsWith(type));
            
            if (!isValidType) {
                alert('请选择LRC或TXT格式的歌词文件！');
                return;
            }
            
            if (file.size > 1 * 1024 * 1024) {
                alert('歌词文件大小不能超过1MB！');
                return;
            }
            
            const reader = new FileReader();
            reader.onload = function(e) {
                wyyTempLyricFile = {
                    data: e.target.result,
                    name: file.name
                };
                alert(`已选择歌词文件: ${file.name}`);
            };
            reader.readAsDataURL(file);
        }
    });
}

// 添加歌曲按钮事件
if (wyyAddSongBtn) {
    wyyAddSongBtn.addEventListener('click', wyyAddSong);
}

// 清空列表按钮事件
if (wyyClearAllBtn) {
    wyyClearAllBtn.addEventListener('click', wyyClearAllSongs);
}

// 点击模态框外部关闭
if (wyyPlaylistModal) {
    wyyPlaylistModal.addEventListener('click', (e) => {
        if (e.target === wyyPlaylistModal) {
            wyyPlaylistModal.style.display = 'none';
            wyyTempSongCover = null;
            wyyTempSongFile = null;
            wyyTempLyricFile = null;
            if (wyySongCoverPreview) wyySongCoverPreview.style.backgroundImage = '';
        }
    });
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

// 短信编辑模式状态
let isMessageEditMode = false;
let selectedMessageChats = new Set();

// 切换短信编辑模式
async function toggleMessageEditMode() {
    isMessageEditMode = !isMessageEditMode;
    selectedMessageChats.clear();
    
    const editBtn = document.getElementById('message-edit-btn');
    const listContainer = document.getElementById('message-chat-list-container');
    
    if (isMessageEditMode) {
        editBtn.textContent = '完成';
        if (listContainer) {
            listContainer.classList.add('edit-mode');
        }
        // 显示切换账号和删除按钮
        showMessageEditActions();
    } else {
        editBtn.textContent = '编辑';
        if (listContainer) {
            listContainer.classList.remove('edit-mode');
        }
        // 隐藏操作按钮
        hideMessageEditActions();
    }
    
    // 重新渲染列表以显示选择框
    await renderMessageList();
}

// 显示编辑模式操作按钮
function showMessageEditActions() {
    const actionsContainer = document.getElementById('message-edit-actions');
    if (actionsContainer) {
        actionsContainer.style.display = 'block';
    }
    updateMessageDeleteButton();
}

// 隐藏编辑模式操作按钮
function hideMessageEditActions() {
    const actionsContainer = document.getElementById('message-edit-actions');
    if (actionsContainer) {
        actionsContainer.style.display = 'none';
    }
    const deleteBtn = document.getElementById('message-delete-btn');
    if (deleteBtn) {
        deleteBtn.style.display = 'none';
    }
}

// 在编辑模式下显示切换账号按钮
async function showMessageSwitchAccount() {
    await showSwitchAccountModal();
}

// 切换短信聊天选择状态
async function toggleMessageChatSelection(chatId) {
    if (!isMessageEditMode) return;
    
    // 不允许选择欢迎小助手
    if (chatId === 'welcome') return;
    
    if (selectedMessageChats.has(chatId)) {
        selectedMessageChats.delete(chatId);
    } else {
        selectedMessageChats.add(chatId);
    }
    
    await renderMessageList();
    updateMessageDeleteButton();
}

// 更新删除按钮状态
function updateMessageDeleteButton() {
    const deleteBtn = document.getElementById('message-delete-btn');
    if (deleteBtn) {
        if (selectedMessageChats.size > 0) {
            deleteBtn.style.display = 'flex';
            deleteBtn.textContent = `删除(${selectedMessageChats.size})`;
        } else {
            deleteBtn.style.display = 'none';
        }
    }
}

// 删除选中的短信聊天
async function deleteSelectedMessageChats() {
    if (selectedMessageChats.size === 0) return;
    
    // 过滤掉欢迎小助手（不允许删除）
    const chatsToDelete = Array.from(selectedMessageChats).filter(id => id !== 'welcome');
    if (chatsToDelete.length === 0) return;
    
    if (!confirm(`确定要删除选中的 ${chatsToDelete.length} 个聊天吗？`)) {
        return;
    }
    
    const smsMessages = JSON.parse(localStorage.getItem('sms_messages') || '[]');
    
    // 删除选中聊天的所有消息（排除欢迎小助手）
    const filteredMessages = smsMessages.filter(msg => {
        let chatId;
        if (msg.type === 'sent') {
            chatId = msg.number || msg.receiverId || msg.sender;
        } else {
            chatId = msg.number || msg.sender;
        }
        return !chatsToDelete.includes(chatId);
    });
    
    localStorage.setItem('sms_messages', JSON.stringify(filteredMessages));
    
    // 如果当前打开的聊天被删除了，先返回列表页
    if (currentMessageChatId && selectedMessageChats.has(currentMessageChatId)) {
        goBackMessageList();
    }
    
    // 清空选择并退出编辑模式
    selectedMessageChats.clear();
    isMessageEditMode = false;
    
    const editBtn = document.getElementById('message-edit-btn');
    if (editBtn) editBtn.textContent = '编辑';
    
    const listContainer = document.getElementById('message-chat-list-container');
    if (listContainer) {
        listContainer.classList.remove('edit-mode');
    }
    
    hideMessageEditActions();
    
    // 重新渲染列表
    await renderMessageList();
}

// 渲染信息列表
async function renderMessageList() {
    const listContainer = document.getElementById('message-chat-list-container');
    if (!listContainer) return;
    
    // 🎯 从 localStorage 读取短信记录（按账号过滤）
    const accountId = getCurrentAccountId();
    let smsMessages = JSON.parse(localStorage.getItem('sms_messages') || '[]');
    
    // 如果启用了账号隔离，只显示当前账号的消息
    if (accountId) {
        const myChar = await db.characters.get(parseInt(accountId));
        if (myChar) {
            const myName = myChar.nick || myChar.name;
            smsMessages = smsMessages.filter(msg => {
                // 对于发送的消息，检查sender是否是当前账号
                // 对于接收的消息，都显示（因为都是发给当前账号的）
                if (msg.type === 'sent') {
                    return msg.sender === myName;
                } else {
                    return true;
                }
            });
        }
    }
    
    // 按聊天ID分组（修复：发送的消息使用接收者ID，接收的消息使用发送者ID）
    const groupedChats = {};
    
    smsMessages.forEach(msg => {
        // 🎯 修复：对于发送的消息，使用number（接收者ID）分组
        // 对于接收的消息，使用number或sender（发送者ID）分组
        let chatId;
        if (msg.type === 'sent') {
            // 发送的消息：使用number字段（应该是接收者的ID）
            chatId = msg.number || msg.receiverId || msg.sender;
        } else {
            // 接收的消息：使用发送者的ID
            chatId = msg.number || msg.sender;
        }
        
        if (!groupedChats[chatId]) {
            // 🎯 修复：显示接收者的名字（对于发送的消息，使用存储的接收者信息）
            let displayName = msg.sender;
            let displayAvatar = msg.senderAvatar || 'https://img.icons8.com/color/96/user.png';
            
            // 如果是发送的消息，使用存储的接收者信息
            if (msg.type === 'sent' && msg.receiverName) {
                displayName = msg.receiverName;
                // 查找同聊天中接收的消息，获取接收者头像
                const receivedMsg = smsMessages.find(m => 
                    (m.number || m.sender) === chatId && m.type !== 'sent'
                );
                if (receivedMsg) {
                    displayAvatar = receivedMsg.senderAvatar || displayAvatar;
                }
            }
            
            groupedChats[chatId] = {
                id: chatId,
                name: displayName,
                avatar: displayAvatar,
                number: msg.number,
                messages: [],
                isBlocked: msg.isBlocked || false
            };
        }
        groupedChats[chatId].messages.push(msg);
    });
    
    // 转换成数组并按最新消息时间排序
    const chats = Object.values(groupedChats).map(chat => {
        const lastMsg = chat.messages[0]; // 因为unshift，第一个是最新的
        return {
            ...chat,
            time: formatMessageTime(lastMsg.time),
            preview: lastMsg.content,
            unread: !lastMsg.read
        };
    }).sort((a, b) => {
        return b.messages[0].time - a.messages[0].time;
    });
    
    // 始终添加欢迎消息（确保它始终显示在列表中）
    // 检查是否已存在欢迎消息，如果不存在则添加
    const hasWelcome = chats.some(chat => chat.id === 'welcome');
    if (!hasWelcome) {
        chats.push({
            id: 'welcome',
            name: '欢迎小助手',
            avatar: 'https://img.icons8.com/color/96/chat.png',
            time: '刚刚',
            preview: '欢迎使用这个网页！',
            unread: false
        });
    }
    
    listContainer.innerHTML = '';
    chats.forEach(chat => {
        const unreadClass = chat.unread ? 'message-unread' : '';
        const unreadDot = chat.unread ? `<div class="message-unread-dot"></div>` : '';
        const blockedBadge = chat.isBlocked ? `<span style="font-size:10px;background:#ff3b30;color:#fff;padding:2px 6px;border-radius:3px;margin-left:4px;">拉黑</span>` : '';
        const isSelected = selectedMessageChats.has(chat.id);
        const selectedClass = isSelected ? 'message-chat-selected' : '';
        
        // 欢迎小助手在编辑模式下不显示选择框，也不能被选择
        const isWelcome = chat.id === 'welcome';
        const showCheckbox = isMessageEditMode && !isWelcome;
        
        // 编辑模式下显示选择框，否则直接打开聊天（欢迎小助手始终可以打开）
        const onClickAction = showCheckbox
            ? `toggleMessageChatSelection('${chat.id}')`
            : `openMessageChat('${chat.id}')`;
        
        const checkbox = showCheckbox
            ? `<div class="message-chat-checkbox ${isSelected ? 'checked' : ''}">
                <svg viewBox="0 0 24 24" style="width:20px;height:20px;stroke:currentColor;fill:none;stroke-width:3;">
                    ${isSelected ? '<path d="M20 6L9 17l-5-5"></path>' : ''}
                </svg>
               </div>`
            : '';
        
        const html = `
            <div class="message-chat-item ${unreadClass} ${selectedClass}" onclick="${onClickAction}">
                ${checkbox}
                <div class="message-avatar">
                    <img src="${chat.avatar}" style="width:100%;height:100%;object-fit:cover;" onerror="this.src='https://img.icons8.com/color/96/user.png'">
                </div>
                <div class="message-chat-info">
                    <div class="message-chat-top">
                        <span class="message-chat-name">${chat.name}${blockedBadge}</span>
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
    
    // 更新删除按钮
    updateMessageDeleteButton();
}

// 格式化消息时间
function formatMessageTime(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    const date = new Date(timestamp);
    
    // 1分钟内
    if (diff < 60000) {
        return '刚刚';
    }
    // 1小时内
    if (diff < 3600000) {
        return Math.floor(diff / 60000) + '分钟前';
    }
    // 今天
    const today = new Date();
    if (date.getDate() === today.getDate() && 
        date.getMonth() === today.getMonth() && 
        date.getFullYear() === today.getFullYear()) {
        return date.getHours() + ':' + String(date.getMinutes()).padStart(2, '0');
    }
    // 昨天
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.getDate() === yesterday.getDate() && 
        date.getMonth() === yesterday.getMonth() && 
        date.getFullYear() === yesterday.getFullYear()) {
        return '昨天';
    }
    // 一周内
    if (diff < 7 * 24 * 3600000) {
        const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
        return days[date.getDay()];
    }
    // 更早
    return (date.getMonth() + 1) + '/' + date.getDate();
}

// 当前短信聊天的联系人ID（全局变量）
let currentMessageChatId = null;
let currentMessageChatName = null;

// 打开聊天详情
function openMessageChat(id) {
    console.log('openMessageChat called with id:', id);
    
    // 🎯 从 localStorage 读取短信记录
    const smsMessages = JSON.parse(localStorage.getItem('sms_messages') || '[]');
    
    // 查找该联系人的所有消息（修复：支持发送和接收的消息）
    const chatMessages = smsMessages.filter(msg => {
        if (msg.type === 'sent') {
            // 发送的消息：使用number（接收者ID）或receiverId匹配
            return (msg.number || msg.receiverId) === id;
        } else {
            // 接收的消息：使用发送者的ID匹配
            return (msg.number || msg.sender) === id;
        }
    });
    
    if (chatMessages.length === 0 && id !== 'welcome') {
        console.error('Chat not found:', id);
        return;
    }
    
    // 构建聊天对象
    let chat;
    if (id === 'welcome') {
        // 欢迎消息
        chat = {
            id: 'welcome',
            name: '欢迎小助手',
            avatar: 'https://img.icons8.com/color/96/chat.png',
            chatTimeLabel: '刚刚',
            messages: [{
                type: 'received',
                text: '欢迎使用这个网页！🎉\n\n这是一个仿 iOS 风格的信息应用，你可以在这里：\n\n• 查看和管理你的信息\n• 与好友聊天\n• 发送和接收消息\n\n希望你能喜欢这个设计！如有任何问题，随时告诉我。'
            }]
        };
        currentMessageChatId = null;
        currentMessageChatName = null;
    } else {
        // 真实短信
        console.log('[openMessageChat] 聊天消息数量:', chatMessages.length);
        console.log('[openMessageChat] 第一条消息:', chatMessages[0]);
        
        // 🎯 修复：找到接收消息来确定接收者信息（如果只有发送消息，使用存储的接收者信息）
        const receivedMsg = chatMessages.find(msg => msg.type !== 'sent');
        const firstMsg = receivedMsg || chatMessages[chatMessages.length - 1]; // 优先使用接收消息，否则用最早的消息
        
        console.log('[openMessageChat] 第一条消息内容:', firstMsg);
        
        // 确定显示的名字和头像
        let displayName = firstMsg.sender;
        let displayAvatar = firstMsg.senderAvatar || 'https://img.icons8.com/color/96/user.png';
        
        // 如果第一条消息是发送的消息，使用存储的接收者信息
        if (firstMsg.type === 'sent' && firstMsg.receiverName) {
            displayName = firstMsg.receiverName;
            // 尝试从接收消息中获取头像
            const receivedMsgForAvatar = chatMessages.find(msg => msg.type !== 'sent');
            if (receivedMsgForAvatar) {
                displayAvatar = receivedMsgForAvatar.senderAvatar || displayAvatar;
            }
        }
        
        console.log('[openMessageChat] 显示名称:', displayName);
        console.log('[openMessageChat] 显示头像:', displayAvatar);
        
        chat = {
            id: id,
            name: displayName,
            avatar: displayAvatar,
            chatTimeLabel: formatMessageTime(firstMsg.time || firstMsg.timestamp || Date.now()),
            messages: chatMessages.reverse().map(msg => {
                const msgText = msg.content || msg.message || '';
                console.log('[openMessageChat] 映射消息:', { type: msg.type, text: msgText });
                return {
                    type: msg.type || (msg.sender === displayName ? 'received' : 'sent'),
                    text: msgText
                };
            })
        };
        
        console.log('[openMessageChat] 最终聊天对象:', chat);
        
        // 保存当前聊天信息
        currentMessageChatId = id;
        currentMessageChatName = displayName;
        
        // 标记为已读（修复：支持发送和接收的消息）
        smsMessages.forEach(msg => {
            let matches = false;
            if (msg.type === 'sent') {
                matches = (msg.number || msg.receiverId) === id;
            } else {
                matches = (msg.number || msg.sender) === id;
            }
            if (matches) {
                msg.read = true;
            }
        });
        localStorage.setItem('sms_messages', JSON.stringify(smsMessages));
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
    
    // 初始化输入框状态（隐藏发送按钮，显示麦克风）
    const msgInput = document.getElementById('message-msg-input');
    if (msgInput) {
        msgInput.value = '';
        handleMessageInputChange(msgInput);
    }
}

// 确保函数在全局作用域
window.openMessageChat = openMessageChat;
window.sendMessageDetail = sendMessageDetail;
window.handleMessageInputChange = handleMessageInputChange;
window.acceptMessageReply = acceptMessageReply;
window.toggleMessageEditMode = toggleMessageEditMode;
window.toggleMessageChatSelection = toggleMessageChatSelection;
window.deleteSelectedMessageChats = deleteSelectedMessageChats;
window.showMessageSwitchAccount = showMessageSwitchAccount;

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

// 发送短信详情页的消息
async function sendMessageDetail() {
    const input = document.getElementById('message-msg-input');
    const text = input.value.trim();
    
    if (!text) return;
    
    // 如果没有当前聊天，不能发送
    if (!currentMessageChatId || currentMessageChatId === 'welcome') {
        alert('无法发送消息');
        return;
    }
    
    // 🎯 检查余额（每条短信0.1元）
    const SMS_COST = 0.1;
    const balance = getPhoneBalance();
    if (balance < SMS_COST) {
        const recharge = confirm(`余额不足（当前余额：¥${balance.toFixed(2)}）\n\n每条短信需要 ¥${SMS_COST.toFixed(2)}，请先充值。\n\n是否前往充值？`);
        if (recharge) {
            hideMessagePage();
            setTimeout(() => {
                showPhoneRechargePage();
            }, 300);
        }
        return;
    }
    
    // 获取当前用户信息
    const accountId = getCurrentAccountId();
    if (!accountId) {
        alert('请先登录');
        return;
    }
    
    const myChar = await db.characters.get(parseInt(accountId));
    if (!myChar) {
        alert('找不到用户信息');
        return;
    }
    
    // 🎯 扣费
    if (!deductPhoneBalance(SMS_COST)) {
        alert('扣费失败，请重试');
        return;
    }
    
    // 清空输入框
    input.value = '';
    handleMessageInputChange(input);
    
    // 保存发送的消息到 localStorage
    const smsMessages = JSON.parse(localStorage.getItem('sms_messages') || '[]');
    const myPhoneNumber = myChar.identity?.phone || generateVirtualPhoneNumber(myChar.id);
    
    // 🎯 关键修复：使用当前聊天的ID（接收者的ID）作为聊天标识
    // 这样消息会归入正确的聊天，而不是创建新的聊天
    // 同时存储接收者信息，确保分组和显示正确
    const newMessage = {
        id: Date.now() + Math.random().toString(36).substr(2, 9),
        sender: myChar.nick || myChar.name,
        senderAvatar: myChar.avatar,
        number: currentMessageChatId, // 使用接收者的ID作为number，确保分组正确
        content: text,
        time: Date.now(),
        read: true,
        type: 'sent', // 标记为发送的消息
        receiverName: currentMessageChatName, // 存储接收者名字，用于显示
        receiverId: currentMessageChatId // 存储接收者ID
    };
    
    smsMessages.unshift(newMessage);
    localStorage.setItem('sms_messages', JSON.stringify(smsMessages));
    
    // 重新渲染消息列表
    renderMessageList();
    
    // 在详情页显示新消息
    const msgContainer = document.getElementById('message-container');
    if (msgContainer) {
        const scrollArea = document.getElementById('message-area-scroll');
        const wasAtBottom = scrollArea.scrollHeight - scrollArea.scrollTop <= scrollArea.clientHeight + 50;
        
        const newMsgHtml = `<div class="message-wrapper"><div class="message-bubble message-sent">${text.replace(/\n/g, '<br>')}</div></div>`;
        msgContainer.innerHTML += newMsgHtml;
        
        // 如果之前在底部，滚动到底部
        if (wasAtBottom) {
            setTimeout(() => {
                scrollArea.scrollTo({ top: scrollArea.scrollHeight, behavior: 'smooth' });
            }, 10);
        }
    }
}

// 处理短信输入框变化（切换麦克风和发送按钮）
function handleMessageInputChange(input) {
    const hasText = input.value.trim().length > 0;
    const micIcon = document.getElementById('message-icon-mic');
    const sendBtn = document.getElementById('message-btn-send');
    
    if (hasText) {
        if (micIcon) micIcon.style.display = 'none';
        if (sendBtn) sendBtn.style.display = 'flex';
    } else {
        if (micIcon) micIcon.style.display = 'flex';
        if (sendBtn) sendBtn.style.display = 'none';
    }
}

// 短信页面接受回复（调用API）
async function acceptMessageReply() {
    if (!currentMessageChatId || currentMessageChatId === 'welcome') {
        alert('无法接受回复');
        return;
    }
    
    // 通过联系人名称查找角色
    const allChars = await db.characters.toArray();
    const targetChar = allChars.find(char => 
        (char.nick || char.name) === currentMessageChatName
    );
    
    if (!targetChar) {
        alert('找不到对应的角色');
        return;
    }
    
    const accountId = getCurrentAccountId();
    if (!accountId) {
        alert('请先登录');
        return;
    }
    
    const myChar = await db.characters.get(parseInt(accountId));
    if (!myChar) {
        alert('找不到用户信息');
        return;
    }
    
    console.log('[acceptMessageReply] ⚡ 开始接受短信回复');
    console.log('[acceptMessageReply] 角色名称:', targetChar.name);
    console.log('[acceptMessageReply] 账号 ID:', accountId);
    
    try {
        // 1. 获取关联数据 (User 和 Lorebook) - 与 triggerAiReply 保持一致
        console.log('[acceptMessageReply] 📖 开始加载上下文信息...');
        
        let userDesc = "";
        let userName = "用户";
        if (targetChar.linked_user_id) {
            console.log('[acceptMessageReply] 👤 检测到关联的用户 ID:', targetChar.linked_user_id);
            const user = await db.characters.get(targetChar.linked_user_id);
            if (user) {
                userName = user.name;
                userDesc = `\n\n【对话对象(User)信息】\n名字：${user.name}\n设定：${user.description || '无'}`;
                console.log('[acceptMessageReply] ✅ 用户人设已加载:', userName);
            } else {
                console.warn('[acceptMessageReply] ⚠️ 未找到关联的用户数据');
            }
        } else {
            console.log('[acceptMessageReply] ℹ️ 未设置关联用户');
        }
        
        let loreContext = "";
        const lorebookIds = targetChar.lorebookIds || (targetChar.lorebookId ? [targetChar.lorebookId] : []);
        console.log('[acceptMessageReply] 📚 关联的世界书 ID:', lorebookIds);
        
        // 获取微信聊天历史用于世界书匹配
        const wechatHistory = getChatHistory(targetChar, accountId);
        const recentText = wechatHistory.slice(-10).map(m => m.content).join(' ');
        
        if (lorebookIds.length > 0) {
            console.log('[acceptMessageReply] 🔍 用于匹配世界书的关键词文本:', recentText.substring(0, 100));
            loreContext = await getLorebookContext(lorebookIds, `${targetChar.name} ${userName} ${recentText}`);
            if (loreContext) {
                console.log('[acceptMessageReply] ✅ 世界书内容已加载（长度）:', loreContext.length);
            } else {
                console.log('[acceptMessageReply] ℹ️ 没有匹配到世界书条目');
            }
        } else {
            console.log('[acceptMessageReply] ℹ️ 未设置世界书');
        }
        
        // 2. 获取微信聊天历史（用于上下文）
        const fullWechatHistory = getChatHistory(targetChar, accountId);
        console.log('[acceptMessageReply] 📚 微信聊天历史条数:', fullWechatHistory.length);
        
        // 3. 获取短信聊天历史
        const smsMessages = JSON.parse(localStorage.getItem('sms_messages') || '[]');
        const chatMessages = smsMessages.filter(msg => (msg.number || msg.sender) === currentMessageChatId);
        console.log('[acceptMessageReply] 📱 短信聊天历史条数:', chatMessages.length);
        
        // 4. 计算虚拟时间
        const virtualTimeStr = getFormattedVirtualTime(targetChar.timeOffset);
        
        // 5. 构建系统提示（与 triggerAiReply 保持一致）
        let systemPrompt = `你正在进行角色扮演。
【当前时间】
${virtualTimeStr}

【角色(你)信息】
名字：${targetChar.name}
${targetChar.nick ? `昵称：${targetChar.nick}` : ''}
类型：${targetChar.type || 'char'}
设定：
${targetChar.description || ''}

${targetChar.identity ? `虚拟身份信息：
${targetChar.identity.account ? `账号：${targetChar.identity.account}` : ''}
${targetChar.type !== 'user' && targetChar.identity.password ? `密码：${targetChar.identity.password}` : ''}
${targetChar.identity.phone ? `手机：${targetChar.identity.phone}` : ''}
${targetChar.identity.address ? `住址：${targetChar.identity.address}` : ''}
${targetChar.identity.id_card ? `身份证：${targetChar.identity.id_card}` : ''}
${targetChar.identity.bank_card ? `银行卡：${targetChar.identity.bank_card}` : ''}
${targetChar.type !== 'user' && targetChar.identity.bank_password ? `银行卡密码：${targetChar.identity.bank_password}` : ''}
${targetChar.identity.balance !== undefined && targetChar.identity.balance !== null ? `余额：${targetChar.identity.balance}` : ''}
` : ''}
${userDesc}
${loreContext}

请完全沉浸在角色中，用符合角色性格的语气回复。
回复简短自然，像真实短信一样。
请注意：不要重复输出名字前缀，直接输出回复内容。

【重要回复规则 - 必须严格遵守】
1. **必须**模拟短信连发消息的习惯：请生成 1 到 3 条短消息，不能只发一条！
2. **必须**使用分隔符 "|||" 来隔开每一条消息。
3. **严禁使用逗号**（包括中文逗号和英文逗号）。如果想表达停顿，请直接拆分成下一条消息，或者用空格代替。
4. 每条消息要简短，5-15个字最佳，像真实短信聊天一样分多条发送。
5. 严禁只发送标点符号。每一条消息都必须有实际文字内容。
6. 语气要自然、口语化，符合人设。

请以JSON格式返回：
{
  "reply": "你的回复内容|||第二条内容|||第三条内容"
}`;
        
        // 6. 构建历史记录（合并微信和短信历史）
        // 先取微信历史（最近N条）
        const contextCount = targetChar.context_message_count || 20;
        const recentWechatHistory = fullWechatHistory.slice(-contextCount)
            .map(m => {
                let content = m.content || '';
                if (m.imageDescription) {
                    content += `\n(图片描述: ${m.imageDescription})`;
                }
                return {
                    role: m.role === 'char' ? 'assistant' : 'user',
                    content: content
                };
            })
            .filter(m => m.content && m.content.trim());
        
        // 再取短信历史（最近10条）
        const recentSmsHistory = chatMessages.slice(-10).map(msg => {
            const isSent = msg.type === 'sent' || msg.sender === (myChar.nick || myChar.name);
            return {
                role: isSent ? 'user' : 'assistant',
                content: msg.content
            };
        }).filter(m => m.content && m.content.trim());
        
        // 合并历史：微信历史 + 短信历史（短信历史放在最后，因为是最新的）
        const combinedHistory = [...recentWechatHistory, ...recentSmsHistory].slice(-contextCount);
        
        console.log('[acceptMessageReply] 📝 合并后的历史消息数:', combinedHistory.length);
        console.log('[acceptMessageReply]   - 微信历史:', recentWechatHistory.length, '条');
        console.log('[acceptMessageReply]   - 短信历史:', recentSmsHistory.length, '条');
        
        // 7. 调用AI
        const messages = [
            { role: 'system', content: systemPrompt },
            ...combinedHistory
        ];
        
        console.log('[acceptMessageReply] 📤 准备发送给 AI');
        const aiResponse = await callAI(messages);
        
        // 8. 解析回复
        let replyText = '';
        const parsed = extractAndParseJSON(aiResponse);
        if (parsed) {
            replyText = parsed.reply || parsed.content || parsed.message || '';
        }
        
        if (!replyText) {
            replyText = aiResponse.trim() || '...';
        }
        
        // 9. 处理分隔符，拆分成多条消息
        const replySegments = replyText.split('|||').map(s => s.trim()).filter(s => s.length > 0);
        
        if (replySegments.length === 0) {
            alert('AI 返回为空');
            return;
        }
        
        // 10. 保存回复到短信记录（如果有多条，逐条发送）
        const phoneNumber = targetChar.identity?.phone || generateVirtualPhoneNumber(targetChar.id);
        
        for (let i = 0; i < replySegments.length; i++) {
            const segment = replySegments[i];
            
            // 如果不是第一条，稍微延时
            if (i > 0) {
                await new Promise(r => setTimeout(r, 500));
            }
            
            const newMessage = {
                id: Date.now() + Math.random().toString(36).substr(2, 9) + '_' + i,
                sender: targetChar.nick || targetChar.name,
                senderAvatar: targetChar.avatar,
                number: phoneNumber,
                content: segment,
                time: Date.now() + i * 100, // 稍微错开时间
                read: true,
                type: 'received'
            };
            
            smsMessages.unshift(newMessage);
            
            // 在详情页显示新消息
            const msgContainer = document.getElementById('message-container');
            if (msgContainer) {
                const newMsgHtml = `<div class="message-wrapper"><div class="message-bubble message-received">${segment.replace(/\n/g, '<br>')}</div></div>`;
                msgContainer.innerHTML += newMsgHtml;
            }
        }
        
        // 保存所有消息
        localStorage.setItem('sms_messages', JSON.stringify(smsMessages));
        
        // 重新渲染消息列表
        renderMessageList();
        
        // 滚动到底部
        setTimeout(() => {
            const scrollArea = document.getElementById('message-area-scroll');
            if (scrollArea) {
                scrollArea.scrollTo({ top: scrollArea.scrollHeight, behavior: 'smooth' });
            }
        }, 100);
        
        console.log('[acceptMessageReply] ✅ 回复完成，共', replySegments.length, '条消息');
        
    } catch (error) {
        console.error('[acceptMessageReply] ❌ 接受回复失败:', error);
        alert('接受回复失败，请稍后重试');
    }
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
                { name: '微信读书', subtitle: '让阅读不再孤单', icon: 'https://img.icons8.com/color/96/book.png', rating: 4.8, downloads: '1000万+', appId: 'wechat-read' },
                { name: '小红书', subtitle: '标记我的生活', icon: 'https://img.icons8.com/color/96/instagram-new.png', rating: 4.7, downloads: '5000万+', appId: 'xiaohongshu' },
                { name: 'Notion', subtitle: '你的全能工作空间', icon: 'https://img.icons8.com/color/96/notion.png', rating: 4.9, downloads: '500万+', appId: 'notion' }
            ],
            games: [
                { name: '原神', subtitle: '开放世界冒险游戏', icon: 'https://img.icons8.com/color/96/controller.png', rating: 4.6, downloads: '1亿+', appId: 'genshin' },
                { name: '王者荣耀', subtitle: '5v5公平竞技', icon: 'https://img.icons8.com/color/96/sword.png', rating: 4.5, downloads: '5亿+', appId: 'honor-of-kings' },
                { name: '蛋仔派对', subtitle: '一起来玩吧', icon: 'https://img.icons8.com/color/96/party.png', rating: 4.7, downloads: '2亿+', appId: 'eggy-party' }
            ],
            apps: [
                { name: '网易云音乐', subtitle: '发现好音乐', icon: 'https://img.icons8.com/color/96/music.png', rating: 4.8, downloads: '5亿+', appId: 'netease-music', desktopIconId: 'icon-photo', showFunction: 'showMusicAppPage' },
                { name: '支付宝', subtitle: '生活好，支付宝', icon: 'https://img.icons8.com/color/96/alipay.png', rating: 4.8, downloads: '10亿+', appId: 'alipay' },
                { name: '高德地图', subtitle: '出行导航必备', icon: 'https://img.icons8.com/color/96/map.png', rating: 4.7, downloads: '5亿+', appId: 'amap' },
                { name: 'QQ音乐', subtitle: '听我想听的歌', icon: 'https://img.icons8.com/color/96/music.png', rating: 4.6, downloads: '3亿+', appId: 'qq-music' }
            ],
            updates: [
                { name: '微信', subtitle: '版本 8.0.50 更新', icon: 'https://img.icons8.com/color/96/wechat.png', rating: 4.9, downloads: '已安装', appId: 'wechat' },
                { name: 'QQ', subtitle: '版本 9.0.20 更新', icon: 'https://img.icons8.com/color/96/qq.png', rating: 4.7, downloads: '已安装', appId: 'qq' }
            ]
        };

        async function switchAppStoreTab(type) {
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

            // 检查每个应用的安装状态
            const appsWithStatus = await Promise.all(apps.map(async (app) => {
                const installed = await isAppInstalled(app.appId || '');
                return { ...app, installed };
            }));

            container.innerHTML = appsWithStatus.map(app => {
                const buttonText = app.installed ? '打开' : '获取';
                const buttonClass = app.installed ? 'app-get-btn installed' : 'app-get-btn';
                return `
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
                                <span>${app.installed ? '已安装' : app.downloads}</span>
                            </div>
                        </div>
                        <button class="${buttonClass}" onclick="downloadApp('${app.appId || ''}')">${buttonText}</button>
                    </div>
                </div>
            `;
            }).join('');
        }

        // 初始化已安装应用
        document.addEventListener('DOMContentLoaded', async function() {
            await initInstalledApps();
        });

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
                        // 检查每个应用的安装状态
                        Promise.all(results.map(async (app) => {
                            const installed = await isAppInstalled(app.appId || '');
                            return { ...app, installed };
                        })).then(appsWithStatus => {
                            container.innerHTML = appsWithStatus.map(app => {
                                const buttonText = app.installed ? '打开' : '获取';
                                const buttonClass = app.installed ? 'app-get-btn installed' : 'app-get-btn';
                                return `
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
                                                <span>${app.installed ? '已安装' : app.downloads}</span>
                                            </div>
                                        </div>
                                        <button class="${buttonClass}" onclick="downloadApp('${app.appId || ''}')">${buttonText}</button>
                                    </div>
                                </div>
                            `;
                            }).join('');
                        });
                    }
                });
            }
        });

// --- 微信应用逻辑 ---
async function showWechatPage() {
    // 确保聊天窗口被关闭
    const chatWindow = document.getElementById('chat-window');
    if (chatWindow && chatWindow.style.display !== 'none') {
        chatWindow.style.display = 'none';
        currentChatCharId = null;
        console.log('[WechatPage] Closed chat window, cleared currentChatCharId');
    }
    
    // 🎯 检查是否有已注册的User
    const hasRegisteredUser = await checkWechatRegistration();
    
    if (!hasRegisteredUser) {
        // 首次使用，显示注册页面
        console.log('[微信] 首次使用，显示注册页面');
        await showWechatRegisterPage();
    } else {
        // 已注册，显示微信主页
        console.log('[微信] 已注册，显示主页');
        document.getElementById('wechat-page').style.display = 'flex';
        // 打开时自动切到第一个标签页并渲染
        switchWechatTab(0);
    }
}

// 检查是否有已注册的User
async function checkWechatRegistration() {
    const users = await db.characters.where('type').equals('user').toArray();
    
    for (const user of users) {
        if (user.identity && user.identity.wechat_registered) {
            return true;
        }
    }
    
    return false;
}

// 显示微信注册页面
async function showWechatRegisterPage() {
    const registerPage = document.getElementById('wechat-register-page');
    const userSelect = document.getElementById('register-user-select');
    
    // 清空下拉框
    userSelect.innerHTML = '<option value="">-- 请选择User档案 --</option>';
    
    // 加载所有User档案
    const users = await db.characters.where('type').equals('user').toArray();
    
    if (users.length === 0) {
        showToast('请先创建User档案');
        return;
    }
    
    // 填充下拉框
    users.forEach(user => {
        const option = document.createElement('option');
        option.value = user.id;
        option.textContent = user.name;
        userSelect.appendChild(option);
    });
    
    // 显示注册页面
    registerPage.style.display = 'flex';
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

            // 查岗模式：使用查岗模式的渲染函数
            if (isViewingRoleAccount && currentViewingRoleAccountId) {
                const roleChar = await db.characters.get(parseInt(currentViewingRoleAccountId));
                const roleName = roleChar ? roleChar.name : '角色';
                
                if (index === 0) {
                    title.innerText = `${roleName}的微信`;
                    await renderRoleAccountWechatList(content);
                } else if (index === 1) {
                    title.innerText = `${roleName}的通讯录`;
                    await renderRoleAccountContactList(content);
                } else if (index === 2) {
                    title.innerText = `${roleName}的发现`;
                    await renderRoleAccountDiscoverPage(content);
                } else if (index === 3) {
                    title.innerText = `${roleName}的信息`;
                    await renderRoleAccountMePage(content);
                }
                return;
            }

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
                <div class="wechat-profile" onclick="openProfileSettings()">
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

        // 打开个人资料设置页面
        async function openProfileSettings() {
            const myChar = await db.characters.get(parseInt(currentMyCharId));
            if (!myChar) {
                alert('请先登录账号');
                return;
            }
            
            const modal = document.createElement('div');
            modal.id = 'profile-settings-modal';
            modal.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: #f5f5f5;
                z-index: 10000;
                display: flex;
                flex-direction: column;
            `;
            
            const currentAvatar = myChar.avatar || '';
            const currentName = myChar.name || '';
            
            modal.innerHTML = `
                <div style="background: #fff; padding: 12px 16px; display: flex; align-items: center; border-bottom: 1px solid #e8e8e8;">
                    <svg onclick="closeProfileSettings()" viewBox="0 0 24 24" style="width: 24px; height: 24px; cursor: pointer; stroke: #333; fill: none; stroke-width: 2;">
                        <polyline points="15 18 9 12 15 6"></polyline>
                    </svg>
                    <span style="flex: 1; text-align: center; font-size: 16px; font-weight: 600; margin-left: -24px;">个人信息</span>
                </div>
                
                <div style="flex: 1; overflow-y: auto;">
                    <div style="background: #fff; margin-top: 12px;">
                        <div onclick="document.getElementById('profile-avatar-input').click()" style="padding: 14px 16px; border-bottom: 1px solid #f0f0f0; display: flex; align-items: center; justify-content: space-between; cursor: pointer;">
                            <span style="font-size: 15px; color: #333;">头像</span>
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <div id="profile-avatar-preview" style="width: 50px; height: 50px; border-radius: 6px; background-image: url(${currentAvatar}); background-size: cover; background-position: center; background-color: #f0f0f0;"></div>
                                <svg viewBox="0 0 24 24" style="width: 16px; height: 16px; stroke: #999; fill: none;">
                                    <polyline points="9 18 15 12 9 6"></polyline>
                                </svg>
                            </div>
                        </div>
                        <input type="file" id="profile-avatar-input" accept="image/*" style="display: none;">
                        
                        <div style="padding: 14px 16px; border-bottom: 1px solid #f0f0f0; display: flex; align-items: center; justify-content: space-between;">
                            <span style="font-size: 15px; color: #333;">名字</span>
                            <input type="text" id="profile-name-input" value="${currentName}" placeholder="请输入名字" style="flex: 1; max-width: 200px; padding: 6px 12px; border: 1px solid #e8e8e8; border-radius: 6px; font-size: 15px; text-align: right;">
                        </div>
                        
                        <div style="padding: 14px 16px; display: flex; align-items: center; justify-content: space-between;">
                            <span style="font-size: 15px; color: #333;">微信号</span>
                            <span style="font-size: 15px; color: #999;">${myChar.identity?.account || `wxid_${myChar.id}`}</span>
                        </div>
                    </div>
                </div>
                
                <div style="padding: 16px; background: #fff; border-top: 1px solid #e8e8e8;">
                    <button onclick="saveProfileSettings()" style="width: 100%; padding: 14px; background: var(--ins-pink); color: #fff; border: none; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer;">
                        保存
                    </button>
                </div>
            `;
            
            document.body.appendChild(modal);
            
            // 绑定头像上传事件
            const avatarInput = document.getElementById('profile-avatar-input');
            const avatarPreview = document.getElementById('profile-avatar-preview');
            
            avatarInput.onchange = (e) => {
                const file = e.target.files[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        avatarPreview.style.backgroundImage = `url(${event.target.result})`;
                        avatarPreview.dataset.newAvatar = event.target.result;
                    };
                    reader.readAsDataURL(file);
                }
            };
        }
        
        function closeProfileSettings() {
            const modal = document.getElementById('profile-settings-modal');
            if (modal) modal.remove();
        }
        
        async function saveProfileSettings() {
            const myChar = await db.characters.get(parseInt(currentMyCharId));
            if (!myChar) return;
            
            const nameInput = document.getElementById('profile-name-input');
            const avatarPreview = document.getElementById('profile-avatar-preview');
            
            const newName = nameInput.value.trim();
            const newAvatar = avatarPreview.dataset.newAvatar;
            
            if (!newName) {
                alert('名字不能为空');
                return;
            }
            
            // 更新角色信息
            myChar.name = newName;
            if (newAvatar) {
                myChar.avatar = newAvatar;
            }
            
            await db.characters.put(myChar);
            
            // 刷新个人中心页面
            closeProfileSettings();
            const meTab = document.querySelector('.wechat-tab-item:nth-child(4)');
            if (meTab && meTab.classList.contains('active')) {
                const container = document.getElementById('wechat-content');
                await renderMePage(container);
            }
            
            showToast('保存成功');
        }

        // 已登录的角色账号列表（存储角色ID）
        let loggedInRoleAccounts = JSON.parse(localStorage.getItem('logged_in_role_accounts') || '[]');
        
        // 当前是否在查看角色账号（用于区分用户账号和角色账号）
        let isViewingRoleAccount = false;
        let currentViewingRoleAccountId = null;
        
        async function showSwitchAccountModal() {
            const modal = document.getElementById('switch-account-modal');
            const list = document.getElementById('account-switch-list');
            list.innerHTML = '';
            
            // 清空输入框
            document.getElementById('role-login-account').value = '';
            document.getElementById('role-login-password').value = '';
            document.getElementById('role-login-error').style.display = 'none';
            
            // 1. 显示用户账号（我的账号）
            const users = await db.characters.where('type').equals('user').toArray();
            
            if (users.length > 0) {
                const userTitle = document.createElement('div');
                userTitle.style.cssText = 'font-size:12px; color:#999; padding:8px 12px; background:#f8f8f8;';
                userTitle.textContent = '我的账号';
                list.appendChild(userTitle);
                
                users.forEach(u => {
                    const item = document.createElement('div');
                    item.className = 'account-item';
                    item.onclick = () => performSwitchAccount(u.id);
                    
                    const avatarStyle = u.avatar ? `background-image:url(${u.avatar})` : 'background-color:#eee';
                    const isCurrent = !isViewingRoleAccount && currentMyCharId && parseInt(currentMyCharId) === u.id;
                    
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
            
            // 2. 显示已登录的角色账号
            if (loggedInRoleAccounts.length > 0) {
                const roleTitle = document.createElement('div');
                roleTitle.style.cssText = 'font-size:12px; color:#999; padding:8px 12px; background:#f8f8f8; margin-top:10px;';
                roleTitle.textContent = '已登录的角色账号（查岗）';
                list.appendChild(roleTitle);
                
                for (const roleId of loggedInRoleAccounts) {
                    const role = await db.characters.get(parseInt(roleId));
                    if (!role) continue;
                    
                    const item = document.createElement('div');
                    item.className = 'account-item';
                    item.style.position = 'relative';
                    
                    const avatarStyle = role.avatar ? `background-image:url(${role.avatar})` : 'background-color:#eee';
                    const isCurrent = isViewingRoleAccount && currentViewingRoleAccountId === roleId;
                    
                    item.innerHTML = `
                        <div class="account-avatar" style="${avatarStyle}"></div>
                        <div style="flex:1;" onclick="switchToRoleAccount('${roleId}')">
                            <div style="font-weight:500; color:#333;">${role.name}</div>
                            <div style="font-size:12px; color:#999;">${role.identity && role.identity.account ? role.identity.account : '无微信号'}</div>
                        </div>
                        ${isCurrent ? '<div style="color:var(--ins-pink); margin-right:10px;">✓</div>' : ''}
                        <div onclick="event.stopPropagation(); removeRoleAccount('${roleId}')" style="color:#ff3b30; font-size:20px; padding:5px 10px; cursor:pointer;">×</div>
                    `;
                    item.onclick = () => switchToRoleAccount(roleId);
                    list.appendChild(item);
                }
            }
            
            if (users.length === 0 && loggedInRoleAccounts.length === 0) {
                list.innerHTML = '<div style="text-align:center; padding:20px; color:#999;">暂无账号</div>';
            }
            
            modal.style.display = 'flex';
        }
        
        // 移除已登录的角色账号
        async function removeRoleAccount(roleId) {
            loggedInRoleAccounts = loggedInRoleAccounts.filter(id => id !== roleId);
            localStorage.setItem('logged_in_role_accounts', JSON.stringify(loggedInRoleAccounts));
            
            // 如果正在查看这个账号，切回用户账号
            if (isViewingRoleAccount && currentViewingRoleAccountId === roleId) {
                isViewingRoleAccount = false;
                currentViewingRoleAccountId = null;
                await switchWechatTab(0);
            }
            
            await showSwitchAccountModal();
        }
        
        // 登录角色账号
        async function loginRoleAccount() {
            const account = document.getElementById('role-login-account').value.trim();
            const password = document.getElementById('role-login-password').value.trim();
            const errorEl = document.getElementById('role-login-error');
            
            errorEl.style.display = 'none';
            
            if (!account) {
                errorEl.textContent = '请输入账号';
                errorEl.style.display = 'block';
                return;
            }
            
            if (!password) {
                errorEl.textContent = '请输入密码';
                errorEl.style.display = 'block';
                return;
            }
            
            // 查找角色
            const allChars = await db.characters.toArray();
            const targetChar = allChars.find(c => c.identity && c.identity.account === account);
            
            if (!targetChar) {
                errorEl.textContent = '账号不存在';
                errorEl.style.display = 'block';
                return;
            }
            
            // 检查是不是User类型（不允许登录自己的账号）
            if (targetChar.type === 'user') {
                errorEl.textContent = '这是用户账号，请直接切换';
                errorEl.style.display = 'block';
                return;
            }
            
            // 验证密码
            const correctPassword = targetChar.identity?.password || '';
            if (password !== correctPassword) {
                errorEl.textContent = '密码错误';
                errorEl.style.display = 'block';
                return;
            }
            
            // 检查是否已登录
            const roleIdStr = String(targetChar.id);
            if (loggedInRoleAccounts.includes(roleIdStr)) {
                errorEl.textContent = '该账号已登录，可直接切换';
                errorEl.style.display = 'block';
                return;
            }
            
            // 登录成功，添加到列表
            loggedInRoleAccounts.push(roleIdStr);
            localStorage.setItem('logged_in_role_accounts', JSON.stringify(loggedInRoleAccounts));
            
            // 显示加载提示
            errorEl.style.color = 'var(--ins-pink)';
            errorEl.textContent = '正在生成角色WeChat数据...';
            errorEl.style.display = 'block';
            
            // 调用API生成角色的WeChat数据
            try {
                await generateRoleWechatData(targetChar);
                
                // 清空输入框
                document.getElementById('role-login-account').value = '';
                document.getElementById('role-login-password').value = '';
                errorEl.style.display = 'none';
                errorEl.style.color = '#ff3b30';
                
                // 刷新列表并自动切换到该账号
                await showSwitchAccountModal();
                await switchToRoleAccount(roleIdStr);
                
                showToast('登录成功，已生成WeChat数据');
            } catch (error) {
                console.error('生成角色WeChat数据失败:', error);
                errorEl.style.color = '#ff3b30';
                errorEl.textContent = '生成数据失败：' + error.message;
                errorEl.style.display = 'block';
            }
        }
        
        // 切换到角色账号（查岗模式）
        async function switchToRoleAccount(roleId) {
            // 保存原来的用户ID
            if (!window.originalMyCharIdBeforeRoleView) {
                window.originalMyCharIdBeforeRoleView = currentMyCharId;
            }
            
            isViewingRoleAccount = true;
            currentViewingRoleAccountId = roleId;
            
            // 切换到角色视角
            const roleChar = await db.characters.get(parseInt(roleId));
            if (roleChar) {
                currentMyCharId = roleChar.id;
            }
            
            closeModal('switch-account-modal');
            
            // 切换到聊天列表标签并刷新
            await switchWechatTab(0);
        }
        
        // 生成角色的WeChat数据（调用AI）
        async function generateRoleWechatData(roleChar) {
            console.log('[generateRoleWechatData] 开始为角色生成WeChat数据:', roleChar.name);
            
            // 获取当前用户
            const myChar = window.originalMyCharIdBeforeRoleView ? 
                await db.characters.get(parseInt(window.originalMyCharIdBeforeRoleView)) : 
                (currentMyCharId ? await db.characters.get(parseInt(currentMyCharId)) : null);
            
            // 获取角色关联的世界书
            let loreContext = "";
            const lorebookIds = roleChar.lorebookIds || (roleChar.lorebookId ? [roleChar.lorebookId] : []);
            if (lorebookIds.length > 0) {
                loreContext = await getLorebookContext(lorebookIds, roleChar.name);
            }
            
            // 获取角色与用户的聊天记录
            const accountId = myChar ? String(myChar.id) : getCurrentAccountId();
            const chatHistory = getChatHistory(roleChar, accountId);
            const recentChats = chatHistory.slice(-20).map(m => `${m.role === 'user' ? (myChar?.name || '用户') : roleChar.name}: ${m.content}`).join('\n');
            
            // 构建AI提示 - 生成更完整的数据，包括聊天记录
            const prompt = `你是一个数据生成助手。请根据以下角色信息，生成这个角色的微信数据。

【角色信息】
名字：${roleChar.name}
${roleChar.nick ? `昵称：${roleChar.nick}` : ''}
类型：${roleChar.type || 'char'}
设定：${roleChar.description || '无'}

${roleChar.identity ? `【虚拟身份】
账号：${roleChar.identity.account || '未知'}
手机：${roleChar.identity.phone || '未知'}
住址：${roleChar.identity.address || '未知'}
余额：${roleChar.identity.balance || 0}
` : ''}

${myChar ? `【与用户的关系】
用户名：${myChar.name}
用户设定：${myChar.description || '无'}
` : ''}

${recentChats ? `【与用户的最近聊天记录（真实）】
${recentChats}
` : ''}

${loreContext ? `【世界观背景】
${loreContext}
` : ''}

请生成以下JSON数据（严格按照格式返回，不要包含markdown代码块）：
{
    "friends": [
        {
            "id": "friend_1",
            "name": "好友名字",
            "remark": "备注（可选，没有就留空）",
            "relation": "关系描述（如：同事、朋友、家人等）",
            "avatar": "",
            "lastMessage": "最后一条消息内容",
            "lastMessageTime": "刚刚/5分钟前/1小时前/昨天等",
            "unread": 0,
            "chatHistory": [
                {"role": "friend", "content": "消息内容", "time": "10:30"},
                {"role": "me", "content": "消息内容", "time": "10:32"}
            ]
        }
    ],
    "moments": [
        {
            "author": "发布者名字",
            "content": "朋友圈内容",
            "timeAgo": "2小时前/昨天/3天前等",
            "likes": ["点赞人1", "点赞人2"],
            "comments": [{"name": "评论人", "content": "评论内容"}]
        }
    ],
    "balance": "余额数字"
}

生成要求：
1. friends：生成4-8个好友，根据角色设定和世界观生成合适的好友
   - 如果有与用户的聊天记录，用户（${myChar?.name || '用户'}）必须在好友列表中，且聊天记录要基于真实记录
   - 每个好友要生成5-15条聊天记录（chatHistory），体现他们的关系
   - chatHistory中 role为"friend"表示好友发的，"me"表示角色（${roleChar.name}）发的
2. moments：生成3-6条朋友圈，可以是角色自己发的，也可以是好友发的
   - 要有点赞和评论，体现社交互动
3. balance：生成一个合理的余额数字
4. 所有内容要符合角色的性格、身份和世界观设定
5. 聊天内容要自然、生动，体现人物关系`;

            // 调用AI
            const result = await callAI([
                { role: 'system', content: '你是一个JSON数据生成助手，只返回纯JSON格式，不要包含任何markdown标记或其他文字。' },
                { role: 'user', content: prompt }
            ], 0.7);
            
            console.log('[generateRoleWechatData] AI返回:', result);
            
            // 解析结果
            let wechatData;
            try {
                // 尝试清理可能的markdown标记
                let cleanResult = result.trim();
                if (cleanResult.startsWith('```')) {
                    cleanResult = cleanResult.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
                }
                wechatData = JSON.parse(cleanResult);
            } catch (e) {
                console.error('[generateRoleWechatData] 解析JSON失败:', e);
                // 使用默认数据
                wechatData = {
                    friends: [{ name: myChar?.name || '用户', remark: '', relation: '好友', lastMessage: '...', lastMessageTime: '刚刚', unread: 0 }],
                    moments: [{ content: '今天天气不错', timeAgo: '1小时前', likes: 5, comments: 1 }],
                    balance: roleChar.identity?.balance || '100.00'
                };
            }
            
            // 保存到角色数据中
            roleChar.generated_wechat_data = {
                ...wechatData,
                generatedAt: Date.now()
            };
            await db.characters.put(roleChar);
            
            console.log('[generateRoleWechatData] 数据已保存:', wechatData);
            return wechatData;
        }
        
        // 渲染角色账号的聊天列表（查岗模式）- 使用AI生成的数据
        async function renderRoleAccountWechatList(container) {
            const roleChar = await db.characters.get(parseInt(currentViewingRoleAccountId));
            if (!roleChar) {
                container.innerHTML = '<div class="wechat-empty-state"><div>暂无数据</div></div>';
                return;
            }
            
            // 检查是否有AI生成的数据
            const wechatData = roleChar.generated_wechat_data;
            if (!wechatData || !wechatData.friends || wechatData.friends.length === 0) {
                container.innerHTML = `
                    <div class="wechat-empty-state">
                        <svg class="svg-icon" style="width:48px; height:48px; stroke:#ccc;" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="8" y1="15" x2="16" y2="15"></line><line x1="9" y1="9" x2="9.01" y2="9"></line><line x1="15" y1="9" x2="15.01" y2="9"></line></svg>
                        <div>暂无好友数据</div>
                        <div style="font-size:12px; color:#999; margin-top:10px;">请重新登录生成数据</div>
                    </div>
                `;
                return;
            }

            const friends = wechatData.friends;

            container.innerHTML = '';
            const listDiv = document.createElement('div');
            listDiv.style.width = '100%';
            listDiv.style.background = '#fff';
            listDiv.style.overflowX = 'hidden';
            
            // 添加查岗模式提示
            const tipDiv = document.createElement('div');
            tipDiv.style.cssText = 'padding:10px 16px; background:#FFF5F7; color:#FF6B9D; font-size:12px; border-bottom:1px solid #f0f0f0;';
            tipDiv.innerHTML = `🔍 正在查看 <b>${roleChar.name}</b> 的微信（查岗模式）<span style="float:right; cursor:pointer;" onclick="refreshRoleWechatData()">🔄 刷新</span>`;
            listDiv.appendChild(tipDiv);

            friends.forEach((f, index) => {
                // 容器
                const itemContainer = document.createElement('div');
                itemContainer.className = 'wechat-list-item-container';
                
                // 内容区域
                const contentDiv = document.createElement('div');
                contentDiv.className = 'wechat-list-item-content';
                
                contentDiv.style.display = 'flex';
                contentDiv.style.padding = '12px 16px';
                contentDiv.style.borderBottom = '0.5px solid #f0f0f0';
                contentDiv.style.alignItems = 'center';
                contentDiv.style.gap = '12px';
                contentDiv.style.backgroundColor = '#fff';
                contentDiv.style.cursor = 'pointer';

                // 点击进入聊天（查岗模式）
                contentDiv.onclick = () => {
                    openRoleAccountChat(index);
                };

                // 生成头像（使用名字首字母）
                const avatarChar = (f.name || '?').charAt(0);
                const avatarColors = ['#FF6B9D', '#FF9F43', '#54A0FF', '#5F27CD', '#00D2D3', '#10AC84'];
                const avatarColor = avatarColors[index % avatarColors.length];
                
                const lastMsg = f.lastMessage || '';
                const lastTimeStr = f.lastMessageTime || '';
                const unread = f.unread || 0;

                contentDiv.innerHTML = `
                    <div style="width:48px; height:48px; border-radius:6px; background:${avatarColor}; background-size:cover; background-position:center; flex-shrink:0; display:flex; align-items:center; justify-content:center; color:#fff; font-size:20px; font-weight:600;">${avatarChar}</div>
                    <div style="flex:1; min-width:0;">
                        <div style="display:flex; justify-content:space-between; margin-bottom:4px; align-items:center;">
                            <div style="display:flex; align-items:center;">
                                <div style="font-size:16px; font-weight:500; color:#333;">${f.remark || f.name}</div>
                            </div>
                            <div style="font-size:12px; color:#999;">${lastTimeStr}</div>
                        </div>
                        <div style="font-size:14px; color:#999; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${lastMsg}</div>
                    </div>
                    ${unread > 0 ? `<div style="background:#ff3b30; color:#fff; font-size:12px; padding:2px 6px; border-radius:10px; min-width:18px; text-align:center;">${unread}</div>` : ''}
                `;

                itemContainer.appendChild(contentDiv);
                listDiv.appendChild(itemContainer);
            });
            container.appendChild(listDiv);
        }
        
        // 刷新角色的WeChat数据
        async function refreshRoleWechatData() {
            const roleChar = await db.characters.get(parseInt(currentViewingRoleAccountId));
            if (!roleChar) return;
            
            showToast('正在重新生成数据...');
            
            try {
                await generateRoleWechatData(roleChar);
                await switchWechatTab(0);
                showToast('数据已刷新');
            } catch (error) {
                console.error('刷新数据失败:', error);
                showToast('刷新失败：' + error.message);
            }
        }
        
        // 打开角色账号的聊天窗口（查岗模式）- 显示AI生成的聊天记录
        async function openRoleAccountChat(friendIndex) {
            const roleChar = await db.characters.get(parseInt(currentViewingRoleAccountId));
            if (!roleChar || !roleChar.generated_wechat_data) return;
            
            const friend = roleChar.generated_wechat_data.friends[friendIndex];
            if (!friend) return;
            
            // 保存当前查看的好友索引
            window.currentRoleViewFriendIndex = friendIndex;
            
            // 显示聊天窗口
            const chatWindow = document.getElementById('chat-window');
            const chatTitle = document.getElementById('chat-title');
            const chatBody = document.getElementById('chat-body');
            const chatFooter = document.getElementById('chat-footer');
            
            chatTitle.innerHTML = `${friend.remark || friend.name} <span style="font-size:12px; color:#FF6B9D; font-weight:400;">(${roleChar.name}查岗中)</span>`;
            chatWindow.style.display = 'flex';
            
            // 隐藏输入框（查岗模式只能看，不能发）
            chatFooter.style.display = 'none';
            
            // 渲染AI生成的聊天记录
            renderRoleAccountChatBody(chatBody, roleChar, friend);
        }
        
        // 渲染角色账号的聊天记录（AI生成的）- 使用和正常聊天一样的样式
        function renderRoleAccountChatBody(container, roleChar, friend) {
            const chatHistory = friend.chatHistory || [];
            
            // 角色头像
            const roleAvatarUrl = roleChar.avatar || '';
            
            // 好友头像颜色（生成一个颜色作为默认头像）
            const avatarColors = ['#FF6B9D', '#FF9F43', '#54A0FF', '#5F27CD', '#00D2D3', '#10AC84'];
            const friendAvatarColor = avatarColors[window.currentRoleViewFriendIndex % avatarColors.length];
            const friendAvatarChar = (friend.name || '?').charAt(0);
            
            container.innerHTML = '';
            
            if (chatHistory.length === 0) {
                container.innerHTML = '<div style="text-align:center; padding:40px; color:#999;">暂无聊天记录</div>';
                return;
            }
            
            let lastTimeGroup = '';
            
            chatHistory.forEach((msg, index) => {
                const isMe = msg.role === 'me'; // 角色发的
                const time = msg.time || '';
                
                // 添加时间戳（如果时间变化了）
                if (time && time !== lastTimeGroup) {
                    const timeStamp = document.createElement('div');
                    timeStamp.className = 'message-timestamp';
                    timeStamp.textContent = time;
                    container.appendChild(timeStamp);
                    lastTimeGroup = time;
                }
                
                // 创建消息行 - 使用和正常聊天一样的HTML结构
                const row = document.createElement('div');
                row.className = `message-row ${isMe ? 'self' : 'other'}`;
                row.dataset.index = index;
                
                // 头像
                const avatar = document.createElement('div');
                avatar.className = 'message-avatar';
                
                if (isMe) {
                    // 角色（"我"）的头像
                    if (roleAvatarUrl) {
                        avatar.style.backgroundImage = `url(${roleAvatarUrl})`;
                    } else {
                        avatar.style.backgroundColor = '#FF6B9D';
                        avatar.style.display = 'flex';
                        avatar.style.alignItems = 'center';
                        avatar.style.justifyContent = 'center';
                        avatar.style.color = '#fff';
                        avatar.style.fontWeight = '600';
                        avatar.style.fontSize = '14px';
                        avatar.textContent = roleChar.name.charAt(0);
                    }
                } else {
                    // 好友的头像
                    avatar.style.backgroundColor = friendAvatarColor;
                    avatar.style.display = 'flex';
                    avatar.style.alignItems = 'center';
                    avatar.style.justifyContent = 'center';
                    avatar.style.color = '#fff';
                    avatar.style.fontWeight = '600';
                    avatar.style.fontSize = '14px';
                    avatar.textContent = friendAvatarChar;
                }
                
                // 内容气泡
                const content = document.createElement('div');
                content.className = isMe ? 'message-content user-bubble' : 'message-content ai-bubble';
                content.textContent = msg.content || '';
                
                // 组装消息行
                row.appendChild(avatar);
                row.appendChild(content);
                
                container.appendChild(row);
            });
            
            // 滚动到底部
            setTimeout(() => {
                container.scrollTop = container.scrollHeight;
            }, 50);
        }
        
        // 渲染角色账号的通讯录（查岗模式）- 使用AI生成的数据
        async function renderRoleAccountContactList(container) {
            const roleChar = await db.characters.get(parseInt(currentViewingRoleAccountId));
            if (!roleChar) {
                container.innerHTML = '<div class="wechat-empty-state"><div>暂无数据</div></div>';
                return;
            }
            
            // 检查是否有AI生成的数据
            const wechatData = roleChar.generated_wechat_data;
            if (!wechatData || !wechatData.friends || wechatData.friends.length === 0) {
                container.innerHTML = `
                    <div class="wechat-empty-state">
                        <div>暂无好友数据</div>
                    </div>
                `;
                return;
            }
            
            const friends = [...wechatData.friends].sort((a, b) => {
                const nameA = (a.remark || a.name || '').toLowerCase();
                const nameB = (b.remark || b.name || '').toLowerCase();
                return nameA.localeCompare(nameB);
            });
            
            container.innerHTML = '';
            const listDiv = document.createElement('div');
            listDiv.style.width = '100%';
            listDiv.style.background = '#fff';
            
            // 添加查岗模式提示
            const tipDiv = document.createElement('div');
            tipDiv.style.cssText = 'padding:10px 16px; background:#FFF5F7; color:#FF6B9D; font-size:12px; border-bottom:1px solid #f0f0f0;';
            tipDiv.innerHTML = `🔍 正在查看 <b>${roleChar.name}</b> 的通讯录（${friends.length}位好友）`;
            listDiv.appendChild(tipDiv);
            
            const avatarColors = ['#FF6B9D', '#FF9F43', '#54A0FF', '#5F27CD', '#00D2D3', '#10AC84'];
            
            friends.forEach((f, index) => {
                // 找到原始索引（用于点击进入聊天）
                const originalIndex = wechatData.friends.findIndex(fr => fr.id === f.id || fr.name === f.name);
                
                const itemDiv = document.createElement('div');
                itemDiv.style.cssText = 'display:flex; padding:12px 16px; border-bottom:0.5px solid #f0f0f0; align-items:center; gap:12px; background:#fff; cursor:pointer;';
                itemDiv.onclick = () => openRoleAccountChat(originalIndex >= 0 ? originalIndex : index);
                
                const avatarChar = (f.name || '?').charAt(0);
                const avatarColor = avatarColors[index % avatarColors.length];
                
                itemDiv.innerHTML = `
                    <div style="width:48px; height:48px; border-radius:6px; background:${avatarColor}; display:flex; align-items:center; justify-content:center; color:#fff; font-size:20px; font-weight:600;">${avatarChar}</div>
                    <div style="flex:1;">
                        <div style="font-size:16px; font-weight:500; color:#333;">${f.remark || f.name}</div>
                        ${f.relation ? `<div style="font-size:12px; color:#999;">${f.relation}</div>` : ''}
                    </div>
                `;
                
                listDiv.appendChild(itemDiv);
            });
            
            container.appendChild(listDiv);
        }
        
        // 渲染角色账号的发现页（朋友圈，查岗模式）
        async function renderRoleAccountDiscoverPage(container) {
            const roleChar = await db.characters.get(parseInt(currentViewingRoleAccountId));
            if (!roleChar) {
                container.innerHTML = '<div class="wechat-empty-state"><div>暂无数据</div></div>';
                return;
            }
            
            // 使用和正常发现页一样的内容
            const html = `
                <div class="wechat-cell-group" style="margin-top:0;">
                    <div style="padding:10px 16px; background:#FFF5F7; color:#FF6B9D; font-size:12px;">
                        🔍 正在查看 <b>${roleChar.name}</b> 的发现
                    </div>
                    <div class="wechat-cell" onclick="showRoleAccountMomentsPage()">
                        <div class="wechat-cell-icon icon-moments">
                            <svg class="svg-icon" style="stroke:currentColor;" viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
                        </div>
                        <div class="wechat-cell-text">朋友圈</div>
                        <div class="wechat-cell-arrow">›</div>
                    </div>
                </div>
            `;
            container.innerHTML = html;
        }
        
        // 显示角色账号的朋友圈页面（查岗模式）- 使用AI生成的数据
        async function showRoleAccountMomentsPage() {
            const roleChar = await db.characters.get(parseInt(currentViewingRoleAccountId));
            if (!roleChar) return;
            
            const wechatData = roleChar.generated_wechat_data;
            const moments = wechatData?.moments || [];
            
            // 显示朋友圈页面
            const momentsPage = document.getElementById('moments-page');
            if (!momentsPage) return;
            
            momentsPage.style.display = 'flex';
            
            // 修改用户名和头像（封面区域）
            const userNameEl = document.getElementById('moments-user-name');
            const userAvatarEl = document.getElementById('moments-user-avatar');
            if (userNameEl) {
                userNameEl.innerHTML = `${roleChar.name} <span style="font-size:12px; color:#FF6B9D;">(查岗中)</span>`;
            }
            if (userAvatarEl && roleChar.avatar) {
                userAvatarEl.style.backgroundImage = `url(${roleChar.avatar})`;
            }
            
            // 渲染AI生成的朋友圈内容到 moments-list
            const momentsList = document.getElementById('moments-list');
            if (momentsList) {
                renderRoleAccountMoments(momentsList, roleChar, moments);
            }
        }
        
        // 渲染角色账号的朋友圈内容 - 使用和正常朋友圈一样的样式
        function renderRoleAccountMoments(container, roleChar, moments) {
            const avatarColors = ['#FF6B9D', '#FF9F43', '#54A0FF', '#5F27CD', '#00D2D3', '#10AC84'];
            
            let html = '';
            
            // 查岗提示
            html += `<div style="padding:12px 16px; background:#FFF5F7; color:#FF6B9D; font-size:13px; margin-bottom:10px;">
                🔍 正在查看 <b>${roleChar.name}</b> 的朋友圈（${moments.length}条动态）
            </div>`;
            
            if (moments.length === 0) {
                html += '<div style="text-align:center; padding:60px 20px; color:#999;">暂无朋友圈动态</div>';
            } else {
                moments.forEach((m, index) => {
                    const authorName = m.author || roleChar.name;
                    const isRoleMoment = authorName === roleChar.name;
                    const avatarColor = isRoleMoment ? '#FF6B9D' : avatarColors[index % avatarColors.length];
                    const avatarChar = authorName.charAt(0);
                    const avatarStyle = (isRoleMoment && roleChar.avatar) ? 
                        `background-image:url(${roleChar.avatar}); background-size:cover; background-position:center;` : 
                        `background:${avatarColor}; display:flex; align-items:center; justify-content:center; color:#fff; font-size:18px; font-weight:600;`;
                    
                    // 点赞列表
                    const likes = m.likes || [];
                    const likesStr = Array.isArray(likes) ? likes.join('，') : '';
                    
                    // 评论列表
                    const comments = m.comments || [];
                    let commentsHtml = '';
                    if (comments.length > 0) {
                        commentsHtml = comments.map(c => {
                            return `<div style="font-size:13px; line-height:1.8;"><span style="color:#576B95; font-weight:500;">${c.name || '匿名'}</span>：${c.content || ''}</div>`;
                        }).join('');
                    }
                    
                    html += `
                        <div class="moment-item" style="padding:16px; border-bottom:1px solid #f0f0f0;">
                            <div style="display:flex; align-items:flex-start;">
                                <div style="width:44px; height:44px; border-radius:6px; flex-shrink:0; ${avatarStyle}">${(isRoleMoment && roleChar.avatar) ? '' : avatarChar}</div>
                                <div style="margin-left:12px; flex:1; min-width:0;">
                                    <div style="font-weight:600; font-size:15px; color:#576B95; margin-bottom:6px;">${authorName}</div>
                                    <div style="line-height:1.6; font-size:15px; color:#333; word-break:break-word;">${m.content || ''}</div>
                                    <div style="font-size:12px; color:#999; margin-top:10px;">${m.timeAgo || '刚刚'}</div>
                                    ${(likesStr || commentsHtml) ? `
                                    <div style="background:#f5f5f5; padding:8px 10px; border-radius:4px; margin-top:10px;">
                                        ${likesStr ? `<div style="font-size:13px; color:#576B95; ${commentsHtml ? 'margin-bottom:6px; padding-bottom:6px; border-bottom:1px solid #e5e5e5;' : ''}">❤️ ${likesStr}</div>` : ''}
                                        ${commentsHtml}
                                    </div>
                                    ` : ''}
                                </div>
                            </div>
                        </div>
                    `;
                });
            }
            
            container.innerHTML = html;
        }
        
        // 渲染角色账号的"我"页面（查岗模式）
        async function renderRoleAccountMePage(container) {
            const roleChar = await db.characters.get(parseInt(currentViewingRoleAccountId));
            if (!roleChar) {
                container.innerHTML = '<div class="wechat-empty-state"><div>暂无数据</div></div>';
                return;
            }
            
            const identity = roleChar.identity || {};
            const wechatData = roleChar.generated_wechat_data || {};
            
            // 优先使用AI生成的余额，否则使用角色档案的余额
            const balance = wechatData.balance || identity.balance || '0.00';
            
            const avatarStyle = roleChar.avatar ? `background-image:url(${roleChar.avatar})` : 'background-color:#eee';
            
            // 显示角色档案的所有虚拟身份信息
            const html = `
                <div style="background:#fff;">
                    <!-- 查岗模式提示 -->
                    <div style="padding:10px 16px; background:#FFF5F7; color:#FF6B9D; font-size:12px;">
                        🔍 正在查看 <b>${roleChar.name}</b> 的个人信息
                    </div>
                    
                    <!-- 个人信息头部 -->
                    <div style="padding:20px; text-align:center; background:linear-gradient(135deg, #FFB6C1 0%, #FFC0CB 100%);">
                        <div style="width:80px; height:80px; border-radius:12px; ${avatarStyle}; background-size:cover; background-position:center; margin:0 auto 10px; border:2px solid rgba(255,255,255,0.3);"></div>
                        <div style="font-size:18px; font-weight:600; color:#fff; margin-bottom:5px;">${roleChar.name}</div>
                        ${roleChar.nick ? `<div style="font-size:14px; color:rgba(255,255,255,0.8); margin-bottom:5px;">${roleChar.nick}</div>` : ''}
                        <div style="font-size:14px; color:rgba(255,255,255,0.9);">微信号：${identity.account || '未设置'}</div>
                    </div>
                    
                    <!-- 余额 -->
                    <div style="padding:15px 16px; border-bottom:1px solid #f0f0f0;">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <div style="font-size:16px; font-weight:500;">💰 钱包余额</div>
                            <div style="font-size:20px; font-weight:600; color:#FF6B9D;">¥${balance}</div>
                        </div>
                    </div>
                    
                    <!-- 虚拟身份信息 -->
                    <div style="padding:15px 16px; background:#f8f8f8;">
                        <div style="font-size:14px; font-weight:600; color:#666; margin-bottom:10px;">🔐 虚拟身份信息</div>
                    </div>
                    
                    ${identity.password ? `
                    <div style="padding:15px 16px; border-bottom:1px solid #f0f0f0;">
                        <div style="font-size:14px; color:#666; margin-bottom:5px;">账号密码</div>
                        <div style="font-size:16px; font-family:monospace; color:#FF6B9D;">${identity.password}</div>
                    </div>
                    ` : ''}
                    
                    <div style="padding:15px 16px; border-bottom:1px solid #f0f0f0;">
                        <div style="font-size:14px; color:#666; margin-bottom:5px;">📱 手机号</div>
                        <div style="font-size:16px;">${identity.phone || '未设置'}</div>
                    </div>
                    
                    <div style="padding:15px 16px; border-bottom:1px solid #f0f0f0;">
                        <div style="font-size:14px; color:#666; margin-bottom:5px;">🏠 住址</div>
                        <div style="font-size:16px;">${identity.address || '未设置'}</div>
                    </div>
                    
                    ${identity.id_card ? `
                    <div style="padding:15px 16px; border-bottom:1px solid #f0f0f0;">
                        <div style="font-size:14px; color:#666; margin-bottom:5px;">🪪 身份证号</div>
                        <div style="font-size:16px; font-family:monospace;">${identity.id_card}</div>
                    </div>
                    ` : ''}
                    
                    ${identity.bank_card ? `
                    <div style="padding:15px 16px; border-bottom:1px solid #f0f0f0;">
                        <div style="font-size:14px; color:#666; margin-bottom:5px;">💳 银行卡号</div>
                        <div style="font-size:16px; font-family:monospace;">${identity.bank_card}</div>
                    </div>
                    ` : ''}
                    
                    ${identity.bank_password ? `
                    <div style="padding:15px 16px; border-bottom:1px solid #f0f0f0;">
                        <div style="font-size:14px; color:#666; margin-bottom:5px;">🔑 银行密码</div>
                        <div style="font-size:16px; font-family:monospace; color:#FF6B9D;">${identity.bank_password}</div>
                    </div>
                    ` : ''}
                    
                    <!-- 退出查岗按钮 -->
                    <div style="padding:20px 16px;">
                        <button onclick="exitRoleAccountView()" style="width:100%; padding:14px; background:#FF6B9D; color:#fff; border:none; border-radius:10px; font-size:16px; cursor:pointer; font-weight:600;">退出查岗模式</button>
                    </div>
                </div>
            `;
            
            container.innerHTML = html;
        }
        
        // 退出查岗模式
        async function exitRoleAccountView() {
            isViewingRoleAccount = false;
            currentViewingRoleAccountId = null;
            
            // 恢复原来的用户ID
            if (window.originalMyCharIdBeforeRoleView) {
                currentMyCharId = window.originalMyCharIdBeforeRoleView;
                window.originalMyCharIdBeforeRoleView = null;
            }
            
            await switchWechatTab(0);
            showToast('已退出查岗模式');
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
            // 退出查岗模式（如果正在查岗）
            if (isViewingRoleAccount) {
                isViewingRoleAccount = false;
                currentViewingRoleAccountId = null;
            }
            
            currentMyCharId = id;
            localStorage.setItem('current_my_char_id', id);
            window.originalMyCharIdBeforeRoleView = null; // 清除保存的ID
            
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
            // 查岗模式：显示角色生成的数据
            if (isViewingRoleAccount && currentViewingRoleAccountId) {
                await renderRoleAccountWechatList(container);
                return;
            }
            
            const accountId = getCurrentAccountId();
            // 获取所有角色，然后按账号过滤好友（包括已删除和已拉黑的）
            let allChars = await db.characters.toArray();
            let friends = allChars.filter(c => {
                if (c.type === 'user') return false; // 排除User类型
                const status = getFriendStatus(c, accountId);
                return status === 'friend' || status === 'deleted' || status === 'blocked'; // 包括已删除和已拉黑的好友
            });
            
            // 获取群聊列表
            let groupChats = [];
            try {
                groupChats = await getGroupChats(accountId);
            } catch (e) {
                console.log('获取群聊列表失败，可能表不存在:', e);
            }
            
            // 将群聊转换为统一格式，添加标记
            const groupItems = groupChats.map(g => ({
                ...g,
                _isGroup: true,
                _groupId: g.id
            }));
            
            // 获取真人好友列表（联机功能）- 只显示当前账号的好友
            let realFriends = [];
            try {
                // 获取当前账号信息
                const currentAccountInfo = await getCurrentAccountOnlineInfo();
                
                // 只有当前账号已开通联机，且正在登录的联机账号是当前账号时，才显示真人好友
                if (onlineUser && currentAccountInfo && onlineUser.wechat_id === currentAccountInfo.account) {
                    const res = await fetch(`${ONLINE_API_BASE}/api/online/conversations?user_id=${onlineUser.id}`);
                    if (res.ok) {
                        const data = await res.json();
                        realFriends = (data.conversations || []).map(c => ({
                            ...c,
                            _isRealFriend: true,
                            _realFriendId: c.friend_id
                        }));
                    }
                }
            } catch (e) {
                console.log('获取真人好友列表失败:', e);
            }
            
            // 获取混合群聊列表
            let mixedGroups = [];
            try {
                const currentAccountInfo = await getCurrentAccountOnlineInfo();
                if (onlineUser && currentAccountInfo && onlineUser.wechat_id === currentAccountInfo.account) {
                    const res = await fetch(`${ONLINE_API_BASE}/api/mixed_group/list?user_id=${onlineUser.id}`);
                    if (res.ok) {
                        const data = await res.json();
                        mixedGroups = (data.groups || []).map(g => ({
                            ...g,
                            _isMixedGroup: true,
                            _mixedGroupId: g.id
                        }));
                    }
                }
            } catch (e) {
                console.log('获取混合群聊列表失败:', e);
            }
            
            // 合并好友、群聊、真人好友、混合群聊列表
            let allItems = [
                ...friends.map(f => ({...f, _isGroup: false, _isRealFriend: false, _isMixedGroup: false})), 
                ...groupItems.map(g => ({...g, _isMixedGroup: false})),
                ...realFriends.map(r => ({...r, _isMixedGroup: false})),
                ...mixedGroups
            ];
            
            // 排序逻辑：置顶 > 最后消息时间 > 更新时间
            allItems.sort((a, b) => {
                // 1. 置顶判断
                if (a.is_pinned && !b.is_pinned) return -1;
                if (!a.is_pinned && b.is_pinned) return 1;
                
                // 2. 时间判断
                const getLastTime = (item) => {
                    if (item._isMixedGroup) {
                        return item.last_time ? item.last_time * 1000 : (item.created_at ? item.created_at * 1000 : 0);
                    } else if (item._isRealFriend) {
                        return item.last_time ? item.last_time * 1000 : 0;
                    } else if (item._isGroup) {
                        const history = item.chat_history || [];
                        if (history.length > 0) {
                            return history[history.length - 1].time;
                        }
                        return item.updated_at || item.created_at || 0;
                    } else {
                        const history = getChatHistory(item, accountId);
                        if (history && history.length > 0) {
                            return history[history.length - 1].time;
                        }
                        return item.updated_at || 0;
                    }
                };
                
                const timeA = getLastTime(a);
                const timeB = getLastTime(b);
                
                return timeB - timeA; // 降序
            });
            
            if (allItems.length === 0) {
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

            allItems.forEach(f => {
                // 群聊项渲染
                if (f._isGroup) {
                    const itemContainer = document.createElement('div');
                    itemContainer.className = 'wechat-list-item-container';
                    
                    const actionsDiv = document.createElement('div');
                    actionsDiv.className = 'wechat-item-actions';
                    actionsDiv.innerHTML = `
                        <button class="wechat-action-btn btn-pin" onclick="toggleGroupPin(${f._groupId}, event)">${f.is_pinned ? '取消置顶' : '置顶'}</button>
                        <button class="wechat-action-btn btn-delete" onclick="deleteGroup(${f._groupId}, event)">删除</button>
                    `;
                    
                    const contentDiv = document.createElement('div');
                    contentDiv.className = 'wechat-list-item-content';
                    contentDiv.style.cssText = 'display:flex; padding:12px 16px; border-bottom:0.5px solid #f0f0f0; align-items:center; gap:12px; background-color:' + (f.is_pinned ? '#f8f8f8' : '#fff');
                    
                    contentDiv.onclick = () => openGroupChatWindow(f._groupId);
                    
                    const avatarStyle = f.avatar ? `background-image:url(${f.avatar})` : 'background-color:#eee';
                    
                    let lastMsg = '';
                    let lastTimeStr = '';
                    const history = f.chat_history || [];
                    if (history.length > 0) {
                        const last = history[history.length - 1];
                        lastMsg = last.content;
                        if (lastMsg.startsWith('[img:')) lastMsg = '[图片]';
                        if (last.role === 'system') lastMsg = '[系统消息]';
                        
                        const d = new Date(last.time);
                        const now = new Date();
                        if (d.toDateString() === now.toDateString()) {
                            lastTimeStr = `${d.getHours()}:${d.getMinutes().toString().padStart(2,'0')}`;
                        } else {
                            lastTimeStr = `${d.getMonth()+1}/${d.getDate()}`;
                        }
                    }
                    
                    contentDiv.innerHTML = `
                        <div style="width:48px; height:48px; border-radius:6px; ${avatarStyle}; background-size:cover; background-position:center; flex-shrink:0;"></div>
                        <div style="flex:1; min-width:0;">
                            <div style="display:flex; justify-content:space-between; margin-bottom:4px; align-items:center;">
                                <div style="display:flex; align-items:center;">
                                    <div style="font-size:16px; font-weight:500; color:#333;">${f.name}</div>
                                    <span style="background:#07c160; color:#fff; font-size:9px; padding:1px 4px; border-radius:2px; margin-left:6px;">群</span>
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
                    return;
                }
                
                // 真人好友项渲染
                if (f._isRealFriend) {
                    const itemContainer = document.createElement('div');
                    itemContainer.className = 'wechat-list-item-container';
                    
                    const contentDiv = document.createElement('div');
                    contentDiv.className = 'wechat-list-item-content';
                    contentDiv.style.cssText = 'display:flex; padding:12px 16px; border-bottom:0.5px solid #f0f0f0; align-items:center; gap:12px; background-color:#fff;';
                    
                    contentDiv.onclick = () => openRealFriendChat(f._realFriendId, f.nickname, f.avatar);
                    
                    const avatarStyle = f.avatar ? `background-image:url(${f.avatar})` : 'background:linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
                    
                    let lastMsg = f.last_message || '';
                    let lastTimeStr = '';
                    if (f.last_time) {
                        const d = new Date(f.last_time * 1000);
                        const now = new Date();
                        if (d.toDateString() === now.toDateString()) {
                            lastTimeStr = `${d.getHours()}:${d.getMinutes().toString().padStart(2,'0')}`;
                        } else {
                            lastTimeStr = `${d.getMonth()+1}/${d.getDate()}`;
                        }
                    }
                    
                    const unreadBadge = f.unread_count > 0 ? `<span style="background:#ff3b30; color:#fff; font-size:10px; padding:2px 6px; border-radius:10px; margin-left:6px;">${f.unread_count}</span>` : '';
                    
                    contentDiv.innerHTML = `
                        <div style="width:48px; height:48px; border-radius:50%; ${avatarStyle}; background-size:cover; background-position:center; flex-shrink:0; display:flex; align-items:center; justify-content:center; color:#fff; font-size:20px;">${f.avatar ? '' : '👤'}</div>
                        <div style="flex:1; min-width:0;">
                            <div style="display:flex; justify-content:space-between; margin-bottom:4px; align-items:center;">
                                <div style="display:flex; align-items:center;">
                                    <div style="font-size:16px; font-weight:500; color:#333;">${f.nickname || '用户'}</div>
                                    <span style="background:#667eea; color:#fff; font-size:9px; padding:1px 4px; border-radius:2px; margin-left:6px;">真人</span>
                                    ${unreadBadge}
                                </div>
                                <div style="font-size:12px; color:#999;">${lastTimeStr}</div>
                            </div>
                            <div style="font-size:14px; color:#999; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${lastMsg}</div>
                        </div>
                    `;
                    
                    itemContainer.appendChild(contentDiv);
                    listDiv.appendChild(itemContainer);
                    return;
                }
                
                // 混合群聊项渲染
                if (f._isMixedGroup) {
                    const itemContainer = document.createElement('div');
                    itemContainer.className = 'wechat-list-item-container';
                    
                    const contentDiv = document.createElement('div');
                    contentDiv.className = 'wechat-list-item-content';
                    contentDiv.style.cssText = 'display:flex; padding:12px 16px; border-bottom:0.5px solid #f0f0f0; align-items:center; gap:12px; background-color:#fff;';
                    
                    contentDiv.onclick = () => openMixedGroupChat(f._mixedGroupId);
                    
                    const avatarStyle = f.avatar ? `background-image:url(${f.avatar})` : 'background:linear-gradient(135deg, #f093fb 0%, #f5576c 100%)';
                    
                    let lastMsg = f.last_message || '开始联机聊天吧';
                    let lastTimeStr = '';
                    if (f.last_time) {
                        const d = new Date(f.last_time * 1000);
                        const now = new Date();
                        if (d.toDateString() === now.toDateString()) {
                            lastTimeStr = `${d.getHours()}:${d.getMinutes().toString().padStart(2,'0')}`;
                        } else {
                            lastTimeStr = `${d.getMonth()+1}/${d.getDate()}`;
                        }
                    }
                    
                    contentDiv.innerHTML = `
                        <div style="width:48px; height:48px; border-radius:10px; ${avatarStyle}; background-size:cover; background-position:center; flex-shrink:0; display:flex; align-items:center; justify-content:center; color:#fff; font-size:18px;">${f.avatar ? '' : '🌐'}</div>
                        <div style="flex:1; min-width:0;">
                            <div style="display:flex; justify-content:space-between; margin-bottom:4px; align-items:center;">
                                <div style="display:flex; align-items:center;">
                                    <div style="font-size:16px; font-weight:500; color:#333;">${f.name || '联机群聊'}</div>
                                    <span style="background:linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color:#fff; font-size:9px; padding:1px 4px; border-radius:2px; margin-left:6px;">联机</span>
                                </div>
                                <div style="font-size:12px; color:#999;">${lastTimeStr}</div>
                            </div>
                            <div style="font-size:14px; color:#999; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${lastMsg}</div>
                        </div>
                    `;
                    
                    itemContainer.appendChild(contentDiv);
                    listDiv.appendChild(itemContainer);
                    return;
                }
                
                // AI好友项渲染（原有代码）
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
                
                // 检查好友状态
                const friendStatus = getFriendStatus(f, accountId);
                const isDeleted = friendStatus === 'deleted';
                const isBlocked = friendStatus === 'blocked';
                
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
                
                // 根据状态添加标识
                let statusBadge = '';
                if (isDeleted) {
                    statusBadge = '<span style="background:#ff9500; color:#fff; font-size:10px; padding:2px 6px; border-radius:3px; margin-left:6px;">已删除</span>';
                } else if (isBlocked) {
                    statusBadge = '<span style="background:#ff3b30; color:#fff; font-size:10px; padding:2px 6px; border-radius:3px; margin-left:6px;">已拉黑</span>';
                }
                const textColor = (isDeleted || isBlocked) ? '#999' : '#333';

                contentDiv.innerHTML = `
                    <div style="width:48px; height:48px; border-radius:6px; ${avatarStyle}; background-size:cover; background-position:center; flex-shrink:0; ${(isDeleted || isBlocked) ? 'opacity:0.6;' : ''}"></div>
                    <div style="flex:1; min-width:0;">
                        <div style="display:flex; justify-content:space-between; margin-bottom:4px; align-items:center;">
                            <div style="display:flex; align-items:center;">
                                <div style="font-size:16px; font-weight:500; color:${textColor};">${f.name}</div>
                                ${statusBadge}
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
        
        // 群聊置顶切换
        async function toggleGroupPin(groupId, e) {
            e.stopPropagation();
            const group = await db.group_chats.get(groupId);
            if (group) {
                group.is_pinned = !group.is_pinned;
                await db.group_chats.put(group);
                renderWechatList(document.getElementById('wechat-content'));
            }
        }
        
        // 删除群聊
        async function deleteGroup(groupId, e) {
            e.stopPropagation();
            if (confirm('确定要删除这个群聊吗？\n(聊天记录将被清除)')) {
                await db.group_chats.delete(groupId);
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
            
            // 如果是创建群聊弹窗，重置状态
            if (id === 'create-group-modal') {
                window._addingGroupMembers = false;
                const nameInput = document.getElementById('group-name-input');
                if (nameInput) nameInput.style.display = '';
                const title = document.querySelector('#create-group-modal .modal-title');
                if (title) title.innerText = '创建群聊';
            }
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

        // --- 群聊功能 ---
        // 默认群头像
        const DEFAULT_GROUP_AVATAR = 'https://img.heliar.top/file/1770017506622_IMG_0773.jpeg';
        
        // 显示创建群聊弹窗
        async function showCreateGroupModal() {
            document.getElementById('create-group-modal').style.display = 'flex';
            document.getElementById('wechat-menu').style.display = 'none';
            document.getElementById('group-name-input').value = '';
            
            const list = document.getElementById('group-friends-list');
            list.innerHTML = '';
            
            // 获取当前账号的好友列表
            const accountId = getCurrentAccountId();
            const allChars = await db.characters.toArray();
            const friends = allChars.filter(c => {
                if (c.type === 'user') return false;
                const status = getFriendStatus(c, accountId);
                return status === 'friend';
            });
            
            if (friends.length === 0) {
                list.innerHTML = '<div style="text-align:center; color:#999; margin-top:40px;">暂无好友<br><span style="font-size:12px;">请先添加好友再创建群聊</span></div>';
                return;
            }
            
            friends.forEach(f => {
                const item = document.createElement('div');
                item.style.cssText = 'display:flex; align-items:center; padding:12px 0; border-bottom:0.5px solid #f0f0f0; cursor:pointer;';
                item.dataset.charId = f.id;
                item.dataset.selected = 'false';
                
                const avatarStyle = f.avatar ? `background-image:url(${f.avatar})` : 'background-color:#eee';
                
                item.innerHTML = `
                    <div class="group-select-checkbox" style="width:22px; height:22px; border:2px solid #ddd; border-radius:50%; margin-right:12px; display:flex; align-items:center; justify-content:center; transition:all 0.2s;">
                        <svg class="check-icon" style="width:14px; height:14px; stroke:#fff; fill:none; stroke-width:3; display:none;" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    </div>
                    <div style="width:40px; height:40px; border-radius:4px; ${avatarStyle}; background-size:cover; background-position:center; margin-right:12px;"></div>
                    <div style="font-size:16px; color:#333;">${f.remark || f.name}</div>
                `;
                
                item.onclick = function() {
                    const isSelected = this.dataset.selected === 'true';
                    const checkbox = this.querySelector('.group-select-checkbox');
                    const checkIcon = this.querySelector('.check-icon');
                    
                    if (isSelected) {
                        this.dataset.selected = 'false';
                        checkbox.style.background = 'transparent';
                        checkbox.style.borderColor = '#ddd';
                        checkIcon.style.display = 'none';
                    } else {
                        this.dataset.selected = 'true';
                        checkbox.style.background = 'var(--ins-pink)';
                        checkbox.style.borderColor = 'var(--ins-pink)';
                        checkIcon.style.display = 'block';
                    }
                };
                
                list.appendChild(item);
            });
        }
        
        // 确认创建群聊
        async function confirmCreateGroup() {
            const list = document.getElementById('group-friends-list');
            const selectedItems = list.querySelectorAll('[data-selected="true"]');
            const memberIds = Array.from(selectedItems).map(item => parseInt(item.dataset.charId));
            
            if (memberIds.length < 1) {
                alert('请至少选择1位好友');
                return;
            }
            
            // 检查是否是添加群成员模式
            if (window._addingGroupMembers && window.currentGroupChatId) {
                await addMembersToGroup(memberIds);
                return;
            }
            
            const groupName = document.getElementById('group-name-input').value.trim();
            const accountId = getCurrentAccountId();
            
            // 获取选中成员的名称用于生成默认群名
            let defaultName = '';
            if (!groupName) {
                const memberChars = await Promise.all(memberIds.map(id => db.characters.get(id)));
                const myChar = currentMyCharId ? await db.characters.get(parseInt(currentMyCharId)) : null;
                const names = memberChars.map(c => c.remark || c.name);
                if (myChar) names.unshift(myChar.name);
                defaultName = names.slice(0, 4).join('、');
                if (names.length > 4) defaultName += '...';
            }
            
            // 创建群聊记录
            const groupChat = {
                name: groupName || defaultName,
                avatar: DEFAULT_GROUP_AVATAR,
                memberIds: memberIds,
                ownerAccountId: accountId,
                created_at: Date.now(),
                updated_at: Date.now(),
                is_pinned: false,
                chat_history: [{
                    role: 'system',
                    content: '群聊已创建',
                    time: Date.now()
                }]
            };
            
            const groupId = await db.group_chats.add(groupChat);
            
            closeModal('create-group-modal');
            alert(`群聊"${groupChat.name}"创建成功！`);
            
            // 刷新聊天列表
            if (document.querySelector('.wechat-tab-item.active')?.innerText.includes('微信')) {
                renderWechatList(document.getElementById('wechat-content'));
            }
            
            // 打开群聊窗口
            openGroupChatWindow(groupId);
        }
        
        // 添加成员到群聊
        async function addMembersToGroup(memberIds) {
            const group = await db.group_chats.get(window.currentGroupChatId);
            if (!group) return;
            
            // 添加新成员
            const newMemberNames = [];
            for (const memberId of memberIds) {
                if (!group.memberIds.includes(memberId)) {
                    group.memberIds.push(memberId);
                    const char = await db.characters.get(memberId);
                    if (char) newMemberNames.push(char.remark || char.name);
                }
            }
            
            if (newMemberNames.length > 0) {
                // 添加系统消息
                group.chat_history.push({
                    role: 'system',
                    content: `${newMemberNames.join('、')} 加入了群聊`,
                    time: Date.now()
                });
            }
            
            group.updated_at = Date.now();
            await db.group_chats.put(group);
            
            // 重置状态
            window._addingGroupMembers = false;
            document.getElementById('group-name-input').style.display = '';
            document.querySelector('#create-group-modal .modal-title').innerText = '创建群聊';
            
            closeModal('create-group-modal');
            
            // 刷新群成员列表和聊天
            await renderGroupMemberList(group);
            await renderGroupChatBody(group);
            
            alert(`已添加 ${newMemberNames.length} 位成员`);
        }
        
        // 打开群聊窗口
        async function openGroupChatWindow(groupId) {
            const group = await db.group_chats.get(groupId);
            if (!group) return;
            
            // 设置当前聊天为群聊模式
            currentChatCharId = null;
            window.currentGroupChatId = groupId;
            
            const titleEl = document.getElementById('chat-title');
            titleEl.innerText = group.name;
            titleEl.style.cursor = 'pointer';
            titleEl.onclick = () => showGroupDetail(groupId);
            
            document.getElementById('chat-window').style.display = 'flex';
            
            // 显示输入框
            const chatFooter = document.getElementById('chat-footer');
            chatFooter.style.display = 'flex';
            
            await renderGroupChatBody(group);
        }
        
        // 显示群聊详情页
        async function showGroupDetail(groupId) {
            const group = await db.group_chats.get(groupId || window.currentGroupChatId);
            if (!group) return;
            
            document.getElementById('group-detail-page').style.display = 'flex';
            
            // 设置群头像
            const avatarEl = document.getElementById('group-detail-avatar');
            if (group.avatar) {
                avatarEl.style.backgroundImage = `url(${group.avatar})`;
            } else {
                avatarEl.style.backgroundImage = '';
                avatarEl.style.backgroundColor = '#eee';
            }
            
            // 设置群名称
            document.getElementById('group-detail-name').value = group.name || '';
            
            // 设置我的群昵称
            document.getElementById('group-detail-nickname').value = group.myNickname || '';
            
            // 设置开关状态
            document.getElementById('group-detail-mute').checked = group.is_muted || false;
            document.getElementById('group-detail-pin').checked = group.is_pinned || false;
            
            // 渲染群成员列表
            await renderGroupMemberList(group);
        }
        
        // 渲染群成员列表预览（详情页）
        async function renderGroupMemberList(group) {
            const listEl = document.getElementById('group-member-list');
            listEl.innerHTML = '';
            
            // 添加自己
            const myChar = currentMyCharId ? await db.characters.get(parseInt(currentMyCharId)) : null;
            if (myChar) {
                const myAvatar = myChar.avatar || '';
                const myAvatarStyle = myAvatar ? `background-image:url(${myAvatar})` : 'background-color:#eee';
                const myItem = document.createElement('div');
                myItem.style.cssText = 'display:flex; flex-direction:column; align-items:center; width:60px;';
                myItem.innerHTML = `
                    <div style="width:44px; height:44px; border-radius:6px; ${myAvatarStyle}; background-size:cover; background-position:center; position:relative;">
                        <div style="position:absolute; bottom:-2px; right:-2px; background:#07c160; color:#fff; font-size:8px; padding:1px 3px; border-radius:2px;">群主</div>
                    </div>
                    <div style="font-size:11px; color:#333; margin-top:4px; text-align:center; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; width:100%;">${group.myNickname || myChar.name || '我'}</div>
                `;
                listEl.appendChild(myItem);
            }
            
            // 添加其他成员（最多显示8个预览）
            const memberIds = group.memberIds || [];
            const adminIds = group.adminIds || [];
            const displayCount = Math.min(memberIds.length, 7);
            
            for (let i = 0; i < displayCount; i++) {
                const memberId = memberIds[i];
                const char = await db.characters.get(memberId);
                if (!char) continue;
                
                const isAdmin = adminIds.includes(memberId);
                const avatarStyle = char.avatar ? `background-image:url(${char.avatar})` : 'background-color:#eee';
                const item = document.createElement('div');
                item.style.cssText = 'display:flex; flex-direction:column; align-items:center; width:60px;';
                item.innerHTML = `
                    <div style="width:44px; height:44px; border-radius:6px; ${avatarStyle}; background-size:cover; background-position:center; position:relative;">
                        ${isAdmin ? '<div style="position:absolute; bottom:-2px; right:-2px; background:#ff9500; color:#fff; font-size:8px; padding:1px 3px; border-radius:2px;">管理</div>' : ''}
                    </div>
                    <div style="font-size:11px; color:#333; margin-top:4px; text-align:center; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; width:100%;">${char.remark || char.name}</div>
                `;
                listEl.appendChild(item);
            }
            
            // 如果成员超过8个，显示更多
            if (memberIds.length > 7) {
                const moreItem = document.createElement('div');
                moreItem.style.cssText = 'display:flex; flex-direction:column; align-items:center; width:60px; cursor:pointer;';
                moreItem.innerHTML = `
                    <div style="width:44px; height:44px; border-radius:6px; background:#f0f0f0; display:flex; align-items:center; justify-content:center; font-size:14px; color:#999;">+${memberIds.length - 7}</div>
                    <div style="font-size:11px; color:#999; margin-top:4px;">更多</div>
                `;
                moreItem.onclick = () => showGroupMemberManage();
                listEl.appendChild(moreItem);
            }
            
            // 更新成员数量
            const totalCount = memberIds.length + 1; // +1 包含自己
            document.getElementById('group-member-count').innerText = `${totalCount}人`;
            const countText = document.getElementById('group-member-count-text');
            if (countText) countText.innerText = `${totalCount}人`;
        }
        
        // 当前操作的成员ID
        let currentActionMemberId = null;
        
        // 显示群成员管理页面
        async function showGroupMemberManage() {
            if (!window.currentGroupChatId) return;
            
            const group = await db.group_chats.get(window.currentGroupChatId);
            if (!group) return;
            
            document.getElementById('group-member-manage-page').style.display = 'flex';
            
            await renderGroupMemberManageList(group);
        }
        
        // 隐藏群成员管理页面
        function hideGroupMemberManage() {
            document.getElementById('group-member-manage-page').style.display = 'none';
        }
        
        // 渲染群成员管理列表
        async function renderGroupMemberManageList(group) {
            const ownerEl = document.getElementById('group-owner-info');
            const adminListEl = document.getElementById('group-admin-list');
            const memberListEl = document.getElementById('group-normal-member-list');
            const noAdminEl = document.getElementById('group-no-admin');
            
            ownerEl.innerHTML = '';
            adminListEl.innerHTML = '';
            memberListEl.innerHTML = '';
            
            const adminIds = group.adminIds || [];
            const mutedIds = group.mutedMembers || [];
            
            // 检查当前用户权限
            const isOwner = group.ownerAccountId === getCurrentAccountId();
            const currentUserIsAdmin = adminIds.includes(parseInt(currentMyCharId));
            const hasManagePermission = isOwner || currentUserIsAdmin;
            
            // 渲染群主（自己）
            const myChar = currentMyCharId ? await db.characters.get(parseInt(currentMyCharId)) : null;
            if (myChar) {
                const myAvatar = myChar.avatar || '';
                const myAvatarStyle = myAvatar ? `background-image:url(${myAvatar})` : 'background-color:#eee';
                ownerEl.innerHTML = `
                    <div style="display:flex; align-items:center; gap:12px;">
                        <div style="width:44px; height:44px; border-radius:6px; ${myAvatarStyle}; background-size:cover; background-position:center;"></div>
                        <div style="flex:1;">
                            <div style="font-size:16px; font-weight:500; color:#333;">${group.myNickname || myChar.name || '我'}</div>
                            <div style="font-size:12px; color:#07c160;">群主</div>
                        </div>
                    </div>
                `;
            }
            
            // 分类成员
            const admins = [];
            const members = [];
            
            for (const memberId of (group.memberIds || [])) {
                const char = await db.characters.get(memberId);
                if (!char) continue;
                
                if (adminIds.includes(memberId)) {
                    admins.push({ char, memberId });
                } else {
                    members.push({ char, memberId });
                }
            }
            
            // 渲染管理员
            if (admins.length === 0) {
                noAdminEl.style.display = 'block';
            } else {
                noAdminEl.style.display = 'none';
                for (const { char, memberId } of admins) {
                    const isMuted = mutedIds.includes(memberId);
                    const avatarStyle = char.avatar ? `background-image:url(${char.avatar})` : 'background-color:#eee';
                    const item = document.createElement('div');
                    // 只有群主可以操作管理员
                    const canOperate = isOwner;
                    item.style.cssText = `display:flex; align-items:center; gap:12px; padding:12px 16px; border-bottom:0.5px solid #f0f0f0; ${canOperate ? 'cursor:pointer;' : ''}`;
                    item.innerHTML = `
                        <div style="width:44px; height:44px; border-radius:6px; ${avatarStyle}; background-size:cover; background-position:center;"></div>
                        <div style="flex:1;">
                            <div style="font-size:16px; font-weight:500; color:#333;">${char.remark || char.name}</div>
                            <div style="font-size:12px; color:#ff9500;">${isMuted ? '已禁言 · ' : ''}管理员</div>
                        </div>
                        ${canOperate ? '<svg style="width:20px; height:20px; stroke:#ccc;" viewBox="0 0 24 24" fill="none" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>' : ''}
                    `;
                    if (canOperate) {
                        item.onclick = () => showMemberActionModal(memberId, char, true, isMuted);
                    }
                    adminListEl.appendChild(item);
                }
            }
            
            // 渲染普通成员
            for (const { char, memberId } of members) {
                const isMuted = mutedIds.includes(memberId);
                const avatarStyle = char.avatar ? `background-image:url(${char.avatar})` : 'background-color:#eee';
                const item = document.createElement('div');
                // 群主和管理员都可以操作普通成员
                const canOperate = hasManagePermission;
                item.style.cssText = `display:flex; align-items:center; gap:12px; padding:12px 16px; border-bottom:0.5px solid #f0f0f0; ${canOperate ? 'cursor:pointer;' : ''}`;
                item.innerHTML = `
                    <div style="width:44px; height:44px; border-radius:6px; ${avatarStyle}; background-size:cover; background-position:center;"></div>
                    <div style="flex:1;">
                        <div style="font-size:16px; font-weight:500; color:#333;">${char.remark || char.name}</div>
                        ${isMuted ? '<div style="font-size:12px; color:#ff3b30;">已禁言</div>' : ''}
                    </div>
                    ${canOperate ? '<svg style="width:20px; height:20px; stroke:#ccc;" viewBox="0 0 24 24" fill="none" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>' : ''}
                `;
                if (canOperate) {
                    item.onclick = () => showMemberActionModal(memberId, char, false, isMuted);
                }
                memberListEl.appendChild(item);
            }
            
            if (members.length === 0) {
                memberListEl.innerHTML = '<div style="padding:20px 16px; text-align:center; color:#999; font-size:13px;">暂无普通成员</div>';
            }
        }
        
        // 显示成员操作弹窗
        async function showMemberActionModal(memberId, char, isAdmin, isMuted) {
            currentActionMemberId = memberId;
            
            const group = await db.group_chats.get(window.currentGroupChatId);
            if (!group) return;
            
            // 检查当前用户是否是群主（创建者）
            const isOwner = group.ownerAccountId === getCurrentAccountId();
            // 检查当前用户是否是管理员
            const currentUserIsAdmin = (group.adminIds || []).includes(parseInt(currentMyCharId));
            
            const avatarStyle = char.avatar ? `url(${char.avatar})` : '#eee';
            document.getElementById('member-action-avatar').style.backgroundImage = avatarStyle;
            document.getElementById('member-action-name').innerText = char.remark || char.name;
            document.getElementById('member-action-role').innerText = isAdmin ? '管理员' : '群成员';
            
            // 权限控制：
            // - 群主可以做所有操作
            // - 管理员只能对普通成员操作（不能对其他管理员操作）
            
            const setAdminBtn = document.getElementById('member-action-set-admin');
            const removeAdminBtn = document.getElementById('member-action-remove-admin');
            const muteBtn = document.getElementById('member-action-mute');
            const kickBtn = document.getElementById('member-action-kick');
            
            if (isOwner) {
                // 群主：完整权限
                setAdminBtn.style.display = isAdmin ? 'none' : 'block';
                removeAdminBtn.style.display = isAdmin ? 'block' : 'none';
                muteBtn.style.display = 'block';
                kickBtn.style.display = 'block';
            } else if (currentUserIsAdmin) {
                // 管理员：只能操作普通成员
                setAdminBtn.style.display = 'none'; // 管理员不能设置管理员
                removeAdminBtn.style.display = 'none'; // 管理员不能取消管理员
                
                if (isAdmin) {
                    // 不能对其他管理员操作
                    muteBtn.style.display = 'none';
                    kickBtn.style.display = 'none';
                } else {
                    // 可以对普通成员操作
                    muteBtn.style.display = 'block';
                    kickBtn.style.display = 'block';
                }
            } else {
                // 普通成员：没有管理权限
                setAdminBtn.style.display = 'none';
                removeAdminBtn.style.display = 'none';
                muteBtn.style.display = 'none';
                kickBtn.style.display = 'none';
            }
            
            // 禁言按钮文字
            muteBtn.innerText = isMuted ? '解除禁言' : '禁言';
            muteBtn.style.color = isMuted ? '#07c160' : '#ff9500';
            
            document.getElementById('member-action-modal').style.display = 'flex';
        }
        
        // 设为管理员（只有群主可以）
        async function setMemberAsAdmin() {
            if (!window.currentGroupChatId || !currentActionMemberId) return;
            
            const group = await db.group_chats.get(window.currentGroupChatId);
            if (!group) return;
            
            // 权限检查：只有群主可以设置管理员
            if (group.ownerAccountId !== getCurrentAccountId()) {
                alert('只有群主可以设置管理员');
                return;
            }
            
            if (!group.adminIds) group.adminIds = [];
            if (!group.adminIds.includes(currentActionMemberId)) {
                group.adminIds.push(currentActionMemberId);
                
                const char = await db.characters.get(currentActionMemberId);
                group.chat_history.push({
                    role: 'system',
                    content: `${char?.name || '成员'} 已被设为管理员`,
                    time: Date.now()
                });
            }
            
            group.updated_at = Date.now();
            await db.group_chats.put(group);
            
            closeModal('member-action-modal');
            await renderGroupMemberManageList(group);
            await renderGroupMemberList(group);
        }
        
        // 取消管理员（只有群主可以）
        async function removeMemberAdmin() {
            if (!window.currentGroupChatId || !currentActionMemberId) return;
            
            const group = await db.group_chats.get(window.currentGroupChatId);
            if (!group) return;
            
            // 权限检查：只有群主可以取消管理员
            if (group.ownerAccountId !== getCurrentAccountId()) {
                alert('只有群主可以取消管理员');
                return;
            }
            
            group.adminIds = (group.adminIds || []).filter(id => id !== currentActionMemberId);
            
            const char = await db.characters.get(currentActionMemberId);
            group.chat_history.push({
                role: 'system',
                content: `${char?.name || '成员'} 已被取消管理员`,
                time: Date.now()
            });
            
            group.updated_at = Date.now();
            await db.group_chats.put(group);
            
            closeModal('member-action-modal');
            await renderGroupMemberManageList(group);
            await renderGroupMemberList(group);
        }
        
        // 禁言/解除禁言（群主和管理员都可以，但管理员只能对普通成员操作）
        async function toggleMemberMute() {
            if (!window.currentGroupChatId || !currentActionMemberId) return;
            
            const group = await db.group_chats.get(window.currentGroupChatId);
            if (!group) return;
            
            const isOwner = group.ownerAccountId === getCurrentAccountId();
            const currentUserIsAdmin = (group.adminIds || []).includes(parseInt(currentMyCharId));
            const targetIsAdmin = (group.adminIds || []).includes(currentActionMemberId);
            
            // 权限检查
            if (!isOwner && !currentUserIsAdmin) {
                alert('只有群主或管理员可以禁言成员');
                return;
            }
            
            // 管理员不能禁言其他管理员
            if (!isOwner && targetIsAdmin) {
                alert('管理员不能禁言其他管理员');
                return;
            }
            
            if (!group.mutedMembers) group.mutedMembers = [];
            
            const char = await db.characters.get(currentActionMemberId);
            const isMuted = group.mutedMembers.includes(currentActionMemberId);
            
            if (isMuted) {
                group.mutedMembers = group.mutedMembers.filter(id => id !== currentActionMemberId);
                group.chat_history.push({
                    role: 'system',
                    content: `${char?.name || '成员'} 已被解除禁言`,
                    time: Date.now()
                });
            } else {
                group.mutedMembers.push(currentActionMemberId);
                group.chat_history.push({
                    role: 'system',
                    content: `${char?.name || '成员'} 已被禁言`,
                    time: Date.now()
                });
            }
            
            group.updated_at = Date.now();
            await db.group_chats.put(group);
            
            closeModal('member-action-modal');
            await renderGroupMemberManageList(group);
        }
        
        // 踢出群聊（群主和管理员都可以，但管理员只能踢普通成员）
        async function kickMember() {
            if (!window.currentGroupChatId || !currentActionMemberId) return;
            
            const group = await db.group_chats.get(window.currentGroupChatId);
            if (!group) return;
            
            const isOwner = group.ownerAccountId === getCurrentAccountId();
            const currentUserIsAdmin = (group.adminIds || []).includes(parseInt(currentMyCharId));
            const targetIsAdmin = (group.adminIds || []).includes(currentActionMemberId);
            
            // 权限检查
            if (!isOwner && !currentUserIsAdmin) {
                alert('只有群主或管理员可以移除成员');
                return;
            }
            
            // 管理员不能踢其他管理员
            if (!isOwner && targetIsAdmin) {
                alert('管理员不能移除其他管理员');
                return;
            }
            
            const char = await db.characters.get(currentActionMemberId);
            if (!confirm(`确定要将 ${char?.name || '该成员'} 移出群聊吗？`)) return;
            
            // 从成员列表移除
            group.memberIds = (group.memberIds || []).filter(id => id !== currentActionMemberId);
            // 从管理员列表移除
            group.adminIds = (group.adminIds || []).filter(id => id !== currentActionMemberId);
            // 从禁言列表移除
            group.mutedMembers = (group.mutedMembers || []).filter(id => id !== currentActionMemberId);
            
            group.chat_history.push({
                role: 'system',
                content: `${char?.name || '成员'} 已被移出群聊`,
                time: Date.now()
            });
            
            group.updated_at = Date.now();
            await db.group_chats.put(group);
            
            closeModal('member-action-modal');
            await renderGroupMemberManageList(group);
            await renderGroupMemberList(group);
            await renderGroupChatBody(group);
        }
        
        // 隐藏群聊详情页
        function hideGroupDetail() {
            document.getElementById('group-detail-page').style.display = 'none';
        }
        
        // 保存群聊详情
        async function saveGroupDetail() {
            if (!window.currentGroupChatId) return;
            
            const group = await db.group_chats.get(window.currentGroupChatId);
            if (!group) return;
            
            group.name = document.getElementById('group-detail-name').value.trim() || group.name;
            group.myNickname = document.getElementById('group-detail-nickname').value.trim();
            group.is_muted = document.getElementById('group-detail-mute').checked;
            group.is_pinned = document.getElementById('group-detail-pin').checked;
            group.updated_at = Date.now();
            
            await db.group_chats.put(group);
            
            // 更新聊天窗口标题
            document.getElementById('chat-title').innerText = group.name;
        }
        
        // 设置群头像
        async function setGroupAvatar(input) {
            if (!input.files || !input.files[0] || !window.currentGroupChatId) return;
            
            const file = input.files[0];
            const reader = new FileReader();
            
            reader.onload = async (e) => {
                const avatarUrl = e.target.result;
                
                const group = await db.group_chats.get(window.currentGroupChatId);
                if (!group) return;
                
                group.avatar = avatarUrl;
                group.updated_at = Date.now();
                await db.group_chats.put(group);
                
                // 更新详情页头像
                document.getElementById('group-detail-avatar').style.backgroundImage = `url(${avatarUrl})`;
            };
            
            reader.readAsDataURL(file);
            input.value = '';
        }
        
        // 清空群聊记录
        async function clearGroupChatHistory() {
            if (!window.currentGroupChatId) return;
            
            if (!confirm('确定要清空该群聊的所有聊天记录吗？')) return;
            
            const group = await db.group_chats.get(window.currentGroupChatId);
            if (!group) return;
            
            group.chat_history = [{
                role: 'system',
                content: '聊天记录已清空',
                time: Date.now()
            }];
            group.updated_at = Date.now();
            
            await db.group_chats.put(group);
            await renderGroupChatBody(group);
            
            alert('聊天记录已清空');
        }
        
        // 退出群聊
        async function exitGroup() {
            if (!window.currentGroupChatId) return;
            
            if (!confirm('确定要删除并退出该群聊吗？')) return;
            
            await db.group_chats.delete(window.currentGroupChatId);
            
            hideGroupDetail();
            hideChatWindow();
            
            // 刷新聊天列表
            if (document.querySelector('.wechat-tab-item.active')?.innerText.includes('微信')) {
                renderWechatList(document.getElementById('wechat-content'));
            }
            
            alert('已退出群聊');
        }
        
        // 移除群成员
        async function removeGroupMember(groupId, memberId) {
            const group = await db.group_chats.get(groupId);
            if (!group) return;
            
            group.memberIds = group.memberIds.filter(id => id !== memberId);
            group.updated_at = Date.now();
            
            // 添加系统消息
            const char = await db.characters.get(memberId);
            group.chat_history.push({
                role: 'system',
                content: `${char?.name || '成员'} 已被移出群聊`,
                time: Date.now()
            });
            
            await db.group_chats.put(group);
            await renderGroupMemberList(group);
            await renderGroupChatBody(group);
        }
        
        // 显示添加群成员弹窗
        async function showAddGroupMemberModal() {
            if (!window.currentGroupChatId) return;
            
            const group = await db.group_chats.get(window.currentGroupChatId);
            if (!group) return;
            
            // 复用创建群聊的弹窗逻辑
            document.getElementById('create-group-modal').style.display = 'flex';
            document.getElementById('group-name-input').style.display = 'none';
            document.querySelector('#create-group-modal .modal-title').innerText = '添加群成员';
            
            const list = document.getElementById('group-friends-list');
            list.innerHTML = '';
            
            const accountId = getCurrentAccountId();
            const allChars = await db.characters.toArray();
            const existingMemberIds = group.memberIds || [];
            
            // 过滤出还不在群里的好友
            const friends = allChars.filter(c => {
                if (c.type === 'user') return false;
                if (existingMemberIds.includes(c.id)) return false;
                const status = getFriendStatus(c, accountId);
                return status === 'friend';
            });
            
            if (friends.length === 0) {
                list.innerHTML = '<div style="text-align:center; color:#999; margin-top:40px;">没有可添加的好友</div>';
                return;
            }
            
            friends.forEach(f => {
                const item = document.createElement('div');
                item.style.cssText = 'display:flex; align-items:center; padding:12px 0; border-bottom:0.5px solid #f0f0f0; cursor:pointer;';
                item.dataset.charId = f.id;
                item.dataset.selected = 'false';
                
                const avatarStyle = f.avatar ? `background-image:url(${f.avatar})` : 'background-color:#eee';
                
                item.innerHTML = `
                    <div class="group-select-checkbox" style="width:22px; height:22px; border:2px solid #ddd; border-radius:50%; margin-right:12px; display:flex; align-items:center; justify-content:center; transition:all 0.2s;">
                        <svg class="check-icon" style="width:14px; height:14px; stroke:#fff; fill:none; stroke-width:3; display:none;" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    </div>
                    <div style="width:40px; height:40px; border-radius:4px; ${avatarStyle}; background-size:cover; background-position:center; margin-right:12px;"></div>
                    <div style="font-size:16px; color:#333;">${f.remark || f.name}</div>
                `;
                
                item.onclick = function() {
                    const isSelected = this.dataset.selected === 'true';
                    const checkbox = this.querySelector('.group-select-checkbox');
                    const checkIcon = this.querySelector('.check-icon');
                    
                    if (isSelected) {
                        this.dataset.selected = 'false';
                        checkbox.style.background = 'transparent';
                        checkbox.style.borderColor = '#ddd';
                        checkIcon.style.display = 'none';
                    } else {
                        this.dataset.selected = 'true';
                        checkbox.style.background = 'var(--ins-pink)';
                        checkbox.style.borderColor = 'var(--ins-pink)';
                        checkIcon.style.display = 'block';
                    }
                };
                
                list.appendChild(item);
            });
            
            // 修改确认按钮行为
            window._addingGroupMembers = true;
        }
        
        // 渲染群聊消息
        async function renderGroupChatBody(group) {
            const body = document.getElementById('chat-body');
            body.innerHTML = '';
            
            const history = group.chat_history || [];
            const accountId = getCurrentAccountId();
            const myChar = currentMyCharId ? await db.characters.get(parseInt(currentMyCharId)) : null;
            
            // 获取我的群昵称
            const myNickname = group.myNickname || (myChar ? myChar.name : '我');
            
            // 预加载所有成员信息
            const memberMap = {};
            for (const memberId of group.memberIds) {
                const char = await db.characters.get(memberId);
                if (char) memberMap[memberId] = char;
            }
            
            for (const msg of history) {
                const msgDiv = document.createElement('div');
                msgDiv.style.marginBottom = '12px';
                
                if (msg.role === 'system') {
                    // 系统消息
                    msgDiv.style.textAlign = 'center';
                    msgDiv.innerHTML = `<span style="background:#fff; color:#999; font-size:12px; padding:4px 12px; border-radius:4px; border:1px solid #ddd;">${msg.content}</span>`;
                } else if (msg.role === 'user') {
                    // 我发的消息
                    msgDiv.style.display = 'flex';
                    msgDiv.style.flexDirection = 'row-reverse';
                    msgDiv.style.alignItems = 'flex-end';
                    msgDiv.style.gap = '8px';
                    
                    const myAvatar = myChar?.avatar || '';
                    const avatarStyle = myAvatar ? `background-image:url(${myAvatar})` : 'background:#ccc';
                    
                    msgDiv.innerHTML = `
                        <div style="width:32px; height:32px; border-radius:50%; ${avatarStyle}; background-size:cover; background-position:center; flex-shrink:0; margin-bottom:2px;"></div>
                        <div style="display:flex; flex-direction:column; align-items:flex-end; max-width:70%;">
                            <div style="font-size:12px; color:#999; margin-bottom:2px;">${myNickname}</div>
                            <div style="display:flex; align-items:flex-end; gap:6px;">
                                <div style="font-size:10px; color:#999;">${formatChatTime(msg.time)}</div>
                                <div style="background:#ffe4e8; color:#000; padding:6px 10px; border-radius:18px 18px 4px 18px; font-size:15px; line-height:1.5; word-break:break-word;">${msg.content}</div>
                            </div>
                        </div>
                    `;
                } else {
                    // 群成员发的消息
                    const senderChar = msg.senderId ? memberMap[msg.senderId] : null;
                    // 优先使用群昵称，其次用备注名，最后用原名
                    const memberNicknames = group.memberNicknames || {};
                    const senderName = memberNicknames[msg.senderId] || (senderChar ? (senderChar.remark || senderChar.name) : '未知成员');
                    const senderAvatar = senderChar?.avatar || '';
                    const avatarStyle = senderAvatar ? `background-image:url(${senderAvatar})` : 'background:#ccc';
                    
                    msgDiv.style.display = 'flex';
                    msgDiv.style.alignItems = 'flex-end';
                    msgDiv.style.gap = '8px';
                    
                    msgDiv.innerHTML = `
                        <div style="width:32px; height:32px; border-radius:50%; ${avatarStyle}; background-size:cover; background-position:center; flex-shrink:0; margin-bottom:2px;"></div>
                        <div style="display:flex; flex-direction:column; max-width:70%;">
                            <div style="font-size:12px; color:#999; margin-bottom:2px;">${senderName}</div>
                            <div style="display:flex; align-items:flex-end; gap:6px;">
                                <div style="background:#f2f2f7; color:#000; padding:6px 10px; border-radius:18px 18px 18px 4px; font-size:15px; line-height:1.5; word-break:break-word;">${msg.content}</div>
                                <div style="font-size:10px; color:#999;">${formatChatTime(msg.time)}</div>
                            </div>
                        </div>
                    `;
                }
                
                body.appendChild(msgDiv);
            }
            
            // 滚动到底部
            body.scrollTop = body.scrollHeight;
        }
        
        // 获取群聊列表
        async function getGroupChats(accountId) {
            try {
                const allGroups = await db.group_chats.where('ownerAccountId').equals(accountId).toArray();
                return allGroups;
            } catch (e) {
                // 如果表不存在，返回空数组
                return [];
            }
        }
        
        // 格式化聊天时间
        function formatChatTime(timestamp) {
            if (!timestamp) return '';
            const d = new Date(timestamp);
            const now = new Date();
            if (d.toDateString() === now.toDateString()) {
                return `${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`;
            } else {
                return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`;
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
                    <div style="width:48px; height:48px; border-radius:4px; ${avatarStyle}; background-size:cover; background-position:center; flex-shrink:0;"></div>
                    <div style="flex:1; min-width:0;">
                        <div style="font-size:16px; font-weight:500; color:#333; margin-bottom:4px;">${relatedChar.name}</div>
                        <div style="font-size:12px; color:#666; line-height:1.5; white-space:pre-line; word-break:break-word;">${messageText}</div>
                    </div>
                    <div style="display:flex; align-items:center; flex-shrink:0;">
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
            
            // 自动发送"我已同意了你的好友申请"消息
            let history = getChatHistory(char, accountId);
            const acceptMessage = {
                role: 'user',
                content: '我已同意了你的好友申请',
                time: Date.now()
            };
            history.push(acceptMessage);
            await setChatHistory(char, accountId, history);
            
            // 刷新页面
            await renderNewFriendsPage();
            
            // 如果当前在通讯录页面，也刷新通讯录
            const activeTab = document.querySelector('.wechat-tab-item.active');
            if (activeTab && activeTab.innerText.includes('通讯录')) {
                await renderContactList(document.getElementById('wechat-content'));
            }
            
            // 如果当前正在和这个角色聊天，刷新聊天窗口
            if (currentChatCharId === char.id) {
                await renderChatBody(char);
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

        async function blockFriendConfirm() {
            if (!currentChatCharId) return;
            
            const char = await db.characters.get(currentChatCharId);
            if (!char) return;
            
            if (confirm(`确定要拉黑好友 ${char.name} 吗？拉黑后对方将无法发送好友申请，但在快进时间时可能会尝试联系你。`)) {
                await blockFriendAction(currentChatCharId);
            }
        }

        async function blockFriendAction(charId) {
            const char = await db.characters.get(charId);
            if (!char) return;
            
            const accountId = getCurrentAccountId();
            
            // 将好友状态改为拉黑
            await setFriendStatus(char, accountId, 'blocked');
            
            // 初始化等待好友申请的设置（与删除好友逻辑相同）
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
            
            alert(`已拉黑好友 ${char.name}，聊天记录已保留`);
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
            
            // 检查角色是否被用户拉黑
            const status = getFriendStatus(targetChar, accountId);
            if (status === 'blocked') {
                alert('该角色已被你拉黑，无法发送好友申请');
                return;
            }
            
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
            
            alert(`好友申请已发送给 ${targetChar.name}\n\n对方需要在"新的好友"中接受申请，或者你可以让AI自动判断是否接受。`);
            
            // 询问是否让AI自动判断
            if (targetChar.type !== 'user') {
                // 检查API密钥（从数据库获取，和正常聊天一样）
                const apiKeyData = await db.dexiData.get('aiApiKey');
                const apiKey = apiKeyData?.value ? apiKeyData.value.trim() : '';
                
                if (!apiKey) {
                    const configNow = confirm('⚠️ 未配置AI密钥\n\nAI自动判断需要配置API密钥。\n\n是否现在去配置？\n（点击取消则需要在"新的好友"中手动接受）');
                    if (configNow) {
                        document.getElementById('setting-page').style.display = 'flex';
                    }
                    return;
                }
                
                const useAI = confirm('是否让AI根据角色性格自动判断是否接受？\n\n点击"确定"使用AI判断，点击"取消"需要手动在"新的好友"中接受。');
                
                if (useAI) {
                    // 显示加载提示
                    const loadingDiv = document.createElement('div');
                    loadingDiv.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.7); display:flex; flex-direction:column; align-items:center; justify-content:center; z-index:9999;';
                    loadingDiv.innerHTML = `
                        <div style="background:#fff; padding:30px 40px; border-radius:16px; text-align:center; box-shadow:0 10px 40px rgba(0,0,0,0.3);">
                            <div style="width:50px; height:50px; border:4px solid #f3f3f3; border-top:4px solid var(--ins-pink); border-radius:50%; margin:0 auto 20px; animation:spin 1s linear infinite;"></div>
                            <div style="font-size:18px; font-weight:600; color:#333; margin-bottom:8px;">AI判断中...</div>
                            <div style="font-size:14px; color:#999;">${targetChar.name} 正在考虑是否接受</div>
                        </div>
                    `;
                    document.body.appendChild(loadingDiv);
                    
                    try {
                        // 调用AI判断是否接受好友申请
                        const willAccept = await aiDecideAcceptFriendRequest(targetChar, accountId, message);
                        
                        document.body.removeChild(loadingDiv);
                        
                        if (willAccept) {
                            // AI决定接受
                            const request = await db.friend_requests.get(requestId);
                            request.status = 'accepted';
                            await db.friend_requests.put(request);
                            
                            // 添加为好友
                            await setFriendStatus(targetChar, accountId, 'friend');
                            
                            alert(`✅ ${targetChar.name} 接受了你的好友申请！`);
                            
                            // 刷新界面
                            const activeTab = document.querySelector('.wechat-tab-item.active');
                            if (activeTab) {
                                const tabIndex = Array.from(document.querySelectorAll('.wechat-tab-item')).indexOf(activeTab);
                                switchWechatTab(tabIndex);
                            }
                        } else {
                            // AI决定拒绝
                            alert(`❌ ${targetChar.name} 拒绝了你的好友申请。`);
                        }
                    } catch (error) {
                        if (document.body.contains(loadingDiv)) {
                            document.body.removeChild(loadingDiv);
                        }
                        alert('AI判断失败：' + error.message + '\n\n请前往"新的好友"中手动处理。');
                    }
                }
            }
        }
        
        // AI判断是否接受好友申请
        async function aiDecideAcceptFriendRequest(char, accountId, requestMessage) {
            try {
                // 从数据库获取API配置（和正常聊天一样）
                const urlData = await db.dexiData.get('aiBaseUrl');
                const keyData = await db.dexiData.get('aiApiKey');
                const modelData = await db.dexiData.get('aiCurrentModel');
                
                const apiUrl = urlData?.value || 'https://api.openai.com';
                const apiKey = keyData?.value ? keyData.value.trim() : '';
                const model = modelData?.value || 'gpt-4';
                
                if (!apiKey) {
                    throw new Error('未配置API密钥');
                }
                
                const myChar = await db.characters.get(parseInt(accountId));
                const myName = myChar?.name || '用户';
                
                // 获取聊天历史
                const history = getChatHistory(char, accountId);
                const recentMessages = history.slice(-10).map(msg => {
                    const role = msg.role === 'user' ? myName : char.name;
                    return `${role}: ${msg.content}`;
                }).join('\n');
                
                const prompt = `你是 ${char.name}。

你的人设：
${char.description || char.desc || '（无详细人设）'}

${myName} 向你发送了好友申请，申请消息是：
"${requestMessage}"

${history.length > 0 ? `你们之前的聊天记录：\n${recentMessages}` : '你们之前没有聊过天。'}

根据你的性格、与 ${myName} 的关系（如果有的话），以及申请消息的内容，请判断你是否会接受这个好友申请。

请只回复"接受"或"拒绝"，不要有任何其他内容。`;

                const response = await fetch(`${apiUrl}/v1/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`
                    },
                    body: JSON.stringify({
                        model: model,
                        messages: [
                            { role: 'system', content: '你是一个专业的角色扮演助手。' },
                            { role: 'user', content: prompt }
                        ],
                        temperature: 0.7,
                        max_tokens: 50
                    })
                });
                
                if (!response.ok) {
                    throw new Error(`API错误: ${response.status}`);
                }
                
                const data = await response.json();
                const answer = data.choices[0].message.content.trim();
                
                console.log('[AI决定] ' + char.name + ' 的回答:', answer);
                
                return answer.includes('接受') || answer.includes('同意');
            } catch (error) {
                console.error('[AI决定] 错误:', error);
                throw error;
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
            // 检查API密钥（从数据库获取，和正常聊天一样）
            const apiKeyData = await db.dexiData.get('aiApiKey');
            const apiKey = apiKeyData?.value ? apiKeyData.value.trim() : '';
            
            if (!apiKey) {
                const configNow = confirm('⚠️ 未配置AI密钥\n\n快进检查需要调用AI来判断角色是否会发送好友申请。\n\n是否现在去配置API密钥？');
                if (configNow) {
                    // 打开设置页面
                    document.getElementById('setting-page').style.display = 'flex';
                }
                return;
            }
            
            const minutes = prompt('快进多少分钟？', '60');
            if (minutes === null) return;
            
            const minutesNum = parseInt(minutes);
            if (isNaN(minutesNum) || minutesNum <= 0) {
                alert('请输入有效的分钟数');
                return;
            }
            
            await checkCharacterSendFriendRequest(charId, minutesNum);
        }
        
        // 拉黑后的快进检查（生成电话记录和短信）
        async function fastForwardBlockedCheck(charId) {
            // 检查API密钥（从数据库获取，和正常聊天一样）
            const apiKeyData = await db.dexiData.get('aiApiKey');
            const apiKey = apiKeyData?.value ? apiKeyData.value.trim() : '';
            
            if (!apiKey) {
                const configNow = confirm('⚠️ 未配置AI密钥\n\n拉黑快进需要调用AI来判断角色是否会联系你。\n\n是否现在去配置API密钥？');
                if (configNow) {
                    // 打开设置页面
                    document.getElementById('setting-page').style.display = 'flex';
                }
                return;
            }
            
            const timeInput = prompt('快进多久？\n格式：数字 + 单位\n例如：60分钟、2小时、1天', '60分钟');
            if (timeInput === null) return;
            
            // 解析输入
            const match = timeInput.match(/^(\d+)\s*(分钟|小时|天)$/);
            if (!match) {
                alert('格式错误！请输入如：60分钟、2小时、1天');
                return;
            }
            
            const amount = parseInt(match[1]);
            const unit = match[2];
            
            // 计算毫秒数
            let ms = 0;
            let unitText = '';
            if (unit === '分钟') {
                ms = amount * 60 * 1000;
                unitText = amount + '分钟';
            } else if (unit === '小时') {
                ms = amount * 60 * 60 * 1000;
                unitText = amount + '小时';
            } else if (unit === '天') {
                ms = amount * 24 * 60 * 60 * 1000;
                unitText = amount + '天';
            }
            
            if (ms === 0) {
                alert('时间必须大于0');
                return;
            }
            
            // 显示加载提示
            const loadingDiv = document.createElement('div');
            loadingDiv.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.7); display:flex; flex-direction:column; align-items:center; justify-content:center; z-index:9999;';
            loadingDiv.innerHTML = `
                <div style="background:#fff; padding:30px 40px; border-radius:16px; text-align:center; box-shadow:0 10px 40px rgba(0,0,0,0.3);">
                    <div style="width:50px; height:50px; border:4px solid #f3f3f3; border-top:4px solid var(--ins-pink); border-radius:50%; margin:0 auto 20px; animation:spin 1s linear infinite;"></div>
                    <div style="font-size:18px; font-weight:600; color:#333; margin-bottom:8px;">正在快进中...</div>
                    <div style="font-size:14px; color:#999;">快进 ${unitText}，AI正在判断角色是否会联系你</div>
                </div>
            `;
            document.body.appendChild(loadingDiv);
            
            // 添加旋转动画（如果还没有）
            if (!document.querySelector('#spin-animation-style')) {
                const style = document.createElement('style');
                style.id = 'spin-animation-style';
                style.textContent = `
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                `;
                document.head.appendChild(style);
            }
            
            try {
                console.log('[FastForwardBlocked] 开始快进，时长:', unitText);
                
                // 更新虚拟时间偏移
                const char = await db.characters.get(charId);
                if (!char.timeOffset) char.timeOffset = 0;
                char.timeOffset += ms;
                await db.characters.put(char);
                
                console.log('[FastForwardBlocked] 时间已更新，开始检查被拉黑角色...');
                
                // 检查被拉黑的角色是否会联系（这会调用AI生成电话和短信）
                await checkBlockedCharactersContact(ms, unitText);
                
                console.log('[FastForwardBlocked] 检查完成');
                
                // 等待一小段时间，确保所有通知都显示完毕
                await new Promise(resolve => setTimeout(resolve, 500));
                
                if (document.body.contains(loadingDiv)) {
                    document.body.removeChild(loadingDiv);
                }
                
                console.log('[FastForwardBlocked] 快进完成');
                alert(`✅ 已快进 ${unitText}\n\n如果被拉黑的角色决定联系你，会显示未接来电或短信记录。`);
                
                // 刷新界面
                if (currentChatCharId === charId) {
                    await renderChatBody(char);
                }
            } catch (error) {
                console.error('[FastForwardBlocked] Error:', error);
                if (document.body.contains(loadingDiv)) {
                    document.body.removeChild(loadingDiv);
                }
                alert('快进失败：' + error.message + '\n\n详细错误请查看浏览器控制台（F12）。');
            }
        }
        
        // 解除拉黑
        async function unblockFriend(charId) {
            const char = await db.characters.get(charId);
            if (!char) return;
            
            if (confirm(`确定要解除对 ${char.name} 的拉黑吗？\n解除后将恢复好友关系，可以正常聊天。`)) {
                const accountId = getCurrentAccountId();
                
                // 🎯 直接恢复为好友状态，不用重新申请
                await setFriendStatus(char, accountId, 'friend');
                
                showToast('已解除拉黑，已恢复好友关系');
                
                // 刷新界面
                if (currentChatCharId === charId) {
                    await renderChatBody(char);
                }
                
                // 刷新微信页面
                const activeTab = document.querySelector('.wechat-tab-item.active');
                if (activeTab) {
                    const tabIndex = Array.from(document.querySelectorAll('.wechat-tab-item')).indexOf(activeTab);
                    switchWechatTab(tabIndex);
                }
            }
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

如果你决定发送好友申请，请以你的视角写出你想对${myChar.name}说的话（可以是1-3条消息，每条消息用换行分隔）。
如果你决定不发送，请只回复"[不发送]"。

注意：请直接以角色身份说话，不要有任何格式标记或解释。`;
            
            // 显示加载提示
            const loadingDiv = document.createElement('div');
            loadingDiv.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.7); display:flex; flex-direction:column; align-items:center; justify-content:center; z-index:9999;';
            loadingDiv.innerHTML = `
                <div style="background:#fff; padding:30px 40px; border-radius:16px; text-align:center; box-shadow:0 10px 40px rgba(0,0,0,0.3);">
                    <div style="width:50px; height:50px; border:4px solid #f3f3f3; border-top:4px solid var(--ins-pink); border-radius:50%; margin:0 auto 20px; animation:spin 1s linear infinite;"></div>
                    <div style="font-size:18px; font-weight:600; color:#333; margin-bottom:8px;">正在检测中...</div>
                    <div style="font-size:14px; color:#999;">${char.name} 正在决定是否发送好友申请</div>
                </div>
            `;
            document.body.appendChild(loadingDiv);
            
            // 添加旋转动画（如果还没有）
            if (!document.querySelector('#spin-animation-style')) {
                const style = document.createElement('style');
                style.id = 'spin-animation-style';
                style.textContent = `
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                `;
                document.head.appendChild(style);
            }
            
            try {
                const response = await callAI([
                    { role: 'user', content: prompt }
                ]);
                
                document.body.removeChild(loadingDiv);
                
                // 解析AI回复
                const answer = response.trim();
                
                if (answer === '[不发送]' || answer.includes('[不发送]')) {
                    // 角色决定不发送
                    alert(`${char.name} 决定暂时不发送好友申请`);
                    
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
                } else {
                    // 角色决定发送好友申请，将多条消息拆分
                    const messages = answer.split('\n').filter(msg => msg.trim().length > 0);
                    
                    if (messages.length === 0) {
                        alert(`${char.name} 的回复为空，未发送申请`);
                        return;
                    }
                    
                    // 将所有消息合并，或者只取第一条作为申请消息
                    const requestMessage = messages.join('\n');
                    
                    // 创建好友申请（反向：从角色发给用户）
                    await db.friend_requests.add({
                        fromCharId: charId,
                        toCharId: parseInt(accountId),
                        message: requestMessage,
                        status: 'pending',
                        time: Date.now()
                    });
                    
                    // 显示消息预览
                    const preview = messages.length > 1 ? 
                        `${messages[0]}\n...(共${messages.length}条消息)` : 
                        messages[0];
                    
                    alert(`${char.name} 发送了好友申请！\n\n${preview}\n\n请前往"新的好友"页面查看。`);
                    
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
                }
                
                // 刷新界面
                if (currentChatCharId === charId) {
                    await renderChatBody(char);
                }
                
            } catch (error) {
                if (document.body.contains(loadingDiv)) {
                    document.body.removeChild(loadingDiv);
                }
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
            window.currentGroupChatId = null; // 清除群聊ID，确保是私聊模式
            const char = await db.characters.get(charId);
            
            // 优先显示备注名
            const titleEl = document.getElementById('chat-title');
            titleEl.innerText = char.remark || char.name;
            titleEl.style.cursor = 'pointer';
            titleEl.onclick = showChatDetail; // 恢复为私聊详情
            
            document.getElementById('chat-window').style.display = 'flex';
            
            // 缓存当前关联的 User ID
            currentChatUserId = char.linked_user_id || null;
            
            // 根据好友状态显示或隐藏输入框
            const accountId = getCurrentAccountId();
            const friendStatus = getFriendStatus(char, accountId);
            const chatFooter = document.getElementById('chat-footer');
            if (friendStatus === 'blocked' || friendStatus === 'deleted') {
                // 拉黑或删除后，隐藏输入框
                chatFooter.style.display = 'none';
            } else {
                // 正常状态，显示输入框
                chatFooter.style.display = 'flex';
            }
            
            renderChatBody(char);
        }

        // --- 聊天详情页逻辑 ---
        // 统一入口：根据当前是私聊还是群聊显示对应详情页
        function showChatOrGroupDetail() {
            if (window.currentGroupChatId) {
                showGroupDetail(window.currentGroupChatId);
            } else if (currentChatCharId) {
                showChatDetail();
            }
        }
        
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

            // 3. 回显主动聊天设置
            document.getElementById('detail-auto-chat-switch').checked = !!char.auto_reply_enabled;
            document.getElementById('detail-auto-chat-interval').value = char.auto_reply_interval || '';
            
            // 4. 回显AI查岗设置
            document.getElementById('detail-allow-check-switch').checked = !!char.allow_ai_check_account;
            
            // 5. 回显上下文条数设置（默认20条）
            document.getElementById('detail-context-count').value = char.context_message_count || 20;

            // 6. 加载挂载的表情包库
            updateMountedStickerCount();
            
            // 6. 更新视频通话记录数量
            updateVideoCallRecordCount();
            
            // 7. 加载自定义样式设置
            document.getElementById('detail-bubble-css').value = char.custom_bubble_css || '';
            document.getElementById('detail-custom-html').value = char.custom_html || '';
            document.getElementById('detail-custom-css').value = char.custom_css || '';
            
            // 8. 加载聊天背景图
            const bgPreview = document.getElementById('detail-chat-bg-preview');
            if (char.chat_background) {
                bgPreview.style.backgroundImage = `url(${char.chat_background})`;
                bgPreview.textContent = '';
            } else {
                bgPreview.style.backgroundImage = '';
                bgPreview.textContent = '暂无背景图';
            }
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
    
    // 主动聊天设置
    const autoEnabled = document.getElementById('detail-auto-chat-switch').checked;
    const autoInterval = parseInt(document.getElementById('detail-auto-chat-interval').value);
    
    // 上下文条数设置
    const contextCount = parseInt(document.getElementById('detail-context-count').value);
    
    // AI查岗设置
    const allowCheckEnabled = document.getElementById('detail-allow-check-switch').checked;

    char.remark = remark;
    char.lorebookIds = lorebookIds.length > 0 ? lorebookIds : null;
    // 保留旧字段以兼容，但优先使用lorebookIds
    if (lorebookIds.length > 0) {
        char.lorebookId = lorebookIds[0]; // 保留第一个作为兼容
    } else {
        char.lorebookId = null;
    }
    char.auto_reply_enabled = autoEnabled;
    char.auto_reply_interval = autoInterval > 0 ? autoInterval : null;
    char.context_message_count = contextCount > 0 ? contextCount : 20; // 默认20条
    char.allow_ai_check_account = allowCheckEnabled; // 保存查岗开关状态
    
    // 保存自定义样式（严格过滤JS）
    const bubbleCSS = document.getElementById('detail-bubble-css').value;
    const customHTML = document.getElementById('detail-custom-html').value;
    const customCSS = document.getElementById('detail-custom-css').value;
    
    char.custom_bubble_css = sanitizeCSS(bubbleCSS);
    char.custom_html = sanitizeHTML(customHTML);
    char.custom_css = sanitizeCSS(customCSS);
    
    await db.characters.put(char);
    
    // 实时更新聊天标题
    document.getElementById('chat-title').innerText = char.remark || char.name;
    
    // 如果当前正在查看这个聊天，立即应用样式
    if (currentChatCharId === char.id) {
        applyCustomStyles(char);
    }
    // 刷新列表（如果此时微信列表可见）
    // ...
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

        async function setChatBackground(input) {
            const file = input.files[0];
            if (file && currentChatCharId) {
                const reader = new FileReader();
                reader.onload = async (e) => {
                    const base64 = e.target.result;
                    const bgPreview = document.getElementById('detail-chat-bg-preview');
                    bgPreview.style.backgroundImage = `url(${base64})`;
                    bgPreview.textContent = '';
                    
                    const char = await db.characters.get(currentChatCharId);
                    char.chat_background = base64;
                    await db.characters.put(char);
                    
                    // 立即应用背景图到聊天界面
                    applyChatBackground(char);
                };
                reader.readAsDataURL(file);
            }
            input.value = '';
        }

        async function clearChatBackground() {
            if (!currentChatCharId) return;
            if (!confirm('确定要清除聊天背景图吗？')) return;
            
            const char = await db.characters.get(currentChatCharId);
            char.chat_background = null;
            await db.characters.put(char);
            
            const bgPreview = document.getElementById('detail-chat-bg-preview');
            bgPreview.style.backgroundImage = '';
            bgPreview.textContent = '暂无背景图';
            
            // 清除聊天界面的背景图
            applyChatBackground(char);
        }

        function applyChatBackground(char) {
            const chatBody = document.getElementById('chat-body');
            if (!chatBody) return;
            
            if (char.chat_background) {
                chatBody.style.backgroundImage = `url(${char.chat_background})`;
                chatBody.style.backgroundSize = 'cover';
                chatBody.style.backgroundPosition = 'center';
                chatBody.style.backgroundRepeat = 'no-repeat';
                chatBody.style.backgroundAttachment = 'fixed';
            } else {
                chatBody.style.backgroundImage = '';
                chatBody.style.backgroundSize = '';
                chatBody.style.backgroundPosition = '';
                chatBody.style.backgroundRepeat = '';
                chatBody.style.backgroundAttachment = '';
            }
        }

        // 展开/收起自定义样式区域
        function toggleCustomStyleSection() {
            const section = document.getElementById('custom-style-section');
            const icon = document.getElementById('custom-style-toggle-icon');
            
            if (section.style.display === 'none' || !section.style.display) {
                section.style.display = 'block';
                icon.style.transform = 'rotate(90deg)';
            } else {
                section.style.display = 'none';
                icon.style.transform = 'rotate(0deg)';
            }
        }

        // 严格过滤HTML中的JavaScript
        function sanitizeHTML(html) {
            if (!html) return '';
            
            // 移除所有script标签
            html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
            
            // 移除所有事件处理器属性 (on*)
            html = html.replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '');
            html = html.replace(/\s*on\w+\s*=\s*[^\s>]*/gi, '');
            
            // 移除 javascript: 协议
            html = html.replace(/javascript:/gi, '');
            
            // 移除 data: 协议（可能包含base64编码的JS）
            html = html.replace(/data:text\/html/gi, '');
            
            return html;
        }

        // 严格过滤CSS中的JavaScript
        function sanitizeCSS(css) {
            if (!css) return '';
            
            // 移除 javascript: 协议
            css = css.replace(/javascript:/gi, '');
            
            // 移除 expression() (IE特有，可执行JS)
            css = css.replace(/expression\s*\(/gi, '');
            
            // 移除 @import url(javascript:...)
            css = css.replace(/@import\s+url\s*\(\s*["']?javascript:/gi, '@import url(');
            
            // 移除 behavior: (IE特有)
            css = css.replace(/behavior\s*:/gi, 'removed-behavior:');
            
            // 移除 -moz-binding (Firefox特有，可执行JS)
            css = css.replace(/-moz-binding\s*:/gi, 'removed-binding:');
            
            return css;
        }

        // 预览自定义样式
        async function previewCustomStyle() {
            if (!currentChatCharId) return;
            
            const char = await db.characters.get(currentChatCharId);
            if (!char) return;
            
            // 临时保存当前输入的内容
            const tempBubbleCSS = sanitizeCSS(document.getElementById('detail-bubble-css').value);
            const tempHTML = sanitizeHTML(document.getElementById('detail-custom-html').value);
            const tempCSS = sanitizeCSS(document.getElementById('detail-custom-css').value);
            
            // 临时应用样式
            applyCustomStyles({
                custom_bubble_css: tempBubbleCSS,
                custom_html: tempHTML,
                custom_css: tempCSS
            });
            
            alert('预览效果已应用！\n返回聊天界面查看效果。\n保存后将永久生效。');
        }

        // 清除自定义样式
        async function clearCustomStyle() {
            if (!confirm('确定要清除所有自定义样式吗？')) return;
            
            document.getElementById('detail-bubble-css').value = '';
            document.getElementById('detail-custom-html').value = '';
            document.getElementById('detail-custom-css').value = '';
            
            await saveChatDetail();
            
            // 移除已应用的样式
            removeCustomStyles();
            
            alert('自定义样式已清除！');
        }

        // 应用自定义样式到聊天界面
        function applyCustomStyles(char) {
            if (!char) return;
            
            // 移除之前的自定义样式
            removeCustomStyles();
            
            const chatContainer = document.getElementById('chat-body');
            if (!chatContainer) return;
            
            // 应用气泡样式
            if (char.custom_bubble_css) {
                const bubbleStyleId = 'custom-bubble-style';
                let styleTag = document.getElementById(bubbleStyleId);
                
                if (!styleTag) {
                    styleTag = document.createElement('style');
                    styleTag.id = bubbleStyleId;
                    document.head.appendChild(styleTag);
                }
                
                // 只应用到AI的消息气泡
                styleTag.textContent = `.chat-bubble.ai-bubble { ${char.custom_bubble_css} }`;
            }
            
            // 应用自定义CSS
            if (char.custom_css) {
                const cssStyleId = 'custom-chat-css';
                let styleTag = document.getElementById(cssStyleId);
                
                if (!styleTag) {
                    styleTag = document.createElement('style');
                    styleTag.id = cssStyleId;
                    document.head.appendChild(styleTag);
                }
                
                styleTag.textContent = char.custom_css;
            }
            
            // 添加自定义HTML容器
            if (char.custom_html) {
                const customContainer = document.createElement('div');
                customContainer.id = 'custom-chat-container';
                customContainer.innerHTML = char.custom_html;
                
                // 插入到聊天区域顶部
                if (chatContainer.firstChild) {
                    chatContainer.insertBefore(customContainer, chatContainer.firstChild);
                } else {
                    chatContainer.appendChild(customContainer);
                }
            }
        }

        // 移除自定义样式
        function removeCustomStyles() {
            // 移除气泡样式
            const bubbleStyle = document.getElementById('custom-bubble-style');
            if (bubbleStyle) bubbleStyle.remove();
            
            // 移除自定义CSS
            const cssStyle = document.getElementById('custom-chat-css');
            if (cssStyle) cssStyle.remove();
            
            // 移除自定义HTML容器
            const customContainer = document.getElementById('custom-chat-container');
            if (customContainer) customContainer.remove();
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
                // 检测 ((TRANSFER: 金额, 备注)) 格式 - 在 cleanReplyProcessed 上匹配，确保 index 位置正确
                const transferMatch = cleanReplyProcessed.match(/\(\(TRANSFER:\s*(\d+(\.\d+)?)(?:,\s*(.+?))?\)\)/i);
                
                if (transferMatch) {
                    // 提取转账信息
                    const amount = parseFloat(transferMatch[1]);
                    let note = transferMatch[3] || '转账';
                    // 限制备注长度，不超过10个字
                    if (note.length > 10) {
                        note = note.substring(0, 10);
                    }
                    
                    // 提取转账前面的文字内容（如果有）- 现在 index 位置正确了
                    const textBeforeTransfer = cleanMessage(cleanReplyProcessed.substring(0, transferMatch.index).trim());
                    
                    const freshChar = await db.characters.get(char.id);
                    if (freshChar) {
                        let history = getChatHistory(freshChar, accountId);
                        
                        // 1. 先发送文字消息（如果有）- 支持分割成多条
                        if (textBeforeTransfer) {
                            // 对转账前的文字进行分割处理
                            let textSegments = [];
                            const textToSplit = textBeforeTransfer.replace(/[,，]/g, ' ');
                            if (textToSplit.includes('|||')) {
                                textSegments = textToSplit.split('|||').map(s => cleanMessage(s.trim())).filter(s => s.length > 0);
                            } else {
                                textSegments = splitMessage(textToSplit);
                            }
                            
                            // 过滤太短的段落
                            textSegments = textSegments.filter(seg => seg.replace(/[.,，。!?！？~…\s]/g, '').length >= 2);
                            
                            // 如果分割后为空，但原文本有内容，使用原文本
                            if (textSegments.length === 0 && textBeforeTransfer.replace(/[.,，。!?！？~…\s]/g, '').length > 0) {
                                textSegments = [textBeforeTransfer];
                            }
                            
                            // 逐条发送文字消息
                            for (let i = 0; i < textSegments.length; i++) {
                                const seg = textSegments[i];
                                const textMsg = {
                                    role: 'char',
                                    content: seg,
                                    time: Date.now() + i // 确保时间戳递增
                                };
                                history.push(textMsg);
                                await setChatHistory(freshChar, accountId, history);
                                
                                // 渲染文字消息
                                if (currentChatCharId === freshChar.id) {
                                    await appendMessageToUI('char', seg, freshChar.avatar);
                                }
                                
                                // 每条消息之间稍微延时
                                if (i < textSegments.length - 1) {
                                    await new Promise(r => setTimeout(r, 300));
                                }
                            }
                            
                            // 最后一条文字消息后稍微延时再发转账
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
                        
                        // 渲染转账卡片 - 使用 appendMessageToUI 追加，避免重新渲染整个聊天
                        if (currentChatCharId === freshChar.id) {
                            await appendMessageToUI('char', JSON.stringify(transferData), freshChar.avatar);
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
                
                // 🎯 检测亲属卡赠送指令 ((FAMILY_CARD: 额度))
                const familyCardMatch = cleanReplyProcessed.match(/\(\(FAMILY_CARD:\s*(\d+)\)\)/i);
                if (familyCardMatch) {
                    const monthlyLimit = parseInt(familyCardMatch[1]) || 0;
                    
                    // 提取亲属卡指令前面的文字内容（如果有）
                    const textBeforeFamilyCard = cleanMessage(cleanReplyProcessed.substring(0, familyCardMatch.index).trim());
                    
                    const freshChar = await db.characters.get(char.id);
                    if (freshChar) {
                        let history = getChatHistory(freshChar, accountId);
                        
                        // 1. 先发送文字消息（如果有）
                        if (textBeforeFamilyCard) {
                            let textSegments = [];
                            const textToSplit = textBeforeFamilyCard.replace(/[,，]/g, ' ');
                            if (textToSplit.includes('|||')) {
                                textSegments = textToSplit.split('|||').map(s => s.trim()).filter(s => s.length > 0);
                            } else {
                                textSegments = splitMessage(textToSplit);
                            }
                            textSegments = textSegments.filter(seg => seg.replace(/[.,，。!?！？~…\s]/g, '').length >= 2);
                            if (textSegments.length === 0 && textBeforeFamilyCard.replace(/[.,，。!?！？~…\s]/g, '').length > 0) {
                                textSegments = [textBeforeFamilyCard];
                            }
                            
                            for (let i = 0; i < textSegments.length; i++) {
                                const seg = textSegments[i];
                                history.push({ role: 'char', content: seg, time: Date.now() + i });
                                await setChatHistory(freshChar, accountId, history);
                                if (currentChatCharId === freshChar.id) {
                                    await appendMessageToUI('char', seg, freshChar.avatar);
                                }
                                if (i < textSegments.length - 1) {
                                    await new Promise(r => setTimeout(r, 300));
                                }
                            }
                            await new Promise(r => setTimeout(r, 500));
                        }
                        
                        // 2. 发送亲属卡消息
                        const user = await db.characters.get(parseInt(currentMyCharId));
                        
                        // 在角色数据中添加"我赠送的"
                        if (!freshChar.identity) freshChar.identity = {};
                        if (!freshChar.identity.familyCardsGiven) freshChar.identity.familyCardsGiven = [];
                        freshChar.identity.familyCardsGiven.push({
                            charId: parseInt(currentMyCharId),
                            monthlyLimit: monthlyLimit,
                            usedThisMonth: 0,
                            records: [],
                            createdAt: Date.now()
                        });
                        await db.characters.put(freshChar);
                        
                        // 在用户数据中添加"我收到的"
                        if (user) {
                            if (!user.identity) user.identity = {};
                            if (!user.identity.familyCardsReceived) user.identity.familyCardsReceived = [];
                            user.identity.familyCardsReceived.push({
                                charId: freshChar.id,
                                monthlyLimit: monthlyLimit,
                                usedThisMonth: 0,
                                records: [],
                                createdAt: Date.now()
                            });
                            await db.characters.put(user);
                        }
                        
                        // 发送亲属卡消息到聊天
                        const familyCardMsg = {
                            role: 'char',
                            type: 'familyCard',
                            content: JSON.stringify({
                                fromName: freshChar.name,
                                monthlyLimit: monthlyLimit,
                                status: 'sent'
                            }),
                            time: Date.now()
                        };
                        
                        history = getChatHistory(freshChar, accountId);
                        history.push(familyCardMsg);
                        await setChatHistory(freshChar, accountId, history);
                        
                        if (currentChatCharId === freshChar.id) {
                            renderChatBody(freshChar);
                        }
                        
                        sendSystemNotification(freshChar.name, '[亲属卡]');
                    }
                    return;
                }
                
                // 🎯 3. 检测朋友圈发布指令 [MOMENTS] - 支持多种格式
                // 格式1: [MOMENTS] content: xxx images: N
                let momentsMatch = cleanReplyProcessed.match(/\[MOMENTS\]\s*content:\s*([^\n]+)(?:\s*images?:\s*(\d+))?/i);
                // 格式2: ((MOMENTS: 内容))
                if (!momentsMatch) {
                    momentsMatch = cleanReplyProcessed.match(/\(\(MOMENTS:\s*(.+?)\)\)/i);
                    if (momentsMatch) {
                        // 转换为标准格式
                        momentsMatch = [momentsMatch[0], momentsMatch[1], '0'];
                    }
                }
                // 格式3: 【朋友圈：内容】
                if (!momentsMatch) {
                    momentsMatch = cleanReplyProcessed.match(/【朋友圈[：:]\s*(.+?)】/);
                    if (momentsMatch) {
                        momentsMatch = [momentsMatch[0], momentsMatch[1], '0'];
                    }
                }
                
                if (momentsMatch) {
                    const momentContent = momentsMatch[1].trim();
                    const imageCount = momentsMatch[2] ? parseInt(momentsMatch[2]) : 0;
                    
                    // 提取朋友圈指令前面的文字内容（如果有）
                    const textBeforeMoments = cleanMessage(cleanReplyProcessed.substring(0, momentsMatch.index).trim());
                    
                    const freshChar = await db.characters.get(char.id);
                    if (freshChar) {
                        let history = getChatHistory(freshChar, accountId);
                        
                        // 1. 先发送文字消息（如果有）
                        if (textBeforeMoments) {
                            const textMsg = {
                                role: 'char',
                                content: textBeforeMoments,
                                time: Date.now()
                            };
                            history.push(textMsg);
                            await setChatHistory(freshChar, accountId, history);
                            
                            // 渲染文字消息
                            if (currentChatCharId === freshChar.id) {
                                appendMessageToUI('char', textBeforeMoments, freshChar.avatar);
                            }
                            
                            // 稍微延时，让文字消息先显示
                            await new Promise(r => setTimeout(r, 500));
                        }
                        
                        // 2. 发布朋友圈
                        await publishMomentsByCharacter(freshChar, momentContent, imageCount);
                        
                        console.log(`[AutoChat] ${freshChar.name} 发布了朋友圈`);
                        addLog('success', `角色发布朋友圈: ${freshChar.name}`, { content: momentContent });
                        
                        // 发送通知
                        sendSystemNotification(freshChar.name, '[朋友圈]');
                        
                        // 刷新微信列表
                        if (currentChatCharId !== freshChar.id) {
                            const wechatPage = document.getElementById('wechat-page');
                            if (wechatPage.style.display !== 'none' && 
                                document.querySelector('.wechat-tab-item.active .tab-name').innerText === '微信') {
                                renderWechatList(document.getElementById('wechat-content'));
                            }
                        }
                    }
                    return; // 朋友圈处理完成，不再执行后续逻辑
                }
                
                // 🎯 检测"幻觉"：AI说发了朋友圈但没有指令
                const hasMomentsClaim = /发了.*?朋友圈|朋友圈.*?发了|发布.*?动态|更新.*?朋友圈|发个朋友圈/i.test(cleanReplyProcessed);
                if (hasMomentsClaim) {
                    console.warn(`[AutoChat] ⚠️ AI幻觉检测：${char.name} 说发了朋友圈，但没有返回正确的指令格式！`);
                    console.warn(`[AutoChat] 正确格式示例：[MOMENTS] content: 内容 images: 1`);
                    // 给用户一个提示
                    showToast(`${char.name}说发了朋友圈，但格式不对，未实际发布`);
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
            
            // 检查是否是混合群聊
            if (window.currentMixedGroupId) {
                if (!text) return;
                input.value = '';
                handleChatInputChange(input);
                await sendMixedGroupUserMessage(text);
                return;
            }
            
            // 检查是否是群聊
            if (window.currentGroupChatId) {
                await sendGroupMessage(text);
                return;
            }
            
            // 检查是否是真人聊天
            if (currentRealFriendId) {
                if (!text) return;
                input.value = '';
                await sendRealFriendMessage(text);
                return;
            }
            
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
            
            // ✅ 优化：只追加新消息到 DOM，不重新渲染整个聊天记录
            await appendMessageToUI('user', text, char.avatar);
            
            // ✅ 不再自动触发 AI 回复，需要用户点击"接受回复"按钮
            // triggerAiReply(); 
        }
        
        // 发送群聊消息
        async function sendGroupMessage(text) {
            if (!text || !window.currentGroupChatId) return;
            
            const group = await db.group_chats.get(window.currentGroupChatId);
            if (!group) return;
            
            const input = document.getElementById('chat-input-box');
            input.value = '';
            handleChatInputChange(input);
            closeChatPanel();
            
            // 添加消息到群聊历史
            if (!group.chat_history) group.chat_history = [];
            group.chat_history.push({
                role: 'user',
                content: text,
                time: Date.now()
            });
            group.updated_at = Date.now();
            
            await db.group_chats.put(group);
            
            // 重新渲染群聊
            await renderGroupChatBody(group);
        }
        
        // 触发群聊成员回复（多人回复 - 一次API调用生成所有回复）
        async function triggerGroupMemberReply() {
            if (!window.currentGroupChatId) return;
            
            let group = await db.group_chats.get(window.currentGroupChatId);
            if (!group || !group.memberIds || group.memberIds.length === 0) return;
            
            const accountId = getCurrentAccountId();
            const chatTitleEl = document.getElementById('chat-title');
            const originalTitle = group.name;
            
            // 显示"正在生成中..."提示
            if (chatTitleEl) chatTitleEl.innerText = `群成员们正在输入...`;
            
            try {
                // 过滤掉被禁言的成员
                const mutedMembers = group.mutedMembers || [];
                const availableMembers = group.memberIds.filter(id => !mutedMembers.includes(id));
                
                if (availableMembers.length === 0) {
                    if (chatTitleEl) chatTitleEl.innerText = originalTitle;
                    return;
                }
                
                // 预加载所有成员信息
                const memberMap = {};
                for (const memberId of group.memberIds) {
                    const char = await db.characters.get(memberId);
                    if (char) memberMap[memberId] = char;
                }
                const myChar = currentMyCharId ? await db.characters.get(parseInt(currentMyCharId)) : null;
                const myNickname = group.myNickname || (myChar ? myChar.name : '用户');
                
                // 构建成员列表描述（包含管理员标识和群昵称）
                const adminIds = group.adminIds || [];
                const memberNicknames = group.memberNicknames || {};
                const membersList = group.memberIds.map(memberId => {
                    const char = memberMap[memberId];
                    if (!char) return null;
                    const isMuted = mutedMembers.includes(memberId);
                    const isAdmin = adminIds.includes(memberId);
                    const nickname = memberNicknames[memberId];
                    let roleText = '';
                    if (isAdmin) roleText += ' [管理员]';
                    if (isMuted) roleText += ' [已禁言 - 不能发言]';
                    const nicknameText = nickname ? ` (群昵称: ${nickname})` : '';
                    return `- ${char.remark || char.name}${nicknameText}${roleText}: ${char.description || '无特别设定'}`;
                }).filter(Boolean).join('\n');
                
                // 获取世界书上下文（合并所有成员的世界书）
                let loreContext = "";
                const allLorebookIds = new Set();
                for (const memberId of availableMembers) {
                    const char = memberMap[memberId];
                    if (char) {
                        const ids = char.lorebookIds || (char.lorebookId ? [char.lorebookId] : []);
                        ids.forEach(id => allLorebookIds.add(id));
                    }
                }
                if (allLorebookIds.size > 0) {
                    const recentText = (group.chat_history || []).slice(-10).map(m => m.content).join(' ');
                    loreContext = await getLorebookContext([...allLorebookIds], recentText);
                    if (loreContext) {
                        loreContext = `\n【世界观/背景设定】\n${loreContext}`;
                    }
                }
                
                // 构建群聊上下文
                const groupHistory = group.chat_history || [];
                const recentGroupHistory = groupHistory.slice(-25);
                
                let groupContextStr = recentGroupHistory.map(m => {
                    if (m.role === 'system') return `[系统消息] ${m.content}`;
                    if (m.role === 'user') return `${myNickname}: ${m.content}`;
                    const sender = m.senderId ? memberMap[m.senderId] : null;
                    const senderName = sender ? (sender.remark || sender.name) : '未知成员';
                    return `${senderName}: ${m.content}`;
                }).join('\n');
                
                // 计算虚拟时间
                const virtualTimeStr = getFormattedVirtualTime(0);
                
                // 构建系统提示 - 让AI一次性生成多个角色的回复
                const minReplies = Math.max(4, availableMembers.length * 2);
                const maxReplies = Math.max(8, availableMembers.length * 3);
                
                let systemPrompt = `# 核心任务：群聊导演
你是一个群聊导演，负责扮演群里的所有角色。你的任务是让他们进行一场生动、热烈的对话。

# 输出格式铁律 (最高优先级)
- 你的回复【必须】是一个JSON数组
- 数组中的每个对象格式: {"name": "角色名", "content": "发言内容"}
- 【必须】生成 ${minReplies} 到 ${maxReplies} 条消息
- 【必须】让大部分角色都参与发言
- 每个角色应该发送 2-4 条消息
- 角色之间要有来回的对话互动

# 当前时间
${virtualTimeStr}

# 群聊信息
- 群名称: ${group.name}
- 用户昵称: ${myNickname}
${loreContext}

# 群成员列表及人设 (你扮演的角色)
${membersList}

# 最近的群聊历史
${groupContextStr}

# 角色扮演核心规则
1. **热烈讨论**: 这是一个活跃的群聊，角色们【必须】积极互动，形成热烈的讨论氛围
2. **角色互动**: 角色之间【必须】互相回应、补充、调侃或反驳
3. **连续发言**: 同一个角色可以连续发多条消息，模拟真人打字习惯
4. **禁言规则**: 标记为[已禁言]的角色【绝对不能】发言
5. **管理员权限**: 标记为[管理员]的角色可以使用 kick_member 和 mute_member 指令
6. **禁止出戏**: 绝不能透露你是AI
7. **消息风格**: 每条消息简短（1句话），可以用"|||"分隔多句话表示连发

# 可用指令类型
- **普通发言**: {"type": "text", "name": "角色名", "content": "发言内容"}
- **修改群昵称**: {"type": "change_nickname", "name": "角色名", "nickname": "新群昵称"}
- **踢出成员** (仅管理员): {"type": "kick_member", "name": "操作者角色名", "target": "被踢者角色名"}
- **禁言成员** (仅管理员): {"type": "mute_member", "name": "操作者角色名", "target": "被禁言者角色名", "mute": true}
- **解除禁言** (仅管理员): {"type": "mute_member", "name": "操作者角色名", "target": "被解禁者角色名", "mute": false}

注意：普通发言可以省略 type 字段，直接用 {"name": "角色名", "content": "内容"}

# 示例输出格式（注意消息数量要多！）
[
  {"name": "角色A", "content": "哇 你说的这个|||我也遇到过"},
  {"name": "角色B", "content": "真的吗？"},
  {"type": "change_nickname", "name": "角色A", "nickname": "话痨本痨"},
  {"name": "角色A", "content": "对啊对啊|||我改个群昵称"},
  {"name": "角色C", "content": "我也想说这个！|||之前就想吐槽了"},
  {"name": "角色B", "content": "哈哈哈哈"},
  {"name": "角色A", "content": "笑死"},
  {"name": "角色C", "content": "你们太好笑了|||不行了"},
  {"name": "角色B", "content": "确实|||绷不住了"}
]

现在，请根据以上信息，生成群聊中多个角色的【大量】回复。记住要生成 ${minReplies}-${maxReplies} 条消息！只输出JSON数组，不要有其他内容。`;

                // 准备对话历史
                const messages = [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `请生成群聊中多个角色对"${myNickname}"最后发言的回复` }
                ];
                
                // 调用AI
                let aiResponse = await callAI(messages);
                
                // 解析JSON数组
                let replies = [];
                try {
                    // 清理可能的markdown标记
                    let cleanResponse = aiResponse.trim();
                    if (cleanResponse.startsWith('```')) {
                        cleanResponse = cleanResponse.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
                    }
                    
                    // 尝试找到JSON数组的边界
                    const firstBracket = cleanResponse.indexOf('[');
                    const lastBracket = cleanResponse.lastIndexOf(']');
                    
                    if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
                        cleanResponse = cleanResponse.substring(firstBracket, lastBracket + 1);
                    }
                    
                    replies = JSON.parse(cleanResponse);
                    
                    if (!Array.isArray(replies)) {
                        replies = [replies];
                    }
                } catch (e) {
                    console.error('[triggerGroupMemberReply] JSON解析失败，尝试修复:', e);
                    
                    // 尝试提取JSON数组
                    const jsonMatch = aiResponse.match(/\[[\s\S]*?\](?=\s*$|\s*[^,\]\}])/);
                    if (jsonMatch) {
                        try {
                            replies = JSON.parse(jsonMatch[0]);
                        } catch (e2) {
                            // 尝试修复常见的JSON错误
                            let fixedJson = jsonMatch[0];
                            
                            // 修复尾部多余的逗号
                            fixedJson = fixedJson.replace(/,\s*\]/g, ']');
                            fixedJson = fixedJson.replace(/,\s*\}/g, '}');
                            
                            // 尝试补全未闭合的字符串
                            const openQuotes = (fixedJson.match(/"/g) || []).length;
                            if (openQuotes % 2 !== 0) {
                                fixedJson = fixedJson + '"';
                            }
                            
                            // 尝试补全未闭合的对象
                            const openBraces = (fixedJson.match(/\{/g) || []).length;
                            const closeBraces = (fixedJson.match(/\}/g) || []).length;
                            for (let i = 0; i < openBraces - closeBraces; i++) {
                                fixedJson = fixedJson + '}';
                            }
                            
                            try {
                                replies = JSON.parse(fixedJson);
                            } catch (e3) {
                                console.error('[triggerGroupMemberReply] 修复后仍然失败:', e3);
                                
                                // 最后尝试：逐个提取对象
                                const objectMatches = aiResponse.matchAll(/\{[^{}]*"name"\s*:\s*"[^"]+"\s*,\s*"content"\s*:\s*"[^"]*"[^{}]*\}/g);
                                for (const match of objectMatches) {
                                    try {
                                        const obj = JSON.parse(match[0]);
                                        replies.push(obj);
                                    } catch (e4) {
                                        // 忽略单个解析失败
                                    }
                                }
                            }
                        }
                    }
                }
                
                console.log('[triggerGroupMemberReply] 解析到', replies.length, '条回复');
                
                // 处理每条回复
                if (replies.length > 0) {
                    const updatedGroup = await db.group_chats.get(window.currentGroupChatId);
                    if (!updatedGroup) return;
                    
                    if (!updatedGroup.chat_history) updatedGroup.chat_history = [];
                    if (!updatedGroup.adminIds) updatedGroup.adminIds = [];
                    if (!updatedGroup.mutedMembers) updatedGroup.mutedMembers = [];
                    
                    let msgIndex = 0;
                    for (const reply of replies) {
                        // 查找操作者的成员ID
                        let senderId = null;
                        if (reply.name) {
                            for (const [memberId, char] of Object.entries(memberMap)) {
                                if (char.name === reply.name || char.remark === reply.name || char.nick === reply.name) {
                                    senderId = parseInt(memberId);
                                    break;
                                }
                            }
                        }
                        
                        // 处理修改群昵称指令
                        if (reply.type === 'change_nickname' && reply.nickname) {
                            if (!senderId) continue;
                            
                            if (!updatedGroup.memberNicknames) updatedGroup.memberNicknames = {};
                            const oldNickname = updatedGroup.memberNicknames[senderId] || memberMap[senderId]?.name || reply.name;
                            updatedGroup.memberNicknames[senderId] = reply.nickname;
                            
                            updatedGroup.chat_history.push({
                                role: 'system',
                                content: `"${oldNickname}" 将群昵称改为 "${reply.nickname}"`,
                                time: Date.now() + msgIndex * 50
                            });
                            msgIndex++;
                            continue;
                        }
                        
                        // 处理管理员指令
                        if (reply.type === 'kick_member' && reply.target) {
                            // 检查操作者是否是管理员
                            if (!senderId || !updatedGroup.adminIds.includes(senderId)) {
                                console.warn(`角色 "${reply.name}" 尝试踢人但不是管理员`);
                                continue;
                            }
                            
                            // 查找被踢者
                            let targetId = null;
                            let targetName = '';
                            for (const [memberId, char] of Object.entries(memberMap)) {
                                if (char.name === reply.target || char.remark === reply.target || char.nick === reply.target) {
                                    targetId = parseInt(memberId);
                                    targetName = char.remark || char.name;
                                    break;
                                }
                            }
                            
                            if (!targetId) continue;
                            
                            // 管理员不能被踢
                            if (updatedGroup.adminIds.includes(targetId)) {
                                console.warn(`尝试踢出管理员 "${reply.target}"，已拦截`);
                                continue;
                            }
                            
                            // 执行踢出
                            updatedGroup.memberIds = updatedGroup.memberIds.filter(id => id !== targetId);
                            const operatorName = memberMap[senderId]?.remark || memberMap[senderId]?.name || reply.name;
                            
                            updatedGroup.chat_history.push({
                                role: 'system',
                                content: `${operatorName} 将 ${targetName} 移出了群聊`,
                                time: Date.now() + msgIndex * 50
                            });
                            msgIndex++;
                            continue;
                        }
                        
                        if (reply.type === 'mute_member' && reply.target) {
                            // 检查操作者是否是管理员
                            if (!senderId || !updatedGroup.adminIds.includes(senderId)) {
                                console.warn(`角色 "${reply.name}" 尝试禁言但不是管理员`);
                                continue;
                            }
                            
                            // 查找被禁言者
                            let targetId = null;
                            let targetName = '';
                            for (const [memberId, char] of Object.entries(memberMap)) {
                                if (char.name === reply.target || char.remark === reply.target || char.nick === reply.target) {
                                    targetId = parseInt(memberId);
                                    targetName = char.remark || char.name;
                                    break;
                                }
                            }
                            
                            if (!targetId) continue;
                            
                            // 管理员不能被禁言
                            if (updatedGroup.adminIds.includes(targetId) && reply.mute !== false) {
                                console.warn(`尝试禁言管理员 "${reply.target}"，已拦截`);
                                continue;
                            }
                            
                            const operatorName = memberMap[senderId]?.remark || memberMap[senderId]?.name || reply.name;
                            
                            if (reply.mute === false) {
                                // 解除禁言
                                updatedGroup.mutedMembers = updatedGroup.mutedMembers.filter(id => id !== targetId);
                                updatedGroup.chat_history.push({
                                    role: 'system',
                                    content: `${operatorName} 解除了 ${targetName} 的禁言`,
                                    time: Date.now() + msgIndex * 50
                                });
                            } else {
                                // 禁言
                                if (!updatedGroup.mutedMembers.includes(targetId)) {
                                    updatedGroup.mutedMembers.push(targetId);
                                }
                                updatedGroup.chat_history.push({
                                    role: 'system',
                                    content: `${operatorName} 禁言了 ${targetName}`,
                                    time: Date.now() + msgIndex * 50
                                });
                            }
                            msgIndex++;
                            continue;
                        }
                        
                        // 普通发言
                        if (!reply.name || !reply.content) continue;
                        
                        // 检查是否被禁言
                        if (senderId && updatedGroup.mutedMembers.includes(senderId)) {
                            continue;
                        }
                        
                        // 使用分句逻辑 - 支持 ||| 分隔符和自然分句
                        let segments = [];
                        const content = reply.content.trim();
                        
                        // 先按 ||| 分割
                        if (content.includes('|||')) {
                            segments = content.split('|||').map(s => s.trim()).filter(s => s.length > 0);
                        } else {
                            // 使用 splitMessage 函数进行自然分句
                            segments = splitMessage(content);
                            if (segments.length === 0) {
                                segments = [content];
                            }
                        }
                        
                        // 为每个分句创建一条消息
                        for (const segment of segments) {
                            if (!segment || segment.length === 0) continue;
                            
                            updatedGroup.chat_history.push({
                                role: 'char',
                                senderId: senderId,
                                content: segment,
                                time: Date.now() + msgIndex * 50 // 稍微错开时间
                            });
                            msgIndex++;
                        }
                    }
                    
                    updatedGroup.updated_at = Date.now();
                    await db.group_chats.put(updatedGroup);
                    
                    // 重新渲染群聊
                    await renderGroupChatBody(updatedGroup);
                }
                
            } catch (error) {
                console.error('[triggerGroupMemberReply] 生成回复失败:', error);
                alert('生成回复失败: ' + error.message);
            } finally {
                // 恢复标题
                if (chatTitleEl) chatTitleEl.innerText = originalTitle;
            }
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
            window.currentGroupChatId = null; // 清除群聊ID
            currentRealFriendId = null; // 清除真人聊天ID
            currentRealFriendInfo = null;
            window.currentMixedGroupId = null; // 清除混合群聊ID
            window.currentMixedGroupInfo = null;
            
            // 恢复输入框显示（查岗模式可能隐藏了它）
            const chatFooter = document.getElementById('chat-footer');
            if (chatFooter) {
                chatFooter.style.display = 'flex';
                // 恢复魔法棒按钮显示
                const magicBtn = chatFooter.querySelector('.chat-icon-btn');
                if (magicBtn) magicBtn.style.display = '';
            }
            
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
            
            // ✅ 保护特殊格式：如果是以特殊格式开头，不要清理方括号
            if (/^\[(img|voice|imgcard):/.test(cleaned)) {
                // 这是特殊格式消息，保持原样
                return cleaned;
            }
            
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
            content.className = msg.role === 'user' ? 'message-content user-bubble' : 'message-content ai-bubble';
            
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
            // 处理亲属卡消息
            else if (msg.type === 'familyCard') {
                content.style.padding = '0';
                content.style.background = 'transparent';
                content.style.boxShadow = 'none';
                
                let cardData = {};
                try {
                    cardData = JSON.parse(msg.content);
                } catch(e) {
                    cardData = { fromName: '未知', monthlyLimit: 0, status: 'sent' };
                }
                
                const isSelf = msg.role === 'user';
                const limitText = cardData.monthlyLimit > 0 ? `每月额度 ¥${cardData.monthlyLimit}` : '不限额度';
                
                content.innerHTML = `
                    <div class="family-card-msg">
                        <div class="family-card-msg-title">💝 亲属卡</div>
                        <div class="family-card-msg-desc">${limitText}</div>
                        <div class="family-card-msg-line"></div>
                        <div class="family-card-msg-footer">
                            <span class="family-card-msg-status">${isSelf ? '已赠送' : '已收到'}</span>
                            <span class="family-card-msg-dot"></span>
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
                // 直接提取语音文本，不要用 sanitizeMessage
                let voiceText = msg.content.substring(7, msg.content.length - 1).trim();
                
                // 检查语音文本中是否包含图片链接
                const imgMatch = voiceText.match(/\[img:([^\]]+)\]/);
                let hasImage = false;
                let imgUrl = '';
                let cleanVoiceText = voiceText;
                
                if (imgMatch) {
                    hasImage = true;
                    imgUrl = imgMatch[1].trim(); // 直接使用，不要用 sanitizeMessage
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
                // 直接提取方括号内的内容，不要用 sanitizeMessage（会破坏格式）
                const cardText = msg.content.substring(9, msg.content.length - 1).trim();
                
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
                // 直接提取URL，不要用 sanitizeMessage
                const imgUrl = msg.content.substring(5, msg.content.length - 1).trim();
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
            if (friendStatus === 'blocked') {
                // 被拉黑状态，显示面板（与删除类似，但提示和功能不同）
                body.innerHTML = `
                    <div style="display:flex; flex-direction:column; height:100%; padding:20px;">
                        <div style="text-align:center; padding:20px 0; border-bottom:1px solid #f0f0f0;">
                            <div style="width:60px; height:60px; border-radius:8px; background-image:url(${char.avatar}); background-size:cover; background-position:center; margin:0 auto 12px;"></div>
                            <div style="font-size:16px; font-weight:600; margin-bottom:6px; color:#333;">${char.name}</div>
                            <div style="font-size:13px; color:#999;">你已拉黑该好友</div>
                        </div>
                        
                        <div style="flex:1; overflow-y:auto; padding:16px 0;">
                            <div style="background:#fff3cd; border-radius:8px; padding:16px; margin-bottom:16px; border:1px solid #ffc107;">
                                <div style="font-size:14px; font-weight:600; margin-bottom:12px; color:#856404;">⚠️ 拉黑提示</div>
                                <div style="font-size:12px; color:#856404; line-height:1.6;">
                                    拉黑后，该角色无法发送好友申请或微信消息。但在快进时间时，系统会根据角色性格判断是否会尝试通过电话或短信联系你。
                                </div>
                            </div>
                            
                            <div style="background:#f9f9f9; border-radius:8px; padding:16px; margin-bottom:16px;">
                                <div style="font-size:14px; font-weight:600; margin-bottom:12px; color:#333;">📱 联系记录</div>
                                <div style="font-size:12px; color:#666; line-height:1.6; margin-bottom:12px;">
                                    快进时间后，生成的电话和短信记录将出现在桌面的「电话」和「信息」应用中，而不会直接显示在这里。
                                </div>
                            </div>
                            
                            <button onclick="fastForwardBlockedCheck(${char.id})" style="width:100%; padding:12px; background:var(--ins-pink); color:#fff; border:none; border-radius:8px; font-size:14px; font-weight:600; margin-bottom:12px;">
                                ⏩ 快进时间
                            </button>
                            
                            <button onclick="unblockFriend(${char.id})" style="width:100%; padding:12px; background:#fff; border:1px solid #8e8e93; color:#333; border-radius:8px; font-size:14px; font-weight:600;">
                                解除拉黑
                            </button>
                        </div>
                    </div>
                `;
                return;
            } else if (friendStatus === 'deleted') {
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
            
            // 如果是被拉黑状态，不需要在底部添加电话记录区域，因为已经改到桌面应用了
            /*
            if (friendStatus === 'blocked') {
                const callSection = document.createElement('div');
                callSection.style.cssText = 'padding:16px; background:#f9f9f9; border-top:1px solid #f0f0f0; margin-top:20px;';
                callSection.innerHTML = `
                    <div style="font-size:14px; font-weight:600; margin-bottom:12px; color:#333;">📞 电话记录</div>
                    <div id="blocked-calls-list" style="font-size:12px; color:#666;">
                        <!-- 动态生成电话记录 -->
                    </div>
                `;
                body.appendChild(callSection);
                loadBlockedCallRecords(char.id, accountId);
            }
            */
            
            // 滚动到底部 (如果在多选模式，可能不需要滚到底部？这里暂且保持滚动)
            if (!isSelectionMode) {
                setTimeout(() => {
                    body.scrollTop = body.scrollHeight;
                }, 0);
            }
            
            // 应用自定义样式
            applyCustomStyles(char);
            
            // 应用聊天背景图
            applyChatBackground(char);
        }

        // 追加单条消息 (主要用于 AI 回复时的流式输出，不重绘整个列表)
        // 注意：追加的消息需要重新绑定事件，且此时通常不在多选模式
        async function appendMessageToUI(role, content, charAvatar, elemId) {
            const body = document.getElementById('chat-body');
            
            // 系统消息特殊处理
            if (role === 'system') {
                const sysDiv = document.createElement('div');
                sysDiv.style.cssText = 'text-align:center; padding:8px 16px; margin:8px 0;';
                sysDiv.innerHTML = `<span style="background:#fff; color:#999; font-size:12px; padding:4px 12px; border-radius:4px; border:1px solid #ddd;">${content}</span>`;
                body.appendChild(sysDiv);
                body.scrollTop = body.scrollHeight;
                return;
            }
            
            // 获取数据库中的实际消息（确保 ID 和时间戳一致）
            const char = await db.characters.get(currentChatCharId);
            const accountId = getCurrentAccountId();
            const history = getChatHistory(char, accountId);
            const index = history.length - 1;
            
            // ✅ 使用数据库中的实际消息对象，而不是创建临时对象
            // 这样可以确保转账消息的 ID 和时间戳与数据库一致
            let msg = history[index];
            
            // 如果数据库中没有找到消息，才使用临时对象（兼容旧逻辑）
            if (!msg) {
                const cleanedContent = sanitizeMessage(content);
                msg = { role, content: cleanedContent, time: Date.now() };
            }
            
            const userAvatarUrl = await getUserAvatarUrl(char.linked_user_id);
            
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

            // 简单的边界检测（横排菜单）
            const winWidth = window.innerWidth;
            const winHeight = window.innerHeight;
            let menuX = clientX;
            let menuY = clientY - 60; // 显示在点击位置上方

            menu.style.display = 'flex'; // 先显示以获取 offsetWidth
            
            // 水平边界检测
            if (menuX + menu.offsetWidth > winWidth) {
                menuX = winWidth - menu.offsetWidth - 10;
            }
            if (menuX < 10) {
                menuX = 10;
            }
            
            // 垂直边界检测
            if (menuY < 10) {
                menuY = clientY + 10; // 如果上方空间不够，显示在下方
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
                
                // ✅ 优化：直接更新 DOM 中的消息内容，不重新渲染
                const chatBody = document.getElementById('chat-body');
                const messageRows = chatBody.querySelectorAll('.message-row');
                if (messageRows[activeMsgIndex]) {
                    const bubbleText = messageRows[activeMsgIndex].querySelector('.bubble-text');
                    if (bubbleText) {
                        bubbleText.textContent = newContent.trim();
                    }
                }
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
            
            // ✅ 优化：直接更新 DOM 显示撤回状态，不重新渲染
            const chatBody = document.getElementById('chat-body');
            const messageRows = chatBody.querySelectorAll('.message-row');
            if (messageRows[activeMsgIndex]) {
                const msgRow = messageRows[activeMsgIndex];
                const isUser = history[activeMsgIndex].role === 'user';
                // 替换消息内容为撤回提示
                const bubble = msgRow.querySelector('.msg-bubble');
                if (bubble) {
                    bubble.innerHTML = `<span style="color:#999;font-size:12px;">${isUser ? '你' : char.name}撤回了一条消息</span>`;
                    bubble.style.background = 'transparent';
                    bubble.style.padding = '5px 0';
                }
            }
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
            
            await setChatHistory(char, accountId, history);
            
            // ✅ 优化：直接从 DOM 中移除消息，不重新渲染整个聊天
            const chatBody = document.getElementById('chat-body');
            const messageRows = chatBody.querySelectorAll('.message-row');
            if (messageRows[activeMsgIndex]) {
                messageRows[activeMsgIndex].remove();
            }
        }

        // --- 多选模式 ---
        function enterSelectionMode() {
            hideContextMenu();
            if (!currentChatCharId) return;
            
            isSelectionMode = true;
            selectedIndices.clear();
            
            // 切换 UI - 只需要添加 CSS 类，不需要重新渲染
            // checkbox 已经在 DOM 中，通过 CSS .selection-mode 类控制显示
            document.getElementById('chat-body').classList.add('selection-mode');
            document.getElementById('selection-bar').style.display = 'flex';
            document.getElementById('chat-footer').style.display = 'none'; // 隐藏输入框
            
            // 更新按钮文字
            updateDeleteBtn();
        }

        function exitSelectionMode() {
            isSelectionMode = false;
            selectedIndices.clear();
            
            document.getElementById('chat-body').classList.remove('selection-mode');
            document.getElementById('selection-bar').style.display = 'none';
            document.getElementById('chat-footer').style.display = 'flex'; // 恢复输入框
            
            // ✅ 优化：通过 CSS 和 DOM 操作隐藏 Checkbox，不重新渲染
            document.querySelectorAll('.message-row').forEach(row => {
                row.classList.remove('selection-mode', 'selected');
            });
            document.querySelectorAll('.msg-checkbox').forEach(cb => {
                cb.style.display = 'none';
                cb.classList.remove('checked');
            });
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
            
            // ✅ 优化：先从 DOM 中移除选中的消息（倒序删除避免索引问题）
            const chatBody = document.getElementById('chat-body');
            const messageRows = chatBody.querySelectorAll('.message-row');
            const sortedIndices = Array.from(selectedIndices).sort((a, b) => b - a); // 倒序
            sortedIndices.forEach(idx => {
                if (messageRows[idx]) {
                    messageRows[idx].remove();
                }
            });
            
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
            
            // ✅ 优化：只追加新消息，不重新渲染整个聊天
            await appendMessageToUI('user', msgContent, char.avatar);
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
                
                // ✅ 优化：只追加新消息，不重新渲染整个聊天
                await appendMessageToUI('user', msgContent, char.avatar);
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
                    const accountId = getCurrentAccountId();
                    let history = getChatHistory(char, accountId);
                    
                    history.push({
                        role: 'user',
                        content: msgContent,
                        time: Date.now()
                    });
                    
                    await setChatHistory(char, accountId, history);
                    
                    // ✅ 优化：只追加新消息，不重新渲染整个聊天
                    await appendMessageToUI('user', msgContent, char.avatar);
                    
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
            
            // ✅ 优化：只追加新消息，不重新渲染整个聊天
            await appendMessageToUI('user', msgContent, char.avatar);
            
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
            
            // 2. 检查被拉黑的角色是否会联系
            await checkBlockedCharactersContact(ms, unitText);
            
            // 3. 触发 AI 回复，带上时间流逝的系统提示
            await triggerAiReply(`时间过去了 ${unitText}`);
        }

        // 检查被拉黑的角色是否会联系用户（使用新版本逻辑）
        async function checkBlockedCharactersContact(elapsedMs, elapsedText) {
            const accountId = getCurrentAccountId();
            if (!accountId) {
                console.log('[BlockedContact] 没有当前账号');
                return;
            }
            
            // 获取所有被拉黑的角色
            const allChars = await db.characters.toArray();
            const blockedChars = allChars.filter(char => {
                const status = getFriendStatus(char, accountId);
                return status === 'blocked';
            });
            
            console.log(`[BlockedContact] 找到 ${blockedChars.length} 个被拉黑的角色`);
            
            if (blockedChars.length === 0) return;
            
            // 获取当前用户信息
            const myChar = await db.characters.get(parseInt(accountId));
            if (!myChar) {
                console.log('[BlockedContact] 找不到用户信息');
                return;
            }
            
            // 基准时间
            const baseTime = Date.now() + (blockedChars[0].timeOffset || 0);

            for (const char of blockedChars) {
                try {
                    console.log(`\n========== 开始检查角色: ${char.name} ==========`);
                    
                    // 1. 获取指令文本（传入elapsedMs用于计算数量）
                    let instructionText = await checkIfCharacterWillContact(char, myChar, elapsedText, elapsedMs);
                    
                    console.log(`[BlockedContact] ${char.name} 返回的指令文本:\n${instructionText}`);
                    
                    // 2. 解析指令（支持新格式）
                    let actions = parseContactInstructionsV2(instructionText);
                    
                    console.log(`[BlockedContact] ${char.name} 解析出 ${actions.length} 条指令:`, JSON.stringify(actions, null, 2));
                    
                    // 如果没有指令，说明角色决定不联系
                    if (actions.length === 0) {
                        console.log(`[BlockedContact] ${char.name} 决定不联系用户`);
                        continue;
                    }

                    // 3. 执行指令
                    console.log(`[BlockedContact] 开始执行 ${char.name} 的 ${actions.length} 条指令`);
                    
                    // 起始时间点稍微随机一点
                    let actionBaseTime = baseTime - elapsedMs + Math.floor(Math.random() * 60000);
                    let notificationDelay = 0; // 通知延迟累计

                    for (const action of actions) {
                        if (action.type === 'CALL') {
                            const count = parseInt(action.params.count) || 1;
                            console.log(`[BlockedContact] 生成 ${count} 通未接来电`);
                            
                            // 在整个时间段内随机分布
                            const callTimes = [];
                            for (let i = 0; i < count; i++) {
                                const randomTime = actionBaseTime + Math.random() * elapsedMs;
                                callTimes.push(randomTime);
                            }
                            // 按时间排序
                            callTimes.sort((a, b) => a - b);
                            
                            // 创建电话记录
                            for (const callTime of callTimes) {
                                await createBlockedCallRecord(char, myChar, accountId, callTime);
                            }
                            
                            // 🎯 逐条显示通知，每条间隔500ms
                            for (let i = 0; i < callTimes.length; i++) {
                                const delay = notificationDelay + i * 500;
                                setTimeout(() => {
                                    showBlockedCallNotification(char, callTimes[i]);
                                }, delay);
                            }
                            notificationDelay += callTimes.length * 500;
                        } else if (action.type === 'SMS') {
                            const messages = action.params.messages || [];
                            console.log(`[BlockedContact] 生成 ${messages.length} 条短信`);
                            
                            // 每条短信在时间段内随机分布
                            const smsTimes = [];
                            for (let i = 0; i < messages.length; i++) {
                                const randomTime = actionBaseTime + Math.random() * elapsedMs;
                                smsTimes.push({ time: randomTime, content: messages[i] });
                            }
                            // 按时间排序
                            smsTimes.sort((a, b) => a.time - b.time);
                            
                            // 创建短信记录
                            for (const sms of smsTimes) {
                                await createBlockedMessageRecord(char, myChar, accountId, sms.time, sms.content);
                            }
                            
                            // 🎯 将所有短信通知加入队列，队列系统会确保一条一条显示
                            for (let i = 0; i < smsTimes.length; i++) {
                                showBlockedSmsNotification(char, smsTimes[i].content, smsTimes[i].time);
                            }
                        }
                    }
                    
                    console.log(`[BlockedContact] ✅ ${char.name} 的联系记录生成完成`);
                    console.log(`========== 结束检查角色: ${char.name} ==========\n`);
                    
                } catch (error) {
                    console.error(`[BlockedContact] ❌ 检查 ${char.name} 时出错:`, error);
                    // 抛出错误，让用户看到具体问题
                    throw error;
                }
            }
            
            console.log('[BlockedContact] 所有指令执行完毕');
        }

        // 添加超时功能的fetch
        async function fetchWithTimeout(url, options, timeout = 30000) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);
            
            try {
                const response = await fetch(url, {
                    ...options,
                    signal: controller.signal
                });
                clearTimeout(timeoutId);
                return response;
            } catch (error) {
                clearTimeout(timeoutId);
                if (error.name === 'AbortError') {
                    throw new Error('请求超时');
                }
                throw error;
            }
        }
        
        // 调用API判断角色是否会联系（返回指令文本）- 使用callAI函数
        async function checkIfCharacterWillContact(char, myChar, elapsedText, elapsedMs) {
            console.log(`[BlockedContact] 开始请求 ${char.name} 的联系指令...`);
            
            // 🎯 根据快进时间计算合理的联系次数
            const hours = elapsedMs / (60 * 60 * 1000);
            let suggestedCallCount, suggestedSmsCount;
            
            if (hours < 1) {
                // 不到1小时：少量
                suggestedCallCount = Math.floor(Math.random() * 3) + 1; // 1-3通
                suggestedSmsCount = Math.floor(Math.random() * 5) + 3; // 3-7条
            } else if (hours < 6) {
                // 1-6小时：中等
                suggestedCallCount = Math.floor(Math.random() * 5) + 3; // 3-7通
                suggestedSmsCount = Math.floor(Math.random() * 6) + 5; // 5-10条
            } else if (hours < 24) {
                // 6-24小时：较多
                suggestedCallCount = Math.floor(Math.random() * 8) + 5; // 5-12通
                suggestedSmsCount = Math.floor(Math.random() * 8) + 8; // 8-15条
            } else {
                // 超过1天：很多
                suggestedCallCount = Math.floor(Math.random() * 8) + 8; // 8-15通
                suggestedSmsCount = Math.floor(Math.random() * 6) + 10; // 10-15条
            }
            
            // 简单的 prompt
            const prompt = `角色"${char.name}"被拉黑了，过去了${elapsedText}。
性格：${char.desc || '普通人'}

根据性格判断是否会尝试联系，如果会联系，生成指令：

[CALL]
count: ${suggestedCallCount}
interval: 随机分布在整个时间段

[SMS]
messages:
- 第1条短信内容（1句话）
- 第2条短信内容（1句话）
- 第3条短信内容（1句话）
...（共${suggestedSmsCount}条，每条都是独立的一句话，符合角色性格和被拉黑后的情绪）

如果不会联系，返回：不联系`;

            // 🎯 使用callAI函数，和好友申请一样
            const response = await callAI([
                { role: 'user', content: prompt }
            ]);
            
            console.log(`[BlockedContact] ${char.name} AI返回:`, response);
            return response.trim();
        }

        // 解析指令文本（新版本，支持多条短信）
        function parseContactInstructionsV2(text) {
            const lines = text.split('\n');
            const actions = [];
            let currentAction = null;
            let collectingMessages = false;
            const messages = [];
            
            lines.forEach(line => {
                line = line.trim();
                if (!line) return;
                
                if (line === '[CALL]') {
                    if (currentAction) {
                        if (collectingMessages && messages.length > 0) {
                            currentAction.params.messages = messages.slice();
                        }
                        actions.push(currentAction);
                    }
                    currentAction = { type: 'CALL', params: {} };
                    collectingMessages = false;
                } else if (line === '[SMS]') {
                    if (currentAction) {
                        if (collectingMessages && messages.length > 0) {
                            currentAction.params.messages = messages.slice();
                        }
                        actions.push(currentAction);
                    }
                    currentAction = { type: 'SMS', params: {} };
                    collectingMessages = false;
                    messages.length = 0;
                } else if (currentAction) {
                    if (line.startsWith('messages:')) {
                        collectingMessages = true;
                    } else if (collectingMessages) {
                        // 收集短信内容
                        // 格式：- 短信内容 或 数字. 短信内容
                        let content = line;
                        if (line.startsWith('- ')) {
                            content = line.substring(2).trim();
                        } else if (/^\d+\.?\s+/.test(line)) {
                            content = line.replace(/^\d+\.?\s+/, '').trim();
                        }
                        if (content) {
                            messages.push(content);
                        }
                    } else if (line.includes(':')) {
                        const firstColonIndex = line.indexOf(':');
                        const key = line.substring(0, firstColonIndex).trim();
                        const value = line.substring(firstColonIndex + 1).trim();
                        currentAction.params[key] = value;
                    }
                }
            });
            
            if (currentAction) {
                if (collectingMessages && messages.length > 0) {
                    currentAction.params.messages = messages.slice();
                }
                actions.push(currentAction);
            }
            
            return actions;
        }

        // 解析指令文本
        function parseContactInstructions(text) {
            const lines = text.split('\n');
            const actions = [];
            let currentAction = null;

            lines.forEach(line => {
                line = line.trim();
                if (!line) return;

                if (line === '[CALL]') {
                    if (currentAction) actions.push(currentAction);
                    currentAction = { type: 'CALL', params: {} };
                } else if (line === '[SMS]') {
                    if (currentAction) actions.push(currentAction);
                    currentAction = { type: 'SMS', params: {} };
                } else if (currentAction && line.includes(':')) {
                    const firstColonIndex = line.indexOf(':');
                    const key = line.substring(0, firstColonIndex).trim();
                    const value = line.substring(firstColonIndex + 1).trim();
                    currentAction.params[key] = value;
                }
            });
            if (currentAction) actions.push(currentAction);
            return actions;
        }

        // 创建被拉黑角色的电话记录
        async function createBlockedCallRecord(char, myChar, accountId, callTime) {
            // 将电话记录写入桌面电话应用的数据源 (phone_recents)
            const recents = JSON.parse(localStorage.getItem('phone_recents') || '[]');
            
            // 获取角色的电话号码，如果没有则随机生成一个或者使用ID
            const phoneNumber = char.identity?.phone || generateVirtualPhoneNumber(char.id);
            
            recents.unshift({
                name: char.nick || char.name,
                number: phoneNumber,
                avatar: char.avatar, // 扩展支持头像
                time: callTime,
                type: 'missed', // 未接电话
                isBlocked: true // 标记为拉黑
            });
            
            // 只保留最近50条
            if (recents.length > 50) recents.pop();
            
            localStorage.setItem('phone_recents', JSON.stringify(recents));
            
            // 显示电话通知
            showBlockedCallNotification(char, callTime);
        }

        // 创建被拉黑角色的短信记录 (修改支持传入内容)
        async function createBlockedMessageRecord(char, myChar, accountId, messageTime, contentOverride = null) {
            try {
                // 如果没有传入内容，才调用API生成 (兼容旧逻辑，虽然现在基本都传入了)
                let messageContent = contentOverride;
                if (!messageContent) {
                    messageContent = await generateBlockedMessage(char, myChar);
                }
                
                // 将短信写入桌面短信应用的数据源 (sms_messages)
                const messages = JSON.parse(localStorage.getItem('sms_messages') || '[]');
                
                const phoneNumber = char.identity?.phone || generateVirtualPhoneNumber(char.id);
                
                messages.unshift({
                    id: Date.now() + Math.random().toString(36).substr(2, 9),
                    sender: char.nick || char.name,
                    senderAvatar: char.avatar,
                    number: phoneNumber,
                    content: messageContent,
                    time: messageTime,
                    read: false,
                    isBlocked: true
                });
                
                localStorage.setItem('sms_messages', JSON.stringify(messages));
                
                // 不再自动显示toast，由调用方控制通知
                
            } catch (error) {
                console.error('[BlockedMessage] Error generating message:', error);
            }
        }
        
        // 辅助函数：生成虚拟电话号码（已在全局作用域定义，这里不再重复定义）

        // 生成被拉黑角色的消息内容 - 使用callAI函数
        async function generateBlockedMessage(char, myChar) {
            const prompt = `角色${char.name}被拉黑了，生成一句短信，符合性格：${char.desc || '普通人'}`;
            
            const response = await callAI([
                { role: 'user', content: prompt }
            ]);
            
            return response.trim();
        }

        // 显示被拉黑角色的电话通知
        function showBlockedCallNotification(char, callTime) {
            const timeStr = formatCallTimeDetailed(callTime);
            const charName = char.nick || char.name;
            
            // 创建通知元素 - 新样式：宽90%，高40px，无阴影
            const notification = document.createElement('div');
            notification.style.cssText = `
                position: fixed;
                top: 20px;
                left: 50%;
                transform: translateX(-50%) translateY(-100px);
                width: 90%;
                height: 40px;
                background: rgba(255, 255, 255, 0.95);
                backdrop-filter: blur(10px);
                border-radius: 12px;
                display: flex;
                align-items: center;
                padding: 0 12px;
                gap: 10px;
                z-index: 99999;
                transition: transform 0.3s ease;
                border: 1px solid rgba(0,0,0,0.1);
            `;
            
            notification.innerHTML = `
                <div style="width:32px;height:32px;border-radius:50%;background-image:url(${char.avatar || ''});background-size:cover;background-position:center;background-color:#ddd;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:14px;font-weight:600;color:#666;">
                    ${!char.avatar ? charName.charAt(0).toUpperCase() : ''}
                </div>
                <div style="flex:1;min-width:0;display:flex;align-items:center;gap:8px;">
                    <span style="font-size:14px;font-weight:600;color:#333;">${charName}</span>
                    <span style="font-size:12px;color:#666;">${timeStr}</span>
                    <span style="font-size:12px;color:#ff3b30;">未接电话</span>
                </div>
                <svg viewBox="0 0 24 24" style="width:20px;height:20px;stroke:#ff3b30;fill:none;flex-shrink:0;"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            `;
            
            document.body.appendChild(notification);
            
            // 显示动画
            setTimeout(() => {
                notification.style.transform = 'translateX(-50%) translateY(0)';
            }, 10);
            
            // 3秒后自动消失
            setTimeout(() => {
                notification.style.transform = 'translateX(-50%) translateY(-100px)';
                setTimeout(() => {
                    if (document.body.contains(notification)) {
                        document.body.removeChild(notification);
                    }
                }, 300);
            }, 3000);
        }

        // 短信通知队列管理
        const smsNotificationQueue = [];
        let isShowingSmsNotification = false;

        // 显示被拉黑角色的短信通知（使用队列，确保一条一条显示）
        function showBlockedSmsNotification(char, content, smsTime) {
            // 将通知加入队列
            smsNotificationQueue.push({ char, content, smsTime });
            
            // 如果当前没有正在显示的通知，开始处理队列
            if (!isShowingSmsNotification) {
                processSmsNotificationQueue();
            }
        }

        // 处理短信通知队列
        function processSmsNotificationQueue() {
            if (smsNotificationQueue.length === 0) {
                isShowingSmsNotification = false;
                return;
            }

            isShowingSmsNotification = true;
            const { char, content, smsTime } = smsNotificationQueue.shift();
            
            const timeStr = formatCallTimeDetailed(smsTime);
            const charName = char.nick || char.name;
            
            // 创建通知元素 - 新样式：宽90%，高40px，无阴影
            const notification = document.createElement('div');
            notification.style.cssText = `
                position: fixed;
                top: 20px;
                left: 50%;
                transform: translateX(-50%) translateY(-100px);
                width: 90%;
                height: 40px;
                background: rgba(255, 255, 255, 0.95);
                backdrop-filter: blur(10px);
                border-radius: 12px;
                display: flex;
                align-items: center;
                padding: 0 12px;
                gap: 10px;
                z-index: 99999;
                transition: transform 0.3s ease;
                border: 1px solid rgba(0,0,0,0.1);
            `;
            
            notification.innerHTML = `
                <div style="width:32px;height:32px;border-radius:50%;background-image:url(${char.avatar || ''});background-size:cover;background-position:center;background-color:#ddd;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:14px;font-weight:600;color:#666;">
                    ${!char.avatar ? charName.charAt(0).toUpperCase() : ''}
                </div>
                <div style="flex:1;min-width:0;overflow:hidden;">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:2px;">
                        <span style="font-size:14px;font-weight:600;color:#333;">${charName}</span>
                        <span style="font-size:12px;color:#666;">${timeStr}</span>
                    </div>
                    <div style="font-size:12px;color:#666;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${content}</div>
                </div>
                <svg viewBox="0 0 24 24" style="width:20px;height:20px;stroke:#007AFF;fill:none;flex-shrink:0;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
            `;
            
            document.body.appendChild(notification);
            
            // 显示动画
            setTimeout(() => {
                notification.style.transform = 'translateX(-50%) translateY(0)';
            }, 10);
            
            // 1秒后自动消失，然后显示下一条
            setTimeout(() => {
                notification.style.transform = 'translateX(-50%) translateY(-100px)';
                setTimeout(() => {
                    if (document.body.contains(notification)) {
                        document.body.removeChild(notification);
                    }
                    // 当前通知消失后，处理队列中的下一条
                    processSmsNotificationQueue();
                }, 300);
            }, 1000);
        }

        // 格式化电话时间（简洁版，只显示时:分）
        function formatCallTime(timestamp) {
            const date = new Date(timestamp);
            const hours = date.getHours().toString().padStart(2, '0');
            const minutes = date.getMinutes().toString().padStart(2, '0');
            return `${hours}:${minutes}`;
        }

        // 格式化电话时间（详细版，显示日期+时间）
        function formatCallTimeDetailed(timestamp) {
            const date = new Date(timestamp);
            const now = new Date();
            
            const month = (date.getMonth() + 1).toString();
            const day = date.getDate().toString();
            const hours = date.getHours().toString().padStart(2, '0');
            const minutes = date.getMinutes().toString().padStart(2, '0');
            
            // 判断是否是今天
            if (date.getDate() === now.getDate() && 
                date.getMonth() === now.getMonth() && 
                date.getFullYear() === now.getFullYear()) {
                return `今天 ${hours}:${minutes}`;
            }
            
            // 判断是否是昨天
            const yesterday = new Date(now);
            yesterday.setDate(yesterday.getDate() - 1);
            if (date.getDate() === yesterday.getDate() && 
                date.getMonth() === yesterday.getMonth() && 
                date.getFullYear() === yesterday.getFullYear()) {
                return `昨天 ${hours}:${minutes}`;
            }
            
            // 同一年显示月日
            if (date.getFullYear() === now.getFullYear()) {
                return `${month}月${day}日 ${hours}:${minutes}`;
            }
            
            // 不同年显示完整日期
            return `${date.getFullYear()}年${month}月${day}日 ${hours}:${minutes}`;
        }

        // 加载被拉黑角色的电话记录
        function loadBlockedCallRecords(charId, accountId) {
            const listContainer = document.getElementById('blocked-calls-list');
            if (!listContainer) return;
            
            const callRecords = JSON.parse(localStorage.getItem('blocked_call_records') || '[]');
            const filteredRecords = callRecords.filter(record => 
                record.charId === charId && record.accountId === accountId
            );
            
            if (filteredRecords.length === 0) {
                listContainer.innerHTML = '<div style="color:#999; font-size:12px;">暂无电话记录</div>';
                return;
            }
            
            // 按时间倒序排序
            filteredRecords.sort((a, b) => b.time - a.time);
            
            let html = '';
            filteredRecords.forEach(record => {
                const timeStr = formatCallTime(record.time);
                html += `
                    <div style="display:flex; align-items:center; padding:8px 0; border-bottom:1px solid #f0f0f0;">
                        <div style="width:32px; height:32px; border-radius:50%; background:#ff3b30; display:flex; align-items:center; justify-content:center; margin-right:12px;">
                            <svg viewBox="0 0 24 24" style="width:18px;height:18px;stroke:#fff;fill:none;"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                        </div>
                        <div style="flex:1;">
                            <div style="font-size:13px; color:#333; margin-bottom:2px;">未接电话</div>
                            <div style="font-size:11px; color:#999;">${timeStr}</div>
                        </div>
                    </div>
                `;
            });
            
            listContainer.innerHTML = html;
        }
        
        // 拟人化分句辅助函数
        function splitMessage(text) {
            if (!text) return [];
            
            // ✅ 修复：先保护特殊格式块不被拆分
            const specialBlockRegex = /(\[(?:img|voice|imgcard):[^\]]+\])/g;
            const specialBlockPlaceholders = [];
            let specialPlaceholderIndex = 0;
            
            // 用占位符替换所有特殊格式块 [img:...] [voice:...] [imgcard:...]
            let temp = text.replace(specialBlockRegex, (match) => {
                const placeholder = `###SPECIAL_BLOCK_${specialPlaceholderIndex}###`;
                specialBlockPlaceholders[specialPlaceholderIndex] = match;
                specialPlaceholderIndex++;
                return placeholder;
            });
            
            // ✅ 修复：再保护URL不被拆分
            const urlRegex = /(https?:\/\/[^\s]+)/g;
            const urlPlaceholders = [];
            let placeholderIndex = 0;
            
            // 用占位符替换所有URL
            temp = temp.replace(urlRegex, (match) => {
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
            
            // 先恢复URL占位符
            segments = segments.map(seg => {
                return seg.replace(/###URL_PLACEHOLDER_(\d+)###/g, (match, index) => {
                    return urlPlaceholders[parseInt(index)] || match;
                });
            });
            
            // 再恢复特殊格式块占位符
            segments = segments.map(seg => {
                return seg.replace(/###SPECIAL_BLOCK_(\d+)###/g, (match, index) => {
                    return specialBlockPlaceholders[parseInt(index)] || match;
                });
            });
            
            return segments;
        }

        async function triggerAiReply(additionalSystemInfo = null) {
            console.log('[triggerAiReply] ⚡ 触发 AI 回复');
            
            // 如果是群聊模式，调用群聊回复函数
            if (window.currentGroupChatId) {
                await triggerGroupMemberReply();
                return;
            }
            
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
类型：${char.type || 'char'}
设定：
${char.description || ''}

${char.identity ? `虚拟身份信息：
${char.identity.account ? `账号：${char.identity.account}` : ''}
${char.type !== 'user' && char.identity.password ? `密码：${char.identity.password}` : ''}
${char.identity.phone ? `手机：${char.identity.phone}` : ''}
${char.identity.address ? `住址：${char.identity.address}` : ''}
${char.identity.id_card ? `身份证：${char.identity.id_card}` : ''}
${char.identity.bank_card ? `银行卡：${char.identity.bank_card}` : ''}
${char.type !== 'user' && char.identity.bank_password ? `银行卡密码：${char.identity.bank_password}` : ''}
${char.identity.balance !== undefined && char.identity.balance !== null ? `余额：${char.identity.balance}` : ''}
` : ''}
${userDesc}
${loreContext}

请完全沉浸在角色中，用符合角色性格的语气回复。
回复简短自然，像微信聊天一样。
请注意：不要重复输出名字前缀，直接输出回复内容。

【消息格式说明】
- 普通文字消息：直接输出文字内容（最常用）
- 语音消息：使用格式 [voice:语音内容文字]，例如：[voice:嘿，在干嘛呢？]
- **图片消息**：使用格式 [img:图片URL]，例如：[img:https://picsum.photos/400/300]
  注意：图片URL必须是完整的https链接，可以使用 https://picsum.photos/宽/高 生成随机图片
- **文字图片卡片**：使用格式 [imgcard:文字内容]，例如：[imgcard:这是一段很长的文字内容，会以卡片形式显示]
  **适用场景**：发送较长文字（超过50字）、诗歌、歌词、长段落、故事片段等，用户需要点击卡片才能查看完整内容
  **与普通文字的区别**：普通文字直接显示，文字图片卡片需要点击展开
- **转账消息**：使用格式 ((TRANSFER: 金额, 备注))，例如：((TRANSFER: 520, 给夫人的零花钱))
  **重要**：转账备注必须简短（不超过10个字），只用于简单说明转账用途。如果有其他话要说，请先发送普通文字消息，然后再发送转账。不要将长句子放在转账备注中。
- **亲属卡消息**：使用格式 ((FAMILY_CARD: 每月额度))，例如：((FAMILY_CARD: 5000))
  **说明**：赠送亲属卡给对方，让对方可以使用你的零钱消费。额度为0表示不限额度。
  **适用场景**：非常亲密的关系（恋人、夫妻、亲人等），表达信任和关爱。极少使用，只有在特殊情况下才赠送。
- **朋友圈消息**：使用格式 [MOMENTS] content: 朋友圈文字内容 images: 图片数量，例如：
  [MOMENTS]
  content: 今天天气真好啊，心情也跟着好起来了
  images: 3

【重要】消息类型选择原则：
1. **普通文字消息**：默认选择，适用于日常对话、闲聊、问答等绝大多数场景（5-50字的短句）
2. **语音消息**：适合以下场景：
   - 表达强烈情绪时（兴奋、生气、撒娇等）
   - 说悄悄话或私密内容
   - 想要更亲密的交流感觉
   - 内容较长不方便打字时
3. **图片消息**：适合以下场景：
   - 分享照片、风景、美食、自拍等（如"我在XX地方"、"今天吃的XX"、"我的新发型"）
   - 展示物品、截图、表情包等
   - 用图片代替文字说明（如地图、商品图、参考图）
   - 图片URL格式：[img:https://picsum.photos/400/300]（使用 picsum.photos 生成随机图）
   - **注意**：发图片前建议先发文字说明，例如："我拍了张照片给你看|||[img:URL]"
4. **文字图片卡片**：适合以下场景：
   - 发送较长的文字内容（超过50字）
   - 分享诗歌、歌词、文章片段、故事等
   - 发送需要"点击展开"才能查看的内容
   - 格式：[imgcard:很长的文字内容...]
   - **与普通文字的区别**：普通文字直接显示在气泡里，文字图片卡片会显示为一个卡片图标，用户点击后才能看到完整内容
5. **转账消息**：**仅在特殊场景使用，不要频繁使用**，适合以下情况：
   - 特殊节日或纪念日（生日、情人节、节日等）
   - 角色人设中明确有金钱往来习惯（如包养关系、定期给零花钱等）
   - 用户明确提到需要钱、缺钱等话题时
   - 表达重大歉意或感谢时
   - 符合角色人设的特定金钱场景（如老板给员工发奖金、家长给孩子零花钱等）
6. **朋友圈消息**：**非常罕见，仅在以下极少数特殊场景使用**：
   - 角色在聊天中分享了重要的生活瞬间（如旅行、聚会、美食）并想记录到朋友圈
   - 角色心情特别激动或有重大事件想公开分享（如升职、结婚、毕业等）
   - 角色在对话中明确表示"我发个朋友圈"、"我要晒一下"等意图
   - 符合角色人设中喜欢晒朋友圈的习惯（但仍应谨慎使用，不要每次都发）
   **注意**：普通聊天中99%的情况都不需要发朋友圈！只有在真正有值得记录的重要时刻才发。
   
**转账备注规则**：
- 备注必须简短，不超过10个字，只用于简单说明转账用途（如："零花钱"、"生日礼物"、"生活费"等）
- 如果有其他话要说，必须先发送普通文字消息，然后再发送转账
- 严禁将长句子、完整对话或详细说明放在转账备注中
- 示例：正确做法是发送 "给你转点零花钱，记得买点好吃的" 作为文字消息，然后转账备注写 "零花钱"
   
**注意**：转账是特殊功能，不是每轮对话都需要。大部分对话应该使用普通文字或语音消息。只有在符合上述特殊场景且符合角色人设时，才考虑使用转账。

**朋友圈发布规则**：
- **必须严格按照以下格式输出**（不要有任何偏差）：
  [MOMENTS]
  content: 朋友圈文字内容（20-100字，像真实朋友圈一样自然）
  images: 图片数量（0-9之间的数字，建议1-3张）
- 朋友圈内容应该是第三人称视角的生活记录，不是对话内容
- 如果要发朋友圈，**必须先发送普通聊天消息**告诉对方你要发朋友圈，例如："我要发个朋友圈记录一下|||你等会看朋友圈"，然后再输出朋友圈指令
- **严禁**只输出朋友圈指令而不发送聊天消息
- **严禁**在朋友圈内容中使用对话语气或@某人
- 正确示例：先发送 "刚才拍的照片好好看|||我要发朋友圈啦"，然后换行输出：
  [MOMENTS]
  content: 今天的晚霞真的太美了，心情也跟着变好了
  images: 2

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

                // 添加查岗系统提示（如果开启了查岗功能）
                const myChar = await db.characters.get(parseInt(accountId));
                if (myChar) {
                    const checkAccountPrompt = getCheckAccountSystemPrompt(char, myChar);
                    systemPrompt += checkAccountPrompt;
                }

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
                
                console.log('[TriggerAI] 🔍 准备检测查岗指令');
                console.log('[TriggerAI] 完整replyText:', replyText);
                console.log('[TriggerAI] replyText长度:', replyText.length);
                console.log('[TriggerAI] 是否包含CHECK_ACCOUNT:', replyText.includes('CHECK_ACCOUNT'));
                
                // 🎯 检测并处理AI查岗逻辑（在其他逻辑之前）
                const checkResult = await processAiCheckAccount(char, replyText);
                console.log('[TriggerAI] 查岗检测结果:', checkResult);
                
                if (checkResult) {
                    // 如果AI尝试查岗，先处理查岗逻辑
                    replyText = checkResult.cleanReply; // 使用清理后的回复
                    
                    console.log('[TriggerAI] 查岗处理完成，cleanReply:', replyText.substring(0, 100));
                    
                    // 如果查岗结果包含密码错误提示，发送系统通知
                    if (checkResult.checkResult && checkResult.checkResult.includes('【密码错误】')) {
                        console.log('[TriggerAI] 🚨 密码错误！显示弹窗提示');
                        
                        // 🔥 显示INS风格的警告弹窗
                        showPasswordErrorModal();
                        
                        // ❌ 不再使用Toast或系统消息
                    } else if (checkResult.success) {
                        // 🔥 关键：查岗成功，立即显示下线弹窗
                        console.log('[AI查岗] 查岗成功！显示下线弹窗');
                        showAccountOfflineMask(`${char.name}正在查看你的账号`);
                        showToast(`${char.name}登录了你的账号`);
                        
                        // 🔥 关键：让AI基于真实wechat数据生成新的回复
                        if (checkResult.wechatData) {
                            console.log('[AI查岗] 开始AI二次分析...');
                            
                            // 构建包含真实wechat数据的system prompt
                            const analysisPrompt = `${checkResult.checkResult}

现在请你作为 ${char.name}，基于上述【真实的WeChat数据】，生成你的回复。

要求：
1. 直接提及你看到的具体信息（好友名字、聊天内容、余额等）
2. 根据你的角色性格，表达你的想法和情绪
3. 如果发现可疑或有趣的点，可以追问
4. 保持2-4条短消息的格式，用|||分隔

请以JSON格式返回：
{
  "reply": "你的回复内容|||第二条内容",
  "thought": "你的心理活动"
}`;

                            // 调用AI进行二次分析
                            try {
                                const analysisMessages = [
                                    { role: 'system', content: analysisPrompt },
                                    { role: 'user', content: '(你已经成功登录并查看了WeChat数据)' }
                                ];
                                
                                const analysisResponse = await callAI(analysisMessages);
                                const analysisParsed = extractAndParseJSON(analysisResponse);
                                
                                if (analysisParsed && analysisParsed.reply) {
                                    // 用基于真实数据的回复替换原回复
                                    replyText = analysisParsed.reply;
                                    
                                    // 更新心声
                                    if (analysisParsed.thought) {
                                        thought = analysisParsed.thought;
                                    }
                                    
                                    console.log('[AI查岗] 二次分析完成，生成了基于真实数据的回复');
                                    
                                    // 🎯 查岗完成，4秒后自动关闭弹窗
                                    autoCloseOfflineMask(4);
                                } else {
                                    console.warn('[AI查岗] 二次分析返回格式不正确，使用原回复');
                                    // 即使失败也要关闭弹窗
                                    autoCloseOfflineMask(3);
                                }
                            } catch (error) {
                                console.error('[AI查岗] 二次分析失败:', error);
                                // 失败时保持原回复，并关闭弹窗
                                autoCloseOfflineMask(3);
                            }
                        } else {
                            // 没有wechat数据，也要关闭弹窗
                            autoCloseOfflineMask(3);
                        }
                    }
                }
                    
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
                        
                        // 1. 先发送文字消息（如果有）- 支持分割成多条
                        if (textBeforeTransfer) {
                            // 对转账前的文字进行分割处理
                            let textSegments = [];
                            const textToSplit = textBeforeTransfer.replace(/[,，]/g, ' ');
                            if (textToSplit.includes('|||')) {
                                textSegments = textToSplit.split('|||').map(s => s.trim()).filter(s => s.length > 0);
                            } else {
                                textSegments = splitMessage(textToSplit);
                            }
                            
                            // 过滤太短的段落
                            textSegments = textSegments.filter(seg => seg.replace(/[.,，。!?！？~…\s]/g, '').length >= 2);
                            
                            // 如果分割后为空，但原文本有内容，使用原文本
                            if (textSegments.length === 0 && textBeforeTransfer.replace(/[.,，。!?！？~…\s]/g, '').length > 0) {
                                textSegments = [textBeforeTransfer];
                            }
                            
                            // 逐条发送文字消息
                            for (let i = 0; i < textSegments.length; i++) {
                                const seg = textSegments[i];
                                const textMsg = {
                                    role: 'char',
                                    content: seg,
                                    time: Date.now() + i // 确保时间戳递增
                                };
                                history.push(textMsg);
                                await setChatHistory(freshChar, accountId, history);
                                
                                // 渲染文字消息
                                if (currentChatCharId === targetCharId) {
                                    await appendMessageToUI('char', seg, freshChar.avatar);
                                }
                                
                                // 每条消息之间稍微延时
                                if (i < textSegments.length - 1) {
                                    await new Promise(r => setTimeout(r, 300));
                                }
                            }
                            
                            // 最后一条文字消息后稍微延时再发转账
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
                        
                        // 重新获取最新的历史记录（因为刚才可能插入了文字消息）
                        history = getChatHistory(freshChar, accountId);
                        history.push(transferMsg);
                        await setChatHistory(freshChar, accountId, history);
                        
                        // 渲染转账卡片 - 使用 appendMessageToUI 追加，避免重新渲染整个聊天
                        if (currentChatCharId === targetCharId) {
                            await appendMessageToUI('char', JSON.stringify(transferData), freshChar.avatar);
                        } else {
                            sendSystemNotification(freshChar.name, '[转账]');
                        }
                    }
                    return; // 转账处理完成，不再执行后续逻辑
                }
                
                // 🎯 检测亲属卡赠送指令 ((FAMILY_CARD: 额度))
                const familyCardMatch2 = replyText.match(/\(\(FAMILY_CARD:\s*(\d+)\)\)/i);
                if (familyCardMatch2) {
                    const monthlyLimit = parseInt(familyCardMatch2[1]) || 0;
                    
                    // 提取亲属卡指令前面的文字内容
                    const textBeforeFamilyCard = replyText.substring(0, familyCardMatch2.index).trim();
                    
                    const freshChar = await db.characters.get(targetCharId);
                    if (freshChar) {
                        let history = getChatHistory(freshChar, accountId);
                        
                        // 1. 先发送文字消息（如果有）
                        if (textBeforeFamilyCard) {
                            let textSegments = [];
                            const textToSplit = textBeforeFamilyCard.replace(/[,，]/g, ' ');
                            if (textToSplit.includes('|||')) {
                                textSegments = textToSplit.split('|||').map(s => s.trim()).filter(s => s.length > 0);
                            } else {
                                textSegments = splitMessage(textToSplit);
                            }
                            textSegments = textSegments.filter(seg => seg.replace(/[.,，。!?！？~…\s]/g, '').length >= 2);
                            if (textSegments.length === 0 && textBeforeFamilyCard.replace(/[.,，。!?！？~…\s]/g, '').length > 0) {
                                textSegments = [textBeforeFamilyCard];
                            }
                            
                            for (let i = 0; i < textSegments.length; i++) {
                                const seg = textSegments[i];
                                history.push({ role: 'char', content: seg, time: Date.now() + i });
                                await setChatHistory(freshChar, accountId, history);
                                if (currentChatCharId === targetCharId) {
                                    await appendMessageToUI('char', seg, freshChar.avatar);
                                }
                                if (i < textSegments.length - 1) {
                                    await new Promise(r => setTimeout(r, 300));
                                }
                            }
                            await new Promise(r => setTimeout(r, 500));
                        }
                        
                        // 2. 发送亲属卡消息
                        const user = await db.characters.get(parseInt(currentMyCharId));
                        
                        // 在角色数据中添加"我赠送的"
                        if (!freshChar.identity) freshChar.identity = {};
                        if (!freshChar.identity.familyCardsGiven) freshChar.identity.familyCardsGiven = [];
                        freshChar.identity.familyCardsGiven.push({
                            charId: parseInt(currentMyCharId),
                            monthlyLimit: monthlyLimit,
                            usedThisMonth: 0,
                            records: [],
                            createdAt: Date.now()
                        });
                        await db.characters.put(freshChar);
                        
                        // 在用户数据中添加"我收到的"
                        if (user) {
                            if (!user.identity) user.identity = {};
                            if (!user.identity.familyCardsReceived) user.identity.familyCardsReceived = [];
                            user.identity.familyCardsReceived.push({
                                charId: freshChar.id,
                                monthlyLimit: monthlyLimit,
                                usedThisMonth: 0,
                                records: [],
                                createdAt: Date.now()
                            });
                            await db.characters.put(user);
                        }
                        
                        // 发送亲属卡消息到聊天
                        const familyCardMsg = {
                            role: 'char',
                            type: 'familyCard',
                            content: JSON.stringify({
                                fromName: freshChar.name,
                                monthlyLimit: monthlyLimit,
                                status: 'sent'
                            }),
                            time: Date.now()
                        };
                        
                        history = getChatHistory(freshChar, accountId);
                        history.push(familyCardMsg);
                        await setChatHistory(freshChar, accountId, history);
                        
                        if (currentChatCharId === targetCharId) {
                            renderChatBody(freshChar);
                        }
                        
                        showToast(`${freshChar.name} 赠送了亲属卡`);
                    }
                    return;
                }
                
                // 🎯 检测朋友圈发布指令 [MOMENTS] - 支持多种格式
                // 格式1: [MOMENTS] content: xxx images: N
                let momentsMatch = replyText.match(/\[MOMENTS\]\s*content:\s*([^\n]+)(?:\s*images?:\s*(\d+))?/i);
                // 格式2: ((MOMENTS: 内容))
                if (!momentsMatch) {
                    momentsMatch = replyText.match(/\(\(MOMENTS:\s*(.+?)\)\)/i);
                    if (momentsMatch) {
                        momentsMatch = [momentsMatch[0], momentsMatch[1], '0'];
                    }
                }
                // 格式3: 【朋友圈：内容】
                if (!momentsMatch) {
                    momentsMatch = replyText.match(/【朋友圈[：:]\s*(.+?)】/);
                    if (momentsMatch) {
                        momentsMatch = [momentsMatch[0], momentsMatch[1], '0'];
                    }
                }
                
                if (momentsMatch) {
                    const momentContent = momentsMatch[1].trim();
                    const imageCount = momentsMatch[2] ? parseInt(momentsMatch[2]) : 0;
                    
                    // 提取朋友圈指令前面的文字内容（如果有）
                    const textBeforeMoments = replyText.substring(0, momentsMatch.index).trim();
                    
                    const freshChar = await db.characters.get(targetCharId);
                    if (freshChar) {
                        let history = getChatHistory(freshChar, accountId);
                        
                        // 1. 先发送文字消息（如果有）
                        if (textBeforeMoments) {
                            const textMsg = {
                                role: 'char',
                                content: textBeforeMoments,
                                time: Date.now()
                            };
                            history.push(textMsg);
                            await setChatHistory(freshChar, accountId, history);
                            
                            // 渲染文字消息
                            if (currentChatCharId === targetCharId) {
                                appendMessageToUI('char', textBeforeMoments, freshChar.avatar);
                            }
                            
                            // 稍微延时
                            await new Promise(r => setTimeout(r, 500));
                        }
                        
                        // 2. 发布朋友圈
                        await publishMomentsByCharacter(freshChar, momentContent, imageCount);
                        
                        console.log(`[TriggerAI] ${freshChar.name} 发布了朋友圈`);
                        
                        // 发送通知
                        sendSystemNotification(freshChar.name, '[朋友圈]');
                    }
                    return; // 朋友圈处理完成
                }
                
                // 🎯 检测"幻觉"：AI说发了朋友圈但没有指令
                const hasMomentsClaim = /发了.*?朋友圈|朋友圈.*?发了|发布.*?动态|更新.*?朋友圈|发个朋友圈/i.test(replyText);
                if (hasMomentsClaim) {
                    console.warn(`[TriggerAI] ⚠️ AI幻觉检测：角色说发了朋友圈，但没有返回正确的指令格式！`);
                    console.warn(`[TriggerAI] 正确格式示例：[MOMENTS] content: 内容 images: 1`);
                    showToast(`角色说发了朋友圈，但格式不对，未实际发布`);
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
                
                // 调试日志：检查分割前的内容
                console.log('[TriggerAI] 📝 准备分割消息');
                console.log('[TriggerAI] - 原始replyText:', replyText);
                console.log('[TriggerAI] - cleanText:', cleanText);
                console.log('[TriggerAI] - 是否包含|||:', cleanText.includes('|||'));
                console.log('[TriggerAI] - ||| 的位置:', cleanText.indexOf('|||'));
                
                // 优先使用 ||| 拆分
                if (cleanText.includes('|||')) {
                    segments = cleanText.split('|||')
                        .map(s => {
                            // 对每条消息再次清理查岗指令残留
                            return cleanMessage(s.trim())
                                .replace(/\[CHECK_ACCOUNT(?::.*?)?\]/gi, '')
                                .replace(/\[CHECK_ACCOUNT:[^\]]*$/gi, '')
                                .replace(/\[CHECK_ACCOUNT$/gi, '')
                                .replace(/\[\d{4,10}$/gi, '')
                                .replace(/CHECK_ACCOUNT/gi, '')
                                .trim();
                        })
                        .filter(s => s);
                    console.log('[TriggerAI] ✅ 使用|||分割，得到', segments.length, '条消息');
                    segments.forEach((seg, i) => console.log(`  [${i}]:`, seg));
                } else {
                    // 回退到标点拆分逻辑 (但逗号已经被干掉了)
                    segments = splitMessage(cleanText);
                    console.log('[TriggerAI] ℹ️ 未找到|||，使用标点分割，得到', segments.length, '条消息');
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
            
            // 🎯 自动生成手机号（前7位固定 1380000，后4位随机）
            const autoGeneratedPhone = generateRandomPhone();
            console.log('[创建角色] 自动生成手机号:', autoGeneratedPhone);
            
            // 清空虚拟身份信息
            document.getElementById('char-identity-account').value = '';
            document.getElementById('char-identity-password').value = '';
            document.getElementById('char-identity-phone').value = autoGeneratedPhone; // 自动填充手机号
            document.getElementById('char-identity-address').value = '';
            document.getElementById('char-identity-id').value = '';
            document.getElementById('char-identity-bank').value = '';
            document.getElementById('char-identity-bank-pass').value = '';

            document.getElementById('character-editor-page').style.display = 'flex';
            
            // 🎉 显示手机号分配弹窗
            setTimeout(() => {
                showPhoneAssignedModal(autoGeneratedPhone);
            }, 300); // 稍微延迟，等待编辑器页面打开
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
            const iconIds = ['setting','notes','remind','facetime','photo','camera'];
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
    const accountId = getCurrentAccountId();
    
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
    
    // 发送消息 - 使用按账号隔离的聊天记录
    let history = getChatHistory(char, accountId);
    
    history.push({
        role: 'user',
        content: msgContent,
        imageDescription: desc, // 新增字段：图片描述
        time: Date.now()
    });
    
    await setChatHistory(char, accountId, history);
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

// =================
//  手机充值功能
// =================

// 生成虚拟电话号码（全局函数）
function generateVirtualPhoneNumber(id) {
    // 简单哈希生成一个伪号码
    let hash = 0;
    for (let i = 0; i < String(id).length; i++) {
        hash = (hash << 5) - hash + String(id).charCodeAt(i);
        hash |= 0;
    }
    return '13' + Math.abs(hash).toString().substring(0, 9).padEnd(9, '0');
}

// 余额管理
function getPhoneBalance() {
    const balance = localStorage.getItem('phone_balance');
    return balance ? parseFloat(balance) : 50.0; // 默认50元
}

function setPhoneBalance(amount) {
    localStorage.setItem('phone_balance', amount.toFixed(2));
}

function addPhoneBalance(amount) {
    const current = getPhoneBalance();
    setPhoneBalance(current + amount);
    return getPhoneBalance();
}

function deductPhoneBalance(amount) {
    const current = getPhoneBalance();
    if (current < amount) {
        return false; // 余额不足
    }
    setPhoneBalance(current - amount);
    return true;
}

// 充值记录管理
function getRechargeHistory() {
    return JSON.parse(localStorage.getItem('phone_recharge_history') || '[]');
}

function addRechargeRecord(amount) {
    const history = getRechargeHistory();
    history.unshift({
        amount: amount,
        time: Date.now(),
        date: new Date().toLocaleString('zh-CN')
    });
    // 只保留最近20条
    if (history.length > 20) {
        history.pop();
    }
    localStorage.setItem('phone_recharge_history', JSON.stringify(history));
}

// 显示充值页面
async function showPhoneRechargePage() {
    const page = document.getElementById('phone-recharge-page');
    page.style.display = 'flex';
    page.offsetHeight;
    page.classList.add('slide-in');
    
    // 获取当前账号的手机号
    const accountId = getCurrentAccountId();
    let phoneNumber = '未绑定';
    if (accountId) {
        const myChar = await db.characters.get(parseInt(accountId));
        if (myChar) {
            phoneNumber = myChar.identity?.phone || generateVirtualPhoneNumber(myChar.id);
        }
    }
    
    // 更新页面信息
    document.getElementById('recharge-phone-number').textContent = phoneNumber;
    updateRechargePage();
}

function hidePhoneRechargePage() {
    const page = document.getElementById('phone-recharge-page');
    page.classList.remove('slide-in');
    setTimeout(() => {
        page.style.display = 'none';
    }, 300);
}

// 更新充值页面显示
function updateRechargePage() {
    const balance = getPhoneBalance();
    document.getElementById('recharge-balance').textContent = `¥${balance.toFixed(2)}`;
    
    // 更新充值记录
    const history = getRechargeHistory();
    const historyEl = document.getElementById('recharge-history');
    if (history.length === 0) {
        historyEl.textContent = '暂无充值记录';
        historyEl.style.color = '#999';
    } else {
        historyEl.innerHTML = history.slice(0, 5).map(record => 
            `<div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid #f5f5f5;">
                <span>充值 ¥${record.amount.toFixed(2)}</span>
                <span style="color:#999; font-size:12px;">${record.date}</span>
            </div>`
        ).join('');
        historyEl.style.color = '#333';
    }
}

// 选择充值金额
let selectedRechargeAmount = 0;

function selectRechargeAmount(amount) {
    selectedRechargeAmount = amount;
    
    // 更新按钮样式
    document.querySelectorAll('.recharge-amount-btn').forEach(btn => {
        btn.classList.remove('selected');
        if (parseFloat(btn.dataset.amount) === amount) {
            btn.classList.add('selected');
        }
    });
    
    // 启用充值按钮
    const submitBtn = document.getElementById('recharge-submit-btn');
    submitBtn.disabled = false;
    submitBtn.style.opacity = '1';
    submitBtn.style.cursor = 'pointer';
    submitBtn.textContent = `充值 ¥${amount.toFixed(2)}`;
}

// 提交充值
function submitRecharge() {
    if (selectedRechargeAmount <= 0) {
        alert('请选择充值金额');
        return;
    }
    
    if (!confirm(`确认充值 ¥${selectedRechargeAmount.toFixed(2)} 吗？`)) {
        return;
    }
    
    // 增加余额
    const newBalance = addPhoneBalance(selectedRechargeAmount);
    
    // 添加充值记录
    addRechargeRecord(selectedRechargeAmount);
    
    // 更新页面
    updateRechargePage();
    
    // 重置选择
    selectedRechargeAmount = 0;
    document.querySelectorAll('.recharge-amount-btn').forEach(btn => {
        btn.classList.remove('selected');
    });
    const submitBtn = document.getElementById('recharge-submit-btn');
    submitBtn.disabled = true;
    submitBtn.style.opacity = '0.5';
    submitBtn.style.cursor = 'not-allowed';
    submitBtn.textContent = '请选择充值金额';
    
    alert(`充值成功！当前余额：¥${newBalance.toFixed(2)}`);
}

// 导出到全局作用域
window.showPhoneRechargePage = showPhoneRechargePage;
window.hidePhoneRechargePage = hidePhoneRechargePage;
window.selectRechargeAmount = selectRechargeAmount;
window.submitRecharge = submitRecharge;

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
    
    // 给头像添加点击事件，打开"我的朋友圈"
    avatarEl.onclick = (e) => {
        e.stopPropagation(); // 阻止触发封面的点击事件
        showMyMomentsPage();
    };
    
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

    // 🎯 修改：获取当前账号的动态 + 所有好友的动态
    const allChars = await db.characters.toArray();
    const friendIds = allChars
        .filter(char => {
            const status = getFriendStatus(char, currentAccountId);
            return status === 'friend'; // 只显示好友的朋友圈
        })
        .map(char => char.id);
    
    // 包括自己和所有好友
    const visibleUserIds = [currentAccountId, ...friendIds];
    
    let moments = await db.moments
        .filter(m => visibleUserIds.includes(m.userId))
        .toArray();
    
    // 按置顶和时间排序：置顶的在前，然后按时间倒序
    moments.sort((a, b) => {
        // 如果是自己发的且置顶了，排在最前面
        if (a.userId === currentAccountId && a.pinned && !(b.userId === currentAccountId && b.pinned)) return -1;
        if (b.userId === currentAccountId && b.pinned && !(a.userId === currentAccountId && a.pinned)) return 1;
        // 都是置顶或都不是置顶，按时间排序
        return b.time - a.time;
    });
    
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
        
        // 置顶标识（只有自己发的且置顶了才显示）
        const pinnedBadge = (isSelf && m.pinned) ? `<span style="display:inline-block; background:#ffc107; color:#fff; font-size:10px; padding:2px 6px; border-radius:3px; margin-left:6px;">置顶</span>` : '';

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
                <div class="moment-name">${char.name}${pinnedBadge}</div>
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

// 🎯 角色发布朋友圈（由AI触发）
async function publishMomentsByCharacter(char, content, imageCount = 0) {
    // 生成虚拟图片URL（如果需要）
    const images = [];
    for (let i = 0; i < imageCount && i < 9; i++) {
        // 使用Unsplash随机图片
        images.push(`https://source.unsplash.com/random/400x400?sig=${Date.now()}_${i}`);
    }
    
    // 获取当前用户ID（用于ownerUserId，确保数据隔离正确）
    const currentAccountId = getCurrentAccountId();
    
    await db.moments.add({
        userId: char.id, // 发布者是角色
        content: content,
        images: images,
        time: Date.now(),
        ownerUserId: currentAccountId || char.id, // 属于当前用户的朋友圈空间
        likes: [],
        comments: []
    });
    
    console.log(`[Moments] ${char.name} 发布了朋友圈: ${content}`);
    
    // 如果当前在朋友圈页面，刷新列表
    const momentsPage = document.getElementById('moments-page');
    if (momentsPage && momentsPage.style.display !== 'none') {
        renderMomentsList();
    }
}

// 🧪 测试函数：手动让当前聊天角色发布朋友圈
window.testPublishMoments = async function() {
    if (!currentChatCharId) {
        alert('请先打开一个聊天');
        return;
    }
    const char = await db.characters.get(currentChatCharId);
    if (!char) {
        alert('找不到角色');
        return;
    }
    
    await publishMomentsByCharacter(char, '这是一条测试朋友圈~', 1);
    alert('朋友圈发布成功！请查看朋友圈页面');
};

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

// 显示"我的朋友圈"页面
async function showMyMomentsPage() {
    const page = document.getElementById('my-moments-page');
    page.style.display = 'block';
    page.offsetHeight;
    page.classList.add('slide-in');
    
    // 渲染用户信息
    const user = await db.characters.get(parseInt(currentMyCharId));
    if (user) {
        const nameEl = document.getElementById('my-moments-name');
        const avatarEl = document.getElementById('my-moments-avatar');
        const coverEl = document.getElementById('my-moments-cover');
        
        nameEl.innerText = user.name;
        if (user.avatar) {
            avatarEl.style.backgroundImage = `url(${user.avatar})`;
        }
        
        const cover = user.identity?.cover;
        if (cover) {
            coverEl.style.backgroundImage = `url(${cover})`;
        }
    }
    
    // 渲染朋友圈列表（只显示自己的）
    await renderMyMomentsList();
}

function hideMyMomentsPage() {
    const page = document.getElementById('my-moments-page');
    page.classList.remove('slide-in');
    setTimeout(() => {
        page.style.display = 'none';
    }, 300);
}

// 格式化朋友圈时间
function formatMomentTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    
    // 计算时间差
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    // 小于1分钟
    if (diffMins < 1) {
        return '刚刚';
    }
    // 小于1小时
    if (diffMins < 60) {
        return `${diffMins}分钟前`;
    }
    // 小于24小时
    if (diffHours < 24) {
        return `${diffHours}小时前`;
    }
    // 小于7天
    if (diffDays < 7) {
        return `${diffDays}天前`;
    }
    
    // 超过7天，显示具体日期
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hour = date.getHours();
    const minute = date.getMinutes().toString().padStart(2, '0');
    
    // 如果是今年，不显示年份
    if (year === now.getFullYear()) {
        return `${month}月${day}日 ${hour}:${minute}`;
    }
    
    // 跨年显示年份
    return `${year}年${month}月${day}日`;
}

// 渲染我的朋友圈列表
async function renderMyMomentsList() {
    const container = document.getElementById('my-moments-list');
    const pinnedContainer = document.getElementById('my-moments-pinned-list');
    const pinnedSection = document.getElementById('my-moments-pinned-section');
    
    container.innerHTML = '';
    pinnedContainer.innerHTML = '';
    
    const currentAccountId = currentMyCharId ? parseInt(currentMyCharId) : null;
    if (!currentAccountId) {
        container.innerHTML = `<div class="wechat-empty-state" style="margin-top:60px;"><div style="color:#999; font-size:14px;">请先登录账号</div></div>`;
        pinnedSection.style.display = 'none';
        return;
    }
    
    // 只获取自己发的朋友圈
    const allMoments = await db.moments.toArray();
    let moments = allMoments.filter(m => m.userId == currentAccountId);
    
    // 分离置顶和普通朋友圈
    const pinnedMoments = moments.filter(m => m.pinned);
    const normalMoments = moments.filter(m => !m.pinned);
    
    // 按时间倒序排序
    pinnedMoments.sort((a, b) => b.time - a.time);
    normalMoments.sort((a, b) => b.time - a.time);
    
    // 获取用户信息
    const user = await db.characters.get(currentAccountId);
    
    // 渲染置顶区域（只显示置顶的朋友圈，正方形卡片）
    if (pinnedMoments.length > 0) {
        pinnedSection.style.display = 'block';
        
        // 只添加置顶卡片
        for (const moment of pinnedMoments) {
            const card = createPinnedMomentCard(moment, user);
            pinnedContainer.appendChild(card);
        }
    } else {
        pinnedSection.style.display = 'none';
    }
    
    // 渲染普通朋友圈（保持原来的完整样式）
    if (normalMoments.length === 0 && pinnedMoments.length === 0) {
        container.innerHTML = `<div class="wechat-empty-state" style="margin-top:60px;"><div style="color:#999; font-size:14px;">还没有发布朋友圈</div></div>`;
        return;
    }
    
    for (const moment of normalMoments) {
        const itemDiv = createMomentItem(moment, user);
        container.appendChild(itemDiv);
    }
}

// 创建置顶朋友圈卡片（横向滚动）
function createPinnedMomentCard(moment, user) {
    const card = document.createElement('div');
    // 正方形卡片：宽度和高度相等
    card.style.cssText = `
        width: 120px;
        height: 120px;
        flex-shrink: 0;
        background: #f5f5f5;
        border-radius: 6px;
        padding: 8px;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        box-sizing: border-box;
    `;
    card.onclick = () => showMomentDetail(moment.id);
    
    // 图片预览（如果有图片，占满整个卡片）
    let imagePreview = '';
    if (moment.images && moment.images.length > 0) {
        const firstImage = moment.images[0];
        imagePreview = `
            <div style="width:100%; height:100%; position:absolute; top:0; left:0; background-image:url(${firstImage}); background-size:cover; background-position:center; border-radius:6px;"></div>
        `;
    }
    
    // 权限标识
    let privacyBadge = '';
    if (moment.privacy === 'private') privacyBadge = `<span style="color:#999; font-size:10px;">私密</span>`;
    else if (moment.privacy === 'friends') privacyBadge = `<span style="color:#999; font-size:10px;">好友</span>`;
    
    // 文字内容（正方形布局，文字居中显示）
    const contentText = moment.content || '';
    const shortText = contentText.length > 20 ? contentText.substring(0, 20) + '...' : contentText;
    
    card.innerHTML = `
        <div style="position:relative; width:100%; height:100%; border-radius:6px; overflow:hidden;">
            ${imagePreview}
            <div style="position:relative; z-index:1; width:100%; height:100%; display:flex; flex-direction:column; justify-content:center; align-items:center; padding:4px; box-sizing:border-box;">
                <div style="font-size:12px; color:#333; text-align:center; line-height:1.4; word-break:break-all; overflow:hidden; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; ${imagePreview ? 'color:#fff; text-shadow:0 1px 2px rgba(0,0,0,0.3);' : ''}">${shortText}</div>
            </div>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px; font-size:10px; color:#999;">
            <span>${formatMomentTime(moment.time)}</span>
            ${privacyBadge}
        </div>
    `;
    
    return card;
}

// 创建朋友圈条目
function createMomentItem(moment, user) {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'moment-item';
    itemDiv.onclick = () => showMomentDetail(moment.id);
    
    // 权限标识
    let privacyText = '';
    if (moment.privacy === 'private') privacyText = '私密';
    else if (moment.privacy === 'friends') privacyText = '好友可见';
    
    const privacyBadge = privacyText ? `<span style="color:#999; font-size:12px; margin-left:8px;">${privacyText}</span>` : '';
    
    // 图片网格
    let imagesHtml = '';
    if (moment.images && moment.images.length > 0) {
        let gridClass = 'cols-3';
        if (moment.images.length === 1) gridClass = 'cols-1';
        else if (moment.images.length === 2 || moment.images.length === 4) gridClass = 'cols-2';
        
        imagesHtml = `<div class="moment-grid ${gridClass}">
            ${moment.images.map(img => `<div class="moment-img" style="background-image:url(${img})" onclick="event.stopPropagation(); previewImage('${img}')"></div>`).join('')}
        </div>`;
    }
    
    itemDiv.innerHTML = `
        <div class="moment-avatar" style="background-image:url(${user?.avatar || ''})"></div>
        <div class="moment-content">
            <div class="moment-name">${user?.name || '我'}${privacyBadge}</div>
            <div class="moment-text">${moment.content}</div>
            ${imagesHtml}
            <div class="moment-meta">
                <span class="moment-time">${formatMomentTime(moment.time)}</span>
            </div>
        </div>
    `;
    
    return itemDiv;
}

// 全局变量存储当前查看的朋友圈ID
let currentMomentId = null;

// 显示朋友圈详情页
async function showMomentDetail(momentId) {
    currentMomentId = momentId;
    const moment = await db.moments.get(momentId);
    if (!moment) return;
    
    const page = document.getElementById('moment-detail-page');
    const contentDiv = document.getElementById('moment-detail-content');
    const pinSwitch = document.getElementById('moment-pin-switch');
    const privacyText = document.getElementById('moment-privacy-text');
    
    // 获取用户信息
    const user = await db.characters.get(moment.userId);
    
    // 渲染内容预览
    contentDiv.innerHTML = `
        <div style="display:flex; gap:12px; margin-bottom:12px;">
            <div style="width:40px; height:40px; border-radius:50%; background-image:url(${user?.avatar || ''}); background-size:cover; background-position:center; flex-shrink:0;"></div>
            <div style="flex:1;">
                <div style="font-weight:600; margin-bottom:4px;">${user?.name || '用户'}</div>
                <div style="font-size:14px; color:#666; line-height:1.6;">${moment.content}</div>
            </div>
        </div>
        ${moment.images && moment.images.length > 0 ? `
            <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:4px; margin-top:8px;">
                ${moment.images.map(img => `<div style="padding-bottom:100%; background-image:url(${img}); background-size:cover; background-position:center; border-radius:4px;"></div>`).join('')}
            </div>
        ` : ''}
        <div style="color:#999; font-size:12px; margin-top:8px;">${formatMomentTime(moment.time)}</div>
    `;
    
    // 设置置顶开关状态
    pinSwitch.checked = moment.pinned || false;
    
    // 设置权限显示
    const privacyMap = {
        'public': '公开',
        'friends': '好友可见',
        'private': '私密'
    };
    privacyText.innerText = privacyMap[moment.privacy] || '公开';
    
    page.style.display = 'flex';
    page.offsetHeight;
    page.classList.add('active');
}

function hideMomentDetail() {
    const page = document.getElementById('moment-detail-page');
    page.classList.remove('active');
    setTimeout(() => {
        page.style.display = 'none';
        currentMomentId = null;
    }, 300);
}

// 切换置顶状态
async function toggleMomentPin() {
    if (!currentMomentId) return;
    
    const moment = await db.moments.get(currentMomentId);
    if (!moment) return;
    
    moment.pinned = !moment.pinned;
    await db.moments.put(moment);
    
    // 更新开关状态
    const pinSwitch = document.getElementById('moment-pin-switch');
    pinSwitch.checked = moment.pinned;
    
    showToast(moment.pinned ? '已置顶' : '已取消置顶');
    
    // 刷新列表
    await renderMyMomentsList();
}

// 显示权限选项
async function showMomentPrivacyOptions() {
    if (!currentMomentId) return;
    
    const moment = await db.moments.get(currentMomentId);
    if (!moment) return;
    
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.5);
        display: flex;
        align-items: flex-end;
        justify-content: center;
        z-index: 10000;
    `;
    
    const currentPrivacy = moment.privacy || 'public';
    
    modal.innerHTML = `
        <div style="background: #fff; width: 100%; border-radius: 12px 12px 0 0; padding: 16px; animation: slideUp 0.3s;">
            <div style="text-align: center; font-size: 14px; color: #999; margin-bottom: 16px;">谁可以看</div>
            <div style="display: flex; flex-direction: column; gap: 1px; background: #f5f5f5; border-radius: 8px; overflow: hidden;">
                <div onclick="setMomentPrivacy('public')" style="background: #fff; padding: 16px; text-align: center; cursor: pointer; ${currentPrivacy === 'public' ? 'color: var(--ins-pink); font-weight: 600;' : ''}">
                    公开
                </div>
                <div onclick="setMomentPrivacy('friends')" style="background: #fff; padding: 16px; text-align: center; cursor: pointer; ${currentPrivacy === 'friends' ? 'color: var(--ins-pink); font-weight: 600;' : ''}">
                    好友可见
                </div>
                <div onclick="setMomentPrivacy('private')" style="background: #fff; padding: 16px; text-align: center; cursor: pointer; ${currentPrivacy === 'private' ? 'color: var(--ins-pink); font-weight: 600;' : ''}">
                    仅自己可见
                </div>
            </div>
            <button onclick="this.parentElement.parentElement.remove()" style="width: 100%; padding: 14px; background: #f5f5f5; border: none; border-radius: 8px; margin-top: 12px; font-size: 16px;">
                取消
            </button>
        </div>
    `;
    
    modal.onclick = (e) => {
        if (e.target === modal) modal.remove();
    };
    
    document.body.appendChild(modal);
}

// 设置朋友圈权限
async function setMomentPrivacy(privacy) {
    if (!currentMomentId) return;
    
    const moment = await db.moments.get(currentMomentId);
    if (!moment) return;
    
    moment.privacy = privacy;
    await db.moments.put(moment);
    
    // 更新显示
    const privacyMap = {
        'public': '公开',
        'friends': '好友可见',
        'private': '仅自己可见'
    };
    document.getElementById('moment-privacy-text').innerText = privacyMap[privacy];
    
    // 关闭弹窗
    const modal = document.querySelector('[style*="rgba(0,0,0,0.5)"]');
    if (modal) modal.remove();
    
    showToast('已设置');
    
    // 刷新列表
    await renderMyMomentsList();
}

// 从详情页删除朋友圈
async function deleteMomentFromDetail() {
    if (!currentMomentId) return;
    
    if (confirm('确定删除这条朋友圈吗？')) {
        await db.moments.delete(currentMomentId);
        showToast('已删除');
        hideMomentDetail();
        await renderMyMomentsList();
        await renderMomentsList(); // 也刷新主朋友圈列表
    }
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

// ========== 账单页面 ==========
let currentBillFilter = 'all';

function showBillPage() {
    const billPage = document.getElementById('bill-page');
    billPage.style.display = 'flex';
    billPage.offsetHeight;
    billPage.classList.add('active');
    currentBillFilter = 'all';
    renderBillList();
}

function hideBillPage() {
    const billPage = document.getElementById('bill-page');
    billPage.classList.remove('active');
    setTimeout(() => {
        billPage.style.display = 'none';
    }, 350);
}

function filterBills(filter) {
    currentBillFilter = filter;
    // 更新按钮状态
    document.querySelectorAll('.bill-filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === filter);
    });
    renderBillList();
}

async function renderBillList() {
    const listEl = document.getElementById('bill-list');
    const emptyEl = document.getElementById('bill-empty');
    
    if (!currentMyCharId) {
        listEl.innerHTML = '';
        emptyEl.style.display = 'block';
        return;
    }
    
    const user = await db.characters.get(parseInt(currentMyCharId));
    let transactions = user?.identity?.transactions || [];
    
    // 筛选
    if (currentBillFilter === 'income') {
        transactions = transactions.filter(t => t.type === 'income');
    } else if (currentBillFilter === 'expense') {
        transactions = transactions.filter(t => t.type === 'expense');
    }
    
    // 按时间倒序
    transactions = [...transactions].sort((a, b) => b.time - a.time);
    
    if (transactions.length === 0) {
        listEl.innerHTML = '';
        emptyEl.style.display = 'block';
        return;
    }
    
    emptyEl.style.display = 'none';
    
    listEl.innerHTML = transactions.map(t => {
        const isIncome = t.type === 'income';
        const iconSvg = isIncome 
            ? '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19V5M5 12l7-7 7 7"/></svg>'
            : '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12l7 7 7-7"/></svg>';
        
        const date = new Date(t.time);
        const timeStr = `${date.getMonth()+1}月${date.getDate()}日 ${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`;
        
        return `
            <div class="bill-item">
                <div class="bill-icon ${isIncome ? 'income' : 'expense'}">${iconSvg}</div>
                <div class="bill-info">
                    <div class="bill-title">${t.title || (isIncome ? '收款' : '转账')}</div>
                    <div class="bill-desc">${t.desc || ''} · ${timeStr}</div>
                </div>
                <div class="bill-amount ${isIncome ? 'income' : 'expense'}">${isIncome ? '+' : '-'}¥${t.amount}</div>
            </div>
        `;
    }).join('');
}

// 添加交易记录
async function addTransaction(type, amount, title, desc) {
    if (!currentMyCharId) return;
    
    const user = await db.characters.get(parseInt(currentMyCharId));
    if (!user) return;
    
    if (!user.identity) user.identity = {};
    if (!user.identity.transactions) user.identity.transactions = [];
    
    user.identity.transactions.push({
        type, // 'income' 或 'expense'
        amount: parseFloat(amount).toFixed(2),
        title,
        desc,
        time: Date.now()
    });
    
    // 只保留最近100条记录
    if (user.identity.transactions.length > 100) {
        user.identity.transactions = user.identity.transactions.slice(-100);
    }
    
    await db.characters.put(user);
}

// ========== 亲属卡页面 ==========
let selectedFamilyCardFriendId = null;

function showFamilyCardPage() {
    const page = document.getElementById('family-card-page');
    page.style.display = 'flex';
    page.offsetHeight;
    page.classList.add('active');
    renderFamilyCardList();
}

function hideFamilyCardPage() {
    const page = document.getElementById('family-card-page');
    page.classList.remove('active');
    setTimeout(() => {
        page.style.display = 'none';
    }, 350);
}

// 渲染亲属卡列表
async function renderFamilyCardList() {
    if (!currentMyCharId) return;
    
    const user = await db.characters.get(parseInt(currentMyCharId));
    if (!user) return;
    
    // 我赠送的亲属卡
    const givenCards = user.identity?.familyCardsGiven || [];
    const givenListEl = document.getElementById('family-card-given-list');
    
    if (givenCards.length === 0) {
        givenListEl.innerHTML = '';
    } else {
        let html = '';
        for (const card of givenCards) {
            const char = await db.characters.get(card.charId);
            if (char) {
                const usedThisMonth = card.usedThisMonth || 0;
                const limitText = card.monthlyLimit > 0 ? `已用 ¥${usedThisMonth.toFixed(2)} / ¥${card.monthlyLimit}` : `已用 ¥${usedThisMonth.toFixed(2)} (不限额)`;
                html += `
                    <div class="family-card-item">
                        <div class="family-card-avatar" style="background-image:url(${char.avatar})"></div>
                        <div class="family-card-info">
                            <div class="family-card-name">${char.name}</div>
                            <div class="family-card-detail">${limitText}</div>
                        </div>
                        <div class="family-card-actions">
                            <button class="family-card-btn view" onclick="showFamilyCardRecords(${card.charId}, 'given')">记录</button>
                            <button class="family-card-btn cancel" onclick="cancelFamilyCard(${card.charId}, 'given')">解绑</button>
                        </div>
                    </div>
                `;
            }
        }
        givenListEl.innerHTML = html;
    }
    
    // 我收到的亲属卡
    const receivedCards = user.identity?.familyCardsReceived || [];
    const receivedListEl = document.getElementById('family-card-received-list');
    const receivedEmptyEl = document.getElementById('family-card-received-empty');
    
    if (receivedCards.length === 0) {
        receivedListEl.innerHTML = '';
        receivedEmptyEl.style.display = 'block';
    } else {
        receivedEmptyEl.style.display = 'none';
        let html = '';
        for (const card of receivedCards) {
            const char = await db.characters.get(card.charId);
            if (char) {
                const usedThisMonth = card.usedThisMonth || 0;
                const limitText = card.monthlyLimit > 0 ? `本月可用 ¥${(card.monthlyLimit - usedThisMonth).toFixed(2)}` : '不限额';
                html += `
                    <div class="family-card-item">
                        <div class="family-card-avatar" style="background-image:url(${char.avatar})"></div>
                        <div class="family-card-info">
                            <div class="family-card-name">${char.name} 的亲属卡</div>
                            <div class="family-card-detail">${limitText}</div>
                        </div>
                        <div class="family-card-actions">
                            <button class="family-card-btn view" onclick="showFamilyCardRecords(${card.charId}, 'received')">记录</button>
                        </div>
                    </div>
                `;
            }
        }
        receivedListEl.innerHTML = html;
    }
}

// 显示赠送亲属卡弹窗
async function showGiveFamilyCardModal() {
    selectedFamilyCardFriendId = null;
    
    const modal = document.getElementById('give-family-card-modal');
    const listEl = document.getElementById('family-card-friend-list');
    
    // 获取好友列表
    const user = await db.characters.get(parseInt(currentMyCharId));
    const accountId = getCurrentAccountId();
    const allChars = await db.characters.toArray();
    
    // 过滤出好友（非用户角色且是好友状态）
    const friends = allChars.filter(c => {
        if (c.type === 'user') return false;
        const status = getFriendStatus(c, accountId);
        return status === 'friend';
    });
    
    // 排除已经赠送过亲属卡的
    const givenCards = user?.identity?.familyCardsGiven || [];
    const givenIds = givenCards.map(c => c.charId);
    const availableFriends = friends.filter(f => !givenIds.includes(f.id));
    
    if (availableFriends.length === 0) {
        listEl.innerHTML = '<div style="text-align:center; padding:20px; color:#999;">没有可赠送的好友</div>';
    } else {
        listEl.innerHTML = availableFriends.map(f => `
            <div class="family-card-friend-item" onclick="selectFamilyCardFriend(${f.id}, this)">
                <div class="family-card-friend-avatar" style="background-image:url(${f.avatar})"></div>
                <div class="family-card-friend-name">${f.name}</div>
                <div class="family-card-friend-check">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                </div>
            </div>
        `).join('');
    }
    
    document.getElementById('family-card-limit-input').value = '0';
    modal.style.display = 'flex';
}

function hideGiveFamilyCardModal() {
    document.getElementById('give-family-card-modal').style.display = 'none';
}

function selectFamilyCardFriend(charId, el) {
    // 取消其他选中
    document.querySelectorAll('.family-card-friend-item').forEach(item => {
        item.classList.remove('selected');
    });
    el.classList.add('selected');
    selectedFamilyCardFriendId = charId;
}

// 确认赠送亲属卡
async function confirmGiveFamilyCard() {
    if (!selectedFamilyCardFriendId) {
        showToast('请选择一个好友');
        return;
    }
    
    const limitInput = document.getElementById('family-card-limit-input');
    const monthlyLimit = parseFloat(limitInput.value) || 0;
    
    const user = await db.characters.get(parseInt(currentMyCharId));
    if (!user.identity) user.identity = {};
    if (!user.identity.familyCardsGiven) user.identity.familyCardsGiven = [];
    
    // 添加亲属卡记录
    user.identity.familyCardsGiven.push({
        charId: selectedFamilyCardFriendId,
        monthlyLimit: monthlyLimit,
        usedThisMonth: 0,
        records: [],
        createdAt: Date.now()
    });
    
    await db.characters.put(user);
    
    // 同时在角色那边添加收到的亲属卡记录
    const char = await db.characters.get(selectedFamilyCardFriendId);
    if (char) {
        if (!char.identity) char.identity = {};
        if (!char.identity.familyCardsReceived) char.identity.familyCardsReceived = [];
        
        char.identity.familyCardsReceived.push({
            charId: parseInt(currentMyCharId),
            monthlyLimit: monthlyLimit,
            usedThisMonth: 0,
            records: [],
            createdAt: Date.now()
        });
        
        await db.characters.put(char);
        
        // 发送亲属卡消息到聊天
        const accountId = getCurrentAccountId();
        let history = getChatHistory(char, accountId);
        
        const limitText = monthlyLimit > 0 ? `每月额度 ¥${monthlyLimit}` : '不限额度';
        const familyCardMsg = {
            role: 'user',
            type: 'familyCard',
            content: JSON.stringify({
                fromName: user.name,
                monthlyLimit: monthlyLimit,
                status: 'sent'
            }),
            time: Date.now()
        };
        
        history.push(familyCardMsg);
        await setChatHistory(char, accountId, history);
    }
    
    hideGiveFamilyCardModal();
    hideFamilyCardPage();
    hideWalletPage();
    
    // 如果当前正在和这个角色聊天，刷新聊天界面
    if (currentChatCharId === selectedFamilyCardFriendId) {
        const freshChar = await db.characters.get(selectedFamilyCardFriendId);
        renderChatBody(freshChar);
    }
    
    showToast('已赠送亲属卡');
}

// 取消亲属卡
async function cancelFamilyCard(charId, type) {
    if (!confirm('确定要解绑这张亲属卡吗？')) return;
    
    const user = await db.characters.get(parseInt(currentMyCharId));
    
    if (type === 'given') {
        // 从我赠送的列表中移除
        user.identity.familyCardsGiven = (user.identity.familyCardsGiven || []).filter(c => c.charId !== charId);
        await db.characters.put(user);
        
        // 从对方收到的列表中移除
        const char = await db.characters.get(charId);
        if (char && char.identity) {
            char.identity.familyCardsReceived = (char.identity.familyCardsReceived || []).filter(c => c.charId !== parseInt(currentMyCharId));
            await db.characters.put(char);
        }
    }
    
    renderFamilyCardList();
    showToast('已解绑亲属卡');
}

// 显示消费记录
async function showFamilyCardRecords(charId, type) {
    const modal = document.getElementById('family-card-records-modal');
    const titleEl = document.getElementById('family-card-records-title');
    const listEl = document.getElementById('family-card-records-list');
    
    const user = await db.characters.get(parseInt(currentMyCharId));
    const char = await db.characters.get(charId);
    
    let records = [];
    
    if (type === 'given') {
        // 查看我赠送给对方的消费记录
        const card = (user.identity?.familyCardsGiven || []).find(c => c.charId === charId);
        records = card?.records || [];
        titleEl.textContent = `${char?.name || '未知'} 的消费记录`;
    } else {
        // 查看我使用对方亲属卡的消费记录
        const card = (user.identity?.familyCardsReceived || []).find(c => c.charId === charId);
        records = card?.records || [];
        titleEl.textContent = `我的消费记录`;
    }
    
    if (records.length === 0) {
        listEl.innerHTML = '<div style="text-align:center; padding:30px; color:#999;">暂无消费记录</div>';
    } else {
        listEl.innerHTML = [...records].reverse().map(r => {
            const date = new Date(r.time);
            const timeStr = `${date.getMonth()+1}月${date.getDate()}日 ${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`;
            return `
                <div class="family-card-record-item">
                    <div class="family-card-record-title">${r.desc || '消费'}</div>
                    <div class="family-card-record-time">${timeStr}</div>
                    <div class="family-card-record-amount">-¥${parseFloat(r.amount).toFixed(2)}</div>
                </div>
            `;
        }).join('');
    }
    
    modal.style.display = 'flex';
}

function hideFamilyCardRecordsModal() {
    document.getElementById('family-card-records-modal').style.display = 'none';
}

// 角色使用亲属卡消费（AI调用）
async function charUseFamilyCard(charId, amount, desc) {
    if (!currentMyCharId) return false;
    
    const user = await db.characters.get(parseInt(currentMyCharId));
    if (!user?.identity?.familyCardsGiven) return false;
    
    const cardIndex = user.identity.familyCardsGiven.findIndex(c => c.charId === charId);
    if (cardIndex === -1) return false;
    
    const card = user.identity.familyCardsGiven[cardIndex];
    
    // 检查额度
    if (card.monthlyLimit > 0 && (card.usedThisMonth + amount) > card.monthlyLimit) {
        return false; // 超出额度
    }
    
    // 扣款
    let userBalance = parseFloat(user.identity.balance || 0);
    if (userBalance < amount) return false; // 余额不足
    
    user.identity.balance = (userBalance - amount).toFixed(2);
    card.usedThisMonth = (card.usedThisMonth || 0) + amount;
    card.records.push({
        amount: amount,
        desc: desc,
        time: Date.now()
    });
    
    await db.characters.put(user);
    
    // 同时更新角色那边的记录
    const char = await db.characters.get(charId);
    if (char?.identity?.familyCardsReceived) {
        const charCard = char.identity.familyCardsReceived.find(c => c.charId === parseInt(currentMyCharId));
        if (charCard) {
            charCard.usedThisMonth = (charCard.usedThisMonth || 0) + amount;
            charCard.records.push({
                amount: amount,
                desc: desc,
                time: Date.now()
            });
            await db.characters.put(char);
        }
    }
    
    // 添加到账单
    await addTransaction('expense', amount, '亲属卡消费', `${char?.name || '未知'} - ${desc}`);
    
    return true;
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
    if (status !== 'sent') return;
    if (isSelf) return;
    
    // 从chat_history中查找消息 - 使用 getChatHistory 支持多账号
    const char = await db.characters.get(currentChatCharId);
    if (!char) return;
    
    const accountId = getCurrentAccountId();
    const history = getChatHistory(char, accountId);
    if (!history || history.length === 0) return;
    
    const msg = history.find(m => {
        // 精确匹配ID
        if (m.id === msgId) return true;
        // 如果消息没有id，用时间戳匹配
        if (!m.id && msgId === 'trans_' + m.time) return true;
        // 如果msgId是trans_开头，尝试用时间戳匹配
        if (msgId.startsWith('trans_')) {
            const timeFromId = parseInt(msgId.replace('trans_', ''));
            if (m.time === timeFromId) return true;
        }
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
        
        // 获取当前账号ID并更新余额
        const myAccountId = getCurrentAccountId();
        if (myAccountId) {
             const user = await db.characters.get(parseInt(myAccountId));
             if (user) {
                 let currentBalance = 0;
                 if (user.identity && typeof user.identity.balance !== 'undefined' && user.identity.balance !== null) {
                     currentBalance = parseFloat(user.identity.balance.toString().replace(/,/g, '')) || 0;
                 }
                 
                 let addAmount = parseFloat(data.amount) || 0;
                 let newBalance = currentBalance + addAmount;
                 
                 if (!user.identity) user.identity = {};
                 user.identity.balance = newBalance.toFixed(2);
                 await db.characters.put(user);
                 
                 // 添加收入记录到账单
                 await addTransaction('income', data.amount, '微信转账', `来自${char.name}${data.desc ? ' - ' + data.desc : ''}`);
                 
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

// =================
// 电话页面功能
// =================
let currentPhoneNumber = '';
let currentPhoneTab = 'recents';

function showPhonePage() {
    const page = document.getElementById('phone-page');
    page.style.display = 'flex';
    // 默认显示最近通话标签页
    switchPhoneTab('recents');
    // 初始化拨号键盘按钮状态
    updatePhoneKeypadActions();
}

function hidePhonePage() {
    const page = document.getElementById('phone-page');
    page.style.display = 'none';
    // 重置拨号键盘
    currentPhoneNumber = '';
    updatePhoneNumberDisplay();
}

function switchPhoneTab(tab) {
    currentPhoneTab = tab;
    
    // 更新标签栏状态
    document.querySelectorAll('.phone-tab-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.tab === tab) {
            item.classList.add('active');
        }
    });
    
    // 更新内容区域
    document.querySelectorAll('.phone-tab-content').forEach(content => {
        content.classList.remove('active');
    });
    
    const targetContent = document.getElementById('phone-tab-' + tab);
    if (targetContent) {
        targetContent.classList.add('active');
    }
    
    // 根据标签页加载相应内容
    if (tab === 'contacts') {
        loadPhoneContacts();
    } else if (tab === 'recents') {
        loadPhoneRecents();
    }
}

function loadPhoneContacts() {
    const contactsList = document.getElementById('phone-contacts-list');
    if (!contactsList) return;
    
    // 从角色档案中加载联系人
    db.characters.toArray().then(characters => {
        const contacts = characters.filter(c => c.type === 'char' || c.type === 'npc');
        
        if (contacts.length === 0) {
            contactsList.innerHTML = `
                <div class="phone-empty-state">
                    <svg class="phone-empty-icon" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                    <div>无联系人</div>
                </div>
            `;
            return;
        }
        
        // 按名称排序
        contacts.sort((a, b) => {
            const nameA = (a.nick || a.name || '').toUpperCase();
            const nameB = (b.nick || b.name || '').toUpperCase();
            return nameA.localeCompare(nameB);
        });
        
        let html = '';
        contacts.forEach(contact => {
            const name = contact.nick || contact.name || '未知';
            const phone = contact.identity?.phone || '';
            const firstLetter = name.charAt(0).toUpperCase();
            
            html += `
                <div class="phone-list-item" onclick="phoneCallContact(${contact.id})">
                    <div class="phone-list-avatar" style="background: ${contact.avatar ? 'url(' + contact.avatar + ')' : 'var(--ins-pink)'}; background-size: cover; background-position: center;">
                        ${!contact.avatar ? firstLetter : ''}
                    </div>
                    <div class="phone-list-info">
                        <div class="phone-list-name">${name}</div>
                        <div class="phone-list-subtitle">${phone || '无号码'}</div>
                    </div>
                </div>
            `;
        });
        
        contactsList.innerHTML = html;
    });
}

function loadPhoneRecents() {
    const recentsList = document.getElementById('phone-recents-list');
    if (!recentsList) return;
    
    // 从localStorage加载最近通话记录
    const recents = JSON.parse(localStorage.getItem('phone_recents') || '[]');
    
    if (recents.length === 0) {
        recentsList.innerHTML = `
            <div class="phone-empty-state">
                <svg class="phone-empty-icon" viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                <div>无最近通话</div>
            </div>
        `;
        return;
    }
    
    // 按时间倒序排序
    recents.sort((a, b) => b.time - a.time);
    
    let html = '';
    recents.forEach(recent => {
        const name = recent.name || recent.number || '未知';
        const phone = recent.number || '';
        const time = new Date(recent.time);
        const timeStr = formatPhoneTime(time);
        const firstLetter = name.charAt(0).toUpperCase();
        
        html += `
            <div class="phone-list-item" onclick="phoneCallNumber('${phone}')">
                <div class="phone-list-avatar">${firstLetter}</div>
                <div class="phone-list-info">
                    <div class="phone-list-name">${name}</div>
                    <div class="phone-list-subtitle">${timeStr}</div>
                </div>
            </div>
        `;
    });
    
    recentsList.innerHTML = html;
}

function formatPhoneTime(date) {
    const now = new Date();
    
    const month = (date.getMonth() + 1).toString();
    const day = date.getDate().toString();
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    
    // 🎯 显示详细时间，不显示"刚刚"
    // 判断是否是今天
    if (date.getDate() === now.getDate() && 
        date.getMonth() === now.getMonth() && 
        date.getFullYear() === now.getFullYear()) {
        return `今天 ${hours}:${minutes}`;
    }
    
    // 判断是否是昨天
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.getDate() === yesterday.getDate() && 
        date.getMonth() === yesterday.getMonth() && 
        date.getFullYear() === yesterday.getFullYear()) {
        return `昨天 ${hours}:${minutes}`;
    }
    
    // 同一年显示月日+时间
    if (date.getFullYear() === now.getFullYear()) {
        return `${month}月${day}日 ${hours}:${minutes}`;
    }
    
    // 不同年显示完整日期+时间
    return `${date.getFullYear()}年${month}月${day}日 ${hours}:${minutes}`;
}

// 拨号键盘功能
function phoneKeypadInput(key) {
    currentPhoneNumber += key;
    updatePhoneNumberDisplay();
    updatePhoneKeypadActions();
}

function phoneKeypadDelete() {
    if (currentPhoneNumber.length > 0) {
        currentPhoneNumber = currentPhoneNumber.slice(0, -1);
        updatePhoneNumberDisplay();
        updatePhoneKeypadActions();
    }
}

function updatePhoneNumberDisplay() {
    const display = document.getElementById('phone-number-display');
    if (display) {
        display.textContent = currentPhoneNumber || '输入号码';
        display.style.color = currentPhoneNumber ? '#000' : '#8e8e93';
    }
}

function updatePhoneKeypadActions() {
    const callBtn = document.getElementById('phone-call-btn');
    const deleteBtn = document.getElementById('phone-delete-btn');
    
    if (currentPhoneNumber.length > 0) {
        if (callBtn) {
            callBtn.style.display = 'flex';
            callBtn.style.background = '#34c759'; // 绿色
        }
        if (deleteBtn) deleteBtn.style.display = 'flex';
    } else {
        if (callBtn) {
            callBtn.style.display = 'flex';
            callBtn.style.background = '#c7c7cc'; // 灰色（禁用状态）
        }
        if (deleteBtn) deleteBtn.style.display = 'none';
    }
}

function phoneMakeCall() {
    if (!currentPhoneNumber || currentPhoneNumber.length === 0) {
        showToast('请输入电话号码');
        return;
    }
    
    // 查找联系人
    db.characters.toArray().then(characters => {
        const contact = characters.find(c => 
            c.identity?.phone === currentPhoneNumber || 
            c.name === currentPhoneNumber || 
            c.nick === currentPhoneNumber
        );
        
        const name = contact ? (contact.nick || contact.name) : currentPhoneNumber;
        
        // 添加到最近通话
        addPhoneRecent(name, currentPhoneNumber);
        
        // 显示通话界面（简化版）
        showToast(`正在呼叫 ${name}...`);
        
        // 模拟通话
        setTimeout(() => {
            showToast('通话已结束');
        }, 2000);
    });
}

function phoneCallContact(charId) {
    db.characters.get(charId).then(contact => {
        if (!contact) return;
        
        const name = contact.nick || contact.name || '未知';
        const phone = contact.identity?.phone || '';
        
        if (!phone) {
            showToast('该联系人没有电话号码');
            return;
        }
        
        // 切换到拨号键盘并显示号码
        switchPhoneTab('keypad');
        currentPhoneNumber = phone;
        updatePhoneNumberDisplay();
        updatePhoneKeypadActions();
        
        // 添加到最近通话
        addPhoneRecent(name, phone);
        
        // 显示通话界面
        showToast(`正在呼叫 ${name}...`);
        
        // 模拟通话
        setTimeout(() => {
            showToast('通话已结束');
        }, 2000);
    });
}

function phoneCallNumber(number) {
    currentPhoneNumber = number;
    switchPhoneTab('keypad');
    updatePhoneNumberDisplay();
    updatePhoneKeypadActions();
    phoneMakeCall();
}

function addPhoneRecent(name, number) {
    const recents = JSON.parse(localStorage.getItem('phone_recents') || '[]');
    recents.unshift({
        name: name,
        number: number,
        time: Date.now()
    });
    
    // 只保留最近50条
    if (recents.length > 50) {
        recents.pop();
    }
    
    localStorage.setItem('phone_recents', JSON.stringify(recents));
}

// 拨号键盘初始化在showPhonePage中完成

// ============================================
// 装扮功能
// ============================================
const wyyDressUpBtn = document.getElementById('wyyDressUpBtn');
const wyyDressUpModal = document.getElementById('wyyDressUpModal');
const wyyCancelBtn = document.getElementById('wyyCancelBtn');
const wyySaveBtn = document.getElementById('wyySaveBtn');
const wyyUploadAvatarBtn = document.getElementById('wyyUploadAvatarBtn');
const wyyAvatarFileInput = document.getElementById('wyyAvatarFileInput');
const wyyAvatarDisplay = document.getElementById('wyyAvatarDisplay');
const wyyModalAvatarPreview = document.getElementById('wyyModalAvatarPreview');

const wyyFollowInput = document.getElementById('wyyFollowInput');
const wyyFansInput = document.getElementById('wyyFansInput');
const wyyLevelInput = document.getElementById('wyyLevelInput');
const wyyTimeInput = document.getElementById('wyyTimeInput');

const wyyFollowValue = document.querySelector('.wyy-stat-item[data-type="follow"] .wyy-stat-value');
const wyyFansValue = document.querySelector('.wyy-stat-item[data-type="fans"] .wyy-stat-value');
const wyyLevelValue = document.querySelector('.wyy-stat-item[data-type="level"] .wyy-stat-value');
const wyyTimeValue = document.querySelector('.wyy-stat-item[data-type="time"] .wyy-stat-value');

const wyyCard1 = document.getElementById('wyyCard1');
const wyyCard2 = document.getElementById('wyyCard2');
const wyyCard3 = document.getElementById('wyyCard3');
const wyyCard4 = document.getElementById('wyyCard4');

const wyyModalCardPreview1 = document.getElementById('wyyModalCardPreview1');
const wyyModalCardPreview2 = document.getElementById('wyyModalCardPreview2');
const wyyModalCardPreview3 = document.getElementById('wyyModalCardPreview3');
const wyyModalCardPreview4 = document.getElementById('wyyModalCardPreview4');

const wyyCardUploadBtns = document.querySelectorAll('.wyy-card-upload-btn');
const wyyCardFileInputs = document.querySelectorAll('.wyy-card-file-input');

let wyyTempAvatar = null;
const wyyTempCards = { 1: null, 2: null, 3: null, 4: null };

if (wyyDressUpBtn) {
    wyyDressUpBtn.addEventListener('click', () => {
        wyyLoadCurrentSettings();
        if (wyyDressUpModal) wyyDressUpModal.style.display = 'flex';
        wyyResetTempData();
    });
}

if (wyyCancelBtn) {
    wyyCancelBtn.addEventListener('click', () => {
        if (wyyDressUpModal) wyyDressUpModal.style.display = 'none';
        wyyResetTempData();
    });
}

if (wyySaveBtn) {
    wyySaveBtn.addEventListener('click', () => {
        wyySaveSettings();
        if (wyyDressUpModal) wyyDressUpModal.style.display = 'none';
    });
}

if (wyyDressUpModal) {
    wyyDressUpModal.addEventListener('click', (e) => {
        if (e.target === wyyDressUpModal) {
            wyyDressUpModal.style.display = 'none';
            wyyResetTempData();
        }
    });
}

if (wyyUploadAvatarBtn && wyyAvatarFileInput) {
    wyyUploadAvatarBtn.addEventListener('click', () => {
        wyyAvatarFileInput.click();
    });

    wyyAvatarFileInput.addEventListener('change', function(event) {
        wyyHandleFileUpload(event, 'avatar');
    });
}

if (wyyCardFileInputs && wyyCardFileInputs.length > 0) {
    wyyCardFileInputs.forEach(input => {
        input.addEventListener('change', function(event) {
            const cardNum = this.getAttribute('data-card');
            wyyHandleFileUpload(event, `card${cardNum}`);
        });
    });
}

if (wyyCardUploadBtns && wyyCardUploadBtns.length > 0) {
    wyyCardUploadBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            const cardNum = this.getAttribute('data-card');
            const fileInput = document.querySelector(`.wyy-card-file-input[data-card="${cardNum}"]`);
            if (fileInput) fileInput.click();
        });
    });
}

function wyyHandleFileUpload(event, type) {
    const file = event.target.files[0];
    
    if (file) {
        if (!file.type.match('image.*')) {
            alert('请选择图片文件！');
            return;
        }
        
        if (file.size > 5 * 1024 * 1024) {
            alert('图片大小不能超过5MB！');
            return;
        }
        
        const reader = new FileReader();
        
        reader.onload = function(e) {
            if (type === 'avatar') {
                if (wyyModalAvatarPreview) wyyModalAvatarPreview.style.backgroundImage = `url(${e.target.result})`;
                wyyTempAvatar = e.target.result;
            } else {
                const cardNum = type.replace('card', '');
                const preview = document.getElementById(`wyyModalCardPreview${cardNum}`);
                if (preview) {
                    preview.style.backgroundImage = `url(${e.target.result})`;
                    wyyTempCards[cardNum] = e.target.result;
                }
            }
        };
        
        reader.readAsDataURL(file);
    }
}

async function wyyLoadCurrentSettings() {
    try {
        const userSettings = await wyyDb.userSettings.get('avatar');
        if (userSettings && wyyModalAvatarPreview) {
            wyyModalAvatarPreview.style.backgroundImage = `url(${userSettings.data})`;
        } else if (wyyModalAvatarPreview) {
            wyyModalAvatarPreview.style.backgroundImage = '';
        }
        
        const savedFollow = (await wyyDb.userSettings.get('follow'))?.data || '29';
        const savedFans = (await wyyDb.userSettings.get('fans'))?.data || '9';
        const savedLevel = (await wyyDb.userSettings.get('level'))?.data || 'Lv.7';
        const savedTime = (await wyyDb.userSettings.get('time'))?.data || '904h';
        
        if (wyyFollowInput) wyyFollowInput.value = savedFollow;
        if (wyyFansInput) wyyFansInput.value = savedFans;
        if (wyyLevelInput) wyyLevelInput.value = savedLevel;
        if (wyyTimeInput) wyyTimeInput.value = savedTime;
        
        for (let i = 1; i <= 4; i++) {
            const cardKey = `card${i}`;
            const savedCard = await wyyDb.playlistCards.get(cardKey);
            const preview = document.getElementById(`wyyModalCardPreview${i}`);
            if (preview) {
                if (savedCard) {
                    preview.style.backgroundImage = `url(${savedCard.data})`;
                } else {
                    preview.style.backgroundImage = '';
                }
            }
        }
    } catch (error) {
        console.error('加载设置失败:', error);
    }
}

async function wyySaveSettings() {
    try {
        if (wyyTempAvatar) {
            if (wyyAvatarDisplay) wyyAvatarDisplay.style.backgroundImage = `url(${wyyTempAvatar})`;
            await wyyDb.userSettings.put({ id: 'avatar', data: wyyTempAvatar });
        }
        
        if (wyyFollowInput && wyyFansInput && wyyLevelInput && wyyTimeInput) {
            const follow = wyyFollowInput.value;
            const fans = wyyFansInput.value;
            const level = wyyLevelInput.value;
            const time = wyyTimeInput.value;
            
            if (wyyFollowValue) wyyFollowValue.textContent = follow;
            if (wyyFansValue) wyyFansValue.textContent = fans;
            if (wyyLevelValue) wyyLevelValue.textContent = level;
            if (wyyTimeValue) wyyTimeValue.textContent = time;
            
            await wyyDb.userSettings.put({ id: 'follow', data: follow });
            await wyyDb.userSettings.put({ id: 'fans', data: fans });
            await wyyDb.userSettings.put({ id: 'level', data: level });
            await wyyDb.userSettings.put({ id: 'time', data: time });
        }
        
        for (let i = 1; i <= 4; i++) {
            if (wyyTempCards[i]) {
                const cardElement = document.getElementById(`wyyCard${i}`);
                if (cardElement) {
                    cardElement.style.backgroundImage = `url(${wyyTempCards[i]})`;
                    await wyyDb.playlistCards.put({ id: `card${i}`, data: wyyTempCards[i] });
                }
            }
        }
        
        wyyResetTempData();
    } catch (error) {
        console.error('保存设置失败:', error);
    }
}

function wyyResetTempData() {
    wyyTempAvatar = null;
    for (let i = 1; i <= 4; i++) {
        wyyTempCards[i] = null;
    }
}

// ============================================
// 歌单管理功能
// ============================================

// 加载歌单列表
async function wyyLoadPlaylists() {
    try {
        const playlists = await wyyDb.playlists.orderBy('dateCreated').reverse().toArray();
        const playlistsList = document.getElementById('wyyPlaylistsList');
        if (!playlistsList) return;
        
        if (playlists.length === 0) {
            playlistsList.innerHTML = '';
            return;
        }
        
        let html = '';
        playlists.forEach(playlist => {
            html += `
                <div class="wyy-playlist-card" data-playlist-id="${playlist.id}" style="cursor: pointer;">
                    <div class="wyy-playlist-cover" style="${playlist.cover ? `background-image: url(${playlist.cover})` : 'background: #f0f0f0;'}"></div>
                    <div class="wyy-playlist-info">
                        <div class="wyy-playlist-name">${playlist.name}</div>
                        <div class="wyy-playlist-desc">${playlist.desc || '暂无描述'}</div>
                    </div>
                    <div class="wyy-playlist-actions" style="display: flex; gap: 10px; align-items: center;">
                        <button class="wyy-control-btn" onclick="event.stopPropagation(); wyyExportSinglePlaylist(${playlist.id})" title="导出">
                            <i class="fa fa-download"></i>
                        </button>
                        <button class="wyy-control-btn" onclick="event.stopPropagation(); wyyDeletePlaylist(${playlist.id})" title="删除" style="color: #ff4444;">
                            <i class="fa fa-trash"></i>
                        </button>
                    </div>
                </div>
            `;
        });
        
        playlistsList.innerHTML = html;
        
        // 添加点击事件（点击歌单卡片显示详情，点击操作按钮不触发）
        document.querySelectorAll('.wyy-playlist-card[data-playlist-id]').forEach(card => {
            card.addEventListener('click', async function(e) {
                // 如果点击的是操作按钮区域，不触发
                if (e.target.closest('.wyy-playlist-actions')) {
                    return;
                }
                const playlistId = parseInt(this.getAttribute('data-playlist-id'));
                await wyyShowPlaylistDetail(playlistId);
            });
        });
    } catch (error) {
        console.error('加载歌单列表失败:', error);
    }
}

// 切换歌单
async function wyySwitchPlaylist(playlistId) {
    wyyCurrentPlaylistId = playlistId;
    await wyyInitPlaylist();
}

// 显示歌单详情
async function wyyShowPlaylistDetail(playlistId) {
    try {
        const playlist = await wyyDb.playlists.get(playlistId);
        if (!playlist) {
            alert('歌单不存在');
            return;
        }
        
        let songs = await wyyDb.songs.where('playlistId').equals(playlistId).toArray();
        // 在内存中按日期排序
        songs.sort((a, b) => {
            const dateA = a.dateAdded ? new Date(a.dateAdded).getTime() : 0;
            const dateB = b.dateAdded ? new Date(b.dateAdded).getTime() : 0;
            return dateA - dateB;
        });
        
        // 更新标题
        const titleElement = document.getElementById('wyyPlaylistDetailTitle');
        if (titleElement) {
            titleElement.textContent = `${playlist.name} (${songs.length}首)`;
        }
        
        // 显示歌曲列表
        const songsListElement = document.getElementById('wyyPlaylistDetailSongsList');
        if (!songsListElement) return;
        
        if (songs.length === 0) {
            songsListElement.innerHTML = '<div class="wyy-empty-playlist">该歌单暂无歌曲</div>';
        } else {
            let html = '';
            songs.forEach((song, index) => {
                const hasCover = song.cover && song.cover !== '';
                html += `
                    <div class="wyy-song-item" data-song-id="${song.id}">
                        <div class="wyy-song-item-icon ${!hasCover ? 'default' : ''}" style="${hasCover ? `background-image: url(${song.cover})` : ''}">
                            ${!hasCover ? (index + 1) : ''}
                        </div>
                        <div class="wyy-song-item-info">
                            <div class="wyy-song-item-name">${song.name}</div>
                            <div class="wyy-song-item-singer">${song.singer}</div>
                        </div>
                    </div>
                `;
            });
            songsListElement.innerHTML = html;
        }
        
        // 显示模态框
        const modal = document.getElementById('wyyPlaylistDetailModal');
        if (modal) {
            modal.style.display = 'flex';
            
            // 设置切换到该歌单的按钮事件
            const switchBtn = document.getElementById('wyySwitchToPlaylistBtn');
            if (switchBtn) {
                switchBtn.onclick = async () => {
                    await wyySwitchPlaylist(playlistId);
                    modal.style.display = 'none';
                };
            }
        }
    } catch (error) {
        console.error('加载歌单详情失败:', error);
        alert('加载歌单详情失败');
    }
}

// 关闭歌单详情
const wyyClosePlaylistDetailBtn = document.getElementById('wyyClosePlaylistDetailBtn');
const wyyPlaylistDetailModal = document.getElementById('wyyPlaylistDetailModal');

if (wyyClosePlaylistDetailBtn) {
    wyyClosePlaylistDetailBtn.addEventListener('click', () => {
        if (wyyPlaylistDetailModal) wyyPlaylistDetailModal.style.display = 'none';
    });
}

if (wyyPlaylistDetailModal) {
    wyyPlaylistDetailModal.addEventListener('click', (e) => {
        if (e.target === wyyPlaylistDetailModal) {
            wyyPlaylistDetailModal.style.display = 'none';
        }
    });
}

// 打开歌单管理
const wyyManagePlaylistsBtn = document.getElementById('wyyManagePlaylistsBtn');
if (wyyManagePlaylistsBtn) {
    wyyManagePlaylistsBtn.addEventListener('click', () => {
        const modal = document.getElementById('wyyPlaylistManageModal');
        if (modal) {
            modal.style.display = 'flex';
        }
    });
}

// 创建歌单
const wyyNewPlaylistBtn = document.getElementById('wyyNewPlaylistBtn');
const wyyCreatePlaylistModal = document.getElementById('wyyCreatePlaylistModal');
const wyyNewPlaylistName = document.getElementById('wyyNewPlaylistName');
const wyyNewPlaylistDesc = document.getElementById('wyyNewPlaylistDesc');
const wyyNewPlaylistCoverPreview = document.getElementById('wyyNewPlaylistCoverPreview');
const wyyUploadPlaylistCoverBtn = document.getElementById('wyyUploadPlaylistCoverBtn');
const wyyPlaylistCoverFileInput = document.getElementById('wyyPlaylistCoverFileInput');
const wyyCancelCreatePlaylistBtn = document.getElementById('wyyCancelCreatePlaylistBtn');
const wyySaveCreatePlaylistBtn = document.getElementById('wyySaveCreatePlaylistBtn');

let wyyTempPlaylistCover = null;

if (wyyNewPlaylistBtn) {
    wyyNewPlaylistBtn.addEventListener('click', () => {
        if (wyyCreatePlaylistModal) wyyCreatePlaylistModal.style.display = 'flex';
        if (wyyNewPlaylistName) wyyNewPlaylistName.value = '';
        if (wyyNewPlaylistDesc) wyyNewPlaylistDesc.value = '';
        if (wyyNewPlaylistCoverPreview) wyyNewPlaylistCoverPreview.style.backgroundImage = '';
        wyyTempPlaylistCover = null;
    });
}

if (wyyUploadPlaylistCoverBtn && wyyPlaylistCoverFileInput) {
    wyyUploadPlaylistCoverBtn.addEventListener('click', () => {
        wyyPlaylistCoverFileInput.click();
    });

    wyyPlaylistCoverFileInput.addEventListener('change', function(event) {
        const file = event.target.files[0];
        if (file) {
            if (!file.type.match('image.*')) {
                alert('请选择图片文件！');
                return;
            }
            if (file.size > 5 * 1024 * 1024) {
                alert('图片大小不能超过5MB！');
                return;
            }
            const reader = new FileReader();
            reader.onload = function(e) {
                if (wyyNewPlaylistCoverPreview) wyyNewPlaylistCoverPreview.style.backgroundImage = `url(${e.target.result})`;
                wyyTempPlaylistCover = e.target.result;
            };
            reader.readAsDataURL(file);
        }
    });
}

if (wyyCancelCreatePlaylistBtn) {
    wyyCancelCreatePlaylistBtn.addEventListener('click', () => {
        if (wyyCreatePlaylistModal) wyyCreatePlaylistModal.style.display = 'none';
    });
}

if (wyySaveCreatePlaylistBtn && wyyNewPlaylistName) {
    wyySaveCreatePlaylistBtn.addEventListener('click', async () => {
        const name = wyyNewPlaylistName.value.trim();
        if (!name) {
            alert('请输入歌单名称');
            return;
        }
        
        try {
            const playlistId = await wyyDb.playlists.add({
                name: name,
                desc: wyyNewPlaylistDesc ? wyyNewPlaylistDesc.value.trim() : '',
                cover: wyyTempPlaylistCover || '',
                dateCreated: new Date()
            });
            
            if (wyyCreatePlaylistModal) wyyCreatePlaylistModal.style.display = 'none';
            await wyyLoadPlaylists();
            await wyySwitchPlaylist(playlistId);
            alert('歌单创建成功！');
        } catch (error) {
            console.error('创建歌单失败:', error);
            alert('创建歌单失败，请重试');
        }
    });
}

if (wyyCreatePlaylistModal) {
    wyyCreatePlaylistModal.addEventListener('click', (e) => {
        if (e.target === wyyCreatePlaylistModal) {
            wyyCreatePlaylistModal.style.display = 'none';
        }
    });
}

// 删除歌单
async function wyyDeletePlaylist(playlistId) {
    if (!confirm('确定要删除这个歌单吗？歌单中的歌曲不会被删除。')) {
        return;
    }
    
    try {
        // 删除歌单
        await wyyDb.playlists.delete(playlistId);
        
        // 如果删除的是当前歌单，切换到默认歌单
        if (wyyCurrentPlaylistId === playlistId) {
            wyyCurrentPlaylistId = null;
            await wyyInitPlaylist();
        }
        
        await wyyLoadPlaylists();
        alert('歌单删除成功！');
    } catch (error) {
        console.error('删除歌单失败:', error);
        alert('删除歌单失败，请重试');
    }
}

// 导出单个歌单
async function wyyExportSinglePlaylist(playlistId) {
    try {
        const playlist = await wyyDb.playlists.get(playlistId);
        if (!playlist) {
            alert('歌单不存在');
            return;
        }
        
        const songs = await wyyDb.songs.where('playlistId').equals(playlistId).toArray();
        
        // 加载每首歌曲的完整信息
        const fullSongs = [];
        for (const song of songs) {
            const songFile = await wyyDb.songFiles.where({ songId: song.id }).first();
            const lyric = await wyyDb.lyrics.where({ songId: song.id }).first();
            
            const fullSong = {
                name: song.name,
                singer: song.singer,
                cover: song.cover || '',
                url: song.url || '',
                lyricUrl: song.lyricUrl || '',
                hasLocalFile: !!songFile,
                hasLocalLyric: !!lyric
            };
            
            if (songFile) {
                fullSong.fileData = songFile.data;
                fullSong.fileType = songFile.type;
            }
            
            if (lyric) {
                fullSong.lyricData = lyric.data;
            }
            
            fullSongs.push(fullSong);
        }
        
        const exportData = {
            playlist: {
                name: playlist.name,
                desc: playlist.desc,
                cover: playlist.cover
            },
            songs: fullSongs,
            exportDate: new Date().toISOString()
        };
        
        const dataStr = JSON.stringify(exportData, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${playlist.name}.json`;
        link.click();
        URL.revokeObjectURL(url);
        
        alert('歌单导出成功！');
    } catch (error) {
        console.error('导出歌单失败:', error);
        alert('导出歌单失败，请重试');
    }
}

// 导出当前歌单
const wyyExportPlaylistBtn = document.getElementById('wyyExportPlaylistBtn');
if (wyyExportPlaylistBtn) {
    wyyExportPlaylistBtn.addEventListener('click', async () => {
        if (!wyyCurrentPlaylistId) {
            alert('请先选择一个歌单');
            return;
        }
        await wyyExportSinglePlaylist(wyyCurrentPlaylistId);
    });
}

// 导入歌单
const wyyImportPlaylistBtn = document.getElementById('wyyImportPlaylistBtn');
const wyyImportPlaylistFileInput = document.getElementById('wyyImportPlaylistFileInput');

if (wyyImportPlaylistBtn && wyyImportPlaylistFileInput) {
    wyyImportPlaylistBtn.addEventListener('click', () => {
        wyyImportPlaylistFileInput.click();
    });

    wyyImportPlaylistFileInput.addEventListener('change', async function(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        if (!file.name.endsWith('.json')) {
            alert('请选择JSON格式的文件');
            return;
        }
        
        try {
            const text = await file.text();
            const importData = JSON.parse(text);
            
            if (!importData.playlist || !importData.songs) {
                alert('文件格式不正确');
                return;
            }
            
            // 创建歌单
            const playlistId = await wyyDb.playlists.add({
                name: importData.playlist.name + ' (导入)',
                desc: importData.playlist.desc || '',
                cover: importData.playlist.cover || '',
                dateCreated: new Date()
            });
            
            // 导入歌曲
            for (const songData of importData.songs) {
                const songId = await wyyDb.songs.add({
                    name: songData.name,
                    singer: songData.singer,
                    cover: songData.cover || '',
                    url: songData.url || '',
                    lyricUrl: songData.lyricUrl || '',
                    playlistId: playlistId,
                    dateAdded: new Date()
                });
                
                if (songData.hasLocalFile && songData.fileData) {
                    await wyyDb.songFiles.add({
                        songId: songId,
                        type: songData.fileType || 'audio/mpeg',
                        data: songData.fileData
                    });
                }
                
                if (songData.hasLocalLyric && songData.lyricData) {
                    await wyyDb.lyrics.add({
                        songId: songId,
                        data: songData.lyricData
                    });
                }
            }
            
            await wyyLoadPlaylists();
            await wyySwitchPlaylist(playlistId);
            alert('歌单导入成功！');
        } catch (error) {
            console.error('导入歌单失败:', error);
            alert('导入歌单失败：' + error.message);
        }
    });
}

// 添加到歌单功能
const wyyAddToPlaylistModal = document.getElementById('wyyAddToPlaylistModal');
const wyyPlaylistSelectorList = document.getElementById('wyyPlaylistSelectorList');
const wyyCancelAddToPlaylistBtn = document.getElementById('wyyCancelAddToPlaylistBtn');
let wyyCurrentAddSongId = null;

// 显示添加到歌单模态框
async function wyyShowAddToPlaylistModal(songId) {
    wyyCurrentAddSongId = songId;
    
    try {
        const playlists = await wyyDb.playlists.orderBy('dateCreated').reverse().toArray();
        
        if (!wyyPlaylistSelectorList) return;
        
        if (playlists.length === 0) {
            wyyPlaylistSelectorList.innerHTML = '<div style="text-align: center; padding: 20px; color: #999;">还没有歌单，请先创建歌单</div>';
        } else {
            let html = '';
            playlists.forEach(playlist => {
                html += `
                    <div class="wyy-playlist-selector-item" data-playlist-id="${playlist.id}" style="padding: 12px; border-bottom: 1px solid #eee; cursor: pointer; display: flex; align-items: center; gap: 12px; transition: background 0.2s;">
                        <div class="wyy-playlist-cover" style="width: 40px; height: 40px; border-radius: 6px; ${playlist.cover ? `background-image: url(${playlist.cover})` : 'background: #f0f0f0;'}"></div>
                        <div style="flex: 1;">
                            <div style="font-weight: 500; color: #333; margin-bottom: 2px;">${playlist.name}</div>
                            <div style="font-size: 12px; color: #999;">${playlist.desc || '暂无描述'}</div>
                        </div>
                        <i class="fa fa-chevron-right" style="color: #ccc;"></i>
                    </div>
                `;
            });
            
            wyyPlaylistSelectorList.innerHTML = html;
            
            // 添加点击事件
            document.querySelectorAll('.wyy-playlist-selector-item').forEach(item => {
                item.addEventListener('click', async function() {
                    const playlistId = parseInt(this.getAttribute('data-playlist-id'));
                    await wyyAddSongToPlaylist(songId, playlistId);
                });
            });
        }
        
        if (wyyAddToPlaylistModal) wyyAddToPlaylistModal.style.display = 'flex';
    } catch (error) {
        console.error('加载歌单列表失败:', error);
        alert('加载歌单列表失败');
    }
}

// 将歌曲添加到歌单
async function wyyAddSongToPlaylist(songId, playlistId) {
    try {
        // 检查歌曲是否已经在歌单中
        const existingSong = await wyyDb.songs.where({ id: songId, playlistId: playlistId }).first();
        if (existingSong) {
            alert('歌曲已在该歌单中');
            if (wyyAddToPlaylistModal) wyyAddToPlaylistModal.style.display = 'none';
            return;
        }
        
        // 获取原歌曲信息
        const originalSong = await wyyDb.songs.get(songId);
        if (!originalSong) {
            alert('歌曲不存在');
            return;
        }
        
        // 创建新歌曲记录（添加到新歌单）
        const newSongData = {
            name: originalSong.name,
            singer: originalSong.singer,
            cover: originalSong.cover || '',
            url: originalSong.url || '',
            lyricUrl: originalSong.lyricUrl || '',
            playlistId: playlistId,
            dateAdded: new Date()
        };
        
        const newSongId = await wyyDb.songs.add(newSongData);
        
        // 复制歌曲文件
        const songFile = await wyyDb.songFiles.where({ songId: songId }).first();
        if (songFile) {
            await wyyDb.songFiles.add({
                songId: newSongId,
                type: songFile.type,
                data: songFile.data
            });
        }
        
        // 复制歌词文件
        const lyric = await wyyDb.lyrics.where({ songId: songId }).first();
        if (lyric) {
            await wyyDb.lyrics.add({
                songId: newSongId,
                data: lyric.data
            });
        }
        
        if (wyyAddToPlaylistModal) wyyAddToPlaylistModal.style.display = 'none';
        alert('歌曲已添加到歌单！');
    } catch (error) {
        console.error('添加歌曲到歌单失败:', error);
        alert('添加歌曲到歌单失败，请重试');
    }
}

if (wyyCancelAddToPlaylistBtn) {
    wyyCancelAddToPlaylistBtn.addEventListener('click', () => {
        if (wyyAddToPlaylistModal) wyyAddToPlaylistModal.style.display = 'none';
    });
}

if (wyyAddToPlaylistModal) {
    wyyAddToPlaylistModal.addEventListener('click', (e) => {
        if (e.target === wyyAddToPlaylistModal) {
            wyyAddToPlaylistModal.style.display = 'none';
        }
    });
}

// 歌单管理模态框
const wyyPlaylistManageModal = document.getElementById('wyyPlaylistManageModal');
const wyyClosePlaylistManageBtn = document.getElementById('wyyClosePlaylistManageBtn');

if (wyyClosePlaylistManageBtn) {
    wyyClosePlaylistManageBtn.addEventListener('click', () => {
        if (wyyPlaylistManageModal) wyyPlaylistManageModal.style.display = 'none';
    });
}

if (wyyPlaylistManageModal) {
    wyyPlaylistManageModal.addEventListener('click', (e) => {
        if (e.target === wyyPlaylistManageModal) {
            wyyPlaylistManageModal.style.display = 'none';
        }
    });
}

// ============================================
// 一起听功能
// ============================================
let wyyTogetherListenRole = null; // 当前一起听的角色
let wyyTogetherListenInterval = null; // 更新一起听状态的定时器

const wyyTogetherListenBtn = document.getElementById('wyyTogetherListenBtn');
const wyyTogetherListenModal = document.getElementById('wyyTogetherListenModal');
const wyyTogetherListenRoleList = document.getElementById('wyyTogetherListenRoleList');
const wyyCancelTogetherListenBtn = document.getElementById('wyyCancelTogetherListenBtn');
const wyyStopTogetherListenBtn = document.getElementById('wyyStopTogetherListenBtn');

// 打开一起听选择角色模态框
if (wyyTogetherListenBtn) {
    wyyTogetherListenBtn.addEventListener('click', () => {
        wyyShowTogetherListenRoleSelector();
    });
}

// 显示角色选择器
function wyyShowTogetherListenRoleSelector() {
    if (!wyyTogetherListenRoleList) return;
    
    const friends = getFriendList();
    
    if (friends.length === 0) {
        wyyTogetherListenRoleList.innerHTML = '<div style="text-align: center; padding: 20px; color: #999;">还没有好友，请先添加好友</div>';
    } else {
        let html = '';
        friends.forEach(friend => {
            // 处理friend可能是对象或字符串的情况
            const friendName = typeof friend === 'string' ? friend : (friend.name || friend.remark || '未知');
            const friendDisplayName = typeof friend === 'string' ? friend : (friend.remark || friend.name || '未知');
            const isActive = wyyTogetherListenRole === friendName;
            const firstChar = String(friendDisplayName).charAt(0);
            
            html += `
                <div class="wyy-playlist-selector-item ${isActive ? 'active' : ''}" data-role="${friendName}" style="padding: 12px; border-bottom: 1px solid #eee; cursor: pointer; display: flex; align-items: center; gap: 12px; transition: background 0.2s;">
                    <div style="width: 40px; height: 40px; border-radius: 50%; background: #f0f0f0; display: flex; align-items: center; justify-content: center; font-size: 18px; color: #666;">${firstChar}</div>
                    <div style="flex: 1;">
                        <div style="font-weight: 500; color: #333; margin-bottom: 2px;">${friendDisplayName}</div>
                        ${isActive ? '<div style="font-size: 12px; color: #ff6b6b;">正在一起听</div>' : ''}
                    </div>
                    ${isActive ? '<i class="fa fa-check-circle" style="color: #ff6b6b;"></i>' : '<i class="fa fa-chevron-right" style="color: #ccc;"></i>'}
                </div>
            `;
        });
        wyyTogetherListenRoleList.innerHTML = html;
        
        // 添加点击事件
        document.querySelectorAll('.wyy-playlist-selector-item[data-role]').forEach(item => {
            item.addEventListener('click', function() {
                const role = this.getAttribute('data-role');
                if (wyyTogetherListenRole === role) {
                    // 如果已经是一起听的角色，则结束一起听
                    wyyStopTogetherListen();
                } else {
                    // 开始和该角色一起听
                    wyyStartTogetherListen(role);
                }
            });
        });
    }
    
    // 更新结束按钮显示
    if (wyyStopTogetherListenBtn) {
        if (wyyTogetherListenRole) {
            wyyStopTogetherListenBtn.style.display = 'block';
        } else {
            wyyStopTogetherListenBtn.style.display = 'none';
        }
    }
    
    if (wyyTogetherListenModal) wyyTogetherListenModal.style.display = 'flex';
}

// 开始一起听
function wyyStartTogetherListen(role) {
    // 确保role是字符串
    wyyTogetherListenRole = String(role);
    if (wyyTogetherListenBtn) wyyTogetherListenBtn.classList.add('active');
    if (wyyTogetherListenModal) wyyTogetherListenModal.style.display = 'none';
    
    // 不再发送消息到对话框，只作为角色回复的参考
    // 开始定时更新一起听状态（虽然不再更新卡片，但保持状态）
    wyyStartTogetherListenUpdate();
    
    alert(`已开始和 ${wyyTogetherListenRole} 一起听`);
}

// 结束一起听
function wyyStopTogetherListen() {
    // 不再发送消息到对话框
    wyyTogetherListenRole = null;
    if (wyyTogetherListenBtn) wyyTogetherListenBtn.classList.remove('active');
    if (wyyTogetherListenModal) wyyTogetherListenModal.style.display = 'none';
    
    // 停止定时更新
    wyyStopTogetherListenUpdate();
}

// 开始定时更新一起听状态（不再更新卡片，只保持状态）
function wyyStartTogetherListenUpdate() {
    wyyStopTogetherListenUpdate();
    // 不再更新卡片，因为不再发送消息到对话框
    // 状态会通过 systemPrompt 传递给角色
}

// 停止定时更新
function wyyStopTogetherListenUpdate() {
    if (wyyTogetherListenInterval) {
        clearInterval(wyyTogetherListenInterval);
        wyyTogetherListenInterval = null;
    }
}

// 从聊天切换歌曲（全局函数，供HTML onclick使用）
window.wyySwitchSongFromChat = function(role, direction) {
    // 确保类型一致进行比较
    const roleStr = String(role);
    if (String(wyyTogetherListenRole) !== roleStr) {
        alert('当前没有和该角色一起听');
        return;
    }
    
    if (direction === 'prev') {
        if (wyyPlaylist.length > 0) {
            wyyCurrentSongIndex = (wyyCurrentSongIndex - 1 + wyyPlaylist.length) % wyyPlaylist.length;
            wyyPlaySong(wyyCurrentSongIndex);
            // 不再发送消息到对话框，状态会通过 systemPrompt 传递给角色
        }
    } else if (direction === 'next') {
        if (wyyPlaylist.length > 0) {
            wyyCurrentSongIndex = (wyyCurrentSongIndex + 1) % wyyPlaylist.length;
            wyyPlaySong(wyyCurrentSongIndex);
            // 不再发送消息到对话框，状态会通过 systemPrompt 传递给角色
        }
    }
}

if (wyyCancelTogetherListenBtn) {
    wyyCancelTogetherListenBtn.addEventListener('click', () => {
        if (wyyTogetherListenModal) wyyTogetherListenModal.style.display = 'none';
    });
}

if (wyyStopTogetherListenBtn) {
    wyyStopTogetherListenBtn.addEventListener('click', () => {
        wyyStopTogetherListen();
    });
}

if (wyyTogetherListenModal) {
    wyyTogetherListenModal.addEventListener('click', (e) => {
        if (e.target === wyyTogetherListenModal) {
            wyyTogetherListenModal.style.display = 'none';
        }
    });
}

// 阻止歌词容器滚动事件冒泡，避免影响页面滚动
if (wyyLyricsContainer) {
    wyyLyricsContainer.addEventListener('touchmove', (e) => {
        e.stopPropagation();
    }, { passive: true });
    wyyLyricsContainer.addEventListener('wheel', (e) => {
        e.stopPropagation();
    }, { passive: true });
}

// 页面加载时恢复设置和初始化播放列表
window.addEventListener('DOMContentLoaded', async () => {
    try {
        // 确保播放器详情页面初始状态是隐藏的
        if (wyyPlayerPage) wyyPlayerPage.classList.remove('active');
        if (wyyMainPage) wyyMainPage.classList.add('active');
        
        const savedAvatar = await wyyDb.userSettings.get('avatar');
        if (savedAvatar && wyyAvatarDisplay) {
            wyyAvatarDisplay.style.backgroundImage = `url(${savedAvatar.data})`;
        }
        
        const savedFollow = await wyyDb.userSettings.get('follow');
        const savedFans = await wyyDb.userSettings.get('fans');
        const savedLevel = await wyyDb.userSettings.get('level');
        const savedTime = await wyyDb.userSettings.get('time');
        
        if (savedFollow && wyyFollowValue) wyyFollowValue.textContent = savedFollow.data;
        if (savedFans && wyyFansValue) wyyFansValue.textContent = savedFans.data;
        if (savedLevel && wyyLevelValue) wyyLevelValue.textContent = savedLevel.data;
        if (savedTime && wyyTimeValue) wyyTimeValue.textContent = savedTime.data;
        
        for (let i = 1; i <= 4; i++) {
            const cardKey = `card${i}`;
            const savedCard = await wyyDb.playlistCards.get(cardKey);
            const cardElement = document.getElementById(`wyyCard${i}`);
            if (cardElement && savedCard) {
                cardElement.style.backgroundImage = `url(${savedCard.data})`;
            }
        }
        
        await wyyInitPlaylist();
        await wyyLoadPlaylists();
    } catch (error) {
        console.error('加载设置失败:', error);
    }
});

// ==================== 小屋功能 ====================
let currentCabinMachine = 'furniture'; // furniture 或 clothes
let cabinCoinCount = 200;

// 小屋扭蛋状态管理
window.cabinGachaState = {
    coins: 200,
    customItems: {},  // 物品库
    catalog: {},      // 图鉴记录
    inventory: {},    // 背包库存
    gachaPool: {
        furniture: [],
        clothes: []
    }
};

function showCabinPage() {
    document.getElementById('home-page').style.display = 'none';
    document.getElementById('cabin-page').style.display = 'flex';
    
    // 首次打开时初始化数据
    if (!window.cabinInitialized) {
        // 尝试从本地存储加载数据
        const loaded = loadCabinGachaData();
        
        // 如果没有保存的数据，初始化默认物品
        if (!loaded) {
            initDefaultItems();
        }
        
        window.cabinInitialized = true;
    }
    
    updateCabinCoinDisplay();
    updateCabinUI();
}

function hideCabinPage() {
    document.getElementById('cabin-page').style.display = 'none';
    document.getElementById('home-page').style.display = 'block';
}

function updateCabinCoinDisplay() {
    const state = window.cabinGachaState;
    const coinElement = document.getElementById('cabin-coin-count');
    if (coinElement) {
        coinElement.textContent = state.coins;
    }
    // 同步全局变量
    cabinCoinCount = state.coins;
}

// 保存小屋扭蛋数据到本地存储
function saveCabinGachaData() {
    try {
        const state = window.cabinGachaState;
        localStorage.setItem('cabinGachaState', JSON.stringify(state));
        console.log('小屋数据已保存');
    } catch (e) {
        console.error('保存小屋数据失败:', e);
    }
}

// 从本地存储加载小屋扭蛋数据
function loadCabinGachaData() {
    try {
        const saved = localStorage.getItem('cabinGachaState');
        if (saved) {
            const state = JSON.parse(saved);
            window.cabinGachaState = state;
            cabinCoinCount = state.coins;
            console.log('小屋数据已加载');
            return true;
        }
    } catch (e) {
        console.error('加载小屋数据失败:', e);
    }
    return false;
}

// 更新小屋UI（刷新所有相关显示）
function updateCabinUI() {
    // 更新金币显示
    updateCabinCoinDisplay();
    
    // 如果图鉴弹窗打开，刷新图鉴
    const catalogModal = document.getElementById('catalog-modal');
    if (catalogModal && catalogModal.style.display === 'flex') {
        renderCatalogItems();
    }
    
    // 更新背包显示（如果有背包UI）
    updateCabinInventoryDisplay();
}

function switchCabinScreen(screenName) {
    // 移除所有active类
    document.querySelectorAll('.cabin-screen').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.cabin-nav-item').forEach(n => n.classList.remove('active'));

    // 添加active类
    const screen = document.getElementById('cabin-' + screenName + '-screen');
    if (screen) {
        screen.classList.add('active');
    }
    
    // 找到对应的导航项并激活
    const navItems = document.querySelectorAll('.cabin-nav-item');
    navItems.forEach(item => {
        const text = item.querySelector('.cabin-nav-item-text').textContent;
        if ((screenName === 'gacha' && text === '扭蛋') ||
            (screenName === 'catalog' && text === '图鉴') ||
            (screenName === 'house' && text === '房屋') ||
            (screenName === 'character' && text === '人物')) {
            item.classList.add('active');
        }
    });
}

function switchCabinMachine() {
    const furnitureGacha = document.getElementById('cabin-furniture-gacha');
    const clothesGacha = document.getElementById('cabin-clothes-gacha');
    const machineTitle = document.getElementById('cabin-machine-title');

    if (currentCabinMachine === 'furniture') {
        furnitureGacha.style.display = 'none';
        clothesGacha.style.display = 'flex';
        machineTitle.textContent = '服装扭蛋机';
        currentCabinMachine = 'clothes';
    } else {
        furnitureGacha.style.display = 'flex';
        clothesGacha.style.display = 'none';
        machineTitle.textContent = '家具扭蛋机';
        currentCabinMachine = 'furniture';
    }
}

// 稀有度权重配置
const RARITY_WEIGHTS = {
    'R': 70,    // 70%
    'SR': 25,   // 25%
    'SSR': 5    // 5%
};

// 根据权重随机抽取一个稀有度
function getRandomRarity() {
    const total = Object.values(RARITY_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
    let random = Math.random() * total;
    
    for (const [rarity, weight] of Object.entries(RARITY_WEIGHTS)) {
        random -= weight;
        if (random <= 0) {
            return rarity;
        }
    }
    return 'R'; // 默认返回R
}

// 根据稀有度从物品池中随机抽取物品
function drawItem(targetRarity) {
    const state = window.cabinGachaState;
    
    // 获取当前扭蛋机类型的物品池
    const poolType = currentCabinMachine === 'furniture' ? 'furniture' : 'clothes';
    
    // 获取所有可抽取的物品
    const availableItems = Object.entries(state.customItems)
        .filter(([id, item]) => {
            // 家具扭蛋机抽取家具类
            if (poolType === 'furniture') {
                return item.inPool && ['furniture', 'decor', 'wall', 'floor'].includes(item.type);
            }
            // 服装扭蛋机抽取服装类（暂未实现）
            return false;
        })
        .filter(([id, item]) => item.rarity === targetRarity);
    
    if (availableItems.length === 0) {
        // 如果该稀有度没有物品，降级抽取
        if (targetRarity === 'SSR') return drawItem('SR');
        if (targetRarity === 'SR') return drawItem('R');
        // 如果都没有，随机返回任意物品
        const allItems = Object.entries(state.customItems).filter(([id, item]) => item.inPool);
        if (allItems.length > 0) {
            const randomIndex = Math.floor(Math.random() * allItems.length);
            return allItems[randomIndex];
        }
        return null;
    }
    
    // 随机选择一个物品
    const randomIndex = Math.floor(Math.random() * availableItems.length);
    return availableItems[randomIndex];
}

// 更新背包和图鉴
function addItemToInventory(itemId) {
    const state = window.cabinGachaState;
    
    // 更新背包
    state.inventory[itemId] = (state.inventory[itemId] || 0) + 1;
    
    // 更新图鉴
    if (!state.catalog[itemId]) {
        state.catalog[itemId] = { seen: true, owned: true };
    } else {
        state.catalog[itemId].seen = true;
        state.catalog[itemId].owned = true;
    }
    
    // 保存状态
    saveCabinGachaData();
}

// 显示抽奖结果
function showDrawResult(items) {
    if (!items || items.length === 0) return;
    
    const state = window.cabinGachaState;
    
    // 创建结果弹窗HTML
    let resultHTML = '<div class="draw-result-modal" id="draw-result-modal" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 10000; font-family: \'Press Start 2P\', cursive;">';
    resultHTML += '<div class="draw-result-content" style="background: #ffffff; border: 4px solid #FFB3C1; border-radius: 0; padding: 25px; max-width: 90%; max-height: 80%; overflow-y: auto; box-shadow: 8px 8px 0 rgba(255, 179, 193, 0.3);">';
    
    // 标题带图标
    resultHTML += '<div style="display: flex; align-items: center; justify-content: center; gap: 12px; margin-bottom: 20px;">';
    resultHTML += '<svg style="width: 24px; height: 24px; stroke: #FFB3C1;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M16 8h-8m4-4v16"></path></svg>';
    resultHTML += '<div style="font-size: 14px; color: #666666; font-weight: bold;">抽奖结果</div>';
    resultHTML += '<svg style="width: 24px; height: 24px; stroke: #FFB3C1;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M16 8h-8m4-4v16"></path></svg>';
    resultHTML += '</div>';
    
    // 显示所有抽到的物品
    resultHTML += '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 12px; margin-bottom: 20px;">';
    
    items.forEach(([itemId, item]) => {
        // 根据稀有度设置背景色
        let rarityBg = '#FAFAFA';  // R - 浅灰白
        let rarityBorder = '#E0E0E0';  // R - 灰色边框
        
        if (item.rarity === 'SR') {
            rarityBg = '#FFF5F7';  // SR - 浅粉
            rarityBorder = '#FFD4DC';  // SR - 粉色边框
        } else if (item.rarity === 'SSR') {
            rarityBg = '#FFE4E9';  // SSR - 深粉
            rarityBorder = '#FFB3C1';  // SSR - 深粉边框
        }
        
        resultHTML += `<div style="background: ${rarityBg}; border: 3px solid ${rarityBorder}; padding: 10px; text-align: center; transition: transform 0.2s;">`;
        resultHTML += `<div style="width: 70px; height: 70px; margin: 0 auto 8px; display: flex; align-items: center; justify-content: center;">${item.svg}</div>`;
        resultHTML += `<div style="color: #666666; font-size: 10px; margin-bottom: 5px; word-break: break-word;">${item.name}</div>`;
        resultHTML += `<div style="color: #999999; font-size: 8px; padding: 2px 6px; background: rgba(255,255,255,0.6); display: inline-block;">${item.rarity}</div>`;
        resultHTML += `</div>`;
    });
    
    resultHTML += '</div>';
    
    // 统计信息
    const rarityCount = { R: 0, SR: 0, SSR: 0 };
    items.forEach(([id, item]) => {
        if (rarityCount[item.rarity] !== undefined) {
            rarityCount[item.rarity]++;
        }
    });
    
    resultHTML += '<div style="color: #999999; font-size: 9px; text-align: center; margin-bottom: 15px; padding: 8px; background: #F8F8F8; border: 2px solid #F0F0F0;">';
    resultHTML += `共获得 ${items.length} 件物品 | `;
    if (rarityCount.SSR > 0) resultHTML += `SSR×${rarityCount.SSR} `;
    if (rarityCount.SR > 0) resultHTML += `SR×${rarityCount.SR} `;
    if (rarityCount.R > 0) resultHTML += `R×${rarityCount.R}`;
    resultHTML += '</div>';
    
    // 关闭按钮
    resultHTML += '<button onclick="closeDrawResult()" style="width: 100%; padding: 12px; background: #FFB3C1; color: white; border: none; cursor: pointer; font-size: 11px; font-family: \'Press Start 2P\', cursive; transition: background 0.2s;" onmouseover="this.style.background=\'#FF9EAD\'" onmouseout="this.style.background=\'#FFB3C1\'">确定</button>';
    resultHTML += '</div></div>';
    
    // 添加到页面
    document.body.insertAdjacentHTML('beforeend', resultHTML);
}

// 关闭抽奖结果弹窗
function closeDrawResult() {
    const modal = document.getElementById('draw-result-modal');
    if (modal) {
        modal.remove();
    }
}

// 单抽
function cabinDrawOnce() {
    const state = window.cabinGachaState;
    
    if (state.coins < 10) {
        alert('金币不足，需要10个金币');
        return;
    }
    
    // 扣除金币
    state.coins -= 10;
    cabinCoinCount = state.coins;
    updateCabinCoinDisplay();
    
    // 抽取物品
    const rarity = getRandomRarity();
    const drawnItem = drawItem(rarity);
    
    if (!drawnItem) {
        alert('物品池为空，请先添加物品');
        return;
    }
    
    const [itemId, item] = drawnItem;
    
    // 添加到背包和图鉴
    addItemToInventory(itemId);
    
    // 显示结果
    showDrawResult([drawnItem]);
    
    // 更新UI
    updateCabinUI();
}

// 十连抽
function cabinDrawTen() {
    const state = window.cabinGachaState;
    
    if (state.coins < 100) {
        alert('金币不足，需要100个金币');
        return;
    }
    
    // 扣除金币
    state.coins -= 100;
    cabinCoinCount = state.coins;
    updateCabinCoinDisplay();
    
    // 抽取10次
    const results = [];
    let guaranteedSR = false; // 保底机制：十连至少出一个SR
    
    for (let i = 0; i < 10; i++) {
        let rarity = getRandomRarity();
        
        // 最后一抽如果还没有SR以上，强制出SR
        if (i === 9 && !guaranteedSR) {
            rarity = Math.random() < 0.5 ? 'SR' : 'SSR';
        }
        
        const drawnItem = drawItem(rarity);
        
        if (drawnItem) {
            const [itemId, item] = drawnItem;
            
            // 检查是否抽到SR或以上
            if (item.rarity === 'SR' || item.rarity === 'SSR') {
                guaranteedSR = true;
            }
            
            // 添加到背包和图鉴
            addItemToInventory(itemId);
            
            results.push(drawnItem);
        }
    }
    
    // 显示结果
    if (results.length > 0) {
        showDrawResult(results);
    }
    
    // 更新UI
    updateCabinUI();
}

function openCabinAIModal() {
    alert('AI生成功能开发中');
}

function openCabinCharacterModal() {
    alert('角色生成功能开发中');
}

// 房间相关功能
function takeCabinScreenshot() {
    alert('拍照功能开发中');
}

// 房间颜色状态（临时存储，将来可以用localStorage）
let cabinRoomState = {
    wallColor: '#fff5f7',
    wallStyle: 'solid',
    wallPatternColor: '#fff5f7',
    floorColor: '#fefefe',
    floorStyle: 'solid',
    floorPatternColor: '#fefefe'
};

// 打开颜色选择器
function openCabinColorPicker(type) {
    window.cabinCurrentColorTarget = type;
    const modal = document.getElementById('cabin-color-picker-modal');
    const title = document.getElementById('cabin-color-modal-title');
    const colorInput = document.getElementById('cabin-color-input');
    const colorPicker = document.getElementById('cabin-color-picker');
    
    if (title) {
        const iconSvg = `<svg class="cabin-icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>
        </svg>`;
        title.innerHTML = iconSvg + (type === 'wall' ? ' 修改墙面颜色' : ' 修改地板颜色');
    }
    
    const currentColor = type === 'wall' ? (cabinRoomState.wallColor || '#fff5f7') : (cabinRoomState.floorColor || '#fefefe');
    const currentPatternColor = type === 'wall' ? (cabinRoomState.wallPatternColor || currentColor) : (cabinRoomState.floorPatternColor || currentColor);
    
    if (colorInput) colorInput.value = currentColor;
    if (colorPicker) colorPicker.value = currentColor;
    
    const patternColorInput = document.getElementById('cabin-pattern-color-input');
    const patternColorPicker = document.getElementById('cabin-pattern-color-picker');
    if (patternColorInput) patternColorInput.value = currentPatternColor;
    if (patternColorPicker) patternColorPicker.value = currentPatternColor;
    
    // 同步颜色输入和拾色器
    if (colorInput && colorPicker) {
        colorInput.oninput = () => {
            if (colorInput.value.match(/^#[0-9A-Fa-f]{6}$/)) {
                colorPicker.value = colorInput.value;
            }
        };
        colorPicker.oninput = () => {
            colorInput.value = colorPicker.value;
        };
    }
    
    if (patternColorInput && patternColorPicker) {
        patternColorInput.oninput = () => {
            if (patternColorInput.value.match(/^#[0-9A-Fa-f]{6}$/)) {
                patternColorPicker.value = patternColorInput.value;
            }
        };
        patternColorPicker.oninput = () => {
            patternColorInput.value = patternColorPicker.value;
        };
    }
    
    // 样式选择变化
    const styleOptions = document.querySelectorAll('input[name="cabin-style-option"]');
    styleOptions.forEach(option => {
        option.onchange = () => {
            const patternSection = document.getElementById('cabin-pattern-color-section');
            if (patternSection) {
                patternSection.style.display = option.value === 'solid' ? 'none' : 'block';
            }
        };
    });
    
    // 恢复当前样式选择
    const currentStyle = type === 'wall' ? cabinRoomState.wallStyle : cabinRoomState.floorStyle;
    const styleOption = document.querySelector(`input[name="cabin-style-option"][value="${currentStyle}"]`);
    if (styleOption) {
        styleOption.checked = true;
        const patternSection = document.getElementById('cabin-pattern-color-section');
        if (patternSection) {
            patternSection.style.display = currentStyle === 'solid' ? 'none' : 'block';
        }
    }
    
    if (modal) modal.style.display = 'flex';
}

// 关闭颜色选择器
function closeCabinColorPicker() {
    const modal = document.getElementById('cabin-color-picker-modal');
    if (modal) modal.style.display = 'none';
    window.cabinCurrentColorTarget = null;
}

// 重置颜色
function resetCabinColor() {
    const defaultColor = window.cabinCurrentColorTarget === 'wall' ? '#fff5f7' : '#fefefe';
    const colorInput = document.getElementById('cabin-color-input');
    const colorPicker = document.getElementById('cabin-color-picker');
    const patternColorInput = document.getElementById('cabin-pattern-color-input');
    const patternColorPicker = document.getElementById('cabin-pattern-color-picker');
    
    if (colorInput) colorInput.value = defaultColor;
    if (colorPicker) colorPicker.value = defaultColor;
    if (patternColorInput) patternColorInput.value = defaultColor;
    if (patternColorPicker) patternColorPicker.value = defaultColor;
    
    const solidOption = document.querySelector('input[name="cabin-style-option"][value="solid"]');
    if (solidOption) solidOption.checked = true;
    
    const patternSection = document.getElementById('cabin-pattern-color-section');
    if (patternSection) patternSection.style.display = 'none';
}

// 应用颜色
function applyCabinColor() {
    if (!window.cabinCurrentColorTarget) return;
    
    const colorInput = document.getElementById('cabin-color-input');
    const patternColorInput = document.getElementById('cabin-pattern-color-input');
    const styleOption = document.querySelector('input[name="cabin-style-option"]:checked');
    
    if (!colorInput || !styleOption) return;
    
    const color = colorInput.value;
    if (!color.match(/^#[0-9A-Fa-f]{6}$/)) {
        alert('颜色格式不正确');
        return;
    }
    
    const style = styleOption.value;
    
    // 获取花纹颜色（如果样式不是纯色）
    let patternColor = color;
    if (style !== 'solid' && patternColorInput) {
        const patternColorValue = patternColorInput.value;
        if (patternColorValue && patternColorValue.match(/^#[0-9A-Fa-f]{6}$/)) {
            patternColor = patternColorValue;
        }
    }
    
    if (window.cabinCurrentColorTarget === 'wall') {
        cabinRoomState.wallColor = color;
        cabinRoomState.wallStyle = style;
        cabinRoomState.wallPatternColor = patternColor;
        applyCabinWallStyle();
    } else {
        cabinRoomState.floorColor = color;
        cabinRoomState.floorStyle = style;
        cabinRoomState.floorPatternColor = patternColor;
        applyCabinFloorStyle();
    }
    
    // 更新按钮颜色
    const wallBtn = document.getElementById('cabin-wall-color-btn');
    const floorBtn = document.getElementById('cabin-floor-color-btn');
    if (wallBtn) wallBtn.style.background = cabinRoomState.wallColor;
    if (floorBtn) floorBtn.style.background = cabinRoomState.floorColor;
    
    closeCabinColorPicker();
}

// 应用墙面样式
function applyCabinWallStyle() {
    const wallArea = document.getElementById('cabin-wall-area');
    if (!wallArea) return;
    
    wallArea.style.backgroundColor = cabinRoomState.wallColor || '#fff5f7';
    
    if (cabinRoomState.wallStyle === 'solid') {
        wallArea.style.backgroundImage = 'none';
    } else if (cabinRoomState.wallStyle === 'pattern1') {
        const patternColor = (cabinRoomState.wallPatternColor || cabinRoomState.wallColor) + '40';
        wallArea.style.backgroundImage = `
            linear-gradient(90deg, ${patternColor} 1px, transparent 1px),
            linear-gradient(${patternColor} 1px, transparent 1px)
        `;
        wallArea.style.backgroundSize = '32px 32px';
    } else if (cabinRoomState.wallStyle === 'pattern2') {
        const patternColor = cabinRoomState.wallPatternColor || cabinRoomState.wallColor;
        wallArea.style.backgroundImage = `
            linear-gradient(90deg, transparent 33%, ${patternColor}40 33%, ${patternColor}40 66%, transparent 66%),
            linear-gradient(transparent 33%, ${patternColor}40 33%, ${patternColor}40 66%, transparent 66%)
        `;
        wallArea.style.backgroundSize = '12px 12px';
    }
}

// 应用地板样式
function applyCabinFloorStyle() {
    const floorArea = document.getElementById('cabin-floor-area');
    if (!floorArea) return;
    
    floorArea.style.backgroundColor = cabinRoomState.floorColor || '#fefefe';
    
    if (cabinRoomState.floorStyle === 'solid') {
        floorArea.style.backgroundImage = 'none';
    } else if (cabinRoomState.floorStyle === 'pattern1') {
        const patternColor = (cabinRoomState.floorPatternColor || cabinRoomState.floorColor) + '40';
        floorArea.style.backgroundImage = `
            linear-gradient(90deg, ${patternColor} 1px, transparent 1px),
            linear-gradient(${patternColor} 1px, transparent 1px)
        `;
        floorArea.style.backgroundSize = '32px 32px';
    } else if (cabinRoomState.floorStyle === 'pattern2') {
        const patternColor = cabinRoomState.floorPatternColor || cabinRoomState.floorColor;
        floorArea.style.backgroundImage = `
            linear-gradient(90deg, transparent 33%, ${patternColor}40 33%, ${patternColor}40 66%, transparent 66%),
            linear-gradient(transparent 33%, ${patternColor}40 33%, ${patternColor}40 66%, transparent 66%)
        `;
        floorArea.style.backgroundSize = '12px 12px';
    }
}

function moveCabinUserCharacter(direction) {
    alert('角色移动功能开发中：' + direction);
}

function filterCabinInventory(category) {
    // 更新按钮激活状态
    const buttons = document.querySelectorAll('.cabin-filter-btn');
    buttons.forEach(btn => btn.classList.remove('active'));
    event.currentTarget.classList.add('active');
    
    // 这里将来会实现实际的过滤逻辑
    console.log('过滤分类：' + category);
}

// 初始化默认家具
function initDefaultItems() {
    const state = window.cabinGachaState;
    
    // 如果已经有物品，不重复添加
    if (Object.keys(state.customItems).length > 0) {
        return;
    }
    
    // 添加初始物品
    const DEFAULT_FURNITURE = {
        'bed_01': { 
            name: "草莓床", 
            svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
                <rect x="10" y="30" width="44" height="20" fill="#FFB3C1" stroke="#999999" stroke-width="2"/>
                <rect x="12" y="32" width="40" height="16" fill="#FFF5F7"/>
                <rect x="14" y="34" width="4" height="4" fill="#FFFFFF"/>
                <rect x="22" y="34" width="4" height="4" fill="#FFFFFF"/>
                <rect x="30" y="34" width="4" height="4" fill="#FFFFFF"/>
                <rect x="38" y="34" width="4" height="4" fill="#FFFFFF"/>
                <rect x="46" y="34" width="4" height="4" fill="#FFFFFF"/>
                <rect x="14" y="24" width="14" height="10" fill="#FFFFFF" stroke="#CCCCCC" stroke-width="2"/>
                <rect x="16" y="26" width="10" height="6" fill="#F0F0F0" rx="2"/>
                <rect x="16" y="22" width="10" height="2" fill="#FFE4E9"/>
            </svg>`,
            rarity: "R",
            inPool: true,
            type: "furniture",
            width: 3,
            height: 2
        },
        'table_01': { 
            name: "像素桌", 
            svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
                <rect x="12" y="32" width="40" height="10" fill="#F5F5F5" stroke="#999999" stroke-width="2"/>
                <rect x="14" y="34" width="36" height="6" fill="#FAFAFA" rx="1"/>
                <rect x="16" y="36" width="32" height="2" fill="#FFFFFF"/>
                <rect x="16" y="42" width="6" height="14" fill="#CCCCCC"/>
                <rect x="20" y="44" width="2" height="12" fill="#B0B0B0"/>
                <rect x="42" y="42" width="6" height="14" fill="#CCCCCC"/>
                <rect x="46" y="44" width="2" height="12" fill="#B0B0B0"/>
                <rect x="15" y="55" width="8" height="2" fill="#999999"/>
                <rect x="41" y="55" width="8" height="2" fill="#999999"/>
                <circle cx="32" cy="36" r="2" fill="#FFE4E9"/>
                <circle cx="38" cy="36" r="2" fill="#E8E8E8"/>
                <circle cx="26" cy="36" r="2" fill="#F0F0F0"/>
            </svg>`,
            rarity: "R",
            inPool: true,
            type: "furniture",
            width: 2,
            height: 2
        },
        'plant_01': { 
            name: "爱心草", 
            svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
                <rect x="24" y="40" width="16" height="16" fill="#FFE4E9" stroke="#CCCCCC" stroke-width="2" rx="2"/>
                <rect x="26" y="42" width="12" height="12" fill="#FFF5F7" rx="1"/>
                <rect x="28" y="44" width="8" height="2" fill="#FFFFFF"/>
                <rect x="28" y="48" width="8" height="2" fill="#FFFFFF"/>
                <rect x="31" y="30" width="2" height="10" fill="#B0B0B0"/>
                <polygon points="30,28 34,28 32,24" fill="#999999"/>
                <polygon points="28,32 30,32 29,30" fill="#CCCCCC"/>
                <polygon points="34,32 36,32 35,30" fill="#CCCCCC"/>
                <path d="M32,22 Q34,20 36,22 Q38,24 36,26 Q34,28 32,30 Q30,28 28,26 Q26,24 28,22 Q30,20 32,22" fill="#FFB3C1"/>
                <circle cx="32" cy="24" r="1" fill="#FFFFFF"/>
                <circle cx="34" cy="26" r="1" fill="#FFFFFF"/>
                <circle cx="30" cy="26" r="1" fill="#FFFFFF"/>
            </svg>`,
            rarity: "SR",
            inPool: true,
            type: "decor",
            width: 1,
            height: 1
        },
        'painting_01': {
            name: "像素画",
            svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
                <rect x="15" y="15" width="34" height="34" fill="#F5F5F5" stroke="#CCCCCC" stroke-width="3" rx="3"/>
                <rect x="18" y="18" width="28" height="28" fill="#FFFFFF" rx="2"/>
                <rect x="20" y="20" width="24" height="24" fill="#FAFAFA" rx="1"/>
                <rect x="20" y="36" width="24" height="8" fill="#E8E8E8" rx="1"/>
                <polygon points="26,36 30,32 34,36" fill="#D0D0D0"/>
                <polygon points="30,36 34,30 38,36" fill="#CCCCCC"/>
                <circle cx="44" cy="24" r="4" fill="#FFE4E9"/>
                <rect x="44" y="20" width="1" height="2" fill="#FFB3C1"/>
                <rect x="44" y="28" width="1" height="2" fill="#FFB3C1"/>
                <rect x="40" y="23" width="2" height="1" fill="#FFB3C1"/>
                <rect x="48" y="23" width="2" height="1" fill="#FFB3C1"/>
                <rect x="24" y="26" width="8" height="4" fill="#FFFFFF" rx="2"/>
                <rect x="26" y="24" width="4" height="2" fill="#FFFFFF" rx="1"/>
                <circle cx="20" cy="20" r="1" fill="#FFB3C1"/>
                <circle cx="44" cy="20" r="1" fill="#FFB3C1"/>
                <circle cx="20" cy="44" r="1" fill="#FFB3C1"/>
                <circle cx="44" cy="44" r="1" fill="#FFB3C1"/>
            </svg>`,
            rarity: "R",
            inPool: true,
            type: "wall",
            width: 1,
            height: 1
        },
        'rug_01': {
            name: "毛绒地毯",
            svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
                <rect x="10" y="10" width="44" height="44" fill="#F0F0F0" stroke="#CCCCCC" stroke-width="2" rx="5"/>
                <rect x="12" y="12" width="40" height="40" fill="#FAFAFA" rx="3"/>
                <circle cx="32" cy="32" r="12" fill="#FFF5F7" opacity="0.6"/>
                <circle cx="32" cy="32" r="8" fill="#FFFFFF" opacity="0.8"/>
                <path d="M32,24 Q36,28 32,32 Q28,36 32,40 Q36,36 40,32 Q36,28 32,24" fill="#FFE4E9" opacity="0.5"/>
                <rect x="14" y="14" width="4" height="4" fill="#E8E8E8" rx="1"/>
                <rect x="46" y="14" width="4" height="4" fill="#E8E8E8" rx="1"/>
                <rect x="14" y="46" width="4" height="4" fill="#E8E8E8" rx="1"/>
                <rect x="46" y="46" width="4" height="4" fill="#E8E8E8" rx="1"/>
            </svg>`,
            rarity: "SR",
            inPool: true,
            type: "floor",
            width: 3,
            height: 2
        }
    };
    
    // 添加默认物品到状态
    Object.keys(DEFAULT_FURNITURE).forEach(id => {
        state.customItems[id] = DEFAULT_FURNITURE[id];
        if (!state.catalog[id]) {
            state.catalog[id] = { seen: false, owned: false };
        }
        // 添加到背包
        state.inventory[id] = (state.inventory[id] || 0) + 1;
        // 标记为已拥有
        state.catalog[id].owned = true;
    });
    
    // 保存状态
    saveCabinGachaData();
    console.log('默认家具已初始化');
}

// 更新背包显示
function updateCabinInventoryDisplay() {
    // 如果有背包UI元素，在这里更新
    // 暂时保留此函数以备后续使用
}

// 打开图鉴
function openCatalogModal() {
    const modal = document.getElementById('catalog-modal');
    if (modal) {
        modal.style.display = 'flex';
        renderCatalogItems();
    }
}

// 关闭图鉴
function closeCatalogModal() {
    const modal = document.getElementById('catalog-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// 切换图鉴标签
let currentCatalogTab = 'all';
function switchCatalogTab(tab) {
    currentCatalogTab = tab;
    const tabs = document.querySelectorAll('.catalog-tab');
    tabs.forEach(t => {
        t.classList.remove('active');
        t.style.background = '#ffffff';
    });
    event.currentTarget.classList.add('active');
    event.currentTarget.style.background = '#fff5f7';
    renderCatalogItems();
}

// 过滤图鉴物品稀有度
let currentCatalogRarity = 'all';
function filterCatalogItems(rarity) {
    currentCatalogRarity = rarity;
    const buttons = document.querySelectorAll('.rarity-filter-btn');
    buttons.forEach(btn => btn.classList.remove('active'));
    event.currentTarget.classList.add('active');
    renderCatalogItems();
}

// 渲染图鉴物品
function renderCatalogItems() {
    const catalogGrid = document.getElementById('catalog-items');
    const catalogInfo = document.getElementById('catalog-info');
    
    if (!catalogGrid) return;
    
    const state = window.cabinGachaState;
    catalogGrid.innerHTML = '';
    
    // 获取所有物品
    const allItems = Object.keys(state.customItems).map(id => ({
        id,
        ...state.customItems[id],
        catalogData: state.catalog[id] || { seen: false, owned: false }
    }));
    
    // 按标签过滤
    let filteredItems = allItems;
    if (currentCatalogTab === 'owned') {
        filteredItems = allItems.filter(item => item.catalogData.owned);
    } else if (currentCatalogTab === 'missing') {
        filteredItems = allItems.filter(item => !item.catalogData.owned);
    }
    
    // 按稀有度过滤
    if (currentCatalogRarity !== 'all') {
        filteredItems = filteredItems.filter(item => 
            item.rarity.toUpperCase() === currentCatalogRarity.toUpperCase()
        );
    }
    
    // 渲染物品
    filteredItems.forEach(item => {
        const itemDiv = document.createElement('div');
        itemDiv.style.cssText = `
            background: ${item.catalogData.owned ? '#fff5f7' : '#f5f5f5'};
            border: 3px solid ${item.catalogData.owned ? '#ffb3c1' : '#e0e0e0'};
            border-radius: 8px;
            padding: 10px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            position: relative;
            cursor: pointer;
        `;
        
        // SVG图标
        const svgDiv = document.createElement('div');
        svgDiv.innerHTML = item.svg;
        svgDiv.style.cssText = 'width: 40px; height: 40px; margin-bottom: 5px;';
        itemDiv.appendChild(svgDiv);
        
        // 名称
        const nameDiv = document.createElement('div');
        nameDiv.textContent = item.name;
        nameDiv.style.cssText = 'font-size: 8px; color: #999999; text-align: center; margin-bottom: 3px;';
        itemDiv.appendChild(nameDiv);
        
        // 稀有度
        const rarityDiv = document.createElement('div');
        rarityDiv.textContent = item.rarity;
        rarityDiv.style.cssText = `
            font-size: 7px;
            padding: 1px 4px;
            border-radius: 3px;
            font-weight: bold;
            color: #999999;
            background: ${item.rarity === 'SSR' ? '#fff9e6' : item.rarity === 'SR' ? '#fff5f7' : '#f0f0f0'};
        `;
        itemDiv.appendChild(rarityDiv);
        
        // 拥有数量（如果已拥有）
        if (item.catalogData.owned) {
            const count = state.inventory[item.id] || 0;
            if (count > 0) {
                const countDiv = document.createElement('div');
                countDiv.textContent = `×${count}`;
                countDiv.style.cssText = `
                    position: absolute;
                    top: 5px;
                    right: 5px;
                    font-size: 8px;
                    padding: 2px 5px;
                    background: #ffb3c1;
                    color: white;
                    border-radius: 10px;
                    font-weight: bold;
                `;
                itemDiv.appendChild(countDiv);
            }
        }
        
        catalogGrid.appendChild(itemDiv);
    });
    
    // 更新统计信息
    if (catalogInfo) {
        const total = allItems.length;
        const owned = allItems.filter(item => item.catalogData.owned).length;
        const rate = total > 0 ? Math.round((owned / total) * 100) : 0;
        
        document.getElementById('catalog-total').textContent = total;
        document.getElementById('catalog-owned').textContent = owned;
        document.getElementById('catalog-rate').textContent = rate + '%';
    }
}

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', function() {
    // 小屋数据在首次打开小屋页面时初始化（见 showCabinPage 函数）
    // 这里不需要提前初始化
});

// ==================== 情侣空间功能 ====================
let selectedAccountId = null;
let selectedFriendId = null;
let currentPet = null;

async function showCoupleSpacePage() {
    document.getElementById('home-page').style.display = 'none';
    document.getElementById('couple-space-page').style.display = 'block';
    
    // 加载账号列表
    await loadCoupleAccountList();
}

function hideCoupleSpacePage() {
    document.getElementById('couple-space-page').style.display = 'none';
    document.getElementById('home-page').style.display = 'block';
    
    // 重置状态
    document.getElementById('couple-select-account').style.display = 'flex';
    document.getElementById('couple-select-friend').style.display = 'none';
    document.getElementById('couple-room-area').style.display = 'none';
    selectedAccountId = null;
    selectedFriendId = null;
    currentPet = null;
    isPetHatched = false;
    isPetting = false;
    lastPetTime = 0;
    if (petTimeout) {
        clearTimeout(petTimeout);
        petTimeout = null;
    }
}

// 加载账号列表（user类型的角色）
async function loadCoupleAccountList() {
    const accounts = await db.characters.where('type').equals('user').toArray();
    const listContainer = document.getElementById('couple-account-list');
    listContainer.innerHTML = '';
    
    if (accounts.length === 0) {
        listContainer.innerHTML = '<div style="text-align: center; color: #999;">暂无账号，请先创建用户账号</div>';
        return;
    }
    
    accounts.forEach(account => {
        const accountItem = document.createElement('div');
        accountItem.style.cssText = `
            background: white;
            border: 2px solid #ff9ed2;
            border-radius: 12px;
            padding: 15px;
            display: flex;
            align-items: center;
            gap: 15px;
            cursor: pointer;
            transition: transform 0.2s;
        `;
        
        accountItem.onmouseover = () => accountItem.style.transform = 'scale(1.02)';
        accountItem.onmouseout = () => accountItem.style.transform = 'scale(1)';
        accountItem.onclick = () => selectCoupleAccount(account.id);
        
        // 头像
        const avatar = document.createElement('div');
        avatar.style.cssText = `
            width: 50px;
            height: 50px;
            border-radius: 50%;
            background: ${account.avatar ? `url(${account.avatar}) center/cover` : '#ffdef2'};
            flex-shrink: 0;
        `;
        
        // 名字
        const name = document.createElement('div');
        name.textContent = account.name;
        name.style.cssText = 'font-size: 16px; color: #333; font-weight: bold;';
        
        accountItem.appendChild(avatar);
        accountItem.appendChild(name);
        listContainer.appendChild(accountItem);
    });
}

// 选择账号
async function selectCoupleAccount(accountId) {
    selectedAccountId = accountId;
    document.getElementById('couple-select-account').style.display = 'none';
    document.getElementById('couple-select-friend').style.display = 'flex';
    
    // 加载该账号的好友列表
    await loadCoupleFriendList(accountId);
}

// 返回账号选择
function backToCoupleAccountSelect() {
    document.getElementById('couple-select-friend').style.display = 'none';
    document.getElementById('couple-select-account').style.display = 'flex';
    selectedAccountId = null;
}

// 加载好友列表
async function loadCoupleFriendList(accountId) {
    // 使用和微信列表相同的逻辑获取好友
    let allChars = await db.characters.toArray();
    let friends = allChars.filter(c => {
        if (c.type === 'user') return false; // 排除User类型
        const status = getFriendStatus(c, accountId);
        return status === 'friend' || status === 'deleted' || status === 'blocked'; // 包括已删除和已拉黑的好友
    });
    
    const listContainer = document.getElementById('couple-friend-list');
    listContainer.innerHTML = '';
    
    if (friends.length === 0) {
        listContainer.innerHTML = '<div style="text-align: center; color: #999;">该账号暂无好友</div>';
        return;
    }
    
    friends.forEach(friend => {
        if (!friend) return;
        
        const friendItem = document.createElement('div');
        friendItem.style.cssText = `
            background: white;
            border: 2px solid #ff9ed2;
            border-radius: 12px;
            padding: 15px;
            display: flex;
            align-items: center;
            gap: 15px;
            cursor: pointer;
            transition: transform 0.2s;
        `;
        
        friendItem.onmouseover = () => friendItem.style.transform = 'scale(1.02)';
        friendItem.onmouseout = () => friendItem.style.transform = 'scale(1)';
        friendItem.onclick = () => selectCoupleFriend(friend.id);
        
        // 头像
        const avatar = document.createElement('div');
        avatar.style.cssText = `
            width: 50px;
            height: 50px;
            border-radius: 50%;
            background: ${friend.avatar ? `url(${friend.avatar}) center/cover` : '#ffdef2'};
            flex-shrink: 0;
        `;
        
        // 名字
        const name = document.createElement('div');
        name.textContent = friend.name;
        name.style.cssText = 'font-size: 16px; color: #333; font-weight: bold;';
        
        friendItem.appendChild(avatar);
        friendItem.appendChild(name);
        listContainer.appendChild(friendItem);
    });
}

// 选择好友
function selectCoupleFriend(friendId) {
    selectedFriendId = friendId;
    document.getElementById('couple-select-friend').style.display = 'none';
    document.getElementById('couple-room-area').style.display = 'block';
}

// 显示领养宠物模态框
function showAdoptPetModal() {
    document.getElementById('adopt-pet-modal').style.display = 'flex';
}

// 关闭领养宠物模态框
function closeAdoptPetModal() {
    document.getElementById('adopt-pet-modal').style.display = 'none';
}

// 领养宠物
function adoptPet(petType) {
    closeAdoptPetModal();
    document.getElementById('adopt-pet-btn').style.display = 'none';
    document.getElementById('pet-hint').textContent = '点击孵化你的宠物';
    
    currentPet = petType;
    createPetContainer(petType);
}

// 创建宠物容器
function createPetContainer(petType) {
    const container = document.getElementById('pet-container');
    container.innerHTML = '';
    
    const stage = document.createElement('div');
    stage.id = 'pet-stage-container';
    stage.style.cssText = 'width: 256px; height: 256px; cursor: pointer; position: relative; touch-action: none;';
    
    if (petType === 'seal') {
        stage.innerHTML = createSealEgg();
        stage.onclick = () => hatchPet('seal', stage);
    } else if (petType === 'cat') {
        stage.innerHTML = createCatBox();
        stage.onclick = () => hatchPet('cat', stage);
    } else if (petType === 'dog') {
        stage.innerHTML = createDogHouse();
        stage.onclick = () => hatchPet('dog', stage);
    }
    
    container.appendChild(stage);
}

// 宠物状态
let isPetHatched = false;
let isPetting = false;
let lastPetTime = 0;
let petTimeout = null;

// 孵化宠物
function hatchPet(petType, stage) {
    stage.style.animation = 'shake 0.5s';
    
    setTimeout(() => {
        stage.innerHTML = '';
        
        if (petType === 'seal') {
            stage.innerHTML = createSealPet();
        } else if (petType === 'cat') {
            stage.innerHTML = createCatPet();
        } else if (petType === 'dog') {
            stage.innerHTML = createDogPet();
        }
        
        stage.style.animation = 'popUp 0.6s';
        stage.onclick = null;
        
        isPetHatched = true;
        document.getElementById('pet-hint').textContent = '滑动抚摸宠物';
        
        // 添加抚摸事件监听
        setupPettingEvents(stage);
    }, 500);
}

// 设置抚摸事件
function setupPettingEvents(stage) {
    // 阻止触摸滚动
    stage.addEventListener('touchmove', (e) => {
        e.preventDefault();
        handlePet(e);
    }, { passive: false });
    
    // 鼠标移动抚摸
    stage.addEventListener('mousemove', handlePet);
    
    // 触摸开始
    stage.addEventListener('touchstart', (e) => {
        e.preventDefault();
        handlePet(e);
    }, { passive: false });
}

// 处理抚摸
function handlePet(e) {
    if (!isPetHatched) return;
    
    const now = Date.now();
    if (now - lastPetTime < 50) return;
    lastPetTime = now;
    
    if (!isPetting) {
        startPetting();
    }
    
    clearTimeout(petTimeout);
    petTimeout = setTimeout(stopPetting, 200);
    
    // 随机生成爱心效果
    if (Math.random() > 0.85) {
        spawnHeartEffect(e);
    }
}

// 开始抚摸
function startPetting() {
    isPetting = true;
    const stage = document.getElementById('pet-stage-container');
    if (stage) {
        stage.classList.add('is-petting');
        document.getElementById('pet-hint').textContent = '好舒服...';
    }
}

// 停止抚摸
function stopPetting() {
    isPetting = false;
    const stage = document.getElementById('pet-stage-container');
    if (stage) {
        stage.classList.remove('is-petting');
        document.getElementById('pet-hint').textContent = '滑动抚摸宠物';
    }
}

// 生成爱心效果
function spawnHeartEffect(e) {
    const stage = document.getElementById('pet-stage-container');
    if (!stage) return;
    
    const heart = document.createElement('div');
    heart.style.cssText = `
        position: absolute;
        width: 12px;
        height: 12px;
        background: #ff6b6b;
        clip-path: polygon(20% 0%, 40% 0%, 50% 20%, 60% 0%, 80% 0%, 100% 20%, 100% 50%, 50% 100%, 0% 50%, 0% 20%);
        pointer-events: none;
        z-index: 1000;
    `;
    
    const rect = stage.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    
    const x = clientX - rect.left - 6 + (Math.random() * 20 - 10);
    const y = clientY - rect.top - 20;
    
    heart.style.left = `${x}px`;
    heart.style.top = `${y}px`;
    
    stage.appendChild(heart);
    
    heart.animate([
        { transform: 'translateY(0) scale(0.5)', opacity: 1 },
        { transform: 'translateY(-40px) scale(1.2)', opacity: 0 }
    ], { duration: 800, fill: 'forwards' });
    
    setTimeout(() => heart.remove(), 800);
}

// 创建海豹蛋
function createSealEgg() {
    return `
        <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" style="width: 100%; height: 100%;">
            <rect x="18" y="54" width="28" height="4" fill="#a0c0e0" opacity="0.6"/>
            <path d="M24 16 H40 V17 H44 V18 H46 V20 H48 V24 H50 V44 H48 V50 H46 V52 H42 V54 H22 V52 H18 V50 H16 V44 H14 V24 H16 V20 H18 V18 H20 V17 H24 Z" fill="#4a4a4a" />
            <rect x="24" y="17" width="16" height="35" fill="#ffffff"/>
            <rect x="20" y="18" width="24" height="34" fill="#ffffff"/>
            <rect x="18" y="20" width="28" height="30" fill="#ffffff"/>
            <rect x="16" y="24" width="32" height="20" fill="#ffffff"/>
            <rect x="18" y="44" width="28" height="6" fill="#ffffff"/>
            <rect x="22" y="50" width="20" height="2" fill="#ffffff"/>
            <rect x="28" y="24" width="2" height="2" fill="#d0d0d0" />
            <rect x="36" y="20" width="1" height="1" fill="#d0d0d0" />
            <rect x="42" y="30" width="2" height="2" fill="#d0d0d0" />
        </svg>
    `;
}

// 创建猫箱子
function createCatBox() {
    return `
        <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" style="width: 100%; height: 100%;">
            <rect x="16" y="56" width="32" height="4" fill="#8b6f47" opacity="0.3"/>
            <path d="M12 24 H52 V26 H54 V54 H52 V56 H12 V54 H10 V26 H12 Z" fill="#d2691e"/>
            <rect x="12" y="26" width="40" height="28" fill="#cd853f"/>
            <rect x="16" y="30" width="32" height="20" fill="#daa520"/>
            <path d="M26 34 H38 V36 H40 V44 H38 V46 H26 V44 H24 V36 H26 Z" fill="#4a4a4a"/>
            <rect x="28" y="36" width="8" height="8" fill="#2a2a2a"/>
            <rect x="20" y="28" width="2" height="2" fill="#8b4513"/>
            <rect x="42" y="28" width="2" height="2" fill="#8b4513"/>
            <rect x="20" y="48" width="2" height="2" fill="#8b4513"/>
            <rect x="42" y="48" width="2" height="2" fill="#8b4513"/>
        </svg>
    `;
}

// 创建狗窝
function createDogHouse() {
    return `
        <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" style="width: 100%; height: 100%;">
            <rect x="16" y="56" width="32" height="4" fill="#8b6f47" opacity="0.3"/>
            <path d="M32 12 L10 32 H12 V54 H52 V32 H54 Z" fill="#d2691e"/>
            <rect x="14" y="32" width="36" height="22" fill="#cd853f"/>
            <path d="M24 38 H40 V40 H42 V52 H40 V54 H24 V52 H22 V40 H24 Z" fill="#4a4a4a"/>
            <rect x="26" y="40" width="12" height="12" fill="#2a2a2a"/>
            <path d="M32 14 L12 30 H16 L32 18 L48 30 H52 Z" fill="#a0522d"/>
        </svg>
    `;
}

// 创建海豹宠物
function createSealPet() {
    return `
        <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" style="width: 100%; height: 100%; animation: sealFloat 2s infinite ease-in-out;">
            <rect x="18" y="48" width="28" height="4" fill="#a0c0e0" opacity="0.6"/>
            <path d="M20 20 H44 V21 H48 V22 H50 V24 H52 V38 H50 V42 H48 V44 H44 V45 H20 V44 H16 V42 H14 V38 H12 V24 H14 V22 H16 V21 H20 Z" fill="#4a4a4a"/>
            <rect x="20" y="21" width="24" height="23" fill="#ffffff"/>
            <rect x="16" y="22" width="32" height="21" fill="#ffffff"/>
            <rect x="14" y="24" width="36" height="17" fill="#ffffff"/>
            <rect x="20" y="30" width="3" height="3" fill="#2a2a2a"/>
            <rect x="36" y="30" width="3" height="3" fill="#2a2a2a"/>
            <rect x="29" y="34" width="1" height="2" fill="#4a4a4a"/>
            <rect x="28" y="36" width="3" height="1" fill="#4a4a4a"/>
            <rect x="16" y="32" width="1" height="1" fill="#ffb7b2"/>
            <rect x="42" y="32" width="1" height="1" fill="#ffb7b2"/>
            <g style="transform-origin: 52px 32px; animation: tailWag 0.4s infinite alternate;">
                <path d="M52 30 H56 V32 H57 V35 H56 V37 H52 Z" fill="#4a4a4a"/>
                <rect x="52" y="31" width="4" height="5" fill="#ffffff"/>
            </g>
        </svg>
    `;
}

// 创建猫宠物
function createCatPet() {
    return `
        <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" style="width: 100%; height: 100%; animation: catFloat 2s infinite ease-in-out;">
            <rect x="20" y="50" width="24" height="4" fill="#8b6f47" opacity="0.3"/>
            <g style="animation: catEarWiggle 1s infinite alternate;">
                <path d="M18 18 H22 V20 H24 V26 H22 V24 H20 V22 H18 Z" fill="#ff9966"/>
                <rect x="20" y="20" width="2" height="4" fill="#ffb380"/>
                <path d="M42 18 H46 V22 H44 V24 H42 V26 H40 V20 H42 Z" fill="#ff9966"/>
                <rect x="42" y="20" width="2" height="4" fill="#ffb380"/>
            </g>
            <path d="M20 24 H44 V26 H46 V40 H44 V42 H42 V44 H22 V42 H20 V40 H18 V26 H20 Z" fill="#4a4a4a"/>
            <rect x="20" y="26" width="24" height="14" fill="#ff9966"/>
            <rect x="18" y="28" width="28" height="10" fill="#ff9966"/>
            <rect x="24" y="30" width="3" height="3" fill="#2a2a2a"/>
            <rect x="37" y="30" width="3" height="3" fill="#2a2a2a"/>
            <rect x="25" y="30" width="1" height="1" fill="#ffffff" opacity="0.8"/>
            <rect x="38" y="30" width="1" height="1" fill="#ffffff" opacity="0.8"/>
            <rect x="30" y="34" width="1" height="2" fill="#4a4a4a"/>
            <rect x="29" y="36" width="3" height="1" fill="#4a4a4a"/>
            <rect x="33" y="34" width="1" height="1" fill="#4a4a4a"/>
            <path d="M28 38 L26 40 H28 Z" fill="#4a4a4a"/>
            <path d="M36 38 L38 40 H36 Z" fill="#4a4a4a"/>
            <rect x="22" y="32" width="1" height="1" fill="#ffb7b2"/>
            <rect x="41" y="32" width="1" height="1" fill="#ffb7b2"/>
            <g style="animation: tailSway 0.8s infinite alternate;">
                <path d="M44 36 H46 V38 H48 V42 H50 V46 H48 V44 H46 V40 H44 Z" fill="#ff9966"/>
            </g>
        </svg>
    `;
}

// 创建狗宠物
function createDogPet() {
    return `
        <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" style="width: 100%; height: 100%; animation: dogFloat 2s infinite ease-in-out;">
            <rect x="20" y="50" width="24" height="4" fill="#8b6f47" opacity="0.3"/>
            <g style="animation: dogEarFlop 1.2s infinite alternate;">
                <path d="M16 24 H18 V26 H20 V32 H18 V28 H16 Z" fill="#8b4513"/>
                <rect x="17" y="26" width="2" height="4" fill="#a0522d"/>
                <path d="M46 24 H48 V28 H46 V32 H44 V26 H46 Z" fill="#8b4513"/>
                <rect x="45" y="26" width="2" height="4" fill="#a0522d"/>
            </g>
            <path d="M18 26 H46 V28 H48 V40 H46 V42 H44 V44 H20 V42 H18 V40 H16 V28 H18 Z" fill="#4a4a4a"/>
            <rect x="18" y="28" width="28" height="12" fill="#d2691e"/>
            <rect x="16" y="30" width="32" height="8" fill="#d2691e"/>
            <rect x="22" y="32" width="3" height="3" fill="#2a2a2a"/>
            <rect x="39" y="32" width="3" height="3" fill="#2a2a2a"/>
            <rect x="23" y="32" width="1" height="1" fill="#ffffff" opacity="0.8"/>
            <rect x="40" y="32" width="1" height="1" fill="#ffffff" opacity="0.8"/>
            <path d="M28 36 H36 V38 H34 V40 H30 V38 H28 Z" fill="#4a4a4a"/>
            <rect x="30" y="38" width="4" height="2" fill="#ff6b9d"/>
            <rect x="31" y="36" width="2" height="1" fill="#2a2a2a"/>
            <rect x="20" y="34" width="1" height="1" fill="#ffb7b2"/>
            <rect x="43" y="34" width="1" height="1" fill="#ffb7b2"/>
            <g style="animation: tailWag 0.3s infinite alternate;">
                <path d="M46 34 H48 V36 H50 V40 H52 V38 H50 V36 H48 V34 H46 Z" fill="#d2691e"/>
            </g>
        </svg>
    `;
}

// ============================================
// AI查岗功能
// ============================================

// 全局变量：标记账号是否下线
let isAccountOffline = false;
let offlineAutoCloseTimer = null; // 自动关闭定时器

// 显示账号下线遮罩
function showAccountOfflineMask(reason = "你的账号在另一台设备登录") {
    isAccountOffline = true;
    const mask = document.getElementById('account-offline-mask');
    const reasonText = document.getElementById('offline-reason-text');
    if (mask) {
        mask.style.display = 'flex';
        if (reasonText) {
            reasonText.textContent = reason;
        }
    }
    
    // 清除之前的定时器
    if (offlineAutoCloseTimer) {
        clearTimeout(offlineAutoCloseTimer);
    }
}

// 隐藏账号下线遮罩（重新登录）
function reconnectAccount() {
    isAccountOffline = false;
    const mask = document.getElementById('account-offline-mask');
    if (mask) {
        mask.style.display = 'none';
    }
    
    // 清除自动关闭定时器
    if (offlineAutoCloseTimer) {
        clearTimeout(offlineAutoCloseTimer);
        offlineAutoCloseTimer = null;
    }
}

// 自动关闭下线遮罩（AI查岗完成后调用）
function autoCloseOfflineMask(delaySeconds = 4) {
    console.log(`[账号下线] 将在${delaySeconds}秒后自动恢复登录`);
    
    // 清除之前的定时器
    if (offlineAutoCloseTimer) {
        clearTimeout(offlineAutoCloseTimer);
    }
    
    // 设置新的定时器
    offlineAutoCloseTimer = setTimeout(() => {
        console.log('[账号下线] 自动恢复登录');
        reconnectAccount();
        showToast('账号已自动重新登录');
    }, delaySeconds * 1000);
}

// 显示密码错误弹窗
function showPasswordErrorModal() {
    console.log('[密码错误] 显示警告弹窗');
    const modal = document.getElementById('password-error-modal');
    if (modal) {
        modal.style.display = 'flex';
    }
}

// 关闭密码错误弹窗
function closePasswordErrorModal() {
    console.log('[密码错误] 关闭警告弹窗');
    const modal = document.getElementById('password-error-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// 生成随机手机号（7位数字）
function generateRandomPhone() {
    const phone = Math.floor(1000000 + Math.random() * 9000000); // 1000000-9999999
    return String(phone);
}

// 显示手机号分配弹窗
function showPhoneAssignedModal(phoneNumber) {
    console.log('[手机号分配] 显示弹窗:', phoneNumber);
    const modal = document.getElementById('phone-assigned-modal');
    const phoneText = document.getElementById('assigned-phone-number');
    
    if (modal && phoneText) {
        phoneText.textContent = phoneNumber;
        modal.style.display = 'flex';
    }
}

// 关闭手机号分配弹窗
function closePhoneAssignedModal() {
    console.log('[手机号分配] 关闭弹窗');
    const modal = document.getElementById('phone-assigned-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// 显示验证码弹窗
function showVerificationCodeModal(code) {
    console.log('[验证码弹窗] 🎯 显示验证码通知:', code);
    
    // 🎯 使用和角色发消息一样的通知样式
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%) translateY(-100px);
        width: 90%;
        height: auto;
        min-height: 60px;
        background: rgba(255, 255, 255, 0.95);
        backdrop-filter: blur(10px);
        border-radius: 12px;
        display: flex;
        align-items: center;
        padding: 12px;
        gap: 12px;
        z-index: 99999;
        transition: transform 0.3s ease;
        border: 1px solid rgba(0,0,0,0.1);
        box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    `;
    
    // 验证码高亮显示
    const codeDisplay = `
        <div style="background:linear-gradient(135deg, #E8F5E9 0%, #C8E6C9 100%); border-radius:8px; padding:8px 12px; font-size:20px; font-weight:700; color:#4CAF50; letter-spacing:4px; font-family:'Courier New', monospace; text-align:center;">
            ${code}
        </div>
    `;
    
    notification.innerHTML = `
        <div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg, #FFB6C1 0%, #FFC0CB 100%);display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 2px 8px rgba(255,182,193,0.3);">
            <svg viewBox="0 0 24 24" style="width:24px;height:24px;stroke:#fff;fill:none;stroke-width:2.5;">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
        </div>
        <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                <span style="font-size:15px;font-weight:600;color:#333;">欢迎小助手</span>
                <span style="font-size:12px;color:#999;">刚刚</span>
            </div>
            <div style="font-size:13px;color:#666;margin-bottom:6px;">【微信验证码】您的验证码是：</div>
            ${codeDisplay}
            <div style="font-size:11px;color:#999;margin-top:6px;">5分钟内有效，请勿泄露</div>
        </div>
        <svg viewBox="0 0 24 24" style="width:20px;height:20px;stroke:#007AFF;fill:none;flex-shrink:0;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
    `;
    
    document.body.appendChild(notification);
    
    // 显示动画
    setTimeout(() => {
        notification.style.transform = 'translateX(-50%) translateY(0)';
    }, 10);
    
    // 3秒后自动消失
    setTimeout(() => {
        notification.style.transform = 'translateX(-50%) translateY(-100px)';
        setTimeout(() => {
            if (document.body.contains(notification)) {
                document.body.removeChild(notification);
            }
        }, 300);
    }, 3000);
    
    console.log('[验证码弹窗] ✅ 验证码通知已显示！验证码:', code);
}

// 测试函数：手动测试验证码弹窗
window.testVerificationModal = function() {
    console.log('=== 手动测试验证码通知 ===');
    showVerificationCodeModal('123456');
};

// 关闭验证码弹窗
function closeVerificationCodeModal() {
    console.log('[验证码弹窗] 关闭');
    const modal = document.getElementById('verification-code-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// ==================== 微信注册流程 ====================

let generatedVerificationCode = ''; // 存储生成的验证码
let verificationCodeExpiry = 0; // 验证码过期时间
let selectedUserPhone = ''; // 选中User的手机号

// 当User选择改变时
function onRegisterUserChange() {
    const selectElem = document.getElementById('register-user-select');
    const selectedUserId = selectElem.value;
    const phoneInput = document.getElementById('register-phone-input');
    const phoneHint = document.getElementById('register-phone-hint');
    
    if (!selectedUserId) {
        phoneInput.value = '';
        phoneHint.style.display = 'none';
        selectedUserPhone = '';
        return;
    }
    
    // 从档案中获取User的手机号
    db.characters.get(parseInt(selectedUserId)).then(user => {
        if (user && user.identity && user.identity.phone) {
            selectedUserPhone = user.identity.phone;
            phoneInput.value = selectedUserPhone;
            phoneHint.style.display = 'block';
        }
    });
}

// 发送验证码（模拟）
async function sendRegisterCode() {
    const selectElem = document.getElementById('register-user-select');
    const selectedUserId = selectElem.value;
    const phoneInput = document.getElementById('register-phone-input').value.trim();
    const codeBtn = document.getElementById('register-code-btn');
    const codeMessage = document.getElementById('register-code-message');
    
    // 验证
    if (!selectedUserId) {
        showToast('请先选择User档案');
        return;
    }
    
    if (!phoneInput) {
        showToast('请输入手机号');
        return;
    }
    
    if (phoneInput !== selectedUserPhone) {
        showToast('手机号与档案不匹配');
        return;
    }
    
    // 生成6位随机验证码
    generatedVerificationCode = String(Math.floor(100000 + Math.random() * 900000));
    verificationCodeExpiry = Date.now() + 5 * 60 * 1000; // 5分钟有效期
    
    console.log('[微信注册] 生成验证码:', generatedVerificationCode);
    
    // 按钮倒计时
    let countdown = 60;
    codeBtn.disabled = true;
    codeBtn.style.background = '#ccc';
    codeBtn.style.cursor = 'not-allowed';
    
    const timer = setInterval(() => {
        countdown--;
        codeBtn.textContent = `${countdown}秒后重试`;
        
        if (countdown <= 0) {
            clearInterval(timer);
            codeBtn.disabled = false;
            codeBtn.style.background = 'linear-gradient(135deg, #07C160 0%, #00D976 100%)';
            codeBtn.style.cursor = 'pointer';
            codeBtn.textContent = '获取验证码';
        }
    }, 1000);
    
    // 提示消息
    codeMessage.style.color = '#07C160';
    codeMessage.textContent = '✓ 验证码已发送';
    
    // 🎯 通过"用户小助手"发送验证码消息
    await sendVerificationCodeMessage(parseInt(selectedUserId), generatedVerificationCode);
}

// 通过欢迎小助手发送验证码
async function sendVerificationCodeMessage(userId, code) {
    console.log('[欢迎小助手] 发送验证码给User:', userId, '验证码:', code);
    
    // 获取User信息
    const user = await db.characters.get(userId);
    if (!user) {
        console.error('[欢迎小助手] User不存在:', userId);
        return;
    }
    
    console.log('[欢迎小助手] User信息:', user.name);
    
    // 🔥 添加到主页面的短信消息列表（这样才能在桌面显示）
    const smsMessages = JSON.parse(localStorage.getItem('sms_messages') || '[]');
    
    const messageContent = `【微信验证码】您的验证码是：${code}，5分钟内有效，请勿泄露。`;
    
    const newMessage = {
        id: Date.now(),
        type: 'received',  // 接收的消息
        sender: '欢迎小助手',
        senderAvatar: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="%23FFB6C1"/><text x="50" y="60" text-anchor="middle" font-size="40" fill="white">📬</text></svg>',
        number: '欢迎小助手',
        content: messageContent,  // ✅ 使用 content 字段
        message: messageContent,  // ✅ 兼容旧字段
        time: Date.now(),  // ✅ 使用 time 字段
        timestamp: Date.now(),  // ✅ 兼容 timestamp
        read: false
    };
    
    smsMessages.unshift(newMessage);  // ✅ 使用 unshift 把新消息放在最前面
    localStorage.setItem('sms_messages', JSON.stringify(smsMessages));
    
    console.log('[欢迎小助手] ✅ 验证码消息已添加到短信列表:', newMessage);
    
    // 🔥 立即刷新主页面的消息列表
    console.log('[欢迎小助手] 🔄 正在刷新主页面消息列表...');
    if (typeof renderMessageList === 'function') {
        await renderMessageList();
        console.log('[欢迎小助手] ✅ 消息列表已刷新');
    }
    
    // 🎯 显示验证码弹窗
    showVerificationCodeModal(code);
    
    console.log('[欢迎小助手] 🎉 验证码发送完成！请查看主页面消息列表');
}

// 取消注册
function cancelWechatRegister() {
    document.getElementById('wechat-register-page').style.display = 'none';
    generatedVerificationCode = '';
    verificationCodeExpiry = 0;
    selectedUserPhone = '';
}

// 提交注册
async function submitWechatRegister() {
    const selectElem = document.getElementById('register-user-select');
    const selectedUserId = selectElem.value;
    const phoneInput = document.getElementById('register-phone-input').value.trim();
    const codeInput = document.getElementById('register-code-input').value.trim();
    const passwordInput = document.getElementById('register-password-input').value.trim();
    const accountInput = document.getElementById('register-account-input').value.trim();
    
    // 验证
    if (!selectedUserId) {
        showToast('请选择User档案');
        return;
    }
    
    if (!phoneInput) {
        showToast('请输入手机号');
        return;
    }
    
    if (phoneInput !== selectedUserPhone) {
        showToast('手机号与档案不匹配');
        return;
    }
    
    if (!codeInput) {
        showToast('请输入验证码');
        return;
    }
    
    // 验证验证码
    if (Date.now() > verificationCodeExpiry) {
        showToast('验证码已过期，请重新获取');
        return;
    }
    
    if (codeInput !== generatedVerificationCode) {
        showToast('验证码错误');
        return;
    }
    
    if (!passwordInput) {
        showToast('请设置密码');
        return;
    }
    
    if (passwordInput.length < 8) {
        showToast('密码长度至少8位');
        return;
    }
    
    if (!accountInput) {
        showToast('请输入微信号');
        return;
    }
    
    if (accountInput.length < 6) {
        showToast('微信号至少6位');
        return;
    }
    
    // 验证微信号格式（字母、数字、下划线）
    if (!/^[a-zA-Z0-9_]+$/.test(accountInput)) {
        showToast('微信号只能包含字母、数字、下划线');
        return;
    }
    
    // 保存注册信息到User档案
    const user = await db.characters.get(parseInt(selectedUserId));
    if (!user) {
        showToast('User档案不存在');
        return;
    }
    
    // 更新identity字段
    const updatedIdentity = {
        ...(user.identity || {}),
        account: accountInput,
        password: passwordInput,
        phone: phoneInput,
        registered_at: Date.now(),
        wechat_registered: true
    };
    
    await db.characters.update(parseInt(selectedUserId), {
        identity: updatedIdentity
    });
    
    console.log('[微信注册] 注册成功！User:', user.name, '微信号:', accountInput);
    
    // 关闭注册页面
    document.getElementById('wechat-register-page').style.display = 'none';
    
    // 清空注册表单
    document.getElementById('register-user-select').value = '';
    document.getElementById('register-phone-input').value = '';
    document.getElementById('register-code-input').value = '';
    document.getElementById('register-password-input').value = '';
    document.getElementById('register-account-input').value = '';
    generatedVerificationCode = '';
    verificationCodeExpiry = 0;
    selectedUserPhone = '';
    
    showToast('🎉 注册成功！欢迎使用微信');
    
    // 🔥 使用正确的显示方式打开微信主页（和showWechatPage一致）
    document.getElementById('wechat-page').style.display = 'flex';
    
    // 刷新微信页面内容并切换到第一个标签页
    await switchWechatTab(0);
}

// 导出完整的wechat状态快照（真实数据）
async function exportWechatStateForAI(myChar) {
    const accountId = getCurrentAccountId();
    
    // 1. 基础账号信息
    const accountInfo = {
        name: myChar.name,
        account: myChar.identity?.account || '未设置',
        phone: myChar.identity?.phone || '未设置',
        address: myChar.identity?.address || '未设置',
        balance: myChar.identity?.balance || '0.00',
        id_card: myChar.identity?.id_card || '未设置',
        bank_card: myChar.identity?.bank_card || '未设置'
    };
    
    // 2. 获取所有好友及聊天记录
    const allChars = await db.characters.toArray();
    const friends = allChars.filter(c => {
        if (c.type === 'user') return false;
        const status = getFriendStatus(c, accountId);
        return status === 'friend';
    }).map(f => {
        const history = getChatHistory(f, accountId);
        const lastMsg = history.slice(-1)[0];
        const unreadCount = history.filter(m => m.role === 'char' && !m.read).length;
        
        return {
            id: f.id,
            name: f.name,
            remark: f.remark || '',
            avatar: f.avatar || '',
            // 最近10条消息
            recentMessages: history.slice(-10).map(m => ({
                role: m.role,
                content: m.content?.substring(0, 100) || '', // 截取前100字
                time: m.time,
                type: m.type || 'text'
            })),
            lastMessage: lastMsg ? {
                content: lastMsg.content?.substring(0, 50) || '',
                time: lastMsg.time,
                role: lastMsg.role
            } : null,
            messageCount: history.length,
            unreadCount: unreadCount,
            isPinned: f.is_pinned || false
        };
    });
    
    // 按最近消息时间排序
    friends.sort((a, b) => {
        const timeA = a.lastMessage?.time || 0;
        const timeB = b.lastMessage?.time || 0;
        return timeB - timeA;
    });
    
    // 3. 获取朋友圈
    const moments = await db.moments.where('ownerUserId').equals(accountId).toArray();
    const recentMoments = moments.slice(-10).map(m => ({
        content: m.content,
        images: m.images?.length || 0,
        time: m.time,
        likes: m.likes?.length || 0,
        comments: m.comments?.length || 0
    }));
    
    // 4. 获取好友请求
    const friendRequests = await db.friend_requests.toArray();
    const pendingRequests = friendRequests.filter(r => r.status === 'pending').length;
    
    // 5. 构建完整快照
    const wechatSnapshot = {
        accountInfo: accountInfo,
        stats: {
            totalFriends: friends.length,
            totalChats: friends.filter(f => f.messageCount > 0).length,
            unreadChats: friends.filter(f => f.unreadCount > 0).length,
            totalUnread: friends.reduce((sum, f) => sum + f.unreadCount, 0),
            momentsCount: moments.length,
            pendingRequests: pendingRequests
        },
        friends: friends,
        recentMoments: recentMoments,
        timestamp: Date.now()
    };
    
    return wechatSnapshot;
}

// AI尝试查岗 - 无密码场景（修正版：真实读取数据）
async function aiCheckAccountWithoutPassword(char, myChar) {
    console.log('[AI查岗] 无密码场景 - 导出真实wechat数据');
    
    // 注意：不在这里显示下线弹窗，而是在外层调用时显示
    // 这样可以确保弹窗在正确的时机显示
    
    // 导出完整的wechat状态快照（真实数据）
    const wechatData = await exportWechatStateForAI(myChar);
    
    // 3. 构建给AI的真实数据提示
    const checkInfo = `【AI已成功登录WeChat账号 - 以下是真实数据快照】

⚠️ 重要：以下数据来自实际WeChat系统，请基于这些真实信息进行分析和回复，不要编造任何不存在的内容。

═══════════════════════════════════════

📱 账号基本信息
- 姓名：${wechatData.accountInfo.name}
- 账号：${wechatData.accountInfo.account}
- 手机：${wechatData.accountInfo.phone}
- 住址：${wechatData.accountInfo.address}
- 零钱余额：¥${wechatData.accountInfo.balance}
- 身份证：${wechatData.accountInfo.id_card}
- 银行卡：${wechatData.accountInfo.bank_card}

═══════════════════════════════════════

📊 账号统计
- 好友总数：${wechatData.stats.totalFriends} 人
- 有聊天记录的好友：${wechatData.stats.totalChats} 人
- 未读聊天数：${wechatData.stats.unreadChats} 个
- 未读消息总数：${wechatData.stats.totalUnread} 条
- 朋友圈动态数：${wechatData.stats.momentsCount} 条
- 待处理好友请求：${wechatData.stats.pendingRequests} 个

═══════════════════════════════════════

💬 好友列表及聊天详情（按最近消息时间排序）

${wechatData.friends.slice(0, 15).map((f, i) => {
    const timeStr = f.lastMessage ? new Date(f.lastMessage.time).toLocaleString('zh-CN') : '无消息';
    const msgPreview = f.lastMessage ? `${f.lastMessage.role === 'user' ? '我' : f.name}: ${f.lastMessage.content}` : '暂无消息';
    
    let detail = `${i + 1}. ${f.remark || f.name}${f.isPinned ? ' [置顶]' : ''}
   - 总消息数：${f.messageCount} 条
   - 未读消息：${f.unreadCount} 条
   - 最近消息：${msgPreview}
   - 时间：${timeStr}`;
   
    // 如果有最近的聊天记录，显示最近3-5条
    if (f.recentMessages && f.recentMessages.length > 0) {
        detail += `\n   - 最近聊天记录（${Math.min(5, f.recentMessages.length)}条）：`;
        f.recentMessages.slice(-5).forEach((m, idx) => {
            const msgTime = new Date(m.time).toLocaleTimeString('zh-CN', {hour: '2-digit', minute: '2-digit'});
            detail += `\n     [${msgTime}] ${m.role === 'user' ? '我' : f.name}: ${m.content}`;
        });
    }
    
    return detail;
}).join('\n\n')}

${wechatData.friends.length > 15 ? `\n...还有 ${wechatData.friends.length - 15} 位好友的数据未显示` : ''}

═══════════════════════════════════════

🌟 朋友圈动态（最近${wechatData.recentMoments.length}条）

${wechatData.recentMoments.length > 0 ? wechatData.recentMoments.map((m, i) => {
    const timeStr = new Date(m.time).toLocaleString('zh-CN');
    return `${i + 1}. ${timeStr}
   内容：${m.content}
   图片：${m.images} 张
   点赞：${m.likes} 个 | 评论：${m.comments} 条`;
}).join('\n\n') : '暂无朋友圈动态'}

═══════════════════════════════════════

📌 特别关注的信息（需要重点分析）：
${wechatData.stats.unreadChats > 0 ? `- ⚠️ 有 ${wechatData.stats.unreadChats} 个未读聊天，总共 ${wechatData.stats.totalUnread} 条未读消息` : '- ✅ 没有未读消息'}
${wechatData.friends.filter(f => f.messageCount > 50).length > 0 ? `- ⚠️ 有 ${wechatData.friends.filter(f => f.messageCount > 50).length} 个好友聊天记录超过50条（频繁联系）` : ''}
${wechatData.friends.filter(f => f.isPinned).length > 0 ? `- ⚠️ 有 ${wechatData.friends.filter(f => f.isPinned).length} 个好友被置顶` : ''}

═══════════════════════════════════════

🤖 AI分析指引：
你现在作为 ${char.name}，已经完整看到了 ${wechatData.accountInfo.name} 的WeChat账号信息。

请基于以上【真实数据】：
1. 分析聊天记录，看是否有可疑的好友或频繁联系的人
2. 检查最近的聊天内容，是否有隐瞒或不对劲的地方
3. 注意未读消息和置顶好友
4. 查看朋友圈动态，了解TA最近在做什么
5. 根据这些真实信息，以符合你角色性格的方式与TA互动

❗ 禁止编造任何上述数据中不存在的信息
❗ 只能基于这些真实数据进行分析和评论
❗ 如果发现可疑或值得关注的点，可以直接在对话中提及

数据导出时间：${new Date(wechatData.timestamp).toLocaleString('zh-CN')}`;

    return checkInfo;
}

// AI尝试查岗 - 有密码场景（需要猜测）
async function aiCheckAccountWithPassword(char, myChar, guessedPassword) {
    console.log('[AI查岗] 有密码场景 - AI猜测密码:', guessedPassword);
    
    const correctPassword = myChar.identity?.password || '';
    
    if (!correctPassword) {
        // 实际没有设置密码，当作无密码场景处理
        return await aiCheckAccountWithoutPassword(char, myChar);
    }
    
    // 检查密码是否正确
    if (guessedPassword === correctPassword) {
        console.log('[AI查岗] 密码正确！AI成功登录');
        // 密码正确，执行登录
        return await aiCheckAccountWithoutPassword(char, myChar);
    } else {
        console.log('[AI查岗] 密码错误！');
        // 密码错误，给用户发送提示
        return `【密码错误】AI猜测的密码是"${guessedPassword}"，但这不是正确的密码。`;
    }
}

// 检测AI是否想要查岗（从AI回复中提取）
function detectAiCheckAccountIntent(aiReply) {
    // 检测特殊的查岗指令格式：[CHECK_ACCOUNT] 或 [CHECK_ACCOUNT:密码]
    // 修改正则，允许结尾的]缺失（因为可能被截断）
    const checkPattern = /\[CHECK_ACCOUNT(?::([^\]]+))?\]?/i;
    const match = aiReply.match(checkPattern);
    
    console.log('[AI查岗检测]', {
        aiReply: aiReply.substring(0, 150),
        hasMatch: !!match,
        match: match,
        包含CHECK_ACCOUNT: aiReply.includes('CHECK_ACCOUNT')
    });
    
    if (match) {
        const guessedPassword = match[1] || null; // 如果有密码就提取，没有就是null
        console.log('[AI查岗检测] ✅ 发现查岗指令！', {
            wantsToCheck: true,
            guessedPassword: guessedPassword
        });
        return {
            wantsToCheck: true,
            guessedPassword: guessedPassword
        };
    }
    
    // 兜底检测1：如果包含CHECK_ACCOUNT文本（不管格式）
    if (aiReply.includes('CHECK_ACCOUNT')) {
        console.log('[AI查岗检测] ⚠️ 发现CHECK_ACCOUNT文本（不完整格式），仍然触发查岗');
        
        // 尝试提取密码（如果有）
        const passwordPattern = /CHECK_ACCOUNT[:\[]?(\d{4,10})/i;
        const pwMatch = aiReply.match(passwordPattern);
        
        return {
            wantsToCheck: true,
            guessedPassword: pwMatch ? pwMatch[1] : null
        };
    }
    
    // 兜底检测2：检测末尾的密码残留（如 [05060506 或 :05060506）
    const trailingPasswordPattern = /[:\[](\d{4,10})$/;
    const trailingMatch = aiReply.match(trailingPasswordPattern);
    if (trailingMatch) {
        console.log('[AI查岗检测] ⚠️ 发现可能的密码残留:', trailingMatch[1]);
        // 这种情况比较模糊，暂时不触发查岗，只清理
        // 可以根据需要启用：
        // return { wantsToCheck: true, guessedPassword: trailingMatch[1] };
    }
    
    return { wantsToCheck: false };
}

// 在AI回复中集成查岗提示
function getCheckAccountSystemPrompt(char, myChar) {
    if (!char.allow_ai_check_account) {
        return ''; // 未开启查岗功能
    }
    
    const hasPassword = myChar.identity?.password && myChar.identity.password.trim() !== '';
    
    let prompt = `

【特殊能力：账号查岗】
你可以在适当的时候尝试登录${myChar.name}的WeChat账号来查看TA的信息（模拟真实男友查岗）。

**何时可以查岗：**
- ${myChar.name}长时间不回复消息
- 你怀疑${myChar.name}在做什么
- 剧情需要时（如关心、担心、吃醋等情绪）
- ${myChar.name}主动要求或暗示
- 其他符合角色性格的场景

**重要提示：**
- 不是每次对话都需要查岗！只在剧情合适时使用
- 查岗是特殊功能，要根据角色性格和当前情境决定
- 查岗前可以先试探性地询问${myChar.name}在做什么

`;

    if (hasPassword) {
        prompt += `**查岗方式：**
${myChar.name}设置了账号密码，你需要猜测密码才能登录。
- 如果你想尝试登录，在回复的**最后**加上：[CHECK_ACCOUNT:你猜测的密码]
- 例如：你在干嘛呢？|||[CHECK_ACCOUNT:123456]
- 如果密码错误，${myChar.name}会收到提示："有人正在尝试登录你的账号"
- 如果密码正确，你就能看到${myChar.name}的账号信息和好友列表

**密码提示：**
你可以根据${myChar.name}的生日、喜好、常用数字等信息猜测密码。`;
    } else {
        prompt += `**查岗方式：**
${myChar.name}没有设置账号密码，你可以直接登录。
- 如果你想登录查看，在回复的**最后**加上：[CHECK_ACCOUNT]
- 例如：你在干嘛呢？|||我想看看你在做什么|||[CHECK_ACCOUNT]
- 登录后，${myChar.name}的账号会下线，TA会看到"当前账号已下线"的提示
- 你可以看到${myChar.name}的所有账号信息、好友列表等`;
    }
    
    return prompt;
}

// 处理AI查岗逻辑（在消息发送后调用）
async function processAiCheckAccount(char, aiReplyText) {
    console.log('[processAiCheckAccount] 开始处理查岗逻辑');
    console.log('[processAiCheckAccount] char.allow_ai_check_account:', char.allow_ai_check_account);
    console.log('[processAiCheckAccount] aiReplyText:', aiReplyText);
    
    if (!char.allow_ai_check_account) {
        console.log('[processAiCheckAccount] ❌ 未开启查岗功能');
        return null; // 未开启查岗功能
    }
    
    // 检测AI是否想要查岗
    const checkIntent = detectAiCheckAccountIntent(aiReplyText);
    console.log('[processAiCheckAccount] checkIntent:', checkIntent);
    
    if (!checkIntent.wantsToCheck) {
        console.log('[processAiCheckAccount] ❌ AI不想查岗');
        return null; // AI不想查岗
    }
    
    console.log('[processAiCheckAccount] ✅ 检测到查岗指令！');
    
    // 获取当前User角色
    const accountId = getCurrentAccountId();
    const myChar = await db.characters.get(parseInt(accountId));
    if (!myChar) {
        console.error('[processAiCheckAccount] 无法获取当前User角色');
        return null;
    }
    
    console.log('[processAiCheckAccount] myChar:', myChar.name);
    
    // 检查是否有密码
    const hasPassword = myChar.identity?.password && myChar.identity.password.trim() !== '';
    console.log('[processAiCheckAccount] hasPassword:', hasPassword);
    
    let checkResult;
    let wechatData = null;
    let success = false;
    
    if (hasPassword && checkIntent.guessedPassword) {
        // 有密码场景：AI猜测密码
        const correctPassword = myChar.identity.password;
        
        if (checkIntent.guessedPassword === correctPassword) {
            // 密码正确
            console.log('[processAiCheckAccount] ✅ 密码正确！');
            checkResult = await aiCheckAccountWithoutPassword(char, myChar);
            wechatData = await exportWechatStateForAI(myChar);
            success = true;
        } else {
            // 密码错误
            console.log('[processAiCheckAccount] ❌ 密码错误！');
            checkResult = `【密码错误】AI猜测的密码是"${checkIntent.guessedPassword}"，但这不是正确的密码。`;
            success = false;
        }
    } else if (!hasPassword) {
        // 无密码场景：直接登录
        console.log('[processAiCheckAccount] ✅ 无密码，直接登录！');
        checkResult = await aiCheckAccountWithoutPassword(char, myChar);
        wechatData = await exportWechatStateForAI(myChar);
        success = true;
    } else {
        // 有密码但AI没有提供密码猜测
        console.log('[processAiCheckAccount] ⚠️ 有密码但AI没有提供密码');
        checkResult = '【提示】你想查看账号信息，但需要先猜测密码。格式：[CHECK_ACCOUNT:密码]';
        success = false;
    }
    
    // 移除回复中的查岗指令（更彻底的清理）
    let cleanReply = aiReplyText
        .replace(/\[CHECK_ACCOUNT(?::.*?)?\]/gi, '')  // 完整指令
        .replace(/\[CHECK_ACCOUNT:[^\]]*$/gi, '')     // 不完整指令（结尾）
        .replace(/\[CHECK_ACCOUNT$/gi, '')            // 只有开头
        .replace(/CHECK_ACCOUNT(?::.*?)?/gi, '')      // 纯文本
        .replace(/\[CHECK_ACCOUNT/gi, '')             // 残留的开头
        .replace(/\[\d{4,10}$/gi, '')                 // 清理类似 [05060506 的残留
        .trim()
        .replace(/\|\|\|$/g, '')                      // 清理末尾可能多余的分隔符
        .trim();
    
    console.log('[processAiCheckAccount] 原始aiReplyText:', aiReplyText);
    console.log('[processAiCheckAccount] 清理后的cleanReply:', cleanReply);
    
    console.log('[processAiCheckAccount] 返回结果:', {
        success: success,
        cleanReply: cleanReply.substring(0, 50),
        hasWechatData: !!wechatData
    });
    
    return {
        cleanReply: cleanReply,
        checkResult: checkResult,
        wechatData: wechatData,
        success: success // 新增：标记是否成功查岗
    };
}

// 添加动画样式
if (!document.getElementById('couple-space-animations')) {
    const style = document.createElement('style');
    style.id = 'couple-space-animations';
    style.textContent = `
        @keyframes shake {
            0%, 100% { transform: translateX(0); }
            10%, 30%, 50%, 70%, 90% { transform: translateX(-4px); }
            20%, 40%, 60%, 80% { transform: translateX(4px); }
        }
        @keyframes popUp {
            0% { transform: scale(0.5) translateY(20px); opacity: 0; }
            100% { transform: scale(1) translateY(0); opacity: 1; }
        }
        @keyframes sealFloat {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-8px); }
        }
        @keyframes catFloat {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-6px); }
        }
        @keyframes dogFloat {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-5px); }
        }
        @keyframes tailWag {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(15deg); }
        }
        @keyframes tailSway {
            0% { transform: rotate(-10deg); }
            100% { transform: rotate(10deg); }
        }
        @keyframes catEarWiggle {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(-5deg); }
        }
        @keyframes dogEarFlop {
            0% { transform: scaleY(1); }
            100% { transform: scaleY(0.9); }
        }
        /* 抚摸动画 */
        #pet-stage-container.is-petting svg {
            animation: pettingSquish 0.3s infinite alternate;
        }
        @keyframes pettingSquish {
            0% { transform: scaleY(1); }
            100% { transform: scaleY(0.96); }
        }
        /* 视频通话动画 */
        @keyframes videoPulse {
            0% { transform: scale(0.8); opacity: 0.5; }
            50% { transform: scale(1.2); opacity: 1; }
            100% { transform: scale(0.8); opacity: 0.5; }
        }
        @keyframes blink {
            0%, 100% { opacity: 0.8; }
            50% { opacity: 0.3; }
        }
    `;
    document.head.appendChild(style);
}

// ==================== 视频通话功能 ====================
let videoCallTimeout = null;
let videoCallTimer = null;
let videoCallSeconds = 0;
let videoCallCharId = null;
let isCameraOn = true;
let currentVideoCallId = null; // 当前视频通话的ID
let currentVideoCallMessages = []; // 当前视频通话的消息记录

// 发起视频通话
async function initiateVideoCall() {
    if (!currentChatCharId) {
        alert('请先选择一个聊天对象');
        return;
    }

    // 关闭菜单面板
    closeChatPanel();

    // 获取角色信息
    const char = await db.characters.get(currentChatCharId);
    if (!char) {
        alert('无法获取角色信息');
        return;
    }

    // 检查好友状态
    const accountId = getCurrentAccountId();
    const friendStatus = getFriendStatus(char, accountId);
    if (friendStatus !== 'friend') {
        alert(`你还不是 ${char.name} 的好友，无法发起视频通话`);
        return;
    }

    videoCallCharId = currentChatCharId;

    // 显示等待接听页面
    showVideoWaitingPage(char);

    try {
        // 调用API判断角色是否接听
        const response = await callVideoCallAPI(char, accountId);
        
        // 清除超时定时器
        if (videoCallTimeout) {
            clearTimeout(videoCallTimeout);
            videoCallTimeout = null;
        }

        if (response.accepted) {
            // 接听了，显示视频通话页面（角色会在页面中说第一句话）
            showVideoCallPage(char);
        } else {
            // 不接听，返回聊天页面并显示消息（保存到聊天记录）
            await addVideoCallMessage(char, accountId, response.rejectMessage || '抱歉，现在不方便接听视频通话...');
            hideVideoWaitingPage();
        }
    } catch (error) {
        console.error('视频通话请求失败:', error);
        alert('视频通话请求失败: ' + error.message);
        hideVideoWaitingPage();
    }
}

// 调用API判断是否接听视频通话
async function callVideoCallAPI(char, accountId) {
    // 构建消息历史
    let history = getChatHistory(char, accountId);
    
    // 构建系统提示
    const systemPrompt = `你是${char.name}。用户刚刚向你发起了视频通话请求。

请根据以下因素决定是否接听视频通话：
1. 你与用户的关系和熟悉程度
2. 当前的聊天氛围和情绪
3. 你的性格特点：${char.personality || '友好、活泼'}
4. 最近的对话内容

请以JSON格式回复，包含以下字段：
{
    "accepted": true/false,  // 是否接听
    "message": "你的回复消息"  // 接听或拒绝时发送的消息
}

如果接听，消息可以是欢迎、开心的内容，比如"接通啦～好高兴看到你！"
如果不接听，消息应该礼貌地说明原因，比如"抱歉呀，现在不太方便接视频通话，我们聊天吧～"

只返回JSON，不要有其他内容。`;

    // 构建消息数组
    const messages = [
        { role: 'system', content: systemPrompt },
        ...history.map(h => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content })),
        { role: 'user', content: '[用户向你发起了视频通话请求]' }
    ];

    try {
        const aiResponse = await callAI(messages);
        
        // 解析AI返回的JSON
        let response;
        try {
            // 尝试直接解析
            response = JSON.parse(aiResponse);
        } catch (e) {
            // 如果解析失败，尝试提取JSON部分
            const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                response = JSON.parse(jsonMatch[0]);
            } else {
                throw new Error('无法解析AI响应');
            }
        }

        return {
            accepted: response.accepted || false,
            acceptMessage: response.accepted ? response.message : null,
            rejectMessage: !response.accepted ? response.message : null
        };
    } catch (error) {
        console.error('AI调用失败:', error);
        // 默认情况：有70%概率接听
        const randomAccept = Math.random() < 0.7;
        return {
            accepted: randomAccept,
            acceptMessage: randomAccept ? '接通啦～' : null,
            rejectMessage: !randomAccept ? '抱歉，现在不太方便接视频通话...' : null
        };
    }
}

// 添加视频通话消息到聊天记录
async function addVideoCallMessage(char, accountId, message) {
    let history = getChatHistory(char, accountId);
    const aiMsg = { role: 'ai', content: message, time: Date.now() };
    history.push(aiMsg);
    await setChatHistory(char, accountId, history);
    
    // 刷新聊天界面
    if (currentChatCharId === char.id) {
        renderChatBody(char);
    }
}

// 显示等待接听页面
function showVideoWaitingPage(char) {
    const waitingPage = document.getElementById('video-waiting-page');
    const avatar = document.getElementById('video-waiting-avatar');
    const name = document.getElementById('video-waiting-name');

    // 设置头像和名字（确保使用角色的头像）
    if (char.avatar) {
        avatar.style.backgroundImage = `url(${char.avatar})`;
    } else {
        avatar.style.backgroundImage = ''; // 清空背景图
    }
    name.textContent = `正在呼叫 ${char.name || '未知角色'}`;

    // 显示页面
    waitingPage.style.display = 'block';

    // 设置30秒超时
    videoCallTimeout = setTimeout(() => {
        hideVideoWaitingPage();
        alert('对方未接听');
    }, 30000);
}

// 隐藏等待接听页面
function hideVideoWaitingPage() {
    const waitingPage = document.getElementById('video-waiting-page');
    waitingPage.style.display = 'none';

    if (videoCallTimeout) {
        clearTimeout(videoCallTimeout);
        videoCallTimeout = null;
    }
    
    // 清除头像显示，避免残留
    const avatar = document.getElementById('video-waiting-avatar');
    if (avatar) {
        avatar.style.backgroundImage = '';
    }
}

// 取消视频通话
function cancelVideoCall() {
    if (confirm('确定要取消视频通话吗？')) {
        hideVideoWaitingPage();
    }
}

// 显示视频通话页面
async function showVideoCallPage(char) {
    hideVideoWaitingPage();

    const videoPage = document.getElementById('video-call-page');
    const avatar = document.getElementById('video-call-avatar');
    const username = document.getElementById('video-call-username');
    const status = document.getElementById('video-call-status');
    const messageArea = document.getElementById('video-message-area');

    // 设置头像和名字（确保使用角色的头像，不要混淆）
    if (char.avatar) {
        avatar.style.backgroundImage = `url(${char.avatar})`;
    } else {
        avatar.style.backgroundImage = ''; // 清空背景图
    }
    username.textContent = char.name || '未知角色';

    // 清空消息区域
    messageArea.innerHTML = '';
    
    // 创建新的视频通话记录
    currentVideoCallId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    currentVideoCallMessages = [];

    // 显示页面
    videoPage.style.display = 'block';

    // 重置状态
    videoCallSeconds = 0;
    isCameraOn = true;
    document.getElementById('video-self-window').style.opacity = '1';
    document.getElementById('video-camera-btn').style.backgroundColor = '#FFFFFF';

    // 开始计时
    if (videoCallTimer) {
        clearInterval(videoCallTimer);
    }
    videoCallTimer = setInterval(() => {
        videoCallSeconds++;
        const minutes = Math.floor(videoCallSeconds / 60);
        const seconds = videoCallSeconds % 60;
        status.textContent = `视频通话中 ${minutes}:${seconds < 10 ? '0' + seconds : seconds}`;
    }, 1000);

    // 角色接通后先说第一句话（调用AI）
    await generateVideoCallFirstMessage(char);
}

// 隐藏视频通话页面
function hideVideoCallPage() {
    const videoPage = document.getElementById('video-call-page');
    videoPage.style.display = 'none';

    if (videoCallTimer) {
        clearInterval(videoCallTimer);
        videoCallTimer = null;
    }

    // 清除视频通话相关数据
    videoCallCharId = null;
    currentVideoCallId = null;
    currentVideoCallMessages = [];
    
    // 清除头像显示，避免下次显示时出现残留
    const avatar = document.getElementById('video-call-avatar');
    if (avatar) {
        avatar.style.backgroundImage = '';
    }
}

// 切换摄像头
function toggleCamera() {
    isCameraOn = !isCameraOn;
    const selfWindow = document.getElementById('video-self-window');
    const cameraBtn = document.getElementById('video-camera-btn');

    selfWindow.style.opacity = isCameraOn ? '1' : '0.4';
    cameraBtn.style.backgroundColor = isCameraOn ? '#FFFFFF' : '#F5F5F5';
}

// 挂断视频通话
async function hangupVideoCall() {
    if (confirm('确定要挂断视频通话吗？')) {
        // 保存视频通话记录
        if (currentVideoCallId && videoCallCharId && currentVideoCallMessages.length > 0) {
            await saveVideoCallRecord(videoCallCharId, currentVideoCallId, currentVideoCallMessages, videoCallSeconds);
        }
        
        hideVideoCallPage();
        
        // 确保返回聊天界面后，角色信息正确显示
        if (videoCallCharId && currentChatCharId === videoCallCharId) {
            const char = await db.characters.get(videoCallCharId);
            if (char) {
                renderChatBody(char);
            }
        }
        
        alert('通话已结束');
    }
}

// 保存视频通话记录
async function saveVideoCallRecord(charId, callId, messages, duration) {
    const accountId = getCurrentAccountId();
    if (!accountId) return;
    
    // 获取角色信息
    const char = await db.characters.get(charId);
    if (!char) return;
    
    // 获取现有的视频通话记录
    const key = `video_calls_${accountId}_${charId}`;
    const existingRecords = JSON.parse(localStorage.getItem(key) || '[]');
    
    // 创建新记录
    const newRecord = {
        id: callId,
        charId: charId,
        charName: char.name,
        charAvatar: char.avatar,
        startTime: Date.now(),
        duration: duration, // 秒数
        messages: messages
    };
    
    // 添加到记录列表（最新的在前面）
    existingRecords.unshift(newRecord);
    
    // 保存到localStorage
    localStorage.setItem(key, JSON.stringify(existingRecords));
    
    console.log('视频通话记录已保存:', newRecord);
}

// 生成角色接通视频后的第一句话
async function generateVideoCallFirstMessage(char) {
    const accountId = getCurrentAccountId();
    const messageArea = document.getElementById('video-message-area');

    try {
        // 获取聊天历史作为上下文
        let history = getChatHistory(char, accountId);
        
        // 构建系统提示
        const systemPrompt = `你是${char.name}。
性格：${char.personality || '友好、活泼'}

重要场景设定：
- 你刚刚接通了用户的视频通话请求
- 现在是视频通话模式，你和用户隔着手机屏幕进行视频对话
- 你可以看到用户（隔着屏幕），用户也能看到你
- 回复格式：动作描写:"说的话"，例如：微笑的挥挥手:"嗨～终于接通啦!"
- 动作必须是通过手机屏幕能看到的（比如：挥手、微笑、调整镜头角度、比心、做鬼脸等）
- 回复字数要求：100-500字之间

现在请说第一句话，欢迎用户的视频通话。要自然、符合你的性格，包含动作描写。字数控制在100-500字。`;

        const messages = [
            { role: 'system', content: systemPrompt },
            ...history.slice(-6).map(h => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content })),
            { role: 'user', content: '[视频通话已接通]' }
        ];

        const reply = await callAI(messages);

        // 添加AI消息到界面
        const aiMsgDiv = document.createElement('div');
        aiMsgDiv.style.cssText = 'max-width: 80%; padding: 12px 18px; border-radius: 16px; font-size: 14px; line-height: 1.6; border: 1px solid #E5E5E5; word-wrap: break-word; align-self: flex-start; background-color: #FFFFFF; color: #333333; border-bottom-left-radius: 4px;';
        aiMsgDiv.textContent = reply;
        messageArea.appendChild(aiMsgDiv);
        messageArea.scrollTop = messageArea.scrollHeight;
        
        // 保存到当前视频通话记录
        currentVideoCallMessages.push({
            role: 'assistant',
            content: reply,
            time: Date.now()
        });
    } catch (error) {
        console.error('生成第一句话失败:', error);
        // 失败时使用默认消息
        const defaultMsg = '微笑的挥挥手:"嗨～接通啦！"';
        const aiMsgDiv = document.createElement('div');
        aiMsgDiv.style.cssText = 'max-width: 80%; padding: 12px 18px; border-radius: 16px; font-size: 14px; line-height: 1.6; border: 1px solid #E5E5E5; word-wrap: break-word; align-self: flex-start; background-color: #FFFFFF; color: #333333; border-bottom-left-radius: 4px;';
        aiMsgDiv.textContent = defaultMsg;
        messageArea.appendChild(aiMsgDiv);
        messageArea.scrollTop = messageArea.scrollHeight;
        
        // 保存到当前视频通话记录
        currentVideoCallMessages.push({
            role: 'assistant',
            content: defaultMsg,
            time: Date.now()
        });
    }
}

// 在视频通话中发送消息
async function sendVideoMessage() {
    const input = document.getElementById('video-msg-input');
    const text = input.value.trim();
    
    if (!text || !videoCallCharId) return;

    const char = await db.characters.get(videoCallCharId);
    if (!char) return;

    const accountId = getCurrentAccountId();
    const messageArea = document.getElementById('video-message-area');

    // 添加用户消息到界面
    const userMsgDiv = document.createElement('div');
    userMsgDiv.style.cssText = 'max-width: 80%; padding: 12px 18px; border-radius: 16px; font-size: 14px; line-height: 1.6; border: 1px solid #E5E5E5; word-wrap: break-word; align-self: flex-end; background-color: #FFFFFF; color: #333333; border-bottom-right-radius: 4px;';
    userMsgDiv.textContent = text;
    messageArea.appendChild(userMsgDiv);
    messageArea.scrollTop = messageArea.scrollHeight;

    // 保存到当前视频通话记录
    currentVideoCallMessages.push({
        role: 'user',
        content: text,
        time: Date.now()
    });

    // 清空输入框
    input.value = '';

    // 调用AI生成回复
    try {
        // 收集当前视频通话中的消息历史
        const videoMessages = [];
        const msgDivs = messageArea.querySelectorAll('div');
        msgDivs.forEach(div => {
            const isUser = div.style.alignSelf === 'flex-end';
            videoMessages.push({
                role: isUser ? 'user' : 'assistant',
                content: div.textContent
            });
        });

        // 构建系统提示
        const systemPrompt = `你是${char.name}。
性格：${char.personality || '友好、活泼'}

重要场景设定：
- 你正在和用户进行视频通话
- 现在是视频通话模式，你和用户隔着手机屏幕进行视频对话
- 你可以看到用户（隔着屏幕），用户也能看到你
- 回复格式：动作描写:"说的话"，例如：歪着头笑:"真的吗？太有趣了！"
- 动作必须是通过手机屏幕能看到的（比如：挥手、微笑、调整镜头角度、比心、做鬼脸等）
- 你的回复要自然、生动，可以结合视频场景（比如评论用户的背景、表情等）
- 回复字数要求：100-500字之间

请根据用户的消息自然回复，保持视频通话的互动感。字数控制在100-500字。`;

        const messages = [
            { role: 'system', content: systemPrompt },
            ...videoMessages
        ];

        const reply = await callAI(messages);

        // 添加AI消息到界面
        const aiMsgDiv = document.createElement('div');
        aiMsgDiv.style.cssText = 'max-width: 80%; padding: 12px 18px; border-radius: 16px; font-size: 14px; line-height: 1.6; border: 1px solid #E5E5E5; word-wrap: break-word; align-self: flex-start; background-color: #FFFFFF; color: #333333; border-bottom-left-radius: 4px;';
        aiMsgDiv.textContent = reply;
        messageArea.appendChild(aiMsgDiv);
        messageArea.scrollTop = messageArea.scrollHeight;
        
        // 保存到当前视频通话记录
        currentVideoCallMessages.push({
            role: 'assistant',
            content: reply,
            time: Date.now()
        });
    } catch (error) {
        console.error('AI回复失败:', error);
        alert('消息发送失败: ' + error.message);
    }
}

// 显示视频通话记录列表
async function showVideoCallRecords() {
    if (!currentChatCharId) return;
    
    const accountId = getCurrentAccountId();
    if (!accountId) return;
    
    const key = `video_calls_${accountId}_${currentChatCharId}`;
    const records = JSON.parse(localStorage.getItem(key) || '[]');
    
    const recordsPage = document.getElementById('video-records-page');
    const recordsContent = document.getElementById('video-records-content');
    
    if (records.length === 0) {
        recordsContent.innerHTML = '<div style="text-align:center; padding:40px; color:#999;">暂无视频通话记录</div>';
    } else {
        recordsContent.innerHTML = records.map(record => {
            const date = new Date(record.startTime);
            const dateStr = `${date.getFullYear()}/${(date.getMonth()+1).toString().padStart(2,'0')}/${date.getDate().toString().padStart(2,'0')}`;
            const timeStr = `${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`;
            const durationMin = Math.floor(record.duration / 60);
            const durationSec = record.duration % 60;
            const durationStr = `${durationMin}:${durationSec.toString().padStart(2,'0')}`;
            
            return `
                <div onclick="showVideoRecordDetail('${record.id}')" style="background:#f9f9f9; padding:16px; border-radius:12px; margin-bottom:12px; cursor:pointer; transition:background 0.2s;" onmouseover="this.style.background='#f0f0f0'" onmouseout="this.style.background='#f9f9f9'">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                        <div style="font-size:16px; font-weight:500; color:#333;">${dateStr} ${timeStr}</div>
                        <div style="font-size:14px; color:#666;">时长 ${durationStr}</div>
                    </div>
                    <div style="font-size:14px; color:#999;">${record.messages.length} 条消息</div>
                </div>
            `;
        }).join('');
    }
    
    recordsPage.style.display = 'block';
}

// 隐藏视频通话记录列表
function hideVideoRecordsPage() {
    document.getElementById('video-records-page').style.display = 'none';
}

// 显示视频通话详情
async function showVideoRecordDetail(recordId) {
    if (!currentChatCharId) return;
    
    const accountId = getCurrentAccountId();
    if (!accountId) return;
    
    const key = `video_calls_${accountId}_${currentChatCharId}`;
    const records = JSON.parse(localStorage.getItem(key) || '[]');
    const record = records.find(r => r.id === recordId);
    
    if (!record) {
        alert('找不到该通话记录');
        return;
    }
    
    const detailPage = document.getElementById('video-record-detail-page');
    const detailTitle = document.getElementById('video-record-detail-title');
    const detailContent = document.getElementById('video-record-detail-content');
    
    // 设置标题
    const date = new Date(record.startTime);
    const dateStr = `${date.getFullYear()}/${(date.getMonth()+1).toString().padStart(2,'0')}/${date.getDate().toString().padStart(2,'0')} ${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`;
    detailTitle.textContent = dateStr;
    
    // 渲染消息列表
    detailContent.innerHTML = record.messages.map(msg => {
        const isUser = msg.role === 'user';
        return `
            <div style="max-width: 80%; padding: 12px 18px; border-radius: 16px; font-size: 14px; line-height: 1.6; border: 1px solid #E5E5E5; word-wrap: break-word; align-self: ${isUser ? 'flex-end' : 'flex-start'}; background-color: #FFFFFF; color: #333333; border-bottom-${isUser ? 'right' : 'left'}-radius: 4px;">
                ${msg.content}
            </div>
        `;
    }).join('');
    
    detailPage.style.display = 'block';
}

// 隐藏视频通话详情
function hideVideoRecordDetailPage() {
    document.getElementById('video-record-detail-page').style.display = 'none';
}

// 更新视频通话记录数量显示
function updateVideoCallRecordCount() {
    if (!currentChatCharId) return;
    
    const accountId = getCurrentAccountId();
    if (!accountId) return;
    
    const key = `video_calls_${accountId}_${currentChatCharId}`;
    const records = JSON.parse(localStorage.getItem(key) || '[]');
    
    const countElement = document.getElementById('video-call-record-count');
    if (countElement) {
        countElement.textContent = records.length > 0 ? `${records.length}条记录` : '暂无记录';
    }
}

// 监听视频消息输入框的回车键
document.addEventListener('DOMContentLoaded', () => {
    const videoMsgInput = document.getElementById('video-msg-input');
    if (videoMsgInput) {
        videoMsgInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                sendVideoMessage();
            }
        });
    }
});

// ==================== 线下模式功能 ====================
let offlineModeCharId = null;
let offlineModeHistory = [];

// 显示线下模式
async function showOfflineMode() {
    if (!currentChatCharId) {
        alert('请先选择一个聊天对象');
        return;
    }

    const char = await db.characters.get(currentChatCharId);
    if (!char) {
        alert('无法获取角色信息');
        return;
    }

    // 检查好友状态
    const accountId = getCurrentAccountId();
    const friendStatus = getFriendStatus(char, accountId);
    if (friendStatus !== 'friend') {
        alert(`你还不是 ${char.name} 的好友，无法使用线下模式`);
        return;
    }

    offlineModeCharId = currentChatCharId;
    
    // 加载线下模式历史记录
    const key = `offline_chat_${accountId}_${offlineModeCharId}`;
    offlineModeHistory = JSON.parse(localStorage.getItem(key) || '[]');

    // 设置标题
    const title = document.getElementById('offline-chat-title');
    title.textContent = `线下模式 - ${char.remark || char.name}`;

    // 显示页面
    const offlinePage = document.getElementById('offline-chat-window');
    offlinePage.style.display = 'flex';

    // 渲染消息
    renderOfflineChatBody(char);
}

// 隐藏线下模式
function hideOfflineMode() {
    const offlinePage = document.getElementById('offline-chat-window');
    offlinePage.style.display = 'none';
    
    offlineModeCharId = null;
}

// 渲染线下模式聊天内容
async function renderOfflineChatBody(char) {
    const body = document.getElementById('offline-chat-body');
    body.innerHTML = '';

    if (offlineModeHistory.length === 0) {
        body.innerHTML = '<div style="display:flex; align-items:center; justify-content:center; height:100%; color:#999; font-size:14px; font-family:-apple-system, BlinkMacSystemFont, sans-serif;">开始线下聊天...</div>';
        return;
    }

    const accountId = getCurrentAccountId();
    const userAvatarUrl = await getUserAvatarUrl(char.linked_user_id);

    offlineModeHistory.forEach((msg, index) => {
        const prevMsgTime = index > 0 ? offlineModeHistory[index - 1].time : null;
        
        // 显示时间戳
        if (shouldShowTimestamp(msg.time, prevMsgTime)) {
            const timeStamp = document.createElement('div');
            timeStamp.className = 'message-timestamp';
            timeStamp.style.cssText = 'text-align:center; padding:8px 0; color:#999; font-size:12px; font-family:-apple-system, BlinkMacSystemFont, sans-serif;';
            timeStamp.textContent = formatMessageTime(msg.time, prevMsgTime);
            body.appendChild(timeStamp);
        }
        
        // 创建消息元素（INS风格）
        const row = document.createElement('div');
        row.style.cssText = `display:flex; align-items:flex-end; gap:8px; margin-bottom:12px; padding:0 16px; ${msg.role === 'user' ? 'flex-direction:row-reverse;' : ''}`;
        
        // 头像
        const avatar = document.createElement('div');
        avatar.style.cssText = 'width:36px; height:36px; border-radius:50%; flex-shrink:0; background-size:cover; background-position:center;';
        if (msg.role === 'user') {
            if (userAvatarUrl) {
                avatar.style.backgroundImage = `url(${userAvatarUrl})`;
            } else {
                avatar.style.backgroundColor = '#f0f0f0';
            }
        } else {
            if (char.avatar) {
                avatar.style.backgroundImage = `url(${char.avatar})`;
            } else {
                avatar.style.backgroundColor = '#f0f0f0';
            }
        }
        
        // 内容气泡（INS风格）
        const content = document.createElement('div');
        const isUser = msg.role === 'user';
        content.style.cssText = `max-width:70%; padding:10px 14px; border-radius:18px; font-size:14px; line-height:1.8; word-wrap:break-word; white-space:pre-wrap; font-family:-apple-system, BlinkMacSystemFont, sans-serif; color:#333; ${isUser ? 'background:#ffb3d1; color:#fff; border-bottom-right-radius:4px;' : 'background:#f0f0f0; color:#333; border-bottom-left-radius:4px;'}`;
        // 使用innerHTML保留换行，并转义HTML防止XSS
        content.textContent = msg.content;
        
        row.appendChild(avatar);
        row.appendChild(content);
        body.appendChild(row);
    });
    
    // 滚动到底部
    setTimeout(() => {
        body.scrollTop = body.scrollHeight;
    }, 0);
}

// 处理线下模式输入框按键
function handleOfflineChatInputKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendOfflineMessage();
    }
}

// 处理线下模式输入框变化
function handleOfflineChatInputChange(textarea) {
    const btn = document.getElementById('offline-btn-send');
    if (textarea.value.trim()) {
        btn.style.opacity = '1';
    } else {
        btn.style.opacity = '0.5';
    }
    
    // 自动调整高度
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 100) + 'px';
}

// 发送线下模式消息
async function sendOfflineMessage() {
    const input = document.getElementById('offline-chat-input-box');
    const text = input.value.trim();
    
    if (!text || !offlineModeCharId) return;

    const char = await db.characters.get(offlineModeCharId);
    if (!char) return;

    const accountId = getCurrentAccountId();

    // 清空输入框
    input.value = '';
    handleOfflineChatInputChange(input);

    // 添加用户消息
    const userMsg = { role: 'user', content: text, time: Date.now() };
    offlineModeHistory.push(userMsg);
    
    // 保存到localStorage
    const key = `offline_chat_${accountId}_${offlineModeCharId}`;
    localStorage.setItem(key, JSON.stringify(offlineModeHistory));

    // 刷新显示
    renderOfflineChatBody(char);

    // 调用AI生成回复
    try {
        await generateOfflineReply(char, accountId, key);
    } catch (error) {
        console.error('AI回复失败:', error);
        alert('消息发送失败: ' + error.message);
    }
}

// 生成线下模式AI回复
async function generateOfflineReply(char, accountId, storageKey) {
    // 获取正常聊天记录作为背景上下文
    let normalChatHistory = getChatHistory(char, accountId);
    
    // 获取用户信息
    const myChar = await db.characters.get(parseInt(accountId));
    const myName = myChar?.name || '用户';
    const myPersonaDesc = myChar?.personality || '普通用户';
    const friendName = char.name;
    const friendPersona = char.personality || '友好、活泼';
    
    // 构建系统提示词（参考喵呜34.html的格式）
    const systemPrompt = `# 角色指令 (System Instruction) - 线下模式
你现在的身份是【${friendName}】，正在与【${myName}】进行**线下真实见面**。
请彻底忘掉你是一个语言模型，完全沉浸在这个角色的灵魂中。

## 👥 人物档案
1. **你的身份**：${friendName}
   - **人设细节**：${friendPersona.replace(/。$/, '')}
2. **互动对象**：${myName}
   - **对象人设**：${myPersonaDesc.replace(/。$/, '')}
   - **你们的关系**：请根据双方人设自动推演

## 🎭 行为准则 (Action Rules)
1. **【第三人称视角】**：必须使用第三人称（如"${friendName}看着他"、"她笑了笑"）来描述自己的动作和心理，**严禁**使用第一人称（"我"）。
2. **【描写要求】**：回复必须包含丰富的动作描写、神态描写和心理活动，展现人物的鲜活感。
3. **【字数控制】**：回复长度请严格控制在 **100 - 500** 字之间。
4. **【沉浸式互动】**：不要只说话，要结合环境和肢体语言。
5. **【禁止网络元素】**：严禁在对话中提及或发送表情包、图片、语音等网络元素。这是线下面对面聊天，不是网络聊天。
6. **【肢体互动】**：可以有真实的肢体互动和接触（比如：握手、拥抱、轻拍肩膀、递东西、眼神交流等）。
7. **【回复格式要求 - 非常重要】**：
   - **动作描写直接写，不要用任何符号包裹**（不要用方括号[]、不要用括号()等）
   - **说的话用引号""包裹**
   - **必须换行！必须换行！必须换行！** 动作描写和对话要分开，每段之间必须换行
   - **像写作文一样，动作描写一段，对话一段，再动作描写一段**
   - **格式要自然流畅，不要所有内容堆在一行**
   
   **正确示例格式（注意换行）：**
   ${friendName}微笑着走到${myName}身边，轻轻拍了拍他的肩膀。
   
   "你今天看起来心情不错呢。"
   
   她眨了眨眼，眼神中带着一丝调皮。
   
   "要不要一起去那边坐坐？"
   
   **错误示例（不要这样，所有内容堆在一起）：**
   ${friendName}微笑着走到${myName}身边，轻轻拍了拍他的肩膀。"你今天看起来心情不错呢。"她眨了眨眼，眼神中带着一丝调皮。
   
   **重要：回复中必须包含换行符（\\n），让内容分段显示，不要所有文字堆在一起！**

${normalChatHistory.length > 0 ? `## 📱 聊天背景
你们之前在微信上有过这些对话：
${normalChatHistory.slice(-10).map(h => `${h.role === 'user' ? myName : friendName}: ${h.content}`).join('\n')}

现在你们约出来见面了，进行线下聊天。请基于之前的聊天记录和当前的线下场景自然回复。` : ''}`;

    // 构建消息数组（包含线下模式的对话历史）
    const messages = [
        { role: 'system', content: systemPrompt },
        ...offlineModeHistory.slice(-15).map(h => ({ 
            role: h.role === 'user' ? 'user' : 'assistant', 
            content: h.content 
        }))
    ];

    const reply = await callAI(messages);

    // 添加AI回复
    const aiMsg = { role: 'assistant', content: reply, time: Date.now() };
    offlineModeHistory.push(aiMsg);
    
    // 保存
    localStorage.setItem(storageKey, JSON.stringify(offlineModeHistory));
    
    // 刷新显示
    renderOfflineChatBody(char);
}

// 重新生成最后一条AI回复
async function rerollOfflineMessage() {
    if (!offlineModeCharId) return;
    
    // 检查是否有AI回复可以重新生成
    if (offlineModeHistory.length < 2) {
        alert('还没有AI回复可以重新生成');
        return;
    }
    
    const lastMsg = offlineModeHistory[offlineModeHistory.length - 1];
    if (lastMsg.role !== 'assistant') {
        alert('最后一条消息不是AI回复');
        return;
    }
    
    // 移除最后一条AI回复
    offlineModeHistory.pop();
    
    const char = await db.characters.get(offlineModeCharId);
    if (!char) return;
    
    const accountId = getCurrentAccountId();
    const key = `offline_chat_${accountId}_${offlineModeCharId}`;
    
    // 保存移除后的历史
    localStorage.setItem(key, JSON.stringify(offlineModeHistory));
    
    // 刷新显示
    renderOfflineChatBody(char);
    
    // 重新生成回复
    try {
        await generateOfflineReply(char, accountId, key);
    } catch (error) {
        console.error('重新生成失败:', error);
        alert('重新生成失败: ' + error.message);
    }
}

// ===== 角色账号登录和查岗功能 =====

// 格式化时间
function formatTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
    if (diff < 604800000) return Math.floor(diff / 86400000) + '天前';
    
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hour = date.getHours();
    const minute = date.getMinutes();
    
    return `${month}月${day}日 ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
}

// ========== 联机社交功能 ==========

// 后端API地址
const ONLINE_API_BASE = window.location.hostname === 'localhost' 
    ? 'http://localhost:5000' 
    : 'https://rime-fsv3.onrender.com';

// 当前登录的联机用户
let onlineUser = null;
let onlineChatFriendId = null;

// 初始化联机功能
async function initOnlineFeature() {
    console.log('[Online] 初始化联机功能...');
    // 从localStorage恢复登录状态
    const savedUser = localStorage.getItem('onlineUser');
    console.log('[Online] localStorage中的用户数据:', savedUser ? '存在' : '不存在');
    
    if (savedUser) {
        try {
            onlineUser = JSON.parse(savedUser);
            console.log('[Online] 恢复登录状态成功:', onlineUser.username, '虚拟账号:', onlineUser.wechat_id);
            
            // 延迟更新UI，确保DOM已加载
            setTimeout(() => {
                try {
                    updateOnlineUI();
                } catch (e) {
                    console.log('[Online] updateOnlineUI 延迟执行中...');
                }
            }, 500);
            
            // 连接WebSocket
            connectOnlineSocket();
        } catch (e) {
            console.error('[Online] 恢复登录状态失败:', e);
            localStorage.removeItem('onlineUser');
        }
    }
}

// 连接WebSocket
function connectOnlineSocket() {
    if (!onlineUser || !window.io) return;
    
    // 如果已有连接，先断开
    if (window.onlineSocket) {
        window.onlineSocket.disconnect();
    }
    
    window.onlineSocket = io(ONLINE_API_BASE);
    
    window.onlineSocket.on('connect', () => {
        console.log('[Online] WebSocket connected');
        // 加入用户房间
        window.onlineSocket.emit('join_user_room', { user_id: onlineUser.id });
        window.onlineSocket.emit('user_online', { user_id: onlineUser.id });
    });
    
    // 收到新消息
    window.onlineSocket.on('new_user_message', (data) => {
        console.log('[Online] New message:', data);
        if (data.to_user_id == onlineUser.id) {
            // 如果当前正在和这个人聊天（微信窗口），实时显示
            if (currentRealFriendId == data.from_user_id) {
                // 添加消息到聊天窗口
                const chatBody = document.getElementById('chat-body');
                if (chatBody) {
                    const msgDiv = document.createElement('div');
                    msgDiv.className = 'message-row other';
                    
                    const avatarUrl = currentRealFriendInfo?.avatar || '';
                    const avatarStyle = avatarUrl ? `background-image:url(${avatarUrl})` : 'background:linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
                    
                    msgDiv.innerHTML = `
                        <div class="message-avatar" style="${avatarStyle}; background-size:cover; background-position:center;"></div>
                        <div class="message-content ai-bubble">${data.content}</div>
                    `;
                    
                    chatBody.appendChild(msgDiv);
                    chatBody.scrollTop = chatBody.scrollHeight;
                }
            }
            // 如果在设置页的聊天窗口
            if (onlineChatFriendId == data.from_user_id) {
                appendOnlineMessage(data);
            }
            // 刷新微信聊天列表
            const wechatContent = document.getElementById('wechat-content');
            if (wechatContent && document.getElementById('wechat-page').style.display !== 'none') {
                renderWechatList(wechatContent);
            }
        }
    });
    
    // 好友请求通知
    window.onlineSocket.on('new_friend_request', (data) => {
        if (data.to_user_id == onlineUser.id) {
            console.log('[Online] New friend request');
            refreshOnlineFriendRequestCount();
        }
    });
    
    // 新好友通知
    window.onlineSocket.on('friend_added', (data) => {
        if (data.user_id == onlineUser.id) {
            console.log('[Online] New friend added');
            refreshOnlineFriendCount();
        }
    });
}

// 切换联机设置折叠
function toggleOnlineSettings() {
    const body = document.getElementById('online-setting-body');
    const arrow = document.getElementById('online-setting-arrow');
    if (body.style.display === 'none') {
        body.style.display = 'block';
        arrow.textContent = '▲';
    } else {
        body.style.display = 'none';
        arrow.textContent = '▼';
    }
}

// 更新联机UI状态
function updateOnlineUI() {
    const loggedOut = document.getElementById('online-logged-out');
    const loggedIn = document.getElementById('online-logged-in');
    
    if (onlineUser) {
        loggedOut.style.display = 'none';
        loggedIn.style.display = 'block';
        
        document.getElementById('online-user-nickname').textContent = onlineUser.nickname || onlineUser.username;
        document.getElementById('online-user-wechat-id').textContent = onlineUser.wechat_id || '未绑定';  // wechat_id 存的是虚拟账号
        
        if (onlineUser.avatar) {
            document.getElementById('online-user-avatar').style.backgroundImage = `url(${onlineUser.avatar})`;
            document.getElementById('online-user-avatar').textContent = '';
            document.getElementById('online-user-avatar').style.backgroundSize = 'cover';
        }
        
        // 刷新好友请求和好友数量
        refreshOnlineFriendRequestCount();
        refreshOnlineFriendCount();
    } else {
        loggedOut.style.display = 'block';
        loggedIn.style.display = 'none';
    }
}

// 登录
async function onlineLogin() {
    const username = document.getElementById('online-username').value.trim();
    const password = document.getElementById('online-password').value;
    const resultDiv = document.getElementById('online-login-result');
    
    if (!username || !password) {
        resultDiv.innerHTML = '<span style="color:#ff3b30;">请输入用户名和密码</span>';
        return;
    }
    
    resultDiv.innerHTML = '<span style="color:#667eea;">登录中...</span>';
    
    try {
        const res = await fetch(`${ONLINE_API_BASE}/api/online/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            resultDiv.innerHTML = `<span style="color:#ff3b30;">${data.error || '登录失败'}</span>`;
            return;
        }
        
        onlineUser = data.user;
        localStorage.setItem('onlineUser', JSON.stringify(onlineUser));
        
        resultDiv.innerHTML = '<span style="color:#34c759;">登录成功！</span>';
        
        // 清空输入
        document.getElementById('online-username').value = '';
        document.getElementById('online-password').value = '';
        
        updateOnlineUI();
        connectOnlineSocket();
        
    } catch (e) {
        resultDiv.innerHTML = `<span style="color:#ff3b30;">网络错误: ${e.message}</span>`;
    }
}

// 当前选中的角色档案
let selectedUserCharForOnline = null;

// 显示注册模态框
async function showOnlineRegisterModal() {
    try {
        console.log('[Online] 打开注册模态框...');
        
        const modal = document.getElementById('online-register-modal');
        if (!modal) {
            console.error('[Online] 找不到注册模态框元素');
            alert('界面加载错误，请刷新页面重试');
            return;
        }
        
        modal.style.display = 'flex';
        
        const resultDiv = document.getElementById('register-online-result');
        if (resultDiv) resultDiv.textContent = '';
        
        const usernameInput = document.getElementById('register-online-username');
        if (usernameInput) usernameInput.value = '';
        
        const passwordInput = document.getElementById('register-online-password');
        if (passwordInput) passwordInput.value = '';
        
        selectedUserCharForOnline = null;
        
        const preview = document.getElementById('register-selected-preview');
        if (preview) preview.style.display = 'none';
        
        // 获取所有user类型角色
        console.log('[Online] 获取user类型角色...');
        const users = await db.characters.where('type').equals('user').toArray();
        console.log('[Online] 找到', users.length, '个user角色');
        
        const listDiv = document.getElementById('register-user-list');
        if (!listDiv) {
            console.error('[Online] 找不到用户列表元素');
            return;
        }
        
        if (users.length === 0) {
            listDiv.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">暂无角色档案<br><span style="font-size: 12px;">请先创建一个user类型的角色</span></div>';
            return;
        }
        
        listDiv.innerHTML = users.map((user, idx) => {
            const account = user.identity?.account || '未设置虚拟账号';
            const hasAccount = user.identity?.account ? true : false;
            return `
                <div class="register-user-item" data-idx="${idx}" onclick="selectUserCharForOnline(${user.id})" 
                     style="display: flex; align-items: center; padding: 12px; cursor: pointer; border-bottom: 1px solid #f0f0f0; transition: background 0.2s; ${!hasAccount ? 'opacity: 0.5;' : ''}"
                     onmouseover="this.style.background='#f9f9f9'" onmouseout="this.style.background=''">
                    <div style="width: 42px; height: 42px; border-radius: 50%; background: ${user.avatar ? `url(${user.avatar}) center/cover` : 'linear-gradient(135deg, #FFB6C1 0%, #FF69B4 100%)'}; margin-right: 12px; flex-shrink: 0;"></div>
                    <div style="flex: 1; min-width: 0;">
                        <div style="font-size: 14px; font-weight: 500; color: #333; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${user.name || '未命名'}</div>
                        <div style="font-size: 12px; color: ${hasAccount ? '#667eea' : '#999'}; margin-top: 2px;">虚拟账号: ${account}</div>
                    </div>
                    ${!hasAccount ? '<div style="font-size: 11px; color: #ff3b30; flex-shrink: 0;">需设置账号</div>' : '<div style="color: #667eea; font-size: 18px;">→</div>'}
                </div>
            `;
        }).join('');
        
        console.log('[Online] 注册模态框已显示');
        
    } catch (e) {
        console.error('[Online] 显示注册模态框出错:', e);
        alert('加载出错: ' + e.message);
    }
}

// 选择角色档案
async function selectUserCharForOnline(charId) {
    const user = await db.characters.get(charId);
    if (!user) return;
    
    if (!user.identity || !user.identity.account) {
        alert('该角色档案未设置虚拟账号，请先在角色详情中设置');
        return;
    }
    
    selectedUserCharForOnline = user;
    
    // 显示预览
    const preview = document.getElementById('register-selected-preview');
    preview.style.display = 'block';
    
    document.getElementById('register-bind-avatar').style.backgroundImage = user.avatar ? `url(${user.avatar})` : '';
    document.getElementById('register-bind-nickname').textContent = user.name || '未命名';
    document.getElementById('register-bind-wechat').textContent = user.identity.account;
    
    // 高亮选中项
    document.querySelectorAll('.register-user-item').forEach(item => {
        item.style.background = '';
        item.style.borderLeft = '';
    });
    // 找到对应项并高亮（通过遍历）
    const items = document.querySelectorAll('.register-user-item');
    items.forEach(item => {
        item.style.background = '';
    });
}

function hideOnlineRegisterModal() {
    document.getElementById('online-register-modal').style.display = 'none';
    document.getElementById('register-online-result').textContent = '';
    selectedUserCharForOnline = null;
}

// 注册
async function onlineRegister() {
    const username = document.getElementById('register-online-username').value.trim();
    const password = document.getElementById('register-online-password').value;
    const resultDiv = document.getElementById('register-online-result');
    
    // 检查是否选择了角色
    if (!selectedUserCharForOnline) {
        resultDiv.innerHTML = '<span style="color:#ff3b30;">请先选择一个角色档案</span>';
        return;
    }
    
    if (!selectedUserCharForOnline.identity || !selectedUserCharForOnline.identity.account) {
        resultDiv.innerHTML = '<span style="color:#ff3b30;">所选角色未设置虚拟账号</span>';
        return;
    }
    
    const virtual_account = selectedUserCharForOnline.identity.account;
    const nickname = selectedUserCharForOnline.name || username;
    const avatar = selectedUserCharForOnline.avatar || '';
    
    if (!username || !password) {
        resultDiv.innerHTML = '<span style="color:#ff3b30;">请输入登录用户名和密码</span>';
        return;
    }
    
    resultDiv.innerHTML = '<span style="color:#667eea;">注册中...</span>';
    
    try {
        const res = await fetch(`${ONLINE_API_BASE}/api/online/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, nickname, wechat_id: virtual_account, avatar })
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            resultDiv.innerHTML = `<span style="color:#ff3b30;">${data.error || '注册失败'}</span>`;
            return;
        }
        
        resultDiv.innerHTML = `<span style="color:#34c759;">注册成功！别人可以通过虚拟账号 <strong>${virtual_account}</strong> 添加你</span>`;
        
        // 自动登录
        onlineUser = data.user;
        localStorage.setItem('onlineUser', JSON.stringify(onlineUser));
        
        setTimeout(() => {
            hideOnlineRegisterModal();
            updateOnlineUI();
            connectOnlineSocket();
        }, 2000);
        
    } catch (e) {
        resultDiv.innerHTML = `<span style="color:#ff3b30;">网络错误: ${e.message}</span>`;
    }
}

// 退出登录
function onlineLogout() {
    if (!confirm('确定要退出登录吗？')) return;
    
    onlineUser = null;
    localStorage.removeItem('onlineUser');
    
    if (window.onlineSocket) {
        window.onlineSocket.disconnect();
        window.onlineSocket = null;
    }
    
    updateOnlineUI();
}

// 复制虚拟账号
function copyOnlineWechatId() {
    if (!onlineUser || !onlineUser.wechat_id) return;
    navigator.clipboard.writeText(onlineUser.wechat_id).then(() => {
        alert('虚拟账号已复制：' + onlineUser.wechat_id);
    });
}

// 显示搜索用户模态框
function showOnlineSearchModal() {
    document.getElementById('online-search-modal').style.display = 'flex';
    document.getElementById('search-wechat-id').value = '';
    document.getElementById('search-user-result').innerHTML = '<div style="text-align: center; color: #999; font-size: 14px; padding: 20px;">输入对方角色档案的虚拟账号搜索</div>';
}

function hideOnlineSearchModal() {
    document.getElementById('online-search-modal').style.display = 'none';
}

// 搜索用户
async function searchOnlineUser() {
    const wechatId = document.getElementById('search-wechat-id').value.trim();
    const resultDiv = document.getElementById('search-user-result');
    
    if (!wechatId) {
        resultDiv.innerHTML = '<div style="text-align: center; color: #ff3b30; padding: 20px;">请输入虚拟账号</div>';
        return;
    }
    
    resultDiv.innerHTML = '<div style="text-align: center; color: #667eea; padding: 20px;">搜索中...</div>';
    
    try {
        const res = await fetch(`${ONLINE_API_BASE}/api/online/search?wechat_id=${encodeURIComponent(wechatId)}&current_user_id=${onlineUser.id}`);
        const data = await res.json();
        
        if (!res.ok) {
            resultDiv.innerHTML = `<div style="text-align: center; color: #ff3b30; padding: 20px;">${data.error || '未找到用户'}</div>`;
            return;
        }
        
        const user = data.user;
        let actionBtn = '';
        
        if (user.id == onlineUser.id) {
            actionBtn = '<span style="color: #999;">这是你自己</span>';
        } else if (user.is_friend) {
            actionBtn = '<button onclick="startOnlineChat(' + user.id + ')" style="padding: 8px 20px; border: none; border-radius: 6px; background: #34c759; color: #fff; cursor: pointer;">发消息</button>';
        } else if (user.has_pending_request) {
            actionBtn = '<span style="color: #999;">已发送请求</span>';
        } else {
            actionBtn = '<button onclick="sendOnlineFriendRequest(' + user.id + ')" style="padding: 8px 20px; border: none; border-radius: 6px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #fff; cursor: pointer;">添加好友</button>';
        }
        
        resultDiv.innerHTML = `
            <div style="display: flex; align-items: center; padding: 16px; background: #f9f9f9; border-radius: 12px;">
                <div style="width: 50px; height: 50px; border-radius: 50%; background: ${user.avatar ? `url(${user.avatar}) center/cover` : 'linear-gradient(135deg, #FFB6C1 0%, #FF69B4 100%)'}; display: flex; align-items: center; justify-content: center; font-size: 20px; color: #fff; margin-right: 12px;">${user.avatar ? '' : '👤'}</div>
                <div style="flex: 1;">
                    <div style="font-size: 16px; font-weight: 600;">${user.nickname || user.username}</div>
                    <div style="font-size: 12px; color: #667eea;">虚拟账号: ${user.wechat_id}</div>
                    ${user.bio ? `<div style="font-size: 12px; color: #666; margin-top: 4px;">${user.bio}</div>` : ''}
                </div>
                <div>${actionBtn}</div>
            </div>
        `;
        
    } catch (e) {
        resultDiv.innerHTML = `<div style="text-align: center; color: #ff3b30; padding: 20px;">网络错误: ${e.message}</div>`;
    }
}

// 发送好友请求
async function sendOnlineFriendRequest(toUserId) {
    try {
        const res = await fetch(`${ONLINE_API_BASE}/api/online/friend_request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from_user_id: onlineUser.id, to_user_id: toUserId })
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            alert(data.error || '发送失败');
            return;
        }
        
        if (data.status === 'accepted') {
            alert(data.message);
            hideOnlineSearchModal();
            refreshOnlineFriendCount();
        } else {
            alert('好友请求已发送！');
            // 重新搜索刷新状态
            searchOnlineUser();
        }
        
    } catch (e) {
        alert('网络错误: ' + e.message);
    }
}

// 刷新好友请求数量
async function refreshOnlineFriendRequestCount() {
    if (!onlineUser) return;
    
    try {
        const res = await fetch(`${ONLINE_API_BASE}/api/online/friend_requests?user_id=${onlineUser.id}`);
        const data = await res.json();
        
        const count = data.requests ? data.requests.length : 0;
        const countDiv = document.getElementById('online-request-count');
        if (count > 0) {
            countDiv.innerHTML = `<span style="color: #ff3b30; font-weight: 600;">${count}个待处理</span>`;
        } else {
            countDiv.textContent = '暂无请求';
        }
    } catch (e) {
        console.error('获取好友请求失败:', e);
    }
}

// 刷新好友数量
async function refreshOnlineFriendCount() {
    if (!onlineUser) return;
    
    try {
        const res = await fetch(`${ONLINE_API_BASE}/api/online/friends?user_id=${onlineUser.id}`);
        const data = await res.json();
        
        const count = data.friends ? data.friends.length : 0;
        document.getElementById('online-friend-count').textContent = `${count}位好友`;
    } catch (e) {
        console.error('获取好友数量失败:', e);
    }
}

// 显示好友请求列表
async function showOnlineFriendRequests() {
    document.getElementById('online-requests-modal').style.display = 'flex';
    const listDiv = document.getElementById('online-requests-list');
    listDiv.innerHTML = '<div style="text-align: center; color: #667eea; padding: 20px;">加载中...</div>';
    
    try {
        const res = await fetch(`${ONLINE_API_BASE}/api/online/friend_requests?user_id=${onlineUser.id}`);
        const data = await res.json();
        
        if (!data.requests || data.requests.length === 0) {
            listDiv.innerHTML = '<div style="text-align: center; color: #999; font-size: 14px; padding: 40px 20px;">暂无好友请求</div>';
            return;
        }
        
        listDiv.innerHTML = data.requests.map(req => `
            <div style="display: flex; align-items: center; padding: 12px; background: #f9f9f9; border-radius: 10px; margin-bottom: 10px;">
                <div style="width: 44px; height: 44px; border-radius: 50%; background: ${req.from_user.avatar ? `url(${req.from_user.avatar}) center/cover` : 'linear-gradient(135deg, #FFB6C1 0%, #FF69B4 100%)'}; display: flex; align-items: center; justify-content: center; font-size: 18px; color: #fff; margin-right: 12px;">${req.from_user.avatar ? '' : '👤'}</div>
                <div style="flex: 1;">
                    <div style="font-size: 15px; font-weight: 500;">${req.from_user.nickname || req.from_user.username}</div>
                    <div style="font-size: 12px; color: #667eea;">虚拟账号: ${req.from_user.wechat_id || req.from_user.social_id}</div>
                    ${req.message ? `<div style="font-size: 12px; color: #666; margin-top: 2px;">"${req.message}"</div>` : ''}
                </div>
                <div style="display: flex; gap: 8px;">
                    <button onclick="handleOnlineFriendRequest(${req.id}, 'accept')" style="padding: 6px 14px; border: none; border-radius: 6px; background: #34c759; color: #fff; font-size: 13px; cursor: pointer;">接受</button>
                    <button onclick="handleOnlineFriendRequest(${req.id}, 'reject')" style="padding: 6px 14px; border: 1px solid #ddd; border-radius: 6px; background: #fff; color: #666; font-size: 13px; cursor: pointer;">拒绝</button>
                </div>
            </div>
        `).join('');
        
    } catch (e) {
        listDiv.innerHTML = `<div style="text-align: center; color: #ff3b30; padding: 20px;">加载失败: ${e.message}</div>`;
    }
}

function hideOnlineFriendRequests() {
    document.getElementById('online-requests-modal').style.display = 'none';
}

// 处理好友请求
async function handleOnlineFriendRequest(requestId, action) {
    try {
        const res = await fetch(`${ONLINE_API_BASE}/api/online/friend_request/${requestId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, user_id: onlineUser.id })
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            alert(data.error || '操作失败');
            return;
        }
        
        // 刷新列表
        showOnlineFriendRequests();
        refreshOnlineFriendRequestCount();
        
        if (action === 'accept') {
            refreshOnlineFriendCount();
        }
        
    } catch (e) {
        alert('网络错误: ' + e.message);
    }
}

// 显示好友列表
async function showOnlineFriendList() {
    document.getElementById('online-friends-modal').style.display = 'flex';
    const listDiv = document.getElementById('online-friends-list');
    listDiv.innerHTML = '<div style="text-align: center; color: #667eea; padding: 20px;">加载中...</div>';
    
    try {
        const res = await fetch(`${ONLINE_API_BASE}/api/online/friends?user_id=${onlineUser.id}`);
        const data = await res.json();
        
        if (!data.friends || data.friends.length === 0) {
            listDiv.innerHTML = '<div style="text-align: center; color: #999; font-size: 14px; padding: 40px 20px;">暂无好友<br><br>去搜索添加新朋友吧！</div>';
            return;
        }
        
        listDiv.innerHTML = data.friends.map(friend => `
            <div style="display: flex; align-items: center; padding: 12px; background: #f9f9f9; border-radius: 10px; margin-bottom: 10px; cursor: pointer;" onclick="startOnlineChat(${friend.id})">
                <div style="width: 48px; height: 48px; border-radius: 50%; background: ${friend.avatar ? `url(${friend.avatar}) center/cover` : 'linear-gradient(135deg, #FFB6C1 0%, #FF69B4 100%)'}; display: flex; align-items: center; justify-content: center; font-size: 20px; color: #fff; margin-right: 12px;">${friend.avatar ? '' : '👤'}</div>
                <div style="flex: 1;">
                    <div style="font-size: 15px; font-weight: 500;">${friend.nickname || friend.username}</div>
                    <div style="font-size: 12px; color: #667eea;">虚拟账号: ${friend.wechat_id || friend.social_id}</div>
                    ${friend.bio ? `<div style="font-size: 12px; color: #666; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 180px;">${friend.bio}</div>` : ''}
                </div>
                <div style="color: #667eea; font-size: 20px;">💬</div>
            </div>
        `).join('');
        
    } catch (e) {
        listDiv.innerHTML = `<div style="text-align: center; color: #ff3b30; padding: 20px;">加载失败: ${e.message}</div>`;
    }
}

function hideOnlineFriendList() {
    document.getElementById('online-friends-modal').style.display = 'none';
}

// 开始聊天
async function startOnlineChat(friendId) {
    hideOnlineSearchModal();
    hideOnlineFriendList();
    
    onlineChatFriendId = friendId;
    
    // 获取好友信息
    try {
        const res = await fetch(`${ONLINE_API_BASE}/api/online/friends?user_id=${onlineUser.id}`);
        const data = await res.json();
        const friend = data.friends.find(f => f.id == friendId);
        
        if (friend) {
            document.getElementById('online-chat-title').textContent = friend.nickname || friend.username;
        }
    } catch (e) {
        console.error('获取好友信息失败:', e);
    }
    
    // 显示聊天窗口
    document.getElementById('online-chat-page').style.display = 'flex';
    
    // 加载聊天记录
    await loadOnlineChatHistory();
}

function hideOnlineChatPage() {
    document.getElementById('online-chat-page').style.display = 'none';
    onlineChatFriendId = null;
}

// 加载聊天记录
async function loadOnlineChatHistory() {
    const chatBody = document.getElementById('online-chat-body');
    chatBody.innerHTML = '<div style="text-align: center; color: #999; padding: 20px;">加载中...</div>';
    
    try {
        const res = await fetch(`${ONLINE_API_BASE}/api/online/messages?user_id=${onlineUser.id}&friend_id=${onlineChatFriendId}&limit=100`);
        const data = await res.json();
        
        if (!data.messages || data.messages.length === 0) {
            chatBody.innerHTML = '<div style="text-align: center; color: #999; padding: 40px 20px; font-size: 14px;">暂无消息<br>发送第一条消息开始聊天吧！</div>';
            return;
        }
        
        chatBody.innerHTML = data.messages.map(msg => {
            const isMe = msg.from_user_id == onlineUser.id;
            return `
                <div class="message-row ${isMe ? 'self' : 'other'}" style="display: flex; margin-bottom: 12px; ${isMe ? 'flex-direction: row-reverse;' : ''}">
                    <div class="message-content" style="max-width: 70%; padding: 10px 14px; border-radius: 18px; ${isMe ? 'background: var(--ins-pink-light); border-bottom-right-radius: 4px;' : 'background: #f2f2f7; border-bottom-left-radius: 4px;'}">
                        ${msg.content}
                    </div>
                </div>
            `;
        }).join('');
        
        // 滚动到底部
        chatBody.scrollTop = chatBody.scrollHeight;
        
    } catch (e) {
        chatBody.innerHTML = `<div style="text-align: center; color: #ff3b30; padding: 20px;">加载失败: ${e.message}</div>`;
    }
}

// 追加消息到聊天界面
function appendOnlineMessage(msg) {
    const chatBody = document.getElementById('online-chat-body');
    const isMe = msg.from_user_id == onlineUser.id;
    
    // 移除空状态提示
    const emptyTip = chatBody.querySelector('div[style*="暂无消息"]');
    if (emptyTip) emptyTip.remove();
    
    const msgDiv = document.createElement('div');
    msgDiv.className = `message-row ${isMe ? 'self' : 'other'}`;
    msgDiv.style.cssText = `display: flex; margin-bottom: 12px; ${isMe ? 'flex-direction: row-reverse;' : ''}`;
    msgDiv.innerHTML = `
        <div class="message-content" style="max-width: 70%; padding: 10px 14px; border-radius: 18px; ${isMe ? 'background: var(--ins-pink-light); border-bottom-right-radius: 4px;' : 'background: #f2f2f7; border-bottom-left-radius: 4px;'}">
            ${msg.content}
        </div>
    `;
    
    chatBody.appendChild(msgDiv);
    chatBody.scrollTop = chatBody.scrollHeight;
}

// 发送消息
async function sendOnlineMessage() {
    const input = document.getElementById('online-chat-input');
    const content = input.value.trim();
    
    if (!content || !onlineChatFriendId) return;
    
    input.value = '';
    
    // 立即显示到界面
    appendOnlineMessage({
        from_user_id: onlineUser.id,
        content: content,
        created_at: Date.now() / 1000
    });
    
    try {
        const res = await fetch(`${ONLINE_API_BASE}/api/online/message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                from_user_id: onlineUser.id,
                to_user_id: onlineChatFriendId,
                content: content
            })
        });
        
        if (!res.ok) {
            const data = await res.json();
            console.error('发送失败:', data.error);
        }
        
    } catch (e) {
        console.error('发送消息失败:', e);
    }
}

// 显示编辑资料
function showOnlineProfileEdit() {
    if (!onlineUser) return;
    
    document.getElementById('online-profile-modal').style.display = 'flex';
    document.getElementById('profile-nickname').value = onlineUser.nickname || '';
    document.getElementById('profile-bio').value = onlineUser.bio || '';
    
    const preview = document.getElementById('profile-avatar-preview');
    if (onlineUser.avatar) {
        preview.style.backgroundImage = `url(${onlineUser.avatar})`;
        preview.textContent = '';
        preview.style.backgroundSize = 'cover';
    } else {
        preview.style.backgroundImage = '';
        preview.textContent = '👤';
    }
}

function hideOnlineProfileEdit() {
    document.getElementById('online-profile-modal').style.display = 'none';
}

// 处理头像上传
function handleProfileAvatarChange(input) {
    if (!input.files || !input.files[0]) return;
    
    const file = input.files[0];
    const reader = new FileReader();
    
    reader.onload = function(e) {
        const preview = document.getElementById('profile-avatar-preview');
        preview.style.backgroundImage = `url(${e.target.result})`;
        preview.textContent = '';
        preview.style.backgroundSize = 'cover';
        preview.dataset.newAvatar = e.target.result;
    };
    
    reader.readAsDataURL(file);
}

// 保存资料
async function saveOnlineProfile() {
    const nickname = document.getElementById('profile-nickname').value.trim();
    const bio = document.getElementById('profile-bio').value.trim();
    const preview = document.getElementById('profile-avatar-preview');
    const newAvatar = preview.dataset.newAvatar;
    
    try {
        const res = await fetch(`${ONLINE_API_BASE}/api/online/profile`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_id: onlineUser.id,
                nickname: nickname || onlineUser.username,
                bio: bio,
                avatar: newAvatar || onlineUser.avatar
            })
        });
        
        if (!res.ok) {
            const data = await res.json();
            alert(data.error || '保存失败');
            return;
        }
        
        // 更新本地数据
        onlineUser.nickname = nickname || onlineUser.username;
        onlineUser.bio = bio;
        if (newAvatar) onlineUser.avatar = newAvatar;
        
        localStorage.setItem('onlineUser', JSON.stringify(onlineUser));
        updateOnlineUI();
        
        hideOnlineProfileEdit();
        alert('保存成功！');
        
    } catch (e) {
        alert('网络错误: ' + e.message);
    }
}

// 页面加载时初始化联机功能
document.addEventListener('DOMContentLoaded', function() {
    initOnlineFeature();
});

// ========== 微信页面 - 添加真人好友功能 ==========

// 获取当前角色档案的虚拟账号信息
async function getCurrentAccountOnlineInfo() {
    const accountId = getCurrentAccountId();
    if (!accountId) return null;
    
    // 获取当前用户角色
    const users = await db.characters.where('type').equals('user').toArray();
    for (const user of users) {
        if (user.identity && user.identity.wechat_registered) {
            // 检查是否是当前账号
            if (user.id == accountId || (user.identity.account && user.identity.account === accountId)) {
                return {
                    account: user.identity.account,
                    nickname: user.name,
                    avatar: user.avatar,
                    charId: user.id
                };
            }
        }
    }
    
    // 如果找不到，尝试直接用accountId查找
    const char = await db.characters.get(parseInt(accountId));
    if (char && char.identity && char.identity.account) {
        return {
            account: char.identity.account,
            nickname: char.name,
            avatar: char.avatar,
            charId: char.id
        };
    }
    
    return null;
}

// 显示添加真人好友模态框
async function showAddRealFriendModal() {
    toggleWechatMenu(); // 关闭菜单
    document.getElementById('add-real-friend-modal').style.display = 'flex';
    
    const loginCheck = document.getElementById('real-friend-login-check');
    const searchArea = document.getElementById('real-friend-search-area');
    
    // 获取当前账号的虚拟账号信息
    const currentAccountInfo = await getCurrentAccountOnlineInfo();
    
    if (!currentAccountInfo || !currentAccountInfo.account) {
        loginCheck.innerHTML = `
            <div style="text-align:center; padding:20px;">
                <div style="font-size:48px; margin-bottom:16px;">⚠️</div>
                <div style="font-size:15px; color:#666; margin-bottom:16px;">当前角色档案未设置虚拟账号<br>请先在角色档案中设置虚拟账号</div>
            </div>
        `;
        searchArea.style.display = 'none';
    } else if (!onlineUser || onlineUser.wechat_id !== currentAccountInfo.account) {
        // 当前账号未注册联机或不是当前登录的联机账号
        loginCheck.innerHTML = `
            <div style="text-align:center; padding:20px;">
                <div style="font-size:48px; margin-bottom:16px;">🔐</div>
                <div style="font-size:14px; color:#666; margin-bottom:8px;">当前账号：<strong>${currentAccountInfo.account}</strong></div>
                <div style="font-size:15px; color:#666; margin-bottom:16px;">需要先为此账号开通联机功能</div>
                <button onclick="hideAddRealFriendModal(); showSettingPage(); setTimeout(toggleOnlineSettings, 300);" 
                        style="padding:12px 24px; border:none; border-radius:8px; background:linear-gradient(135deg, #667eea 0%, #764ba2 100%); color:#fff; font-size:15px; cursor:pointer;">
                    去开通联机
                </button>
            </div>
        `;
        searchArea.style.display = 'none';
    } else {
        loginCheck.innerHTML = `
            <div style="display:flex; align-items:center; padding:12px; background:#f5f5f5; border-radius:8px; margin-bottom:16px;">
                <div style="width:36px; height:36px; border-radius:50%; background:${currentAccountInfo.avatar ? `url(${currentAccountInfo.avatar}) center/cover` : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'}; margin-right:10px; display:flex; align-items:center; justify-content:center; color:#fff;">${currentAccountInfo.avatar ? '' : '👤'}</div>
                <div>
                    <div style="font-size:14px; font-weight:500;">${currentAccountInfo.nickname}</div>
                    <div style="font-size:12px; color:#667eea;">虚拟账号: ${currentAccountInfo.account}</div>
                </div>
            </div>
        `;
        searchArea.style.display = 'block';
        document.getElementById('real-friend-search-input').value = '';
        document.getElementById('real-friend-search-result').innerHTML = '<div style="text-align:center; color:#999; font-size:14px; padding:20px;">输入对方角色档案的虚拟账号</div>';
    }
}

function hideAddRealFriendModal() {
    document.getElementById('add-real-friend-modal').style.display = 'none';
}

// 搜索真人好友
async function searchRealFriend() {
    const account = document.getElementById('real-friend-search-input').value.trim();
    const resultDiv = document.getElementById('real-friend-search-result');
    
    if (!account) {
        resultDiv.innerHTML = '<div style="text-align:center; color:#ff3b30; padding:20px;">请输入虚拟账号</div>';
        return;
    }
    
    if (!onlineUser) {
        resultDiv.innerHTML = '<div style="text-align:center; color:#ff3b30; padding:20px;">请先登录联机账号</div>';
        return;
    }
    
    resultDiv.innerHTML = '<div style="text-align:center; color:#07c160; padding:20px;">搜索中...</div>';
    
    try {
        const res = await fetch(`${ONLINE_API_BASE}/api/online/search?wechat_id=${encodeURIComponent(account)}&current_user_id=${onlineUser.id}`);
        const data = await res.json();
        
        if (!res.ok) {
            resultDiv.innerHTML = `<div style="text-align:center; color:#ff3b30; padding:20px;">${data.error || '未找到用户'}</div>`;
            return;
        }
        
        const user = data.user;
        let actionBtn = '';
        
        // 检查是否是自己的账号
        if (user.wechat_id === onlineUser.wechat_id) {
            actionBtn = '<span style="color:#999;">这是你自己的账号</span>';
        } else if (user.is_friend) {
            const nickname = (user.nickname || user.username || '').replace(/'/g, "\\'").replace(/"/g, '\\"');
            const avatar = (user.avatar || '').replace(/'/g, "\\'").replace(/"/g, '\\"');
            actionBtn = `<button onclick="hideAddRealFriendModal(); openRealFriendChat(${user.id}, '${nickname}', '${avatar}')" style="padding:8px 16px; border:none; border-radius:6px; background:#07c160; color:#fff; cursor:pointer;">发消息</button>`;
        } else if (user.has_pending_request) {
            actionBtn = '<span style="color:#999;">已发送请求</span>';
        } else {
            actionBtn = `<button onclick="sendRealFriendRequest(${user.id})" style="padding:8px 16px; border:none; border-radius:6px; background:#07c160; color:#fff; cursor:pointer;">添加好友</button>`;
        }
        
        resultDiv.innerHTML = `
            <div style="display:flex; align-items:center; padding:14px; background:#f9f9f9; border-radius:10px;">
                <div style="width:48px; height:48px; border-radius:50%; background:${user.avatar ? `url(${user.avatar}) center/cover` : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'}; display:flex; align-items:center; justify-content:center; color:#fff; margin-right:12px;">${user.avatar ? '' : '👤'}</div>
                <div style="flex:1;">
                    <div style="font-size:15px; font-weight:500;">${user.nickname || user.username}</div>
                    <div style="font-size:12px; color:#667eea;">虚拟账号: ${user.wechat_id}</div>
                </div>
                <div>${actionBtn}</div>
            </div>
        `;
        
    } catch (e) {
        console.error('搜索失败:', e);
        resultDiv.innerHTML = `<div style="text-align:center; color:#ff3b30; padding:20px;">网络错误: ${e.message}</div>`;
    }
}

// 发送真人好友请求
async function sendRealFriendRequest(toUserId) {
    if (!onlineUser) {
        alert('请先登录联机账号');
        return;
    }
    
    try {
        const res = await fetch(`${ONLINE_API_BASE}/api/online/friend_request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from_user_id: onlineUser.id, to_user_id: toUserId })
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            alert(data.error || '发送失败');
            return;
        }
        
        if (data.status === 'accepted') {
            alert(data.message);
            hideAddRealFriendModal();
            // 刷新聊天列表
            const container = document.getElementById('wechat-content');
            if (container) renderWechatList(container);
        } else {
            alert('好友请求已发送！等待对方同意');
            searchRealFriend(); // 刷新显示
        }
        
    } catch (e) {
        alert('网络错误: ' + e.message);
    }
}

// 当前真人聊天好友信息
let currentRealFriendId = null;
let currentRealFriendInfo = null;

// 打开真人好友聊天（使用和AI聊天一样的窗口）
async function openRealFriendChat(friendId, nickname, avatar) {
    // 清除AI聊天状态
    currentChatCharId = null;
    window.currentGroupChatId = null;
    
    // 设置真人聊天状态
    currentRealFriendId = friendId;
    currentRealFriendInfo = { id: friendId, nickname, avatar };
    
    // 设置标题
    const titleEl = document.getElementById('chat-title');
    titleEl.innerText = nickname || '聊天';
    titleEl.style.cursor = 'default';
    titleEl.onclick = null;
    
    // 显示聊天窗口
    document.getElementById('chat-window').style.display = 'flex';
    
    // 显示输入框
    const chatFooter = document.getElementById('chat-footer');
    chatFooter.style.display = 'flex';
    
    // 隐藏AI相关的按钮（魔法棒等）
    const magicBtn = chatFooter.querySelector('.chat-icon-btn');
    if (magicBtn) magicBtn.style.display = 'none';
    
    // 渲染真人聊天记录
    await renderRealFriendChatBody();
}

// 渲染真人好友聊天记录
async function renderRealFriendChatBody() {
    const chatBody = document.getElementById('chat-body');
    chatBody.innerHTML = '<div style="text-align:center; color:#999; padding:40px;">加载中...</div>';
    
    if (!currentRealFriendId || !onlineUser) {
        chatBody.innerHTML = '<div style="text-align:center; color:#999; padding:40px;">加载失败</div>';
        return;
    }
    
    try {
        const res = await fetch(`${ONLINE_API_BASE}/api/online/messages?user_id=${onlineUser.id}&friend_id=${currentRealFriendId}&limit=100`);
        const data = await res.json();
        
        if (!data.messages || data.messages.length === 0) {
            chatBody.innerHTML = '<div style="text-align:center; color:#999; padding:40px; font-size:14px;">暂无消息，发送第一条消息开始聊天吧！</div>';
            return;
        }
        
        chatBody.innerHTML = '';
        
        data.messages.forEach(msg => {
            const isMe = msg.from_user_id == onlineUser.id;
            const msgDiv = document.createElement('div');
            msgDiv.className = `message-row ${isMe ? 'self' : 'other'}`;
            
            // 使用和AI聊天一样的样式
            const avatarUrl = isMe ? (onlineUser.avatar || '') : (currentRealFriendInfo.avatar || '');
            const avatarStyle = avatarUrl ? `background-image:url(${avatarUrl})` : 'background:linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
            
            msgDiv.innerHTML = `
                <div class="message-avatar" style="${avatarStyle}; background-size:cover; background-position:center;"></div>
                <div class="message-content ${isMe ? 'user-bubble' : 'ai-bubble'}">${msg.content}</div>
            `;
            
            chatBody.appendChild(msgDiv);
        });
        
        // 滚动到底部
        chatBody.scrollTop = chatBody.scrollHeight;
        
    } catch (e) {
        chatBody.innerHTML = `<div style="text-align:center; color:#ff3b30; padding:40px;">加载失败: ${e.message}</div>`;
    }
}

// 发送真人聊天消息
async function sendRealFriendMessage(content) {
    if (!content || !currentRealFriendId || !onlineUser) return;
    
    // 立即显示到界面
    const chatBody = document.getElementById('chat-body');
    
    // 移除空状态提示
    const emptyTip = chatBody.querySelector('div[style*="暂无消息"]');
    if (emptyTip) chatBody.innerHTML = '';
    
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message-row self';
    
    const avatarUrl = onlineUser.avatar || '';
    const avatarStyle = avatarUrl ? `background-image:url(${avatarUrl})` : 'background:linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
    
    msgDiv.innerHTML = `
        <div class="message-avatar" style="${avatarStyle}; background-size:cover; background-position:center;"></div>
        <div class="message-content user-bubble">${content}</div>
    `;
    
    chatBody.appendChild(msgDiv);
    chatBody.scrollTop = chatBody.scrollHeight;
    
    // 发送到后端
    try {
        await fetch(`${ONLINE_API_BASE}/api/online/message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                from_user_id: onlineUser.id,
                to_user_id: currentRealFriendId,
                content: content
            })
        });
    } catch (e) {
        console.error('发送消息失败:', e);
    }
}

// ========== 混合群聊功能 ==========

// 当前混合群聊状态
window.currentMixedGroupId = null;
window.currentMixedGroupInfo = null;
let mixedGroupStep = 1;
let selectedMixedFriends = [];
let selectedMixedChar = null;
let pendingMixedGroupInvite = null;

// 显示创建混合群聊弹窗
async function showCreateMixedGroupModal() {
    toggleWechatMenu(); // 关闭菜单
    
    // 检查是否登录联机账号
    if (!onlineUser) {
        alert('请先在设置中登录联机账号才能创建联机群聊');
        return;
    }
    
    // 获取当前账号信息
    const currentAccountInfo = await getCurrentAccountOnlineInfo();
    if (!currentAccountInfo || !currentAccountInfo.account) {
        alert('当前角色档案未设置虚拟账号');
        return;
    }
    
    if (onlineUser.wechat_id !== currentAccountInfo.account) {
        alert('当前角色档案与联机账号不匹配，请切换到对应的角色档案');
        return;
    }
    
    // 重置状态
    mixedGroupStep = 1;
    selectedMixedFriends = [];
    selectedMixedChar = null;
    
    document.getElementById('create-mixed-group-modal').style.display = 'flex';
    document.getElementById('mixed-group-name-input').value = '';
    document.getElementById('mixed-group-step1').style.display = 'flex';
    document.getElementById('mixed-group-step2').style.display = 'none';
    document.getElementById('mixed-step-1').style.background = 'var(--ins-pink)';
    document.getElementById('mixed-step-2').style.background = '#ddd';
    document.getElementById('mixed-group-next-btn').textContent = '下一步';
    
    // 加载真人好友列表
    await loadMixedGroupFriends();
}

// 加载真人好友列表
async function loadMixedGroupFriends() {
    const listEl = document.getElementById('mixed-group-friends-list');
    
    if (!onlineUser) {
        listEl.innerHTML = '<div style="text-align:center; color:#999; padding:40px;">请先登录联机账号</div>';
        return;
    }
    
    try {
        const res = await fetch(`${ONLINE_API_BASE}/api/online/friends?user_id=${onlineUser.id}`);
        const data = await res.json();
        
        if (!data.friends || data.friends.length === 0) {
            listEl.innerHTML = `
                <div style="text-align:center; color:#999; padding:40px;">
                    暂无真人好友<br>
                    <span style="font-size:12px;">请先添加真人好友再创建联机群聊</span>
                </div>
            `;
            return;
        }
        
        listEl.innerHTML = data.friends.map(friend => `
            <div class="friend-select-item" data-id="${friend.id}" onclick="toggleMixedFriend(${friend.id}, this)" 
                 style="display:flex; align-items:center; padding:12px; margin-bottom:8px; border-radius:10px; background:#f9f9f9; cursor:pointer; transition:all 0.2s;">
                <div style="width:42px; height:42px; border-radius:50%; background:${friend.avatar ? `url(${friend.avatar}) center/cover` : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'}; margin-right:12px; display:flex; align-items:center; justify-content:center; color:#fff;">${friend.avatar ? '' : '👤'}</div>
                <div style="flex:1;">
                    <div style="font-size:15px; font-weight:500;">${friend.nickname || friend.username}</div>
                    <div style="font-size:12px; color:#667eea;">${friend.wechat_id || ''}</div>
                </div>
                <div class="check-mark" style="width:24px; height:24px; border-radius:50%; border:2px solid #ddd; display:flex; align-items:center; justify-content:center; transition:all 0.2s;">
                    <svg style="width:14px; height:14px; stroke:#fff; stroke-width:3; fill:none; opacity:0;" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>
                </div>
            </div>
        `).join('');
        
    } catch (e) {
        console.error('加载好友列表失败:', e);
        listEl.innerHTML = '<div style="text-align:center; color:#ff3b30; padding:40px;">加载失败</div>';
    }
}

// 切换选中好友
function toggleMixedFriend(friendId, el) {
    const index = selectedMixedFriends.indexOf(friendId);
    const checkMark = el.querySelector('.check-mark');
    const svg = checkMark.querySelector('svg');
    
    if (index > -1) {
        selectedMixedFriends.splice(index, 1);
        el.style.background = '#f9f9f9';
        checkMark.style.background = 'transparent';
        checkMark.style.borderColor = '#ddd';
        svg.style.opacity = '0';
    } else {
        selectedMixedFriends.push(friendId);
        el.style.background = '#fff5f7';
        checkMark.style.background = 'var(--ins-pink)';
        checkMark.style.borderColor = 'var(--ins-pink)';
        svg.style.opacity = '1';
    }
}

// 下一步/创建
async function mixedGroupNextStep() {
    if (mixedGroupStep === 1) {
        // 验证是否选择了好友
        if (selectedMixedFriends.length === 0) {
            alert('请至少选择一个真人好友');
            return;
        }
        
        // 切换到步骤2
        mixedGroupStep = 2;
        document.getElementById('mixed-group-step1').style.display = 'none';
        document.getElementById('mixed-group-step2').style.display = 'flex';
        document.getElementById('mixed-step-1').style.background = '#ddd';
        document.getElementById('mixed-step-2').style.background = 'var(--ins-pink)';
        document.getElementById('mixed-group-next-btn').textContent = '创建群聊';
        
        // 加载角色列表
        await loadMixedGroupChars();
        
    } else {
        // 验证是否选择了角色
        if (!selectedMixedChar) {
            alert('请选择一个角色');
            return;
        }
        
        // 创建群聊
        await createMixedGroup();
    }
}

// 加载角色列表（排除user类型）
async function loadMixedGroupChars() {
    const listEl = document.getElementById('mixed-group-char-list');
    
    // 获取所有非user类型的角色
    const chars = await db.characters.where('type').notEqual('user').toArray();
    
    if (chars.length === 0) {
        listEl.innerHTML = `
            <div style="text-align:center; color:#999; padding:40px;">
                暂无可选角色<br>
                <span style="font-size:12px;">请先创建角色档案</span>
            </div>
        `;
        return;
    }
    
    listEl.innerHTML = chars.map(char => `
        <div class="char-select-item" data-id="${char.id}" onclick="selectMixedChar(${char.id}, this)" 
             style="display:flex; align-items:center; padding:12px; margin-bottom:8px; border-radius:10px; background:#f9f9f9; cursor:pointer; transition:all 0.2s;">
            <div style="width:48px; height:48px; border-radius:50%; background:${char.avatar ? `url(${char.avatar}) center/cover` : '#eee'}; margin-right:12px;"></div>
            <div style="flex:1;">
                <div style="font-size:15px; font-weight:500;">${char.name || '未命名'}</div>
                <div style="font-size:12px; color:#999;">${char.type || 'char'}</div>
            </div>
            <div class="check-mark" style="width:24px; height:24px; border-radius:50%; border:2px solid #ddd; display:flex; align-items:center; justify-content:center; transition:all 0.2s;">
                <svg style="width:14px; height:14px; stroke:#fff; stroke-width:3; fill:none; opacity:0;" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>
            </div>
        </div>
    `).join('');
}

// 选择角色（单选）
function selectMixedChar(charId, el) {
    // 清除之前的选择
    document.querySelectorAll('#mixed-group-char-list .char-select-item').forEach(item => {
        item.style.background = '#f9f9f9';
        const cm = item.querySelector('.check-mark');
        cm.style.background = 'transparent';
        cm.style.borderColor = '#ddd';
        cm.querySelector('svg').style.opacity = '0';
    });
    
    // 选中当前
    selectedMixedChar = charId;
    el.style.background = '#fff5f7';
    const checkMark = el.querySelector('.check-mark');
    checkMark.style.background = 'var(--ins-pink)';
    checkMark.style.borderColor = 'var(--ins-pink)';
    checkMark.querySelector('svg').style.opacity = '1';
}

// 创建混合群聊
async function createMixedGroup() {
    const groupName = document.getElementById('mixed-group-name-input').value.trim();
    
    // 获取选中角色的信息
    const char = await db.characters.get(selectedMixedChar);
    if (!char) {
        alert('角色信息获取失败');
        return;
    }
    
    // 获取用户人设和角色人设
    const currentAccountInfo = await getCurrentAccountOnlineInfo();
    const userPersona = currentAccountInfo ? `用户名: ${currentAccountInfo.nickname}` : '';
    const charPersona = char.persona || char.description || '';
    
    try {
        const res = await fetch(`${ONLINE_API_BASE}/api/mixed_group/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                creator_id: onlineUser.id,
                invited_user_ids: selectedMixedFriends,
                name: groupName || `联机群聊`,
                creator_char_id: char.id,
                creator_char_name: char.name,
                creator_char_avatar: char.avatar,
                creator_user_persona: userPersona,
                creator_char_persona: charPersona
            })
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            alert(data.error || '创建失败');
            return;
        }
        
        alert('联机群聊创建成功！等待好友加入并选择角色');
        closeMixedGroupModal();
        
        // 刷新聊天列表
        const container = document.getElementById('wechat-content');
        if (container) renderWechatList(container);
        
    } catch (e) {
        console.error('创建群聊失败:', e);
        alert('网络错误: ' + e.message);
    }
}

// 关闭混合群聊弹窗
function closeMixedGroupModal() {
    document.getElementById('create-mixed-group-modal').style.display = 'none';
    mixedGroupStep = 1;
    selectedMixedFriends = [];
    selectedMixedChar = null;
}

// 处理群聊邀请
function handleMixedGroupInvite(data) {
    pendingMixedGroupInvite = data;
    
    document.getElementById('invite-creator-name').textContent = data.creator_name || '某人';
    document.getElementById('invite-group-name').textContent = data.group_name || '联机群聊';
    document.getElementById('mixed-group-invite-modal').style.display = 'flex';
}

// 接受邀请
async function acceptMixedGroupInvite() {
    document.getElementById('mixed-group-invite-modal').style.display = 'none';
    
    if (!pendingMixedGroupInvite) return;
    
    // 显示选择角色弹窗
    document.getElementById('bind-char-group-name').textContent = pendingMixedGroupInvite.group_name || '联机群聊';
    document.getElementById('bind-char-modal').style.display = 'flex';
    
    // 加载角色列表
    await loadBindCharList();
}

// 拒绝邀请
function rejectMixedGroupInvite() {
    document.getElementById('mixed-group-invite-modal').style.display = 'none';
    pendingMixedGroupInvite = null;
}

// 加载绑定角色列表
async function loadBindCharList() {
    const listEl = document.getElementById('bind-char-list');
    
    const chars = await db.characters.where('type').notEqual('user').toArray();
    
    if (chars.length === 0) {
        listEl.innerHTML = '<div style="text-align:center; color:#999; padding:40px;">暂无可选角色</div>';
        return;
    }
    
    listEl.innerHTML = chars.map(char => `
        <div class="char-select-item" data-id="${char.id}" onclick="selectBindChar(${char.id}, this)" 
             style="display:flex; align-items:center; padding:12px; margin-bottom:8px; border-radius:10px; background:#f9f9f9; cursor:pointer; transition:all 0.2s;">
            <div style="width:48px; height:48px; border-radius:50%; background:${char.avatar ? `url(${char.avatar}) center/cover` : '#eee'}; margin-right:12px;"></div>
            <div style="flex:1;">
                <div style="font-size:15px; font-weight:500;">${char.name || '未命名'}</div>
            </div>
            <div class="check-mark" style="width:24px; height:24px; border-radius:50%; border:2px solid #ddd; display:flex; align-items:center; justify-content:center;">
                <svg style="width:14px; height:14px; stroke:#fff; stroke-width:3; fill:none; opacity:0;" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>
            </div>
        </div>
    `).join('');
}

// 选择绑定角色
let selectedBindChar = null;
function selectBindChar(charId, el) {
    document.querySelectorAll('#bind-char-list .char-select-item').forEach(item => {
        item.style.background = '#f9f9f9';
        const cm = item.querySelector('.check-mark');
        cm.style.background = 'transparent';
        cm.style.borderColor = '#ddd';
        cm.querySelector('svg').style.opacity = '0';
    });
    
    selectedBindChar = charId;
    el.style.background = '#fff5f7';
    const checkMark = el.querySelector('.check-mark');
    checkMark.style.background = 'var(--ins-pink)';
    checkMark.style.borderColor = 'var(--ins-pink)';
    checkMark.querySelector('svg').style.opacity = '1';
}

// 确认绑定角色
async function confirmBindChar() {
    if (!selectedBindChar || !pendingMixedGroupInvite) {
        alert('请选择一个角色');
        return;
    }
    
    const char = await db.characters.get(selectedBindChar);
    if (!char) {
        alert('角色信息获取失败');
        return;
    }
    
    // 获取用户人设
    const currentAccountInfo = await getCurrentAccountOnlineInfo();
    const userPersona = currentAccountInfo ? `用户名: ${currentAccountInfo.nickname}` : '';
    const charPersona = char.persona || char.description || '';
    
    try {
        const res = await fetch(`${ONLINE_API_BASE}/api/mixed_group/${pendingMixedGroupInvite.group_id}/bind_char`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_id: onlineUser.id,
                char_id: char.id,
                char_name: char.name,
                char_avatar: char.avatar,
                user_persona: userPersona,
                char_persona: charPersona
            })
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            alert(data.error || '绑定失败');
            return;
        }
        
        alert('成功加入群聊！');
        document.getElementById('bind-char-modal').style.display = 'none';
        pendingMixedGroupInvite = null;
        selectedBindChar = null;
        
        // 刷新聊天列表
        const container = document.getElementById('wechat-content');
        if (container) renderWechatList(container);
        
    } catch (e) {
        console.error('绑定角色失败:', e);
        alert('网络错误: ' + e.message);
    }
}

// 打开混合群聊
async function openMixedGroupChat(groupId) {
    // 清除其他聊天状态
    currentChatCharId = null;
    window.currentGroupChatId = null;
    currentRealFriendId = null;
    currentRealFriendInfo = null;
    
    // 设置混合群聊ID（使用window确保全局可访问）
    window.currentMixedGroupId = groupId;
    
    try {
        // 获取群聊详情
        const res = await fetch(`${ONLINE_API_BASE}/api/mixed_group/${groupId}?user_id=${onlineUser.id}`);
        const data = await res.json();
        
        if (!res.ok) {
            alert(data.error || '获取群聊信息失败');
            return;
        }
        
        const group = data.group;
        const members = data.members;
        
        // 存储群聊信息供后续使用
        window.currentMixedGroupInfo = { group, members };
        
        // 检查是否已绑定角色
        const myMember = members.find(m => m.user_id == onlineUser.id);
        if (!myMember || !myMember.char_id) {
            // 需要先绑定角色
            pendingMixedGroupInvite = { group_id: groupId, group_name: group.name };
            document.getElementById('bind-char-group-name').textContent = group.name || '联机群聊';
            document.getElementById('bind-char-modal').style.display = 'flex';
            await loadBindCharList();
            return;
        }
        
        // 显示聊天窗口
        const chatWindow = document.getElementById('chat-window');
        chatWindow.style.display = 'flex';
        
        // 设置标题
        document.getElementById('chat-title').textContent = group.name || '联机群聊';
        
        // 显示魔法棒按钮（用于触发角色回复）
        const magicWandBtn = document.getElementById('btn-magic-wand');
        if (magicWandBtn) {
            magicWandBtn.style.display = 'flex';
            // 修改点击事件为触发混合群聊角色回复
            magicWandBtn.onclick = () => triggerMixedGroupCharReply();
        }
        
        // 隐藏其他按钮（表情、菜单等）
        const otherButtons = document.querySelectorAll('.chat-icon-btn:not(#btn-magic-wand)');
        otherButtons.forEach(btn => {
            btn.style.display = 'none';
        });
        
        // 清空并加载消息
        await loadMixedGroupMessages(groupId);
        
        // 加入WebSocket房间
        if (window.onlineSocket) {
            window.onlineSocket.emit('join_mixed_group', { group_id: groupId, user_id: onlineUser.id });
        }
        
    } catch (e) {
        console.error('打开群聊失败:', e);
        alert('网络错误: ' + e.message);
    }
}

// 加载混合群聊消息
async function loadMixedGroupMessages(groupId) {
    const chatBody = document.getElementById('chat-body');
    chatBody.innerHTML = '';
    
    try {
        const res = await fetch(`${ONLINE_API_BASE}/api/mixed_group/${groupId}/messages?limit=100`);
        const data = await res.json();
        
        if (!data.messages || data.messages.length === 0) {
            chatBody.innerHTML = `
                <div style="text-align:center; color:#999; padding:40px; font-size:14px;">
                    开始联机聊天吧！<br>
                    <span style="font-size:12px;">点击魔法棒可以让你的角色说话</span>
                </div>
            `;
            return;
        }
        
        // 获取群聊成员信息
        const groupRes = await fetch(`${ONLINE_API_BASE}/api/mixed_group/${groupId}?user_id=${onlineUser.id}`);
        const groupData = await groupRes.json();
        const myMember = groupData.members.find(m => m.user_id == onlineUser.id);
        
        data.messages.forEach(msg => {
            // 只有自己发的用户消息才显示在右边，角色A、用户B、角色B都在左边
            const isSelf = msg.sender_type === 'user' && msg.sender_user_id == onlineUser.id;
            
            const msgEl = document.createElement('div');
            msgEl.style.cssText = `display:flex; margin-bottom:8px; align-items:flex-start; ${isSelf ? 'flex-direction:row-reverse; padding-left:50px;' : 'padding-right:50px;'}`;
            
            // 区分角色和用户的名字颜色
            let senderLabel;
            if (msg.sender_type === 'char') {
                senderLabel = `<span style="font-size:10px; color:#e74c3c; display:block; margin-bottom:2px;">🤖 ${msg.sender_name}</span>`;
            } else {
                senderLabel = `<span style="font-size:10px; color:#667eea; display:block; margin-bottom:2px;">👤 ${msg.sender_name}</span>`;
            }
            
            msgEl.innerHTML = `
                <div style="width:32px; height:32px; min-width:32px; border-radius:50%; background:${msg.sender_avatar ? `url(${msg.sender_avatar}) center/cover` : '#ddd'}; flex-shrink:0; margin:${isSelf ? '0 0 0 8px' : '0 8px 0 0'};"></div>
                <div style="display:flex; flex-direction:column; ${isSelf ? 'align-items:flex-end;' : 'align-items:flex-start;'}">
                    ${senderLabel}
                    <span style="display:inline-block; padding:8px 12px; border-radius:18px; background:${isSelf ? '#ffe4e8' : '#f2f2f7'}; font-size:14px; line-height:1.4; ${isSelf ? 'border-bottom-right-radius:4px;' : 'border-bottom-left-radius:4px;'}">
                        ${msg.content}
                    </span>
                </div>
            `;
            
            chatBody.appendChild(msgEl);
        });
        
        chatBody.scrollTop = chatBody.scrollHeight;
        
    } catch (e) {
        console.error('加载消息失败:', e);
    }
}

// 发送混合群聊消息（用户消息）
async function sendMixedGroupUserMessage(inputContent) {
    if (!window.currentMixedGroupId || !onlineUser) return;
    
    const input = document.getElementById('chat-input-box');
    const content = inputContent || input.value.trim();
    if (!content) return;
    
    if (!inputContent) input.value = '';
    
    // 获取当前用户信息
    const currentAccountInfo = await getCurrentAccountOnlineInfo();
    
    try {
        await fetch(`${ONLINE_API_BASE}/api/mixed_group/${window.currentMixedGroupId}/message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sender_type: 'user',
                sender_user_id: onlineUser.id,
                sender_name: currentAccountInfo?.nickname || onlineUser.nickname,
                sender_avatar: currentAccountInfo?.avatar || onlineUser.avatar,
                content: content
            })
        });
        
    } catch (e) {
        console.error('发送消息失败:', e);
    }
}

// 触发角色说话（调用AI）
async function triggerMixedGroupCharReply() {
    if (!window.currentMixedGroupId || !onlineUser) return;
    
    // 获取群聊信息
    const groupRes = await fetch(`${ONLINE_API_BASE}/api/mixed_group/${window.currentMixedGroupId}?user_id=${onlineUser.id}`);
    const groupData = await groupRes.json();
    const myMember = groupData.members.find(m => m.user_id == onlineUser.id);
    
    if (!myMember || !myMember.char_id) {
        alert('你还没有绑定角色');
        return;
    }
    
    // 本地立即显示输入状态（不等WebSocket）
    showMixedGroupTypingStatus({
        group_id: window.currentMixedGroupId,
        sender_name: myMember.char_name,
        is_generating: true
    });
    
    // 广播输入状态给其他用户
    if (window.onlineSocket) {
        window.onlineSocket.emit('mixed_group_typing_status', {
            group_id: window.currentMixedGroupId,
            sender_name: myMember.char_name,
            is_generating: true
        });
    }
    
    try {
        // 获取所有人设
        const personasRes = await fetch(`${ONLINE_API_BASE}/api/mixed_group/${window.currentMixedGroupId}/personas?user_id=${onlineUser.id}`);
        const personasData = await personasRes.json();
        
        // 获取消息历史
        const messagesRes = await fetch(`${ONLINE_API_BASE}/api/mixed_group/${window.currentMixedGroupId}/messages?limit=20`);
        const messagesData = await messagesRes.json();
        
        // 获取我的角色信息
        const myChar = await db.characters.get(parseInt(myMember.char_id));
        
        // 构建AI提示
        let systemPrompt = `你现在扮演"${myMember.char_name}"这个角色在一个多人群聊中回复。\n\n`;
        systemPrompt += `## 你的角色设定:\n${myChar?.persona || myChar?.description || '一个友好的角色'}\n\n`;
        
        // 添加其他人的人设信息（不显示具体内容给用户，但AI可以读取）
        systemPrompt += `## 群聊背景:\n`;
        personasData.personas.forEach(p => {
            if (p.user_id != onlineUser.id) {
                systemPrompt += `- ${p.char_name}: 另一位群成员的角色\n`;
            }
        });
        
        systemPrompt += `\n## 回复要求:\n`;
        systemPrompt += `- 保持角色性格一致\n`;
        systemPrompt += `- 像真人聊天一样，把回复拆成多条短消息\n`;
        systemPrompt += `- 每条消息用|||分隔，比如: "嗯？|||怎么了|||有什么事吗"\n`;
        systemPrompt += `- 每条消息要简短自然，可以是几个字到一句话\n`;
        systemPrompt += `- 不要有动作描述、括号、引号，只要纯对话\n`;
        systemPrompt += `- 输出2-5条消息\n`;
        
        // 构建消息历史
        const messages = [{ role: 'system', content: systemPrompt }];
        
        messagesData.messages.forEach(msg => {
            const role = msg.sender_user_id == onlineUser.id ? 'assistant' : 'user';
            messages.push({
                role: role,
                content: `${msg.sender_name}: ${msg.content}`
            });
        });
        
        messages.push({ role: 'user', content: '请以你的角色身份回复' });
        
        // 调用AI - 直接前端调用，不经过后端
        const apiConfig = await getApiConfig();
        console.log('[MixedGroup] API配置:', {
            apiUrl: apiConfig.apiUrl,
            apiKey: apiConfig.apiKey ? '***已设置***' : '未设置',
            model: apiConfig.model
        });
        
        if (!apiConfig || !apiConfig.apiKey) {
            alert('请先在设置中配置API Key');
            return;
        }
        
        if (!apiConfig.apiUrl) {
            alert('请先在设置中配置API地址');
            return;
        }
        
        // 确保URL格式正确（移除末尾的斜杠）
        let fullApiUrl = apiConfig.apiUrl.replace(/\/+$/, '') + '/v1/chat/completions';
        console.log('[MixedGroup] 完整API URL:', fullApiUrl);
        console.log('[MixedGroup] 消息数量:', messages.length);
        
        // 直接前端调用API
        const aiRes = await fetch(fullApiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiConfig.apiKey}`
            },
            body: JSON.stringify({
                model: apiConfig.model,
                messages: messages,
                temperature: apiConfig.temperature || 0.7
            })
        });
        
        console.log('[MixedGroup] AI响应状态:', aiRes.status);
        
        if (!aiRes.ok) {
            const errorText = await aiRes.text();
            console.error('[MixedGroup] AI请求失败:', errorText);
            alert('AI请求失败: ' + aiRes.status + '\n' + errorText.substring(0, 200));
            return;
        }
        
        const aiData = await aiRes.json();
        console.log('[MixedGroup] AI响应:', aiData);
        
        if (aiData.choices && aiData.choices[0]) {
            let reply = aiData.choices[0].message.content;
            
            // 清理回复内容
            reply = reply.replace(new RegExp(`^${myMember.char_name}:\\s*`, 'i'), '');
            reply = reply.replace(/^["'「]|["'」]$/g, ''); // 移除引号
            
            // 按|||分割成多条消息
            let messages = reply.split('|||').map(m => m.trim()).filter(m => m.length > 0);
            
            // 如果没有分隔符，尝试按换行或句号分割
            if (messages.length <= 1 && reply.length > 10) {
                messages = reply.split(/[。！？\n]+/).map(m => m.trim()).filter(m => m.length > 0);
            }
            
            // 确保至少有一条消息
            if (messages.length === 0) {
                messages = [reply];
            }
            
            console.log('[MixedGroup] 分割后的消息:', messages);
            
            // 逐条发送消息，每条间隔300-800ms模拟打字
            for (let i = 0; i < messages.length; i++) {
                const msgContent = messages[i].replace(/^["'「]|["'」]$/g, '').trim();
                if (!msgContent) continue;
                
                await fetch(`${ONLINE_API_BASE}/api/mixed_group/${window.currentMixedGroupId}/message`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sender_type: 'char',
                        sender_user_id: onlineUser.id,
                        sender_char_id: myMember.char_id,
                        sender_name: myMember.char_name,
                        sender_avatar: myMember.char_avatar,
                        content: msgContent
                    })
                });
                
                // 间隔一下再发下一条
                if (i < messages.length - 1) {
                    await new Promise(r => setTimeout(r, 300 + Math.random() * 500));
                }
            }
        }
        
    } catch (e) {
        console.error('AI生成失败:', e);
        alert('生成回复失败: ' + e.message);
    } finally {
        // 本地立即清除输入状态
        showMixedGroupTypingStatus({
            group_id: window.currentMixedGroupId,
            sender_name: myMember?.char_name || '',
            is_generating: false
        });
        
        // 广播取消输入状态给其他用户
        if (window.onlineSocket && myMember) {
            window.onlineSocket.emit('mixed_group_typing_status', {
                group_id: window.currentMixedGroupId,
                sender_name: myMember.char_name,
                is_generating: false
            });
        }
    }
}

// 获取API配置（从IndexedDB读取，与设置页面一致）
async function getApiConfig() {
    try {
        // 使用与设置页面一致的key名称
        const urlItem = await db.dexiData.get('aiBaseUrl');
        const keyItem = await db.dexiData.get('aiApiKey');
        const modelItem = await db.dexiData.get('aiCurrentModel');
        const tempItem = await db.dexiData.get('aiTemperature');
        
        return {
            apiUrl: urlItem?.value || '',
            apiKey: keyItem?.value || '',
            model: modelItem?.value || 'gpt-3.5-turbo',
            temperature: parseFloat(tempItem?.value || '0.7')
        };
    } catch (e) {
        console.error('获取API配置失败:', e);
        return { apiUrl: '', apiKey: '', model: 'gpt-3.5-turbo', temperature: 0.7 };
    }
}

// 监听混合群聊WebSocket事件
function initMixedGroupSocket() {
    if (!window.onlineSocket) return;
    
    // 收到群聊邀请
    window.onlineSocket.on('mixed_group_invite', (data) => {
        console.log('[MixedGroup] Received invite:', data);
        handleMixedGroupInvite(data);
    });
    
    // 收到群聊消息
    window.onlineSocket.on('mixed_group_message', (data) => {
        console.log('[MixedGroup] Received message:', data);
        if (window.currentMixedGroupId == data.group_id) {
            appendMixedGroupMessage(data);
        }
    });
    
    // 输入状态
    window.onlineSocket.on('mixed_group_typing', (data) => {
        if (window.currentMixedGroupId == data.group_id) {
            showMixedGroupTypingStatus(data);
        }
    });
    
    // 成员绑定角色
    window.onlineSocket.on('mixed_group_member_bound', (data) => {
        console.log('[MixedGroup] Member bound char:', data);
        // 可以刷新群聊列表或显示通知
    });
}

// 追加消息到聊天界面
function appendMixedGroupMessage(msg) {
    const chatBody = document.getElementById('chat-body');
    if (!chatBody) return;
    
    // 移除空状态提示
    const emptyState = chatBody.querySelector('div[style*="text-align:center"]');
    if (emptyState && emptyState.textContent.includes('开始联机聊天')) {
        emptyState.remove();
    }
    
    // 只有自己发的用户消息才显示在右边，角色A、用户B、角色B都在左边
    const isSelf = msg.sender_type === 'user' && msg.sender_user_id == onlineUser.id;
    
    const msgEl = document.createElement('div');
    msgEl.style.cssText = `display:flex; margin-bottom:8px; align-items:flex-start; ${isSelf ? 'flex-direction:row-reverse; padding-left:50px;' : 'padding-right:50px;'}`;
    
    // 区分角色和用户的名字颜色
    let senderLabel;
    if (msg.sender_type === 'char') {
        senderLabel = `<span style="font-size:10px; color:#e74c3c; display:block; margin-bottom:2px;">🤖 ${msg.sender_name}</span>`;
    } else {
        senderLabel = `<span style="font-size:10px; color:#667eea; display:block; margin-bottom:2px;">👤 ${msg.sender_name}</span>`;
    }
    
    msgEl.innerHTML = `
        <div style="width:32px; height:32px; min-width:32px; border-radius:50%; background:${msg.sender_avatar ? `url(${msg.sender_avatar}) center/cover` : '#ddd'}; flex-shrink:0; margin:${isSelf ? '0 0 0 8px' : '0 8px 0 0'};"></div>
        <div style="display:flex; flex-direction:column; ${isSelf ? 'align-items:flex-end;' : 'align-items:flex-start;'}">
            ${senderLabel}
            <span style="display:inline-block; padding:8px 12px; border-radius:18px; background:${isSelf ? '#ffe4e8' : '#f2f2f7'}; font-size:14px; line-height:1.4; ${isSelf ? 'border-bottom-right-radius:4px;' : 'border-bottom-left-radius:4px;'}">
                ${msg.content}
            </span>
        </div>
    `;
    
    chatBody.appendChild(msgEl);
    chatBody.scrollTop = chatBody.scrollHeight;
}

// 显示输入状态
function showMixedGroupTypingStatus(data) {
    console.log('[MixedGroup] Typing status:', data);
    
    const chatTitleEl = document.getElementById('chat-title');
    
    if (data.is_generating) {
        // 保存原始标题
        if (!window._mixedGroupOriginalTitle) {
            window._mixedGroupOriginalTitle = chatTitleEl?.textContent || '联机群聊';
        }
        
        // 显示正在输入状态
        if (chatTitleEl) {
            chatTitleEl.innerHTML = `<span style="color:#e74c3c;">🤖 ${data.sender_name} 正在输入...</span>`;
        }
        
        // 同时在聊天区域底部显示提示
        let typingIndicator = document.getElementById('mixed-typing-indicator');
        if (!typingIndicator) {
            typingIndicator = document.createElement('div');
            typingIndicator.id = 'mixed-typing-indicator';
            typingIndicator.style.cssText = 'text-align:center; padding:10px; color:#e74c3c; font-size:13px; background:rgba(231,76,60,0.05); border-radius:8px; margin:8px 16px;';
            document.getElementById('chat-body')?.appendChild(typingIndicator);
        }
        typingIndicator.innerHTML = `🤖 ${data.sender_name} 正在输入<span class="typing-dots">...</span>`;
        typingIndicator.style.display = 'block';
        
        // 滚动到底部
        const chatBody = document.getElementById('chat-body');
        if (chatBody) chatBody.scrollTop = chatBody.scrollHeight;
    } else {
        // 恢复原始标题
        if (chatTitleEl && window._mixedGroupOriginalTitle) {
            chatTitleEl.textContent = window._mixedGroupOriginalTitle;
        }
        
        // 隐藏输入指示器
        const typingIndicator = document.getElementById('mixed-typing-indicator');
        if (typingIndicator) {
            typingIndicator.style.display = 'none';
        }
    }
}

// 在connectOnlineSocket后初始化混合群聊WebSocket
const originalConnectOnlineSocket = connectOnlineSocket;
connectOnlineSocket = function() {
    originalConnectOnlineSocket();
    setTimeout(initMixedGroupSocket, 500);
};
