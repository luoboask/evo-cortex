#!/usr/bin/env python3
"""
每日记忆压缩 — 独立 Python 脚本（供 cron 调用）

替代 isolated session 中不可用的 memory_compress 工具。
流程：
1. 运行 consolidate（晋升 WM → LTM）
2. 运行 decay（实体/关系衰减）
3. 运行 validate_rules（规则验证）
4. 输出统计报告
"""

import sys
import os
import json
import sqlite3
from datetime import datetime

AGENT_ID = sys.argv[1] if len(sys.argv) > 1 else "cortex-test-agent"
# ✅ 使用 workspace 目录（不是插件目录）
HOME = os.path.expanduser('~')
WORKSPACE_DIR = os.path.join(HOME, '.openclaw', f'workspace-{AGENT_ID}')
DATA_DIR = os.path.join(WORKSPACE_DIR, 'data', AGENT_ID)
MEMORY_DB = os.path.join(DATA_DIR, 'memory.db')
KNOWLEDGE_DB = os.path.join(DATA_DIR, 'knowledge.db')


def ensure_dirs():
    os.makedirs(DATA_DIR, exist_ok=True)


def get_db(path):
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    return db


def consolidate():
    """晋升 working_memory 中最新 100 条之后且 importance >= 5.0 的条目到长期记忆"""
    if not os.path.exists(MEMORY_DB):
        print("  ⚠️ memory.db 不存在，跳过")
        return 0

    db = get_db(MEMORY_DB)
    try:
        # 标记过期（24 小时前的条目）
        db.execute("""
            UPDATE working_memory 
            SET expires_at = strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now', '-1 second'))
            WHERE expires_at IS NULL 
              AND created_at < datetime('now', '-24 hours')
              AND importance >= 5.0
        """)
        db.commit()

        # 晋升（最新 100 条之后的，importance 达标即晋升）
        rows = db.execute("""
            SELECT * FROM working_memory 
            WHERE importance >= 5.0
              AND id NOT IN (
                  SELECT id FROM working_memory ORDER BY created_at DESC LIMIT 100
              )
        """).fetchall()

        promoted = 0
        for row in rows:
            ltm_id = f"ltm_{int(datetime.now().timestamp() * 1000)}_{os.urandom(3).hex()}"
            db.execute("""
                INSERT INTO long_term_memory 
                (id, type, title, content, importance, tags, source, source_ref, created_at, consolidated_from)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                ltm_id, row['type'], row['title'], row['content'],
                row['importance'], row['tags'], row['source'], row['source_ref'],
                row['created_at'], row['id']
            ))
            db.execute("""
                INSERT INTO consolidation_log (id, working_id, long_term_id, reason, importance)
                VALUES (?, ?, ?, 'daily_compress', ?)
            """, (f"cl_{ltm_id}", row['id'], ltm_id, row['importance']))
            db.execute("DELETE FROM working_memory WHERE id = ?", (row['id'],))
            promoted += 1

        db.commit()
        return promoted
    finally:
        db.close()


def run_decay():
    """实体/关系衰减"""
    if not os.path.exists(KNOWLEDGE_DB):
        print("  ⚠️ knowledge.db 不存在，跳过")
        return

    db = get_db(KNOWLEDGE_DB)
    try:
        # 实体衰减：30 天未提及的降权 10%
        db.execute("""
            UPDATE entities 
            SET importance = MAX(0.1, importance * 0.9)
            WHERE last_mentioned < datetime('now', '-30 days')
              AND importance > 0.5
        """)
        entity_decayed = db.total_changes

        # 关系衰减：60 天无证据更新的降权 15%
        db.execute("""
            UPDATE relations 
            SET strength = MAX(0.1, strength * 0.85)
            WHERE discovered_at < datetime('now', '-60 days')
              AND strength > 0.3
        """)
        relation_decayed = db.total_changes - entity_decayed

        db.commit()
        print(f"  实体衰减: {entity_decayed}, 关系衰减: {relation_decayed}")
    finally:
        db.close()


def validate_rules():
    """规则验证"""
    if not os.path.exists(KNOWLEDGE_DB):
        return

    db = get_db(KNOWLEDGE_DB)
    try:
        # 确保 status 列存在
        cols = [r[1] for r in db.execute('PRAGMA table_info(rules)').fetchall()]
        if 'status' not in cols:
            db.execute('ALTER TABLE rules ADD COLUMN status TEXT DEFAULT \'active\'')
            db.execute("UPDATE rules SET status='active' WHERE status IS NULL")
            db.commit()

        # 标记低置信度规则为过时
        db.execute("""
            UPDATE rules SET status = 'stale'
            WHERE confidence < 0.3 AND status = 'active'
        """)
        stale = db.total_changes

        # 标记高置信度规则为核心
        db.execute("""
            UPDATE rules SET status = 'core'
            WHERE confidence > 0.8 AND status = 'active'
        """)
        core = db.total_changes - stale

        db.commit()
        print(f"  过时规则: {stale}, 核心规则: {core}")
    finally:
        db.close()


def print_stats():
    """输出统计"""
    stats = {}
    db_mem = None
    db_know = None
    try:
        if os.path.exists(MEMORY_DB):
            db_mem = get_db(MEMORY_DB)
            stats['working_memory'] = db_mem.execute("SELECT COUNT(*) FROM working_memory").fetchone()[0]
            stats['long_term_memory'] = db_mem.execute("SELECT COUNT(*) FROM long_term_memory").fetchone()[0]
        if os.path.exists(KNOWLEDGE_DB):
            db_know = get_db(KNOWLEDGE_DB)
            stats['entities'] = db_know.execute("SELECT COUNT(*) FROM entities").fetchone()[0]
            stats['relations'] = db_know.execute("SELECT COUNT(*) FROM relations").fetchone()[0]
            stats['rules'] = db_know.execute("SELECT COUNT(*) FROM rules").fetchone()[0]
    finally:
        if db_mem: db_mem.close()
        if db_know: db_know.close()
    
    print(f"\n📊 当前状态:")
    for k, v in stats.items():
        print(f"  {k}: {v}")


def main():
    print(f"=== 每日记忆压缩 ({AGENT_ID}) ===")
    print(f"时间: {datetime.now().isoformat()}")
    
    ensure_dirs()
    
    print("\n🔄 [1/3] 晋升工作记忆...")
    promoted = consolidate()
    print(f"  晋升: {promoted} 条")
    
    print("\n📉 [2/3] 衰减更新...")
    run_decay()
    
    print("\n✅ [3/3] 规则验证...")
    validate_rules()
    
    print_stats()
    print("\n✅ 每日压缩完成")


if __name__ == "__main__":
    main()
