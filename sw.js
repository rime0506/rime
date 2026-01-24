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
    console.log('[SW] Push received:', event);
    
    let payload = {
        title: '新消息',
        body: '你有一条新消息',
        icon: '/icon-192.png',
        badge: '/icon-192.png'
    };
    
    if (event.data) {
        try {
            payload = event.data.json();
        } catch (e) {
            console.error('[SW] Failed to parse push data:', e);
        }
    }
    
    console.log('[SW] Showing notification:', payload);
    
    // 显示通知（这是唯一允许显示通知的地方）
    event.waitUntil(
        self.registration.showNotification(payload.title, {
            body: payload.body,
            icon: payload.icon || '/icon-192.png',
            badge: payload.badge || '/icon-192.png',
            vibrate: [200, 100, 200],
            tag: 'chat-notification',
            data: payload.data || {},
            requireInteraction: false
        })
    );
});

// 点击通知
self.addEventListener('notificationclick', (event) => {
    console.log('[SW] Notification clicked');
    event.notification.close();
    
    // 打开或聚焦应用
    const targetUrl = (event.notification.data && event.notification.data.url) || './呀呀呀.html';
    
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then((clientList) => {
                // 先尝试聚焦已有窗口 (匹配文件名即可，忽略参数)
                for (let client of clientList) {
                    // 如果当前 URL 包含目标文件名（简单匹配）
                    if (client.url.indexOf('呀呀呀.html') > -1 && 'focus' in client) {
                        return client.focus();
                    }
                }
                // 否则打开新窗口
                if (clients.openWindow) {
                    return clients.openWindow(targetUrl);
                }
            })
    );
});

console.log('[SW] Ready for push notifications');
