// Service Worker - 真正的后台推送接收器
// 这个文件在后台独立运行，即使页面关闭也能收到推送

console.log('[SW] Service Worker loaded');

// 安装
self.addEventListener('install', (event) => {
    console.log('[SW] Installing...');
    self.skipWaiting();
});

// 激活
self.addEventListener('activate', (event) => {
    console.log('[SW] Activated');
    event.waitUntil(clients.claim());
});

// 接收推送（核心）
self.addEventListener('push', (event) => {
    console.log('[SW] ========================================');
    console.log('[SW] 🔔🔔🔔 收到推送事件！');
    console.log('[SW] Event:', event);
    
    let payload = {
        title: '新消息',
        body: '你有一条新消息',
        icon: 'https://img.heliar.top/file/1769158422909_无标题281_20251207015501_20260123165317.png',
        badge: 'https://img.heliar.top/file/1769158422909_无标题281_20251207015501_20260123165317.png'
    };
    
    if (event.data) {
        try {
            const data = event.data.json();
            console.log('[SW] 解析推送数据:', data);
            payload = {
                title: data.title || payload.title,
                body: data.body || payload.body,
                icon: data.icon || payload.icon,
                badge: data.badge || payload.badge,
                data: data.data || {}
            };
        } catch (e) {
            console.error('[SW] 解析推送数据失败:', e);
            // 尝试文本格式
            try {
                payload.body = event.data.text();
            } catch (e2) {
                console.error('[SW] 无法解析推送数据');
            }
        }
    }
    
    console.log('[SW] 准备显示通知:', payload);
    
    // 显示通知（这是唯一允许显示通知的地方）
    event.waitUntil(
        self.registration.showNotification(payload.title, {
            body: payload.body,
            icon: payload.icon,
            badge: payload.badge,
            vibrate: [200, 100, 200],
            tag: 'chat-notification-' + (payload.data.char_id || Date.now()),
            data: payload.data || {},
            requireInteraction: false,
            silent: false
        }).then(() => {
            console.log('[SW] ✓✓✓ 通知已成功显示！');
        }).catch((err) => {
            console.error('[SW] ✗✗✗ 通知显示失败:', err);
        })
    );
    
    console.log('[SW] ========================================');
});

// 点击通知
self.addEventListener('notificationclick', (event) => {
    console.log('[SW] Notification clicked');
    event.notification.close();
    
    // 打开或聚焦应用
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then((clientList) => {
                // 先尝试聚焦已有窗口
                for (let client of clientList) {
                    if (client.url.includes('index.html') && 'focus' in client) {
                        return client.focus();
                    }
                }
                // 否则打开新窗口
                if (clients.openWindow) {
                    return clients.openWindow('/index.html');
                }
            })
    );
});

console.log('[SW] Ready for push notifications');

