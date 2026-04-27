#!/usr/bin/env python3
# ═══════════════════════════════════════════════════
# 🔬 Evo-Cortex 知识图谱自动更新（memory.db → knowledge.db）
# ═══════════════════════════════════════════════════
"""
功能：从 memory.db 提取实体和关系，写入 knowledge.db
用法：python3 kg_auto_update.py <agent-id>

v3: 激进垃圾过滤 + 关系共现阈值 + UUID 防冲突
"""

import sys
import re
import uuid
import sqlite3
from pathlib import Path
from datetime import datetime, timedelta
from collections import Counter

ENTITY_TYPE_RULES = [
    (r'(?:React|Vue|Angular|Svelte|Next\.js|Nuxt|Node\.js|Python|TypeScript|JavaScript|Go|Rust|Java|Swift|Kotlin)', '框架/语言'),
    (r'(?:SQLite|PostgreSQL|MySQL|MongoDB|Redis|WAL|FTS5)', '数据库'),
    (r'(?:Docker|Kubernetes|AWS|GCP|Azure)', '基础设施'),
    (r'(?:OpenClaw|Linux|macOS|Windows|Android|iOS)', '系统/平台'),
    (r'(?:IndexBuilder|MemorySystem|KnowledgeSystem|EmbeddingProvider|SessionScanner|MemoryHub)', '组件'),
    (r'(?:cron|hook|heartbeat|webhook|API|CLI|TUI|PTY)', '技术概念'),
    (r'(?:schema|rowid|BLOB|WAL|ESM|CJS|import|require)', '技术概念'),
]

TECH_PATTERNS = [
    r'\b[A-Z]{2,}\b',
    r'\b[A-Z][a-z]+[A-Z][a-z]+\b',
    r'[""「『《]([^""」』》]{2,15})[""」』》]',
]

ENTITY_NOISE = {
    'UUID', 'uuid', '会话', '对话', '轨迹', '的对话',
    'trajectory', 'checkpoint', 'Context', 'Sender',
    'JSON', 'TEXT', 'NULL', 'TRUE', 'FALSE',
    'PRIMARY', 'FOREIGN', 'TABLE', 'INDEX',
    'Bootstrap', 'AGENTS', 'SOUL', 'TOOLS', 'MEMORY', 'IDENTITY',
    'OK', 'ID', 'DB', 'text', 'type', 'content', 'label', 'name',
    'username', 'metadata', 'GMT', 'Mon', 'Tue', 'Wed',
    'Thu', 'Fri', 'Sat', 'Sun', 'Assistant', 'Message',
    'Agent', 'Session', 'Plugin',
}

ENTITY_NOISE_CN = {
    '的是', '一个', '这个', '那个', '什么', '怎么', '如何', '可以', '所以', '因为',
    '如果', '但是', '而且', '现在', '已经', '没有', '我们', '你们', '他们', '自己',
    '这些', '那些', '可能', '也许', '大概', '应该', '需要', '能够', '就是', '还有',
    '还是', '或者', '并且', '虽然', '尽管', '因此', '然后', '接着', '继续', '开始',
    '结束', '完成', '进行', '正在', '曾经', '过去', '将来', '未来', '当前', '目前',
    '最近', '之前', '之后', '以上', '以下', '其中', '之间', '之内', '之外', '上面',
    '下面', '前面', '后面', '中间', '中心', '核心', '关键', '重要', '主要', '次要',
    '基本', '标准', '默认', '普通', '一般', '特殊', '常见', '通常', '经常', '偶尔',
    '总是', '从不', '很少', '常常', '往往', '大体', '大致', '大概', '大约', '差不多',
    '几乎', '将近', '接近', '达到', '超过', '低于', '高于', '大于', '小于', '等于',
    '相同', '相似', '类似', '不同', '区别', '差异', '差别', '变化', '改变', '修改',
    '调整', '优化', '改进', '提升', '增强', '提高', '增加', '减少', '降低', '删除',
    '移除', '清除', '清理', '整理', '组织', '管理', '维护', '保持', '保存', '存储',
    '记录', '日志', '文件', '目录', '路径', '位置', '地址', '端口', '协议', '格式',
    '类型', '种类', '类别', '分类', '分组', '标签', '标记', '标识', '名称', '名字',
    '标题', '内容', '正文', '文本', '字符', '字符串', '数字', '整数', '小数', '浮点',
    '布尔', '逻辑', '条件', '判断', '比较', '检查', '验证', '确认', '确定', '决定',
    '选择', '选取', '挑选', '过滤', '筛选', '排序', '排列', '顺序', '次序', '先后',
}


def get_entity_type(name: str) -> str:
    for pattern, entity_type in ENTITY_TYPE_RULES:
        if re.search(pattern, name, re.IGNORECASE):
            return entity_type
    return '概念'


def is_clean_content(content: str) -> bool:
    """激进过滤：所有 session_scanner 导入的数据 + 旧报告"""
    if not content or not content.strip():
        return False
    junk_prefixes = [
        '[user]: [{', '[assistant]: [{',
        '[user]: [', '[assistant]: [',
        '[user]: Sender', '[user]: {',
        'Sender (untrusted metadata):',
        '[Bootstrap pending]',
        '⚠️ Context limit exceeded',
        '```json',
        '# 👤 用户偏好设置',
        '# 记忆数据分析报告',
        '# 周统计报告', '# 周度摘要',
        '# 2026-04-',
        'User: ',  # 单条对话记录
    ]
    for prefix in junk_prefixes:
        if content.startswith(prefix):
            return False
    return True


def extract_entities(text: str) -> list[str]:
    """提取候选实体（严格噪音过滤）"""
    entities = set()
    for pattern in TECH_PATTERNS:
        for m in re.findall(pattern, text):
            if isinstance(m, str) and len(m) >= 3 and m not in ENTITY_NOISE:
                entities.add(m)
    for w in re.findall(r'\b[A-Z][a-zA-Z]{3,}\b', text):
        if w not in ENTITY_NOISE:
            entities.add(w)
    for w in re.findall(r'[\u4e00-\u9fff]{2,4}', text):
        if w not in ENTITY_NOISE_CN:
            entities.add(w)
    return list(entities)


def main():
    agent_id = sys.argv[1] if len(sys.argv) > 1 else "cortex-test-agent"
    workspace = Path.home() / '.openclaw' / f'workspace-{agent_id}'
    data_dir = workspace / 'data' / agent_id
    memory_db = data_dir / 'memory.db'
    knowledge_db = data_dir / 'knowledge.db'

    print(f"🔬 知识图谱自动更新 v3 - Agent: {agent_id}")
    print(f"📊 数据源: {memory_db}")
    print(f"📊 目标库: {knowledge_db}")
    print("=" * 50)

    if not memory_db.exists():
        print(f"❌ memory.db 不存在")
        return

    knowledge_db.parent.mkdir(parents=True, exist_ok=True)

    # 读取并过滤
    conn = sqlite3.connect(memory_db)
    conn.row_factory = sqlite3.Row
    week_ago = (datetime.now() - timedelta(days=7)).strftime('%Y-%m-%d')

    ltm_all = conn.execute(
        'SELECT id, type, title, content, importance, created_at FROM long_term_memory WHERE created_at >= ? ORDER BY importance DESC',
        (week_ago,)).fetchall()
    conn.close()

    # 仅使用 LTM（WM 全是 session_scanner 垃圾）
    all_entries = ltm_all

    print(f"📝 读取: {len(ltm_all)} LTM（跳过 WM — 旧 session_scanner 数据）")
    print(f"   ✅ 有效: {len(all_entries)} 条")

    if not all_entries:
        print("⚠️  没有 LTM 数据（旧 session_scanner 数据已跳过）")
        print("   提示：运行 daily_compress.py 将 WM 晋升到 LTM，或等新 hook 写入数据")
        # 仍然创建空库（确保 schema 存在）
        kconn = sqlite3.connect(knowledge_db)
        kconn.execute('CREATE TABLE IF NOT EXISTS entities (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, type TEXT DEFAULT \'concept\', importance REAL DEFAULT 0.5, last_mentioned TEXT, created_at TEXT, updated_at TEXT)')
        kconn.execute('CREATE TABLE IF NOT EXISTS relations (id TEXT PRIMARY KEY, source_id TEXT, target_id TEXT, type TEXT DEFAULT \'related\', strength REAL DEFAULT 0.5, discovered_at TEXT)')
        kconn.execute('CREATE TABLE IF NOT EXISTS rules (id TEXT PRIMARY KEY, type TEXT, title TEXT, condition TEXT, action TEXT, confidence REAL DEFAULT 0.5, support_count INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT)')
        kconn.commit()
        kconn.close()
        print("   ✅ 空库已创建（schema 就绪）")
        return

    # 提取实体
    print("\n🔍 提取实体...")
    all_candidates: Counter = Counter()
    all_texts = []
    for row in all_entries:
        text = f"{row['title'] or ''} {row['content'] or ''}"
        all_texts.append(text)
        all_candidates.update(extract_entities(text))

    print(f"   候选: {len(all_candidates)} 个")
    if all_candidates:
        print("   Top 10:")
        for w, c in all_candidates.most_common(10):
            print(f"     {w}: {c}")

    # 写入 knowledge.db
    print("\n📦 写入 knowledge.db...")
    kconn = sqlite3.connect(knowledge_db)

    kconn.execute('''CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL DEFAULT 'concept', description TEXT DEFAULT '',
        aliases TEXT DEFAULT '[]', properties TEXT DEFAULT '{}',
        importance REAL DEFAULT 0.5, freshness REAL DEFAULT 1.0,
        last_mentioned TEXT DEFAULT (datetime('now')),
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')))''')

    # 迁移
    cols = [r[1] for r in kconn.execute('PRAGMA table_info(entities)').fetchall()]
    for col, ctype in [('description','TEXT'),('aliases','TEXT'),('properties','TEXT'),
                        ('importance','REAL'),('freshness','REAL'),
                        ('last_mentioned','TEXT'),('updated_at','TEXT')]:
        if col not in cols:
            kconn.execute(f'ALTER TABLE entities ADD COLUMN {col} {ctype}')
            if col in ('importance','freshness'): kconn.execute(f'UPDATE entities SET {col}=0.5 WHERE {col} IS NULL')
            elif col in ('last_mentioned','updated_at'): kconn.execute(f'UPDATE entities SET {col}=datetime(\'now\') WHERE {col} IS NULL')
            elif col in ('aliases','properties'): kconn.execute(f'UPDATE entities SET {col}=\'[]\' WHERE {col} IS NULL')
            else: kconn.execute(f'UPDATE entities SET {col}=\'\' WHERE {col} IS NULL')
            print(f"   🔧 迁移: entities.{col}")

    kconn.execute('''CREATE TABLE IF NOT EXISTS relations (
        id TEXT PRIMARY KEY, source_id TEXT NOT NULL, target_id TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'related', strength REAL DEFAULT 0.5,
        evidence TEXT DEFAULT '[]', discovered_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (source_id) REFERENCES entities(id),
        FOREIGN KEY (target_id) REFERENCES entities(id))''')

    rcols = [r[1] for r in kconn.execute('PRAGMA table_info(relations)').fetchall()]
    for col, ctype in [('type','TEXT'),('strength','REAL'),('evidence','TEXT'),('discovered_at','TEXT')]:
        if col not in rcols:
            kconn.execute(f'ALTER TABLE relations ADD COLUMN {col} {ctype}')
            if col == 'strength': kconn.execute(f'UPDATE relations SET {col}=0.5 WHERE {col} IS NULL')
            elif col == 'discovered_at': kconn.execute(f'UPDATE relations SET {col}=datetime(\'now\') WHERE {col} IS NULL')
            elif col == 'evidence': kconn.execute(f'UPDATE relations SET {col}=\'[]\' WHERE {col} IS NULL')
            else: kconn.execute(f'UPDATE relations SET {col}=\'related\' WHERE {col} IS NULL')

    existing = {name: eid for eid, name in kconn.execute('SELECT id, name FROM entities').fetchall()}
    existing_names = set(existing.keys())
    print(f"   现有实体: {len(existing_names)} 个")

    added = updated = 0
    entity_map = dict(existing)
    for word, count in all_candidates.most_common():
        if count < 2:
            continue
        if word not in existing_names:
            eid = f"ent_{uuid.uuid4().hex[:8]}"
            kconn.execute('INSERT INTO entities (id,name,type,importance,last_mentioned,updated_at) VALUES (?,?,?,?,datetime(\'now\'),datetime(\'now\'))',
                (eid, word, get_entity_type(word), min(1.0, count * 0.2)))
            entity_map[word] = eid
            existing_names.add(word)
            added += 1
        else:
            kconn.execute('UPDATE entities SET last_mentioned=datetime(\'now\'), importance=MIN(1.0,importance+0.1), updated_at=datetime(\'now\') WHERE id=?',
                (entity_map[word],))
            updated += 1
    print(f"   新增: {added}, 更新: {updated}")

    # 关系：共现计数 + 阈值过滤
    print("\n🔗 构建关系（共现 ≥ 2 次，最多 50 条）...")
    cooccur: Counter = Counter()
    name_to_id = entity_map
    for text in all_texts:
        ents = [e for e in name_to_id if e.lower() in text.lower()]
        for i, e1 in enumerate(ents):
            for e2 in ents[i+1:]:
                cooccur[tuple(sorted([name_to_id[e1], name_to_id[e2]]))] += 1

    strong = [(p, c) for p, c in cooccur.most_common() if c >= 2][:50]
    rel_added = 0
    for (src, tgt), count in strong:
        if kconn.execute('SELECT id FROM relations WHERE (source_id=? AND target_id=?) OR (source_id=? AND target_id=?)',
            (src, tgt, tgt, src)).fetchone():
            continue
        kconn.execute('INSERT INTO relations (id,source_id,target_id,type,strength,discovered_at) VALUES (?,?,?,?,?,datetime(\'now\'))',
            (f"rel_{uuid.uuid4().hex}", src, tgt, 'related', min(1.0, count * 0.3)))
        rel_added += 1
    print(f"   候选: {len(cooccur)}, 过阈: {len(strong)}, 新增: {rel_added}")

    kconn.commit()
    te = kconn.execute('SELECT COUNT(*) FROM entities').fetchone()[0]
    tr = kconn.execute('SELECT COUNT(*) FROM relations').fetchone()[0]
    kconn.close()
    print(f"\n✅ 完成 — 实体: {te}, 关系: {tr}")


if __name__ == "__main__":
    main()
