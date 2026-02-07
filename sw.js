// Service Worker - 纯前端 PWA 版本
// 用于离线缓存和 PWA 功能，不依赖后端推送

console.log('[SW] Service Worker loaded (纯前端模式)');

// 缓存名称
const CACHE_NAME = 'ins-desktop-v1';

// 需要缓存的资源
const CACHE_URLS = [
    './',
    './index.html',
    './style.css',
    './script.JS',
    './manifest.json'
];

// 安装：预缓存资源
self.addEventListener('install', (event) => {
    console.log('[SW] Installing...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('[SW] Caching app shell');
                return cache.addAll(CACHE_URLS).catch(err => {
                    console.log('[SW] Cache failed for some resources:', err);
                });
            })
    );
    self.skipWaiting();
});

// 激活：清理旧缓存
self.addEventListener('activate', (event) => {
    console.log('[SW] Activated');
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.filter(name => name !== CACHE_NAME)
                    .map(name => caches.delete(name))
            );
        }).then(() => clients.claim())
    );
});

// 请求拦截：网络优先，失败时使用缓存
self.addEventListener('fetch', (event) => {
    // 跳过非 GET 请求和 API 请求
    if (event.request.method !== 'GET') return;
    if (event.request.url.includes('/api/')) return;
    
    event.respondWith(
        fetch(event.request)
            .then(response => {
                // 缓存成功的响应
                if (response.status === 200) {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, responseClone);
                    });
                }
                return response;
            })
            .catch(() => {
                // 网络失败时使用缓存
                return caches.match(event.request);
            })
    );
});

// 点击通知（本地通知点击处理）
self.addEventListener('notificationclick', (event) => {
    console.log('[SW] Notification clicked');
    event.notification.close();
    
    // 打开或聚焦应用
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then((clientList) => {
                // 先尝试聚焦已有窗口
                for (let client of clientList) {
                    if ('focus' in client) {
                        return client.focus();
                    }
                }
                // 否则打开新窗口
                if (clients.openWindow) {
                    return clients.openWindow('./');
                }
            })
    );
});

console.log('[SW] Ready (纯前端 PWA 模式)');

