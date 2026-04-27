#!/usr/bin/env python3
# ═══════════════════════════════════════════════════
# 🧠 Evo-Cortex 主动学习（memory.db 版）
# ═══════════════════════════════════════════════════
"""
功能：词频分析 + 用户偏好提取 + 待办事项识别
用法：python3 active_learning.py <agent-id>

变更日志:
    2026-04-27: 数据源 memory/*.md → memory.db
"""

import sys
import re
import json
import sqlite3
from pathlib import Path
from datetime import datetime, timedelta
from collections import Counter

def main():
    agent_id = sys.argv[1] if len(sys.argv) > 1 else "cortex-test-agent"
    workspace = Path.home() / '.openclaw' / f'workspace-{agent_id}'
    data_dir = workspace / 'data' / agent_id
    memory_db = data_dir / 'memory.db'
    knowledge_db = data_dir / 'knowledge.db'

    print(f"🧠 主动学习分析 - Agent: {agent_id}")
    print("=" * 50)

    if not memory_db.exists():
        print(f"❌ memory.db 不存在: {memory_db}")
        return

    conn = sqlite3.connect(memory_db)
    conn.row_factory = sqlite3.Row

    # 读取近 7 天数据
    week_ago = (datetime.now() - timedelta(days=7)).strftime('%Y-%m-%d')

    ltm_rows = conn.execute('''
        SELECT title, content, type FROM long_term_memory WHERE created_at >= ?
    ''', (week_ago,)).fetchall()

    wm_rows = conn.execute('''
        SELECT title, content, type FROM working_memory WHERE created_at >= ? LIMIT 100
    ''', (week_ago,)).fetchall()

    conn.close()

    all_entries = list(ltm_rows) + list(wm_rows)
    print(f"📝 从 memory.db 读取 {len(all_entries)} 条记录")

    if not all_entries:
        print("⚠️  无近期数据")
        return

    # 1. 词频分析
    print("\n📊 词频分析...")
    all_text = ' '.join(f"{r['title'] or ''} {r['content'] or ''}" for r in all_entries)

    # 英文技术词
    en_words = re.findall(r'\b[A-Z][a-zA-Z]{3,}\b', all_text)
    stop_words = {'The', 'This', 'That', 'These', 'Those', 'What', 'When', 'Where',
                  'Which', 'Who', 'Why', 'How', 'Have', 'Has', 'Had', 'Will', 'Would',
                  'Could', 'Should', 'Can', 'May', 'Must', 'Shall', 'Need', 'From',
                  'With', 'About', 'After', 'Before', 'Into', 'Upon', 'Over', 'Under',
                  'Between', 'Through', 'During', 'Without', 'Within', 'Along', 'Across',
                  'Please', 'Thank', 'Hello', 'Good', 'Just', 'Very', 'More', 'Most',
                  'Also', 'Some', 'Then', 'Than', 'They', 'Them', 'Their', 'There',
                  'Other', 'Another', 'Each', 'Every', 'Any', 'All', 'Both', 'Few',
                  'Many', 'Much', 'Such', 'Only', 'Own', 'Same', 'Well', 'Back',
                  'Even', 'Still', 'Already', 'Always', 'Never', 'Often', 'Sometimes'}
    filtered = [(w, c) for w, c in Counter(en_words).most_common(30) if w not in stop_words]

    if filtered:
        print("   高频技术词:")
        for word, count in filtered[:15]:
            print(f"     {word}: {count}")
    else:
        print("   无显著高频词")

    # 中文技术词
    cn_words = re.findall(r'[\u4e00-\u9fff]{2,6}', all_text)
    cn_stopwords = {'的是', '一个', '这个', '那个', '什么', '怎么', '如何', '可以', '所以', '因为', '如果', '但是', '而且', '现在', '已经', '没有', '我们', '你们', '他们', '自己', '这些', '那些', '可能', '也许', '大概', '应该', '需要', '能够', '就是', '还有', '还是', '或者', '并且', '虽然', '尽管', '因此', '然后', '接着', '继续', '开始', '结束', '完成', '进行', '正在', '曾经', '过去', '将来', '未来', '当前', '目前', '最近', '之前', '之后'}
    cn_filtered = [(w, c) for w, c in Counter(cn_words).most_common(30) if w not in cn_stopwords and len(w) >= 2]

    if cn_filtered:
        print("   高频中文词:")
        for word, count in cn_filtered[:10]:
            print(f"     {word}: {count}")

    # 2. 偏好提取
    print("\n🎯 偏好提取...")
    pref_patterns = [
        (r'(?:喜欢|偏好|倾向于|倾向|prefer)\s*[：:]\s*(.+)', 'preference'),
        (r'(?:不喜欢|讨厌|不要|avoid)\s*[：:]\s*(.+)', 'dislike'),
        (r'(?:用|使用|use)\s*([\w]+)\s*(?:开发|编写|写|做|实现)', 'tech_stack'),
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

    # 3. 待办识别
    print("\n📋 待办事项...")
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

    print(f"\n✅ 主动学习分析完成 — {len(all_entries)} 条记录 / {len(filtered)} 高频词 / {len(prefs)} 偏好 / {len(todos)} 待办")

if __name__ == "__main__":
    main()
