#!/usr/bin/env python3
# ═══════════════════════════════════════════════════
# 🧠 Evo-Cortex 主动学习（memory.db 版）
# ═══════════════════════════════════════════════════
"""
功能：词频分析 + 多类型偏好提取 + 待办事项识别 + 重要性评分
用法：python3 active_learning.py <agent-id>

架构灵感：hermes-agent-skill（LiFulian/hermes-agent-skill）
  - 多类型记忆（preference/tech_stack/workflow/fact/todo）
  - 句式感知提取（匹配完整句子而非孤立关键词）
  - 重要性评分（0.3~0.9）

变更日志:
    2026-04-27: 数据源 memory/*.md → memory.db
    2026-04-29: 引入 hermes-agent 架构 — 多类型记忆 + 句式感知 + importance scoring
"""

import sys
import re
import json
import sqlite3
from pathlib import Path
from datetime import datetime, timedelta
from collections import Counter
from dataclasses import dataclass

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
    try:
        conn.row_factory = sqlite3.Row

        # 读取近 7 天数据
        week_ago = (datetime.now() - timedelta(days=7)).strftime('%Y-%m-%d')

        ltm_rows = conn.execute('''
            SELECT title, content, type FROM long_term_memory WHERE created_at >= ?
        ''', (week_ago,)).fetchall()

        wm_rows = conn.execute('''
            SELECT title, content, type FROM working_memory WHERE created_at >= ? LIMIT 100
        ''', (week_ago,)).fetchall()
    finally:
        conn.close()

    all_entries = list(ltm_rows) + list(wm_rows)
    print(f"📝 从 memory.db 读取 {len(all_entries)} 条记录")

    if not all_entries:
        print("⚠️  无近期数据")
        return

    # ═══════════════════════════════════════════════
    # 1. 词频分析（增强版 — 技术上下文感知）
    # ═══════════════════════════════════════════════
    print("\n📊 词频分析...")
    all_text = ' '.join(f"{r['title'] or ''} {r['content'] or ''}" for r in all_entries)

    # 英文技术词：只匹配 CamelCase/PascalCase 技术名词
    # 排除：孤立大写词（WHERE/Current/April）、文件路径（Users/...\）
    en_words = re.findall(r'\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b', all_text)  # CamelCase only
    stop_words = {
        'The', 'This', 'That', 'These', 'Those', 'What', 'When', 'Where',
        'Which', 'Who', 'Why', 'How', 'Have', 'Has', 'Had', 'Will', 'Would',
        'Could', 'Should', 'Can', 'May', 'Must', 'Shall', 'Need', 'From',
        'With', 'About', 'After', 'Before', 'Into', 'Upon', 'Over', 'Under',
        'Between', 'Through', 'During', 'Without', 'Within', 'Along', 'Across',
        'Please', 'Thank', 'Hello', 'Good', 'Just', 'Very', 'More', 'Most',
        'Also', 'Some', 'Then', 'Than', 'They', 'Them', 'Their', 'There',
        'Other', 'Another', 'Each', 'Every', 'Any', 'All', 'Both', 'Few',
        'Many', 'Much', 'Such', 'Only', 'Own', 'Same', 'Well', 'Back',
        'Even', 'Still', 'Already', 'Always', 'Never', 'Often', 'Sometimes',
        # 模板噪音
        'User', 'Boot', 'Strap', 'Identity', 'Soul', 'Memory', 'Tools', 'Agents',
        'Name', 'Notes', 'Related', 'Update', 'Make', 'Agent',
        'Your', 'Workspace', 'Context', 'First', 'Session', 'Heartbeat',
        'System', 'Status', 'Red', 'Lines', 'External', 'Internal',
        'Skills', 'Voice', 'Platform', 'Default',
        'Keep', 'Local', 'What', 'Goes', 'Here', 'Like',
        'Cameras', 'Living', 'Front', 'Tts', 'Preferred', 'Speaker',
        'Separate', 'Shared', 'Keeping', 'Apart', 'Means',
        'Infrastructure', 'Add', 'Whatever', 'Helps', 'Cheat', 'Sheet',
        # 对话元数据噪音
        'Gateway', 'Sender', 'Metadata', 'Untrusted',
        'Label', 'Username', 'Json', 'Gmt', 'Cst', 'Utc',
        # 通用技术噪音
        'File', 'Line', 'Error', 'Debug', 'Info', 'Warning',
        'Check', 'Done', 'Run', 'Test', 'Phase', 'Commit',
        'Replace', 'Syntax', 'Index', 'Builder',
        # 文件路径片段
        'Users', 'Library', 'Application', 'Support',
        # 时间/日期噪音
        'April', 'March', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday',
        'January', 'February', 'June', 'July', 'August', 'September', 'October',
        'November', 'December',
    }
    filtered = [(w, c) for w, c in Counter(en_words).most_common(30) if w not in stop_words]

    if filtered:
        print("   高频技术词 (CamelCase):")
        for word, count in filtered[:15]:
            print(f"     {word}: {count}")
    else:
        print("   无显著高频词")

    # 中文技术词（2-6 字，排除停用词）
    cn_words = re.findall(r'[\u4e00-\u9fff]{2,6}', all_text)
    cn_stopwords = {
        '的是', '一个', '这个', '那个', '什么', '怎么', '如何', '可以', '所以',
        '因为', '如果', '但是', '而且', '现在', '已经', '没有', '我们', '你们',
        '他们', '自己', '这些', '那些', '可能', '也许', '大概', '应该', '需要',
        '能够', '就是', '还有', '还是', '或者', '并且', '虽然', '尽管', '因此',
        '然后', '接着', '继续', '开始', '结束', '完成', '进行', '正在', '曾经',
        '过去', '将来', '未来', '当前', '目前', '最近', '之前', '之后',
        # 对话噪音
        '用户', '问题', '回复', '测试', '确认',
        # 技术对话通用词（非特定技术栈）
        '代码', '文件', '运行', '命令', '输出', '结果', '错误', '问题',
        '配置', '安装', '使用', '修改', '删除', '添加', '检查', '完成',
        '继续', '好的', '收到', '明白', '知道',
    }
    cn_filtered = [(w, c) for w, c in Counter(cn_words).most_common(30)
                   if w not in cn_stopwords and len(w) >= 2]

    if cn_filtered:
        print("   高频中文词:")
        for word, count in cn_filtered[:10]:
            print(f"     {word}: {count}")

    # ═══════════════════════════════════════════════
    # 2. 多类型记忆提取（hermes-agent 架构）
    # ═══════════════════════════════════════════════
    print("\n🎯 记忆提取（多类型 + 句式感知）...")

    @dataclass
    class MemoryEntry:
        content: str
        memory_type: str
        importance: float  # 0.3 ~ 0.9

    def is_noise(value: str) -> bool:
        """统一噪声过滤器 — 拒绝截断/元数据/格式标签/纯中文长句"""
        v = value.strip()
        if len(v) < 2:
            return True
        # 截断检测：以常见单字开头且长度<5
        if len(v) < 5 and v[0] in ('户', '的', '了', '是', '在', '有', '于', '自', '对', '与', '或'):
            return True
        # 元数据噪音前缀
        noise_prefix = (
            '用户自身', '用户问题', '用户发送', 'AI 回复',
            'Gateway', 'Hook', 'Session', 'Sender', 'metadata',
        )
        if any(v.startswith(p) for p in noise_prefix):
            return True
        # 纯中文且过长 → 对话片段，非偏好
        if re.fullmatch(r'[\u4e00-\u9fff\s，。！？、：；]+', v) and len(v) > 12:
            return True
        # 格式标签：[tech_stack] xxx
        if re.match(r'^\[\w+\]', v):
            return True
        # SQL 关键字 / 路径片段
        sql_keywords = ('WHERE', 'SELECT', 'FROM', 'JOIN', 'INSERT', 'UPDATE', 'DELETE')
        if any(v.upper().startswith(kw) for kw in sql_keywords):
            return True
        if v.startswith('/') and 'Users/' in v:
            return True
        return False

    entries: list[MemoryEntry] = []
    seen = set()

    # ── 2a. 用户偏好（preference）— 句式感知 ──
    # 借鉴 hermes-agent：匹配完整句式而非孤立词
    preference_patterns = [
        # 中文偏好句式
        (r'(?:我喜欢|我偏好|我倾向于|我喜欢用|我习惯)\s*(.+?)(?:。|！|\.|,|，|;|；|$)', 'preference', 0.8),
        (r'(?:偏好|倾向于|习惯)\s*[：:]\s*(.+?)(?:。|！|\.|,|，|;|；|$)', 'preference', 0.7),
        # 英文偏好句式（hermes-agent 风格）
        (r'(?:I prefer|I like|I usually)\s+(?:to\s+)?(?:use\s+)?(.{5,80}?)(?:\.|,|for|when|instead|rather|$)', 'preference', 0.8),
        (r'(?:my|the)\s+(?:preferred|favorite)\s+(?:way|method|tool|approach)\s+(?:is|are)\s+(.{5,80}?)(?:\.|,|$)', 'preference', 0.7),
        # 负面偏好
        (r'(?:我不喜欢|我讨厌|避免|don\'t like|hate|avoid)\s+(.{5,80}?)(?:。|！|\.|,|，|$)', 'dislike', 0.6),
    ]

    for pattern, mem_type, importance in preference_patterns:
        for match in re.finditer(pattern, all_text, re.IGNORECASE | re.UNICODE):
            val = match.group(1).strip()[:100]
            if is_noise(val):
                continue
            key = f"{mem_type}|{val.lower()}"
            if key in seen:
                continue
            seen.add(key)
            entries.append(MemoryEntry(val, mem_type, importance))

    # ── 2b. 技术栈（tech_stack）— 上下文感知 ──
    # 不再匹配孤立大写词，改为匹配技术上下文
    tech_stack_patterns = [
        # 中文技术栈句式
        (r'(?:用|使用|基于|采用|技术栈是)\s*(.+?)(?:开发|编写|构建|搭建|实现|做的|来完成)(.+?)(?:。|！|\.|,|，|$)', 'tech_stack', 0.9),
        (r'(?:用|使用)\s*([A-Z][A-Za-z0-9+#./]{2,})\s*(?:开发|写|做|实现)', 'tech_stack', 0.8),
        # 英文技术栈句式
        (r'(?:built with|using|tech stack|based on)\s+(.{5,80}?)(?:\.|,|$)', 'tech_stack', 0.8),
        (r'(?:use|prefer)\s+(Python|TypeScript|JavaScript|Rust|Go|Java|Swift|Kotlin|React|Vue|FastAPI|Django|Flask|SQLite|PostgreSQL|MySQL|MongoDB|Redis|Docker|Kubernetes|AWS|GCP|Azure)\b', 'tech_stack', 0.7),
    ]

    for pattern, mem_type, importance in tech_stack_patterns:
        for match in re.finditer(pattern, all_text, re.IGNORECASE | re.UNICODE):
            val = match.group(1).strip()[:100]
            if is_noise(val):
                continue
            # 技术栈额外验证：必须包含已知技术词或合理长度
            known_tech = {
                'Python', 'TypeScript', 'JavaScript', 'Rust', 'Go', 'Java',
                'Swift', 'Kotlin', 'React', 'Vue', 'Angular', 'FastAPI',
                'Django', 'Flask', 'SQLite', 'PostgreSQL', 'MySQL', 'MongoDB',
                'Redis', 'Docker', 'Kubernetes', 'AWS', 'GCP', 'Azure',
                'Node.js', 'Node', 'Claude', 'OpenAI', 'Ollama', 'OpenClaw',
                'GitHub', 'Git', 'VSCode', 'Cursor', 'Pytest', 'pytest',
            }
            has_tech = any(t in val for t in known_tech) or len(val) >= 4
            if not has_tech:
                continue
            key = f"{mem_type}|{val.lower()}"
            if key in seen:
                continue
            seen.add(key)
            entries.append(MemoryEntry(val, mem_type, importance))

    # ── 2c. 工作流模式（workflow）— 新增类型 ──
    workflow_patterns = [
        (r'(?:每天|每周|每月|通常|总是|经常|一般|习惯)(.+?)(?:。|！|\.|,|，|$)', 'workflow', 0.5),
        (r'(?:usually|always|often|every day|every week|typically)(.{10,100}?)(?:\.|,|$)', 'workflow', 0.5),
    ]

    for pattern, mem_type, importance in workflow_patterns:
        for match in re.finditer(pattern, all_text, re.IGNORECASE | re.UNICODE):
            val = match.group(1).strip()[:100]
            if is_noise(val):
                continue
            key = f"{mem_type}|{val.lower()}"
            if key in seen:
                continue
            seen.add(key)
            entries.append(MemoryEntry(val, mem_type, importance))

    # ── 2d. 重要事实（fact）— 新增类型 ──
    # hermes-agent 风格：只匹配明确的事实声明
    fact_patterns = [
        # 时区/位置/部署
        (r'(?:时区是|timezone\s+is|位于|部署在|deployed\s+to)\s*([\w\-/\s，,]+?)(?:。|！|\.|,|，|;|；|$)', 'fact', 0.7),
        # 明确声明："我的 X 是 Y" / "X 的地址/端口是 Y"
        (r'(?:我的|系统|服务|数据库)\s*(?:地址|端口|路径|配置|密码|账号|用户名)\s*[是:=]\s*([\w\-/.@:\s]+?)(?:。|！|\.|,|，|;|；|$)', 'fact', 0.8),
        # 技术事实："X 运行在 Y 上"
        (r'(?:运行在|跑在|监听|listening\s+on)\s*(.+?)(?:。|！|\.|,|，|$)', 'fact', 0.7),
    ]

    for pattern, mem_type, importance in fact_patterns:
        for match in re.finditer(pattern, all_text, re.IGNORECASE | re.UNICODE):
            val = match.group(1).strip()[:100]
            if is_noise(val):
                continue
            # 额外验证：太短（<3字）或太长（>60字）都不是好事实
            if len(val) < 3 or len(val) > 60:
                continue
            # 排除 markdown 表格行/管道符
            if '|' in val and val.count('|') > 2:
                continue
            # 排除纯数字/符号
            if re.fullmatch(r'[\s\-/.:;，。；\d]+', val):
                continue
            key = f"{mem_type}|{val.lower()}"
            if key in seen:
                continue
            seen.add(key)
            entries.append(MemoryEntry(val, mem_type, importance))

    # 按重要性排序
    entries.sort(key=lambda e: e.importance, reverse=True)

    # 分类打印
    type_counts = Counter(e.memory_type for e in entries)
    type_emoji = {
        'preference': '🎯', 'dislike': '🚫', 'tech_stack': '💻',
        'workflow': '🔄', 'fact': '📌', 'todo': '☐',
    }

    if entries:
        print(f"   发现 {len(entries)} 条记忆:")
        for e in entries:
            emoji = type_emoji.get(e.memory_type, '📝')
            imp = '⭐' * max(1, int(e.importance * 3))
            print(f"     {emoji} [{e.memory_type}] {imp} {e.content}")

        # 写入 knowledge.db
        import uuid
        kg_path = data_dir / 'knowledge.db'
        if kg_path.exists():
            kg_conn = sqlite3.connect(str(kg_path))
            try:
                # DB 级去重
                existing = set()
                for row in kg_conn.execute('SELECT category, value FROM preferences').fetchall():
                    existing.add(f"{row[0]}|{row[1].lower()}")

                inserted = 0
                skipped = 0
                for e in entries:
                    key = f"{e.memory_type}|{e.content.lower()}"
                    if key in existing:
                        skipped += 1
                        continue
                    pid = f"pref_{uuid.uuid4().hex[:12]}"
                    kg_conn.execute(
                        '''INSERT OR REPLACE INTO preferences (id, category, value, confidence, source, updated_at)
                           VALUES (?, ?, ?, ?, 'active_learning', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))''',
                        (pid, e.memory_type, e.content, e.importance)
                    )
                    existing.add(key)
                    inserted += 1
                kg_conn.commit()
            finally:
                kg_conn.close()
            print(f"   ✅ {inserted} 条新记忆已写入 knowledge.db（跳过 {skipped} 条重复）")
        else:
            print(f"   ⚠️ knowledge.db 不存在，记忆未保存")
    else:
        print("   未发现新记忆")

    # ═══════════════════════════════════════════════
    # 3. 待办识别（收紧 — 只匹配明确待办）
    # ═══════════════════════════════════════════════
    print("\n📋 待办事项...")
    todo_patterns = [
        # TODO: 标准格式
        (r'(?:TODO|待办|待处理)[：:]\s*(.+?)(?:。|！|\.|,|，|$)', 0.8),
        # 明确的未来动作（需要+动词短语，至少8字）
        (r'(?:需要|应该|别忘了|don.t forget)\s*(?:去|做|把|给)?\s*([\u4e00-\u9fffA-Za-z].{7,60}?)(?:。|！|\.|,|，|$)', 0.6),
    ]
    todos = []
    todo_seen = set()
    for pattern, importance in todo_patterns:
        for match in re.finditer(pattern, all_text, re.IGNORECASE):
            val = match.group(1).strip()[:100]
            if is_noise(val):
                continue
            # 排除：已完成/已过去
            if any(v in val for v in ('已经', '已完成', '已修复', '已删除', '已解决', '早就', '早就')):
                continue
            # 排除：markdown 表格行
            if val.count('|') > 2:
                continue
            # 排除：问句
            if val.endswith('？') or val.endswith('?'):
                continue
            # 排除：包含反引号的代码片段（通常是引用，不是待办）
            if val.count('`') >= 2 and len(val) < 30:
                continue
            # 排除：未闭合的反引号（截断）
            if val.count('`') % 2 != 0:
                continue
            # 排除：陈述句
            if any(v in val for v in ('了', '不包含', '没有', '重/', '而是')):
                continue
            # 排除：太短（<6字）或纯名词短语（需要动作动词）
            if len(val) < 6:
                continue
            # 排除：条件描述（非动作）
            if re.match(r'^[A-Z\u4e00-\u9fff]+\s*(?:记录|数据|条目|文件)', val) and '运行' not in val and '设置' not in val:
                continue
            # 确保是动作导向（包含动词或 TODO 前缀）
            action_words = ('运行', '设置', '修复', '添加', '删除', '检查', '更新', '清理', '优化', '部署', '配置', '测试', 'run', 'set', 'fix', 'add', 'delete', 'check', 'update', 'clean', 'optimize', 'deploy', 'configure', 'test', '等')
            if not any(v in val.lower() for v in action_words) and 'TODO' not in val.upper() and '待办' not in val:
                continue
            key = f"todo|{val.lower()}"
            if key in todo_seen:
                continue
            todo_seen.add(key)
            todos.append(MemoryEntry(val, 'todo', importance))

    if todos:
        print(f"   发现 {len(todos)} 条待办:")
        for t in todos:
            imp = '⭐' * max(1, int(t.importance * 3))
            print(f"     ☐ [{t.importance:.1f}] {imp} {t.content}")
    else:
        print("   无新待办")

    # ═══════════════════════════════════════════════
    # 4. 汇总
    # ═══════════════════════════════════════════════
    all_items = entries + todos
    print(f"\n✅ 主动学习完成 — {len(all_entries)} 条记录 / {len(all_items)} 条记忆 ({len(filtered)} 高频词)")
    print(f"   📊 类型分布: {dict(type_counts)}")
    if todos:
        type_counts['todo'] = len(todos)
        print(f"   📊 更新分布: {dict(type_counts)}")

if __name__ == "__main__":
    main()
