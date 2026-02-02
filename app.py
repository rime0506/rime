import sqlite3
import json
import time
import os
import threading
import requests
from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_socketio import SocketIO, emit
from pywebpush import webpush, WebPushException

# 配置静态文件夹路径 (假设前端文件在当前目录下)
app = Flask(__name__, static_folder='.', static_url_path='')
CORS(app, resources={r"/*": {"origins": "*"}})

# 初始化 SocketIO（用于实时推送）
# 生产环境使用 gevent，本地开发使用 threading
import os
if os.environ.get('RENDER') or os.environ.get('PORT'):
    socketio = SocketIO(app, cors_allowed_origins="*", async_mode='gevent')
else:
    socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

# 适配 Zeabur 容器环境，优先使用 /app/data (持久化目录)，其次当前目录，最后 /tmp
if os.path.exists('/app/data'):
    DB_FILE = '/app/data/notifications.db'
    KEY_FILE = '/app/data/vapid_private.pem'
else:
    DB_FILE = 'notifications.db'
    KEY_FILE = 'vapid_private.pem'

print(f"[Config] DB_FILE: {DB_FILE}")
print(f"[Config] KEY_FILE: {KEY_FILE}")

# VAPID 密钥（用于 Web Push）
print("[VAPID] ========================================")
print("[VAPID] 🔧 初始化 VAPID 密钥")

def load_or_generate_vapid_keys():
    """
    加载或生成 VAPID 密钥，支持持久化到文件
    """
    from py_vapid import Vapid
    from cryptography.hazmat.primitives import serialization
    import base64
    
    private_key_pem = None
    print(f"[VAPID] 当前密钥文件路径: {KEY_FILE}")
    
    # 尝试从文件加载
    if os.path.exists(KEY_FILE):
        try:
            print(f"[VAPID] 📂 发现现有密钥文件: {KEY_FILE}")
            with open(KEY_FILE, 'r') as f:
                file_content = f.read()
            
            # 尝试解析以验证有效性
            Vapid.from_string(file_content)
            
            private_key_pem = file_content
            print("[VAPID] ✅ 成功加载并验证私钥")
        except Exception as e:
            print(f"[VAPID] ⚠️ 密钥文件无效或损坏: {e}")
            try:
                os.remove(KEY_FILE)
                print(f"[VAPID] 🗑️ 已删除损坏的密钥文件，将重新生成")
            except Exception as remove_e:
                print(f"[VAPID] ❌ 删除文件失败: {remove_e}")
    
    # 如果没有加载到，则生成新的
    if not private_key_pem:
        print("[VAPID] 🔑 正在生成新的 VAPID 密钥...")
        v = Vapid()
        v.generate_keys()
        private_key_pem = v.private_pem()
        if isinstance(private_key_pem, bytes):
            private_key_pem = private_key_pem.decode('utf-8')
            
        # 尝试保存到文件
        try:
            with open(KEY_FILE, 'w') as f:
                f.write(private_key_pem)
            print(f"[VAPID] 💾 新密钥已保存到: {KEY_FILE}")
        except Exception as e:
            print(f"[VAPID] ⚠️ 无法保存密钥文件 (使用内存模式): {e}")

    # 从私钥推导公钥
    try:
        v = Vapid.from_string(private_key_pem)
        public_key_bytes = v.public_key.public_bytes(
            encoding=serialization.Encoding.X962,
            format=serialization.PublicFormat.UncompressedPoint
        )
        public_key_b64 = base64.urlsafe_b64encode(public_key_bytes).decode('utf-8').rstrip('=')
        
        return {
            'private_key': private_key_pem,
            'public_key': public_key_b64
        }
    except Exception as e:
        print(f"[VAPID] ❌ 密钥处理失败: {e}")
        return None

try:
    vapid_keys = load_or_generate_vapid_keys()
    
    if vapid_keys and vapid_keys.get('public_key') and vapid_keys.get('private_key'):
        VAPID_PRIVATE_KEY = vapid_keys['private_key']
        VAPID_PUBLIC_KEY = vapid_keys['public_key']
        VAPID_CLAIMS = {"sub": "mailto:admin@example.com"}
        
        print("[VAPID] ✅✅✅ VAPID 已就绪")
        print(f"[VAPID]   公钥预览: {VAPID_PUBLIC_KEY[:40]}...")
    else:
        raise Exception("密钥生成后为空，检查文件路径或权限")
        
except Exception as e:
    print(f"[VAPID] ❌❌❌ 致命错误: {e}")
    import traceback
    traceback.print_exc()
    
    VAPID_PRIVATE_KEY = None
    VAPID_PUBLIC_KEY = None
    VAPID_CLAIMS = {}

print("[VAPID] ========================================")

def init_db():
    """初始化数据库表"""
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    # 通知表
    # type: 'all' (全员) 或 'single' (单人)
    c.execute('''CREATE TABLE IF NOT EXISTS notifications
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  title TEXT NOT NULL,
                  content TEXT,
                  type TEXT NOT NULL,
                  target_user_id TEXT,
                  created_at REAL)''')
    
    # 已读记录表 (用于记录用户已读了哪些通知)
    c.execute('''CREATE TABLE IF NOT EXISTS read_records
                 (user_id TEXT,
                  notification_id INTEGER,
                  PRIMARY KEY (user_id, notification_id))''')
    
    # 角色配置表（前端同步过来的）
    c.execute('''CREATE TABLE IF NOT EXISTS characters
                 (id TEXT PRIMARY KEY,
                  name TEXT NOT NULL,
                  avatar TEXT,
                  auto_reply_enabled INTEGER DEFAULT 0,
                  auto_reply_interval INTEGER DEFAULT 0,
                  last_message_time REAL DEFAULT 0,
                  user_id TEXT,
                  updated_at REAL)''')
    
    # 推送订阅表（存储用户的推送订阅信息）
    c.execute('''CREATE TABLE IF NOT EXISTS push_subscriptions
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  user_id TEXT NOT NULL,
                  subscription TEXT NOT NULL,
                  created_at REAL,
                  UNIQUE(user_id, subscription))''')
    
    # 消息记录表
    c.execute('''CREATE TABLE IF NOT EXISTS messages
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  user_id TEXT,
                  char_id TEXT,
                  sender TEXT,
                  content TEXT,
                  timestamp REAL)''')
    
    # ========== 联机社交功能表 ==========
    
    # 用户表（联机账号）
    c.execute('''CREATE TABLE IF NOT EXISTS online_users
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  username TEXT UNIQUE NOT NULL,
                  password TEXT NOT NULL,
                  social_id TEXT UNIQUE NOT NULL,
                  wechat_id TEXT UNIQUE,
                  nickname TEXT,
                  avatar TEXT,
                  bio TEXT,
                  created_at REAL,
                  last_online REAL)''')
    
    # 好友关系表
    c.execute('''CREATE TABLE IF NOT EXISTS friendships
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  user_id INTEGER NOT NULL,
                  friend_id INTEGER NOT NULL,
                  created_at REAL,
                  UNIQUE(user_id, friend_id))''')
    
    # 好友请求表
    c.execute('''CREATE TABLE IF NOT EXISTS friend_requests
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  from_user_id INTEGER NOT NULL,
                  to_user_id INTEGER NOT NULL,
                  message TEXT,
                  status TEXT DEFAULT 'pending',
                  created_at REAL,
                  updated_at REAL)''')
    
    # 用户间私聊消息表
    c.execute('''CREATE TABLE IF NOT EXISTS user_messages
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  from_user_id INTEGER NOT NULL,
                  to_user_id INTEGER NOT NULL,
                  content TEXT NOT NULL,
                  msg_type TEXT DEFAULT 'text',
                  is_read INTEGER DEFAULT 0,
                  created_at REAL)''')
    
    conn.commit()
    conn.close()

def get_db_connection():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn

# 初始化数据库
init_db()

@app.route('/')
def index():
    # 默认返回前端主页
    return app.send_static_file('index.html')

# 显式处理 sw.js，确保 Service Worker 位于根作用域
@app.route('/sw.js')
def service_worker():
    response = app.send_static_file('sw.js')
    response.headers['Content-Type'] = 'application/javascript'
    return response

# 显式处理 manifest.json
@app.route('/manifest.json')
def manifest():
    response = app.send_static_file('manifest.json')
    response.headers['Content-Type'] = 'application/manifest+json'
    return response

# 1. 创建通知 (管理员接口)
@app.route('/api/notifications', methods=['POST'])
def create_notification():
    data = request.json
    title = data.get('title')
    content = data.get('content', '')
    msg_type = data.get('type', 'all') # all 或 single
    target_user_id = data.get('target_user_id', None)

    if not title:
        return jsonify({'error': 'Title is required'}), 400

    conn = get_db_connection()
    c = conn.cursor()
    c.execute("INSERT INTO notifications (title, content, type, target_user_id, created_at) VALUES (?, ?, ?, ?, ?)",
              (title, content, msg_type, target_user_id, time.time()))
    conn.commit()
    new_id = c.lastrowid
    conn.close()

    return jsonify({'id': new_id, 'message': 'Notification created successfully'}), 201

# 2. 获取用户通知列表 (包含未读/已读状态)
@app.route('/api/notifications', methods=['GET'])
def get_notifications():
    user_id = request.args.get('user_id')
    if not user_id:
        return jsonify({'error': 'user_id is required'}), 400

    conn = get_db_connection()
    c = conn.cursor()
    
    # 查询逻辑：获取发送给所有人(all)的通知 OR 发送给该用户(single)的通知
    # 结果按时间倒序排列
    query = '''
        SELECT n.id, n.title, n.content, n.type, n.created_at,
               CASE WHEN r.user_id IS NOT NULL THEN 1 ELSE 0 END as is_read
        FROM notifications n
        LEFT JOIN read_records r ON n.id = r.notification_id AND r.user_id = ?
        WHERE n.type = 'all' OR (n.type = 'single' AND n.target_user_id = ?)
        ORDER BY n.created_at DESC
    '''
    
    rows = c.execute(query, (user_id, user_id)).fetchall()
    conn.close()

    notifications = []
    for row in rows:
        notifications.append({
            'id': row['id'],
            'title': row['title'],
            'content': row['content'],
            'type': row['type'],
            'timestamp': row['created_at'],
            'is_read': bool(row['is_read'])
        })

    return jsonify(notifications)

# 3. 标记通知已读
@app.route('/api/notifications/<int:notification_id>/read', methods=['POST'])
def mark_as_read(notification_id):
    data = request.json
    user_id = data.get('user_id')
    
    if not user_id:
        return jsonify({'error': 'user_id is required'}), 400

    conn = get_db_connection()
    c = conn.cursor()
    try:
        c.execute("INSERT OR IGNORE INTO read_records (user_id, notification_id) VALUES (?, ?)",
                  (user_id, notification_id))
        conn.commit()
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()

    return jsonify({'message': 'Marked as read'}), 200

# 4. 获取 VAPID 公钥
@app.route('/api/push/public_key', methods=['GET'])
def get_public_key():
    """返回VAPID公钥，供前端订阅使用"""
    return jsonify({'public_key': VAPID_PUBLIC_KEY})

# 5. 保存推送订阅
@app.route('/api/push/subscribe', methods=['POST'])
def subscribe_push():
    """保存用户的推送订阅"""
    data = request.json
    user_id = data.get('user_id')
    subscription = data.get('subscription')
    
    print(f"[Subscribe] ========================================")
    print(f"[Subscribe] 📥 收到订阅请求")
    print(f"[Subscribe]   user_id: {user_id}")
    print(f"[Subscribe]   user_id类型: {type(user_id).__name__}")
    print(f"[Subscribe]   subscription endpoint: {subscription.get('endpoint', 'N/A')[:50] if subscription else 'N/A'}...")
    
    if not user_id or not subscription:
        print(f"[Subscribe] ✗ 缺少必要参数")
        print(f"[Subscribe] ========================================")
        return jsonify({'error': 'user_id and subscription required'}), 400
    
    conn = get_db_connection()
    c = conn.cursor()
    try:
        subscription_json = json.dumps(subscription)
        c.execute('''INSERT OR REPLACE INTO push_subscriptions 
                     (user_id, subscription, created_at) 
                     VALUES (?, ?, ?)''',
                  (user_id, subscription_json, time.time()))
        conn.commit()
        
        print(f"[Subscribe] ✓✓✓ 订阅保存成功！")
        print(f"[Subscribe]   已保存到数据库: user_id={user_id}")
        
        # 验证保存结果
        verify = c.execute('SELECT user_id FROM push_subscriptions WHERE user_id = ?', (user_id,)).fetchone()
        if verify:
            print(f"[Subscribe]   ✓ 验证成功：数据库中已存在该订阅")
        else:
            print(f"[Subscribe]   ✗ 警告：保存后查询不到该订阅！")
        
        print(f"[Subscribe] ========================================")
        return jsonify({'message': 'Subscribed successfully'}), 200
    except Exception as e:
        print(f"[Subscribe] ✗✗✗ 保存失败！")
        print(f"[Subscribe]   错误: {str(e)}")
        print(f"[Subscribe] ========================================")
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()

# ========== 联机社交功能 API ==========

import hashlib
import secrets

def hash_password(password):
    """简单密码哈希"""
    return hashlib.sha256(password.encode()).hexdigest()

def generate_social_id():
    """生成唯一社交ID（6位字母数字）"""
    import string
    import random
    chars = string.ascii_uppercase + string.digits
    while True:
        social_id = ''.join(random.choices(chars, k=6))
        conn = get_db_connection()
        exists = conn.execute('SELECT 1 FROM online_users WHERE social_id = ?', (social_id,)).fetchone()
        conn.close()
        if not exists:
            return social_id

# 用户注册
@app.route('/api/online/register', methods=['POST'])
def online_register():
    """用户注册联机账号"""
    data = request.json
    username = data.get('username', '').strip()
    password = data.get('password', '')
    nickname = data.get('nickname', '').strip()
    wechat_id = data.get('wechat_id', '').strip()  # 角色档案的微信号
    avatar = data.get('avatar', '')
    
    if not username or not password:
        return jsonify({'error': '用户名和密码不能为空'}), 400
    
    if len(username) < 3 or len(username) > 20:
        return jsonify({'error': '用户名长度需在3-20个字符之间'}), 400
    
    if len(password) < 6:
        return jsonify({'error': '密码长度至少6个字符'}), 400
    
    if not wechat_id:
        return jsonify({'error': '请先在角色档案中设置虚拟账号'}), 400
    
    conn = get_db_connection()
    c = conn.cursor()
    
    # 检查用户名是否已存在
    if c.execute('SELECT 1 FROM online_users WHERE username = ?', (username,)).fetchone():
        conn.close()
        return jsonify({'error': '用户名已被注册'}), 400
    
    # 检查虚拟账号是否已被绑定
    if c.execute('SELECT 1 FROM online_users WHERE wechat_id = ?', (wechat_id,)).fetchone():
        conn.close()
        return jsonify({'error': '该虚拟账号已被其他账号绑定'}), 400
    
    # 生成唯一社交ID（备用）
    social_id = generate_social_id()
    
    try:
        c.execute('''INSERT INTO online_users (username, password, social_id, wechat_id, nickname, avatar, created_at, last_online)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)''',
                  (username, hash_password(password), social_id, wechat_id, nickname or username, avatar, time.time(), time.time()))
        conn.commit()
        user_id = c.lastrowid
        conn.close()
        
        print(f"[Online] ✓ 用户注册成功: {username}, wechat_id: {wechat_id}")
        return jsonify({
            'message': '注册成功',
            'user': {
                'id': user_id,
                'username': username,
                'social_id': social_id,
                'wechat_id': wechat_id,
                'nickname': nickname or username,
                'avatar': avatar
            }
        }), 201
    except Exception as e:
        conn.close()
        return jsonify({'error': str(e)}), 500

# 用户登录
@app.route('/api/online/login', methods=['POST'])
def online_login():
    """用户登录"""
    data = request.json
    username = data.get('username', '').strip()
    password = data.get('password', '')
    
    if not username or not password:
        return jsonify({'error': '请输入用户名和密码'}), 400
    
    conn = get_db_connection()
    user = conn.execute('SELECT * FROM online_users WHERE username = ?', (username,)).fetchone()
    
    if not user or user['password'] != hash_password(password):
        conn.close()
        return jsonify({'error': '用户名或密码错误'}), 401
    
    # 更新最后在线时间
    conn.execute('UPDATE online_users SET last_online = ? WHERE id = ?', (time.time(), user['id']))
    conn.commit()
    conn.close()
    
    print(f"[Online] ✓ 用户登录: {username}")
    return jsonify({
        'message': '登录成功',
        'user': {
            'id': user['id'],
            'username': user['username'],
            'social_id': user['social_id'],
            'wechat_id': user['wechat_id'],
            'nickname': user['nickname'],
            'avatar': user['avatar'],
            'bio': user['bio']
        }
    }), 200

# 更新用户资料
@app.route('/api/online/profile', methods=['PUT'])
def update_profile():
    """更新用户资料"""
    data = request.json
    user_id = data.get('user_id')
    
    if not user_id:
        return jsonify({'error': '缺少user_id'}), 400
    
    conn = get_db_connection()
    c = conn.cursor()
    
    updates = []
    params = []
    
    if 'nickname' in data:
        updates.append('nickname = ?')
        params.append(data['nickname'])
    if 'avatar' in data:
        updates.append('avatar = ?')
        params.append(data['avatar'])
    if 'bio' in data:
        updates.append('bio = ?')
        params.append(data['bio'])
    
    if updates:
        params.append(user_id)
        c.execute(f'UPDATE online_users SET {", ".join(updates)} WHERE id = ?', params)
        conn.commit()
    
    conn.close()
    return jsonify({'message': '更新成功'}), 200

# 搜索用户（通过微信号）
@app.route('/api/online/search', methods=['GET'])
def search_user():
    """通过微信号搜索用户"""
    wechat_id = request.args.get('wechat_id', '').strip()
    social_id = request.args.get('social_id', '').strip().upper()  # 兼容社交ID搜索
    current_user_id = request.args.get('current_user_id')
    
    if not wechat_id and not social_id:
        return jsonify({'error': '请输入虚拟账号'}), 400
    
    conn = get_db_connection()
    
    # 优先通过微信号搜索，其次通过社交ID
    if wechat_id:
        user = conn.execute('SELECT id, username, social_id, wechat_id, nickname, avatar, bio FROM online_users WHERE wechat_id = ?', (wechat_id,)).fetchone()
    else:
        user = conn.execute('SELECT id, username, social_id, wechat_id, nickname, avatar, bio FROM online_users WHERE social_id = ?', (social_id,)).fetchone()
    
    if not user:
        conn.close()
        return jsonify({'error': '未找到该用户，对方可能还没有开通联机功能'}), 404
    
    # 检查是否已经是好友
    is_friend = False
    has_pending_request = False
    
    if current_user_id:
        friendship = conn.execute('SELECT 1 FROM friendships WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)',
                                 (current_user_id, user['id'], user['id'], current_user_id)).fetchone()
        is_friend = friendship is not None
        
        # 检查是否有待处理的好友请求
        pending = conn.execute('SELECT 1 FROM friend_requests WHERE from_user_id = ? AND to_user_id = ? AND status = "pending"',
                              (current_user_id, user['id'])).fetchone()
        has_pending_request = pending is not None
    
    conn.close()
    
    return jsonify({
        'user': {
            'id': user['id'],
            'username': user['username'],
            'social_id': user['social_id'],
            'wechat_id': user['wechat_id'],
            'nickname': user['nickname'],
            'avatar': user['avatar'],
            'bio': user['bio'],
            'is_friend': is_friend,
            'has_pending_request': has_pending_request
        }
    }), 200

# 发送好友请求
@app.route('/api/online/friend_request', methods=['POST'])
def send_friend_request():
    """发送好友请求"""
    data = request.json
    from_user_id = data.get('from_user_id')
    to_user_id = data.get('to_user_id')
    message = data.get('message', '')
    
    if not from_user_id or not to_user_id:
        return jsonify({'error': '缺少参数'}), 400
    
    if from_user_id == to_user_id:
        return jsonify({'error': '不能添加自己为好友'}), 400
    
    conn = get_db_connection()
    c = conn.cursor()
    
    # 检查是否已经是好友
    if c.execute('SELECT 1 FROM friendships WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)',
                (from_user_id, to_user_id, to_user_id, from_user_id)).fetchone():
        conn.close()
        return jsonify({'error': '你们已经是好友了'}), 400
    
    # 检查是否已有待处理请求
    existing = c.execute('SELECT * FROM friend_requests WHERE from_user_id = ? AND to_user_id = ? AND status = "pending"',
                        (from_user_id, to_user_id)).fetchone()
    if existing:
        conn.close()
        return jsonify({'error': '已发送过好友请求，请等待对方处理'}), 400
    
    # 检查对方是否也向我发送了请求（直接成为好友）
    reverse = c.execute('SELECT * FROM friend_requests WHERE from_user_id = ? AND to_user_id = ? AND status = "pending"',
                       (to_user_id, from_user_id)).fetchone()
    if reverse:
        # 双方互相添加，直接成为好友
        c.execute('UPDATE friend_requests SET status = "accepted", updated_at = ? WHERE id = ?',
                 (time.time(), reverse['id']))
        c.execute('INSERT INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)',
                 (from_user_id, to_user_id, time.time()))
        c.execute('INSERT INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)',
                 (to_user_id, from_user_id, time.time()))
        conn.commit()
        conn.close()
        
        # 通过WebSocket通知双方
        socketio.emit('friend_added', {'user_id': from_user_id, 'friend_id': to_user_id})
        socketio.emit('friend_added', {'user_id': to_user_id, 'friend_id': from_user_id})
        
        return jsonify({'message': '对方也想添加你，你们已成为好友！', 'status': 'accepted'}), 200
    
    # 创建好友请求
    c.execute('INSERT INTO friend_requests (from_user_id, to_user_id, message, status, created_at, updated_at) VALUES (?, ?, ?, "pending", ?, ?)',
             (from_user_id, to_user_id, message, time.time(), time.time()))
    conn.commit()
    request_id = c.lastrowid
    conn.close()
    
    # 通过WebSocket通知对方
    socketio.emit('new_friend_request', {'to_user_id': to_user_id, 'from_user_id': from_user_id})
    
    print(f"[Online] 好友请求: {from_user_id} -> {to_user_id}")
    return jsonify({'message': '好友请求已发送', 'request_id': request_id}), 200

# 获取好友请求列表
@app.route('/api/online/friend_requests', methods=['GET'])
def get_friend_requests():
    """获取收到的好友请求"""
    user_id = request.args.get('user_id')
    
    if not user_id:
        return jsonify({'error': '缺少user_id'}), 400
    
    conn = get_db_connection()
    rows = conn.execute('''
        SELECT fr.*, u.username, u.social_id, u.wechat_id, u.nickname, u.avatar
        FROM friend_requests fr
        JOIN online_users u ON fr.from_user_id = u.id
        WHERE fr.to_user_id = ? AND fr.status = "pending"
        ORDER BY fr.created_at DESC
    ''', (user_id,)).fetchall()
    conn.close()
    
    requests = []
    for row in rows:
        requests.append({
            'id': row['id'],
            'from_user': {
                'id': row['from_user_id'],
                'username': row['username'],
                'social_id': row['social_id'],
                'wechat_id': row['wechat_id'],
                'nickname': row['nickname'],
                'avatar': row['avatar']
            },
            'message': row['message'],
            'created_at': row['created_at']
        })
    
    return jsonify({'requests': requests}), 200

# 处理好友请求
@app.route('/api/online/friend_request/<int:request_id>', methods=['PUT'])
def handle_friend_request(request_id):
    """接受或拒绝好友请求"""
    data = request.json
    action = data.get('action')  # 'accept' or 'reject'
    user_id = data.get('user_id')
    
    if action not in ['accept', 'reject']:
        return jsonify({'error': '无效的操作'}), 400
    
    conn = get_db_connection()
    c = conn.cursor()
    
    req = c.execute('SELECT * FROM friend_requests WHERE id = ? AND to_user_id = ? AND status = "pending"',
                   (request_id, user_id)).fetchone()
    
    if not req:
        conn.close()
        return jsonify({'error': '请求不存在或已处理'}), 404
    
    if action == 'accept':
        # 更新请求状态
        c.execute('UPDATE friend_requests SET status = "accepted", updated_at = ? WHERE id = ?',
                 (time.time(), request_id))
        # 创建双向好友关系
        c.execute('INSERT OR IGNORE INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)',
                 (req['from_user_id'], req['to_user_id'], time.time()))
        c.execute('INSERT OR IGNORE INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)',
                 (req['to_user_id'], req['from_user_id'], time.time()))
        
        # 通知双方
        socketio.emit('friend_added', {'user_id': req['from_user_id'], 'friend_id': req['to_user_id']})
        socketio.emit('friend_added', {'user_id': req['to_user_id'], 'friend_id': req['from_user_id']})
        
        message = '已添加好友'
    else:
        c.execute('UPDATE friend_requests SET status = "rejected", updated_at = ? WHERE id = ?',
                 (time.time(), request_id))
        message = '已拒绝请求'
    
    conn.commit()
    conn.close()
    
    return jsonify({'message': message}), 200

# 获取好友列表
@app.route('/api/online/friends', methods=['GET'])
def get_friends():
    """获取好友列表"""
    user_id = request.args.get('user_id')
    
    if not user_id:
        return jsonify({'error': '缺少user_id'}), 400
    
    conn = get_db_connection()
    rows = conn.execute('''
        SELECT u.id, u.username, u.social_id, u.wechat_id, u.nickname, u.avatar, u.bio, u.last_online
        FROM friendships f
        JOIN online_users u ON f.friend_id = u.id
        WHERE f.user_id = ?
        ORDER BY u.last_online DESC
    ''', (user_id,)).fetchall()
    conn.close()
    
    friends = []
    for row in rows:
        friends.append({
            'id': row['id'],
            'username': row['username'],
            'social_id': row['social_id'],
            'wechat_id': row['wechat_id'],
            'nickname': row['nickname'],
            'avatar': row['avatar'],
            'bio': row['bio'],
            'last_online': row['last_online']
        })
    
    return jsonify({'friends': friends}), 200

# 删除好友
@app.route('/api/online/friend/<int:friend_id>', methods=['DELETE'])
def delete_friend(friend_id):
    """删除好友"""
    user_id = request.args.get('user_id')
    
    if not user_id:
        return jsonify({'error': '缺少user_id'}), 400
    
    conn = get_db_connection()
    c = conn.cursor()
    c.execute('DELETE FROM friendships WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)',
             (user_id, friend_id, friend_id, user_id))
    conn.commit()
    conn.close()
    
    return jsonify({'message': '已删除好友'}), 200

# 发送用户间消息
@app.route('/api/online/message', methods=['POST'])
def send_user_message():
    """发送用户间私聊消息"""
    data = request.json
    from_user_id = data.get('from_user_id')
    to_user_id = data.get('to_user_id')
    content = data.get('content', '').strip()
    msg_type = data.get('msg_type', 'text')
    
    if not from_user_id or not to_user_id or not content:
        return jsonify({'error': '缺少参数'}), 400
    
    conn = get_db_connection()
    c = conn.cursor()
    
    # 验证是否是好友关系
    if not c.execute('SELECT 1 FROM friendships WHERE user_id = ? AND friend_id = ?',
                    (from_user_id, to_user_id)).fetchone():
        conn.close()
        return jsonify({'error': '你们还不是好友'}), 403
    
    # 保存消息
    now = time.time()
    c.execute('INSERT INTO user_messages (from_user_id, to_user_id, content, msg_type, created_at) VALUES (?, ?, ?, ?, ?)',
             (from_user_id, to_user_id, content, msg_type, now))
    conn.commit()
    msg_id = c.lastrowid
    conn.close()
    
    # 通过WebSocket实时推送给对方
    socketio.emit('new_user_message', {
        'id': msg_id,
        'from_user_id': from_user_id,
        'to_user_id': to_user_id,
        'content': content,
        'msg_type': msg_type,
        'created_at': now
    })
    
    return jsonify({'message': '发送成功', 'msg_id': msg_id, 'created_at': now}), 200

# 获取聊天记录
@app.route('/api/online/messages', methods=['GET'])
def get_user_messages():
    """获取与某用户的聊天记录"""
    user_id = request.args.get('user_id')
    friend_id = request.args.get('friend_id')
    limit = request.args.get('limit', 50, type=int)
    before_id = request.args.get('before_id', type=int)
    
    if not user_id or not friend_id:
        return jsonify({'error': '缺少参数'}), 400
    
    conn = get_db_connection()
    
    query = '''
        SELECT * FROM user_messages
        WHERE (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)
    '''
    params = [user_id, friend_id, friend_id, user_id]
    
    if before_id:
        query += ' AND id < ?'
        params.append(before_id)
    
    query += ' ORDER BY created_at DESC LIMIT ?'
    params.append(limit)
    
    rows = conn.execute(query, params).fetchall()
    
    # 标记消息已读
    conn.execute('UPDATE user_messages SET is_read = 1 WHERE from_user_id = ? AND to_user_id = ? AND is_read = 0',
                (friend_id, user_id))
    conn.commit()
    conn.close()
    
    messages = []
    for row in rows:
        messages.append({
            'id': row['id'],
            'from_user_id': row['from_user_id'],
            'to_user_id': row['to_user_id'],
            'content': row['content'],
            'msg_type': row['msg_type'],
            'is_read': row['is_read'],
            'created_at': row['created_at']
        })
    
    # 按时间正序返回
    messages.reverse()
    return jsonify({'messages': messages}), 200

# 获取未读消息数
@app.route('/api/online/unread_count', methods=['GET'])
def get_unread_count():
    """获取未读消息数"""
    user_id = request.args.get('user_id')
    
    if not user_id:
        return jsonify({'error': '缺少user_id'}), 400
    
    conn = get_db_connection()
    
    # 获取每个好友的未读数
    rows = conn.execute('''
        SELECT from_user_id, COUNT(*) as count
        FROM user_messages
        WHERE to_user_id = ? AND is_read = 0
        GROUP BY from_user_id
    ''', (user_id,)).fetchall()
    conn.close()
    
    unread = {}
    total = 0
    for row in rows:
        unread[row['from_user_id']] = row['count']
        total += row['count']
    
    return jsonify({'unread': unread, 'total': total}), 200

# 获取会话列表（带最后一条消息）
@app.route('/api/online/conversations', methods=['GET'])
def get_conversations():
    """获取会话列表"""
    user_id = request.args.get('user_id')
    
    if not user_id:
        return jsonify({'error': '缺少user_id'}), 400
    
    conn = get_db_connection()
    
    # 获取所有好友及最后消息
    rows = conn.execute('''
        SELECT 
            u.id, u.nickname, u.avatar, u.social_id,
            (SELECT content FROM user_messages 
             WHERE (from_user_id = u.id AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = u.id)
             ORDER BY created_at DESC LIMIT 1) as last_message,
            (SELECT created_at FROM user_messages 
             WHERE (from_user_id = u.id AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = u.id)
             ORDER BY created_at DESC LIMIT 1) as last_time,
            (SELECT COUNT(*) FROM user_messages 
             WHERE from_user_id = u.id AND to_user_id = ? AND is_read = 0) as unread_count
        FROM friendships f
        JOIN online_users u ON f.friend_id = u.id
        WHERE f.user_id = ?
        ORDER BY last_time DESC NULLS LAST
    ''', (user_id, user_id, user_id, user_id, user_id, user_id)).fetchall()
    conn.close()
    
    conversations = []
    for row in rows:
        conversations.append({
            'friend_id': row['id'],
            'nickname': row['nickname'],
            'avatar': row['avatar'],
            'social_id': row['social_id'],
            'last_message': row['last_message'],
            'last_time': row['last_time'],
            'unread_count': row['unread_count']
        })
    
    return jsonify({'conversations': conversations}), 200

# ========== 联机社交功能 API 结束 ==========

# 新增：AI 聊天代理接口 (解决前端跨域和Mixed Content问题)
@app.route('/api/chat/proxy', methods=['POST'])
def chat_proxy():
    data = request.json
    api_url = data.get('apiUrl')
    api_key = data.get('apiKey')
    model = data.get('model')
    messages = data.get('messages')
    
    # 允许部分参数从环境变量读取（如果未提供）
    # 这里主要处理前端传来的参数
    
    if not all([api_url, api_key, messages]):
        return jsonify({'error': 'Missing required parameters (apiUrl, apiKey, messages)'}), 400
        
    try:
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}"
        }
        
        # 构造请求体
        payload = {
            "model": model if model else "gpt-3.5-turbo",
            "messages": messages,
            "temperature": 0.7
        }
        
        print(f"[Proxy] Forwarding request to {api_url}...")
        # 设置超时时间，避免长时间挂起
        response = requests.post(api_url, headers=headers, json=payload, timeout=60)
        
        if response.status_code != 200:
            print(f"[Proxy] API Error: {response.status_code} - {response.text[:200]}")
            return jsonify({
                'error': f"Upstream API Error: {response.status_code}", 
                'details': response.text
            }), response.status_code
            
        return jsonify(response.json())
        
    except requests.exceptions.Timeout:
        return jsonify({'error': 'Request timed out'}), 504
    except Exception as e:
        print(f"[Proxy] Exception: {e}")
        return jsonify({'error': str(e)}), 500

# 6. 同步角色配置
@app.route('/api/characters/sync', methods=['POST'])
def sync_characters():
    """前端同步角色配置到后端"""
    data = request.json
    characters = data.get('characters', [])
    
    print(f"[Sync] ========================================")
    print(f"[Sync] 📥 收到同步请求")
    print(f"[Sync]   角色数量: {len(characters)}")
    
    conn = get_db_connection()
    c = conn.cursor()
    
    for idx, char in enumerate(characters):
        char_id = char.get('id')
        char_name = char.get('name')
        user_id = char.get('user_id')
        
        print(f"[Sync] ----------------------------------------")
        print(f"[Sync] 角色 #{idx+1}/{len(characters)}")
        print(f"[Sync]   id: {char_id}")
        print(f"[Sync]   name: {char_name}")
        print(f"[Sync]   user_id: {user_id}")
        print(f"[Sync]   user_id类型: {type(user_id).__name__}")
        print(f"[Sync]   auto_reply_enabled: {char.get('auto_reply_enabled')}")
        print(f"[Sync]   auto_reply_interval: {char.get('auto_reply_interval')} 分钟")
        print(f"[Sync]   last_message_time: {char.get('last_message_time')}")
        
        c.execute('''INSERT OR REPLACE INTO characters 
                     (id, name, avatar, auto_reply_enabled, auto_reply_interval, 
                      last_message_time, user_id, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)''',
                  (char_id, char_name, char.get('avatar'),
                   1 if char.get('auto_reply_enabled') else 0,
                   char.get('auto_reply_interval', 0),
                   char.get('last_message_time', 0),
                   user_id,
                   time.time()))
    
    conn.commit()
    conn.close()
    
    print(f"[Sync] ✓✓✓ 同步完成！已保存 {len(characters)} 个角色到数据库")
    print(f"[Sync] ========================================")
    return jsonify({'message': f'Synced {len(characters)} characters'}), 200

# 后台定时检查线程
def check_auto_messages():
    """后台线程：每10秒检查是否需要触发主动消息"""
    print("[AutoCheck] Background checker thread started")
    while True:
        try:
            time.sleep(10)  # 每10秒检查一次
            
            now = time.time()
            conn = get_db_connection()
            c = conn.cursor()
            
            # 查询开启了主动发消息的角色
            rows = c.execute('''SELECT id, name, avatar, auto_reply_interval, 
                                       last_message_time, user_id
                                FROM characters 
                                WHERE auto_reply_enabled = 1 
                                AND auto_reply_interval > 0''').fetchall()
            
            if rows:
                print(f"[AutoCheck] ========================================")
                print(f"[AutoCheck] 🔍 检查 {len(rows)} 个角色...")
            
            for row in rows:
                char_id = row['id']
                char_name = row['name']
                interval_minutes = row['auto_reply_interval']
                last_time = row['last_message_time']
                user_id = row['user_id']
                
                # 检查user_id是否有效
                if not user_id:
                    print(f"[AutoCheck] ⚠️ {char_name} 的user_id为空，跳过")
                    continue
                
                # 【关键修复】确保 user_id 是字符串类型
                user_id = str(user_id)
                print(f"[AutoCheck]   user_id转换后: {user_id} (类型: {type(user_id).__name__})")
                
                # 计算时间差（分钟）
                time_diff = (now - last_time) / 60
                
                print(f"[AutoCheck] 角色: {char_name}")
                print(f"[AutoCheck]   user_id: {user_id} (类型: {type(user_id).__name__})")
                print(f"[AutoCheck]   间隔: {interval_minutes}分钟, 已过: {time_diff:.1f}分钟")
                
                # 如果超过间隔时间，立即推送
                if time_diff >= interval_minutes:
                    print(f"[AutoCheck] ✓✓✓ {char_name} 需要发消息！")
                    
                    # 更新最后发送时间
                    c.execute('UPDATE characters SET last_message_time = ? WHERE id = ?',
                              (now, char_id))
                    conn.commit()
                    
                    # 1. 通过WebSocket推送给前端（如果在线，让前端生成消息）
                    push_data = {
                        'type': 'auto_chat_trigger',
                        'char_id': char_id,
                        'char_name': char_name,
                        'user_id': user_id,
                        'timestamp': now
                    }
                    socketio.emit('auto_chat_trigger', push_data, broadcast=True)
                    print(f"[AutoCheck] ✓ WebSocket推送已发送")
                    
                    # 2. 【关键】立即通过 Web Push 推送系统通知（即使浏览器在后台也能收到）
                    print(f"[AutoCheck] 🔔 正在发送Web Push后台通知...")
                    message_preview = f"{char_name} 想和你聊天了~"
                    send_web_push(user_id, char_name, char_id, message_preview)
                    print(f"[AutoCheck] ✓✓✓ Web Push后台通知已发送！")
            
            if rows:
                print(f"[AutoCheck] ========================================")
            
            conn.close()
            
        except Exception as e:
            print(f"[AutoCheck] ✗ Error: {e}")
            import traceback
            traceback.print_exc()

# Web Push 推送函数
def send_web_push(user_id, char_name, char_id, message=None):
    """通过 Web Push 发送通知（带消息内容）"""
    try:
        # 【关键修复】确保 user_id 是字符串类型
        user_id = str(user_id)
        
        conn = get_db_connection()
        c = conn.cursor()
        
        # 获取该用户的所有订阅
        print(f"[WebPush] ========================================")
        print(f"[WebPush] 🔍 查找订阅...")
        print(f"[WebPush]   user_id: {user_id}")
        print(f"[WebPush]   user_id类型: {type(user_id).__name__}")
        
        # 先查询所有订阅，看看数据库里有什么
        all_rows = c.execute('SELECT user_id, created_at FROM push_subscriptions').fetchall()
        print(f"[WebPush]   数据库中的订阅总数: {len(all_rows)}")
        if all_rows:
            print(f"[WebPush]   数据库中的user_id列表:")
            for r in all_rows:
                print(f"[WebPush]     - user_id: {r['user_id']} (类型: {type(r['user_id']).__name__})")
        
        # 精确匹配查询
        rows = c.execute('SELECT subscription FROM push_subscriptions WHERE user_id = ?', 
                        (user_id,)).fetchall()
        conn.close()
        
        if not rows:
            print(f"[WebPush] ✗✗✗ 没有找到匹配的订阅！")
            print(f"[WebPush]   查询的user_id: {user_id} (类型: {type(user_id).__name__})")
            print(f"[WebPush]   请检查：")
            print(f"[WebPush]     1. user_id是否完全匹配（包括大小写和类型）？")
            print(f"[WebPush]     2. 前端订阅时使用的user_id是什么？")
            print(f"[WebPush]     3. 角色同步时使用的user_id是什么？")
            print(f"[WebPush] ========================================")
            return
        
        print(f"[WebPush] ✓ 找到 {len(rows)} 个匹配的订阅")
        print(f"[WebPush] ========================================")
        
        # 准备推送数据（带真实消息内容）
        body_text = message if message else f'{char_name} 给你发来了消息'
        push_payload = json.dumps({
            'title': char_name,
            'body': body_text,
            'icon': 'https://img.heliar.top/file/1769158422909_无标题281_20251207015501_20260123165317.png',
            'data': {
                'char_id': char_id,
                'char_name': char_name,
                'url': './index.html'
            }
        })
        
        # 推送到所有订阅
        for idx, row in enumerate(rows):
            try:
                subscription_info = json.loads(row['subscription'])
                
                print(f"[WebPush] ========================================")
                print(f"[WebPush] 🔔 正在发送推送 #{idx+1}/{len(rows)}")
                print(f"[WebPush]   user_id: {user_id}")
                print(f"[WebPush]   char_name: {char_name}")
                print(f"[WebPush]   message: {body_text[:50]}...")
                print(f"[WebPush]   subscription endpoint: {subscription_info.get('endpoint', 'N/A')[:50]}...")
                
                webpush(
                    subscription_info=subscription_info,
                    data=push_payload,
                    vapid_private_key=VAPID_PRIVATE_KEY,
                    vapid_claims=VAPID_CLAIMS
                )
                
                print(f"[WebPush] ✓✓✓ 推送成功发送！user_id={user_id}, char={char_name}")
                print(f"[WebPush] ========================================")
                
            except WebPushException as e:
                print(f"[WebPush] ========================================")
                print(f"[WebPush] ✗✗✗ WebPush异常！")
                print(f"[WebPush]   错误类型: {type(e).__name__}")
                print(f"[WebPush]   错误消息: {str(e)}")
                if e.response:
                    print(f"[WebPush]   响应状态码: {e.response.status_code}")
                    try:
                        error_detail = e.response.json()
                        print(f"[WebPush]   响应详情: {error_detail}")
                    except:
                        print(f"[WebPush]   响应内容: {e.response.text[:200]}")
                
                if e.response and e.response.status_code == 410:
                    # 订阅已过期，删除
                    print(f"[WebPush]   订阅已过期(410)，正在删除...")
                    conn = get_db_connection()
                    c = conn.cursor()
                    c.execute('DELETE FROM push_subscriptions WHERE subscription = ?',
                             (row['subscription'],))
                    conn.commit()
                    conn.close()
                    print(f"[WebPush]   ✓ 已删除过期订阅")
                print(f"[WebPush] ========================================")
                
            except Exception as e:
                print(f"[WebPush] ========================================")
                print(f"[WebPush] ✗✗✗ 未知异常！")
                print(f"[WebPush]   错误类型: {type(e).__name__}")
                print(f"[WebPush]   错误消息: {str(e)}")
                import traceback
                print(f"[WebPush]   堆栈跟踪:")
                traceback.print_exc()
                print(f"[WebPush] ========================================")
                
    except Exception as e:
        print(f"[WebPush] ✗ Error in send_web_push: {e}")

# 诊断API - 检查订阅状态
@app.route('/api/debug/subscriptions', methods=['GET'])
def debug_subscriptions():
    """检查push_subscriptions表中的订阅数量"""
    try:
        conn = get_db_connection()
        c = conn.cursor()
        rows = c.execute('SELECT user_id, created_at FROM push_subscriptions').fetchall()
        conn.close()
        
        result = {
            'count': len(rows),
            'subscriptions': [{'user_id': r['user_id'], 'created_at': r['created_at']} for r in rows]
        }
        print(f"[Debug] 订阅数量: {len(rows)}")
        return jsonify(result), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# 诊断API - 手动触发一次后台检查
@app.route('/api/debug/trigger_check', methods=['POST'])
def debug_trigger_check():
    """手动触发一次后台检查（用于测试）"""
    try:
        now = time.time()
        conn = get_db_connection()
        c = conn.cursor()
        
        rows = c.execute('''SELECT id, name, auto_reply_interval, last_message_time, user_id
                            FROM characters 
                            WHERE auto_reply_enabled = 1 
                            AND auto_reply_interval > 0''').fetchall()
        
        results = []
        for row in rows:
            char_id = row['id']
            char_name = row['name']
            user_id = row['user_id']
            
            # 直接发送Web Push（不管时间）
            message = f"【测试】{char_name} 的后台推送"
            send_web_push(user_id, char_name, char_id, message)
            results.append({'char_name': char_name, 'user_id': user_id, 'pushed': True})
        
        conn.close()
        return jsonify({'message': f'已触发 {len(results)} 个推送', 'results': results}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# 按需触发推送通知（前端调用）
@app.route('/api/trigger_push', methods=['POST'])
def trigger_push():
    """前端AI消息生成后，立即调用此API发送推送（带消息内容）"""
    try:
        data = request.get_json()
        user_id = data.get('user_id')
        char_id = data.get('char_id')
        char_name = data.get('char_name')
        message = data.get('message', f'{char_name} 给你发来了消息')  # 消息内容
        
        if not all([user_id, char_id, char_name]):
            return jsonify({'error': 'Missing parameters'}), 400
        
        # 【关键修复】确保 user_id 是字符串类型（前端可能传数字）
        user_id = str(user_id)
        print(f"[TriggerPush] ✓ Immediate push for {char_name}: {message[:20]}...")
        print(f"[TriggerPush]   user_id: {user_id} (类型: {type(user_id).__name__})")
        
        # 立即发送Web Push（带消息内容）
        send_web_push(user_id, char_name, char_id, message)
        
        return jsonify({'message': 'Push sent successfully'}), 200
        
    except Exception as e:
        print(f"[TriggerPush] ✗ Error: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/trigger-active-message', methods=['POST'])
def trigger_active_message():
    data = request.json
    user_id = data.get('user_id')
    char_id = data.get('char_id')
    content = data.get('content', '我好想你呀，你在干嘛呢？') # 默认内容

    if not user_id or not char_id:
        return jsonify({'error': 'Missing params'}), 400

    conn = get_db_connection()
    try:
        # 1. 获取角色信息
        cursor = conn.execute('SELECT name, avatar FROM characters WHERE id = ?', (char_id,))
        char = cursor.fetchone()
        char_name = char['name'] if char else "AI角色"
        
        # 2. 保存消息到数据库
        conn.execute('INSERT INTO messages (user_id, char_id, sender, content, timestamp) VALUES (?, ?, ?, ?, ?)',
                     (user_id, char_id, 'ai', content, int(time.time())))
        conn.commit()
        
        # 3. WebSocket 发送 (用于前台实时显示，如果在后台会被挂起)
        socketio.emit('receive_message', {
            'role': 'ai',
            'content': content,
            'char_id': char_id,
            'timestamp': int(time.time())
        }, room=str(user_id))
        
        # ============================================================
        # 【修改这里】新增：必须主动调用 Web Push，手机才能在后台收到通知
        # ============================================================
        print(f"[Active] 正在给用户 {user_id} 发送后台推送...")
        
        # 这里的 send_web_push 是你在文件上方定义的那个函数
        # 只要前端之前调用过 subscribeToPush，这里就能推送成功
        send_web_push(
            user_id, 
            char_name,   # 标题（角色名）
            char_id,     # 如果你的 send_web_push 需要 icon，这里传 char_id 或具体 url
            content      # 消息内容
        )
        # ============================================================

        return jsonify({'success': True, 'message': 'Active message sent'})
    except Exception as e:
        print(f"Error: {e}")
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()

# 启动后台检查线程（已废弃，改为按需推送）
def start_background_checker():
    thread = threading.Thread(target=check_auto_messages, daemon=True)
    thread.start()
    print("[Backend] ✓ Background auto-message checker started (10s interval)")

# WebSocket连接事件
@socketio.on('connect')
def handle_connect():
    print(f"[WebSocket] ✓ Client connected")

@socketio.on('disconnect')
def handle_disconnect():
    print(f"[WebSocket] ✗ Client disconnected")

# 用户加入自己的房间（用于接收私聊消息）
@socketio.on('join_user_room')
def handle_join_user_room(data):
    user_id = data.get('user_id')
    if user_id:
        from flask_socketio import join_room
        join_room(f'user_{user_id}')
        print(f"[WebSocket] ✓ User {user_id} joined room user_{user_id}")

# 用户上线通知
@socketio.on('user_online')
def handle_user_online(data):
    user_id = data.get('user_id')
    if user_id:
        conn = get_db_connection()
        conn.execute('UPDATE online_users SET last_online = ? WHERE id = ?', (time.time(), user_id))
        conn.commit()
        conn.close()
        emit('user_status_changed', {'user_id': user_id, 'status': 'online'}, broadcast=True)

if __name__ == '__main__':
    # 获取环境变量 PORT，Zeabur 会自动注入此变量，本地默认使用 5000
    port = int(os.environ.get('PORT', 5000))
    print(f"Starting Flask + WebSocket server on port {port}...")
    print("=" * 50)
    print("API Routes:")
    print(" - POST /api/notifications (Create)")
    print(" - GET  /api/notifications?user_id=... (List)")
    print(" - POST /api/notifications/<id>/read (Mark Read)")
    print(" - POST /api/characters/sync (Sync Characters)")
    print("WebSocket Events:")
    print(" - auto_chat_trigger (实时推送)")
    print("=" * 50)
    
    # ✅ 启动后台检查线程（必须！否则后台无法收到通知）
    # 这个线程会在后台持续检查，即使前端JavaScript被暂停也能工作
    start_background_checker()
    
    # 使用socketio.run而不是app.run
    socketio.run(app, debug=True, port=port, host='0.0.0.0', allow_unsafe_werkzeug=True)
