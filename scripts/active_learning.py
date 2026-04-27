#!/usr/bin/env python3
# ═══════════════════════════════════════════════════
# 🧠 Evo-Cortex 主动学习（跨平台 Python 版）
# ═══════════════════════════════════════════════════
"""
功能：词频分析 + 用户偏好提取 + 待办事项识别
用法：python3 active_learning_enhanced.py <agent-id>
"""
import sys
import os
import re
import json
import sqlite3
from pathlib import Path
from datetime import datetime, timedelta
from collections import Counter

def main():
    agent_id = sys.argv[1] if len(sys.argv) > 1 else "cortex-test-agent"
    home = Path.home()
    workspace = home / f".openclaw/workspace-{agent_id}"
    memory_dir = workspace / "memory" / agent_id
    data_dir = workspace / "data" / agent_id
    db_path = data_dir / "cortex.db"

    print(f"🧠 主动学习分析 - Agent: {agent_id}")
    print("=" * 50)

    # 1. 词频分析
    print("\n📊 词频分析...")
    all_text = ""
    files_analyzed = 0
    if memory_dir.exists():
        for f in memory_dir.glob("????-??-??.md"):
            all_text += f.read_text(encoding="utf-8", errors="ignore")
            files_analyzed += 1

    print(f"   分析了 {files_analyzed} 个记忆文件")

    # 英文关键词
    en_words = re.findall(r'\b[A-Z][a-z]{3,}\b', all_text)
    top_en = Counter(en_words).most_common(20)

    # 停用词
    stop_words = {'The', 'This', 'That', 'These', 'Those', 'What', 'When', 'Where',
                  'Which', 'Who', 'Why', 'How', 'Have', 'Has', 'Had', 'Will', 'Would',
                  'Could', 'Should', 'Can', 'May', 'Must', 'Shall', 'Need', 'From',
                  'With', 'About', 'After', 'Before', 'Into', 'Upon', 'Over', 'Under',
                  'Between', 'Through', 'During', 'Without', 'Within', 'Along', 'Across',
                  'Please', 'Thank', 'Hello', 'Good', 'Just', 'Very', 'More', 'Most'}

    filtered = [(w, c) for w, c in top_en if w not in stop_words]
    if filtered:
        print("   高频词:")
        for word, count in filtered[:15]:
            print(f"     {word}: {count}")
    else:
        print("   无显著高频词")

    # 2. 偏好提取
    print("\n🎯 偏好提取...")
    pref_patterns = [
        (r'(?:喜欢|偏好|倾向于|prefer)\s*[：:]\s*(.+)', 'preference'),
        (r'(?:不喜欢|讨厌|不要|avoid)\s*[：:]\s*(.+)', 'dislike'),
        (r'(?:用|使用|use)\s*([\w]+)\s*(?:开发|编写|写|coding)', 'tech_stack'),
    ]

    prefs = []
    for pattern, category in pref_patterns:
        matches = re.findall(pattern, all_text)
        for m in matches:
            prefs.append({"category": category, "value": m.strip()[:100]})

    if prefs:
        print(f"   发现 {len(prefs)} 条偏好:")
        for p in prefs:
            print(f"     [{p['category']}] {p['value']}")
    else:
        print("   未发现新偏好")

    # 3. 保存偏好到数据库
    if db_path.exists() and prefs:
        conn = sqlite3.connect(str(db_path))
        cur = conn.cursor()
        cur.execute('''CREATE TABLE IF NOT EXISTS preferences
            (id INTEGER PRIMARY KEY AUTOINCREMENT,
             key TEXT, value TEXT, category TEXT,
             confidence REAL, extracted_at TEXT, confirmed INTEGER DEFAULT 0)''')
        for p in prefs:
            cur.execute(
                "INSERT INTO preferences (key, value, category, confidence, extracted_at) VALUES (?, ?, ?, ?, ?)",
                (p['value'][:50], p['value'], p['category'], 0.7, datetime.now().isoformat())
            )
        conn.commit()
        conn.close()
        print(f"   ✅ 已保存 {len(prefs)} 条偏好到数据库")

    # 4. 待办识别
    print("\n📋 待办事项识别...")
    todo_patterns = [
        r'TODO[：: ]*(.+)',
        r'(?:需要|应该|记得|别忘了|don.t forget)\s*(.+)',
    ]
    todos = []
    for pattern in todo_patterns:
        matches = re.findall(pattern, all_text)
        todos.extend(matches[:5])

    if todos:
        for t in todos:
            print(f"   ☐ {t.strip()[:80]}")
    else:
        print("   无新待办")

    print("\n✅ 主动学习分析完成")

if __name__ == "__main__":
    main()
