import sqlite3
import json
import time
import os
import threading
from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_socketio import SocketIO, emit
from pywebpush import webpush, WebPushException

# 配置静态文件夹路径 (假设前端文件在当前目录下)
app = Flask(__name__, static_folder='.', static_url_path='')
CORS(app, resources={r"/*": {"origins": "*"}})

# 初始化 SocketIO（用于实时推送）
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

# VAPID 密钥（用于 Web Push）
# 首次运行时自动生成，会保存到文件
VAPID_FILE = '/tmp/vapid_keys.json'

def get_vapid_keys():
    """获取或生成 VAPID 密钥"""
    if os.path.exists(VAPID_FILE):
        with open(VAPID_FILE, 'r') as f:
            keys = json.load(f)
            print("[VAPID] ✓ Loaded existing keys from file")
            return keys
    else:
        print("[VAPID] Generating new VAPID keys...")
        try:
            from pywebpush import vapid as vapid_gen
            import base64
            
            v = vapid_gen.Vapid()
            v.generate_keys()
            
            # 获取原始字节
            private_bytes = v.private_key.to_string()
            public_bytes = v.public_key.to_string()
            
            # 转为URL-safe base64（前端需要这种格式）
            public_key_b64 = base64.urlsafe_b64encode(public_bytes).decode('utf-8').rstrip('=')
            
            keys = {
                'private_key': private_bytes.hex(),
                'public_key': public_key_b64,
                'public_key_raw': public_bytes.hex()
            }
            
            with open(VAPID_FILE, 'w') as f:
                json.dump(keys, f, indent=2)
            
            print(f"[VAPID] ✓ Generated new keys")
            print(f"[VAPID] Public Key: {public_key_b64[:30]}...")
            return keys
            
        except ImportError:
            print("[VAPID] ✗ pywebpush not installed! Run: pip install pywebpush")
            return None
        except Exception as e:
            print(f"[VAPID] ✗ Error generating keys: {e}")
            return None

try:
    vapid_keys = get_vapid_keys()
    if vapid_keys:
        VAPID_PRIVATE_KEY = bytes.fromhex(vapid_keys['private_key'])
        VAPID_PUBLIC_KEY = vapid_keys['public_key']
        VAPID_CLAIMS = {"sub": "mailto:admin@example.com"}
        print(f"[VAPID] ✓ Ready to send push notifications")
    else:
        raise Exception("Failed to generate VAPID keys")
except Exception as e:
    print(f"[VAPID] ✗ Fatal error: {e}")
    print("[VAPID] Please install pywebpush: pip install -r requirements.txt")
    VAPID_PRIVATE_KEY = None
    VAPID_PUBLIC_KEY = None
    VAPID_CLAIMS = {}

# 适配 Zeabur 容器环境，使用 /tmp 目录（注意：Zeabur 免费版容器重启后 /tmp 数据会重置）
# 如果需要持久化，建议在 Zeabur 设置中挂载存储卷到特定路径
DB_FILE = '/tmp/notifications.db'

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
    
    if not user_id or not subscription:
        return jsonify({'error': 'user_id and subscription required'}), 400
    
    conn = get_db_connection()
    c = conn.cursor()
    try:
        c.execute('''INSERT OR REPLACE INTO push_subscriptions 
                     (user_id, subscription, created_at) 
                     VALUES (?, ?, ?)''',
                  (user_id, json.dumps(subscription), time.time()))
        conn.commit()
        print(f"[Push] Subscription saved for user: {user_id}")
        return jsonify({'message': 'Subscribed successfully'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()

# 6. 同步角色配置
@app.route('/api/characters/sync', methods=['POST'])
def sync_characters():
    """前端同步角色配置到后端"""
    data = request.json
    characters = data.get('characters', [])
    
    conn = get_db_connection()
    c = conn.cursor()
    
    for char in characters:
        c.execute('''INSERT OR REPLACE INTO characters 
                     (id, name, avatar, auto_reply_enabled, auto_reply_interval, 
                      last_message_time, user_id, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)''',
                  (char.get('id'), char.get('name'), char.get('avatar'),
                   1 if char.get('auto_reply_enabled') else 0,
                   char.get('auto_reply_interval', 0),
                   char.get('last_message_time', 0),
                   char.get('user_id'),
                   time.time()))
    
    conn.commit()
    conn.close()
    
    print(f"[Sync] Synced {len(characters)} characters")
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
            
            for row in rows:
                char_id = row['id']
                char_name = row['name']
                interval_minutes = row['auto_reply_interval']
                last_time = row['last_message_time']
                user_id = row['user_id']
                
                # 计算时间差（分钟）
                time_diff = (now - last_time) / 60
                
                # 如果超过间隔时间，立即推送
                if time_diff >= interval_minutes:
                    print(f"[AutoCheck] ✓ {char_name} needs to send (interval: {interval_minutes}min, elapsed: {time_diff:.1f}min)")
                    
                    # 更新最后发送时间
                    c.execute('UPDATE characters SET last_message_time = ? WHERE id = ?',
                              (now, char_id))
                    conn.commit()
                    
                    # 通过WebSocket立即推送给前端（如果在线）
                    push_data = {
                        'type': 'auto_chat_trigger',
                        'char_id': char_id,
                        'char_name': char_name,
                        'user_id': user_id,
                        'timestamp': now
                    }
                    socketio.emit('auto_chat_trigger', push_data, broadcast=True)
                    print(f"[AutoCheck] ✓ WebSocket push sent for {char_name}")
                    
                    # 同时通过 Web Push 推送（即使浏览器在后台也能收到）
                    send_web_push(user_id, char_name, char_id)
            
            conn.close()
            
        except Exception as e:
            print(f"[AutoCheck] ✗ Error: {e}")

# Web Push 推送函数
def send_web_push(user_id, char_name, char_id, message=None):
    """通过 Web Push 发送通知（带消息内容）"""
    try:
        conn = get_db_connection()
        c = conn.cursor()
        
        # 获取该用户的所有订阅
        rows = c.execute('SELECT subscription FROM push_subscriptions WHERE user_id = ?', 
                        (user_id,)).fetchall()
        conn.close()
        
        if not rows:
            print(f"[WebPush] No subscriptions found for user: {user_id}")
            return
        
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
        for row in rows:
            try:
                subscription_info = json.loads(row['subscription'])
                
                webpush(
                    subscription_info=subscription_info,
                    data=push_payload,
                    vapid_private_key=VAPID_PRIVATE_KEY,
                    vapid_claims=VAPID_CLAIMS
                )
                
                print(f"[WebPush] ✓ Push sent to {user_id} for {char_name}")
                
            except WebPushException as e:
                print(f"[WebPush] ✗ Failed: {e}")
                if e.response and e.response.status_code == 410:
                    # 订阅已过期，删除
                    conn = get_db_connection()
                    c = conn.cursor()
                    c.execute('DELETE FROM push_subscriptions WHERE subscription = ?',
                             (row['subscription'],))
                    conn.commit()
                    conn.close()
                    print(f"[WebPush] Removed expired subscription")
            except Exception as e:
                print(f"[WebPush] ✗ Error: {e}")
                
    except Exception as e:
        print(f"[WebPush] ✗ Error in send_web_push: {e}")

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
        
        print(f"[TriggerPush] ✓ Immediate push for {char_name}: {message[:20]}...")
        
        # 立即发送Web Push（带消息内容）
        send_web_push(user_id, char_name, char_id, message)
        
        return jsonify({'message': 'Push sent successfully'}), 200
        
    except Exception as e:
        print(f"[TriggerPush] ✗ Error: {e}")
        return jsonify({'error': str(e)}), 500

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
    
    # ❌ 移除10秒轮询，改为前端按需触发推送（立即推送，无延迟）
    # start_background_checker()
    
    # 使用socketio.run而不是app.run
    socketio.run(app, debug=True, port=port, host='0.0.0.0', allow_unsafe_werkzeug=True)
