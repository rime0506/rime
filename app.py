import sqlite3
import json
import time
import os
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
# 允许跨域，方便前端直接调用
CORS(app)

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
    return "Notification System API is Running!"

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

if __name__ == '__main__':
    # 获取环境变量 PORT，Zeabur 会自动注入此变量，本地默认使用 5000
    port = int(os.environ.get('PORT', 5000))
    print(f"Starting Flask server on port {port}...")
    print("API Routes:")
    print(" - POST /api/notifications (Create)")
    print(" - GET  /api/notifications?user_id=... (List)")
    print(" - POST /api/notifications/<id>/read (Mark Read)")
    app.run(debug=True, port=port, host='0.0.0.0')
