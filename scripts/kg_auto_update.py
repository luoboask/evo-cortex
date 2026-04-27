#!/usr/bin/env python3
# ═══════════════════════════════════════════════════
# 🔬 Evo-Cortex 知识图谱自动更新（memory.db → knowledge.db）
# ═══════════════════════════════════════════════════
"""
功能：从 memory.db 提取实体和关系，写入 knowledge.db
用法：python3 kg_auto_update.py <agent-id>

变更日志:
    2026-04-27: 数据源从 memory/*.md → memory.db；输出从 JSON → knowledge.db
"""

import sys
import re
import uuid
import sqlite3
from pathlib import Path
from datetime import datetime, timedelta
from collections import Counter

# 实体类型推断规则
ENTITY_TYPE_RULES = [
    (r'(?:React|Vue|Angular|Svelte|Next\.js|Nuxt|Node\.js|Python|TypeScript|JavaScript|Go|Rust|Java|Swift|Kotlin)', '框架/语言'),
    (r'(?:SQLite|PostgreSQL|MySQL|MongoDB|Redis|WAL|FTS5)', '数据库'),
    (r'(?:Docker|Kubernetes|AWS|GCP|Azure)', '基础设施'),
    (r'(?:OpenClaw|Linux|macOS|Windows|Android|iOS)', '系统/平台'),
    (r'(?:IndexBuilder|MemorySystem|KnowledgeSystem|EmbeddingProvider|SessionScanner|MemoryHub)', '组件'),
    (r'(?:cron|hook|heartbeat|webhook|API|CLI|TUI|PTY)', '技术概念'),
    (r'(?:schema|rowid|BLOB|WAL|ESM|CJS|import|require)', '技术概念'),
]

# 扩展实体提取正则（补充技术术语）
TECH_PATTERNS = [
    r'\b[A-Z]{2,}\b',                        # 大写缩写 (FTS5, WAL, ESM)
    r'\b[A-Z][a-z]+[A-Z][a-z]+\b',           # 驼峰式 (IndexBuilder)
    r'[""「『《]([^""」』》]{2,15})[""」』》]', # 引号/书名号中的内容
]

def get_entity_type(name: str) -> str:
    for pattern, entity_type in ENTITY_TYPE_RULES:
        if re.search(pattern, name, re.IGNORECASE):
            return entity_type
    return '概念'

def extract_entities(text: str, min_length: int = 3) -> list[str]:
    """从文本中提取候选实体"""
    entities = set()
    
    # 技术术语模式
    for pattern in TECH_PATTERNS:
        matches = re.findall(pattern, text)
        for m in matches:
            if isinstance(m, str) and len(m) >= min_length:
                entities.add(m)
    
    # 英文技术名词
    en_words = re.findall(r'\b[A-Z][a-zA-Z]{%d,}\b' % (min_length - 1), text)
    entities.update(en_words)
    
    # 中文关键词（2-4 字）
    cn_words = re.findall(r'[\u4e00-\u9fff]{2,6}', text)
    # 过滤掉常见停用词
    stopwords = {'的是', '一个', '这个', '那个', '什么', '怎么', '如何', '可以', '所以', '因为', '如果', '但是', '而且', '现在', '已经', '没有', '我们', '你们', '他们', '自己', '这些', '那些', '可能', '也许', '大概', '应该', '需要', '能够', '就是', '还有', '还是', '或者', '并且', '虽然', '尽管', '因此', '然后', '接着', '继续', '开始', '结束', '完成', '进行', '正在', '曾经', '过去', '将来', '未来', '当前', '目前', '最近', '之前', '之后', '以上', '以下', '其中', '之间', '之内', '之外', '上面', '下面', '前面', '后面', '中间', '中心', '核心', '关键', '重要', '主要', '次要', '基本', '标准', '默认', '普通', '一般', '特殊', '常见', '通常', '经常', '偶尔', '总是', '从不', '很少', '常常', '往往', '大体', '大致', '大概', '大约', '差不多', '几乎', '将近', '接近', '达到', '超过', '低于', '高于', '大于', '小于', '等于', '相同', '相似', '类似', '不同', '区别', '差异', '差别', '变化', '改变', '修改', '调整', '优化', '改进', '提升', '增强', '提高', '增加', '减少', '降低', '删除', '移除', '清除', '清理', '整理', '组织', '管理', '维护', '保持', '保存', '存储', '记录', '日志', '文件', '目录', '路径', '位置', '地址', '端口', '协议', '格式', '类型', '种类', '类别', '分类', '分组', '标签', '标记', '标识', '名称', '名字', '标题', '内容', '正文', '文本', '字符', '字符串', '数字', '整数', '小数', '浮点', '布尔', '逻辑', '条件', '判断', '比较', '检查', '验证', '确认', '确定', '决定', '选择', '选取', '挑选', '过滤', '筛选', '排序', '排列', '顺序', '次序', '先后'}
    filtered = [w for w in cn_words if w not in stopwords and len(w) >= 2]
    entities.update(filtered)
    
    return list(entities)

def build_entity_graph(entities: list[str], text: str) -> list[tuple]:
    """基于共现分析构建实体间关系
    
    同一文本中同时出现的实体被认为有关联
    """
    relations = []
    for i, e1 in enumerate(entities):
        for e2 in entities[i+1:]:
            # 简单共现：两个实体都出现在文本中
            if e1.lower() in text.lower() and e2.lower() in text.lower():
                relations.append((e1, e2, 'related'))
    return relations

def main():
    agent_id = sys.argv[1] if len(sys.argv) > 1 else "cortex-test-agent"
    
    # 路径配置
    workspace = Path.home() / '.openclaw' / f'workspace-{agent_id}'
    data_dir = workspace / 'data' / agent_id
    memory_db = data_dir / 'memory.db'
    knowledge_db = data_dir / 'knowledge.db'
    
    print(f"🔬 知识图谱自动更新 - Agent: {agent_id}")
    print(f"📊 数据源: {memory_db}")
    print(f"📊 目标库: {knowledge_db}")
    print("=" * 50)
    
    # 检查数据源
    if not memory_db.exists():
        print(f"❌ memory.db 不存在: {memory_db}")
        print("   提示：先运行一些对话，让 hook 写入数据")
        return
    
    # 确保 knowledge.db 目录存在
    knowledge_db.parent.mkdir(parents=True, exist_ok=True)
    
    # 读取 memory.db 数据
    conn = sqlite3.connect(memory_db)
    conn.row_factory = sqlite3.Row
    
    # 获取近期数据（最近 7 天）
    week_ago = (datetime.now() - timedelta(days=7)).strftime('%Y-%m-%d')
    
    # 从 long_term_memory 提取（质量更高）
    ltm_rows = conn.execute('''
        SELECT id, type, title, content, importance, created_at
        FROM long_term_memory
        WHERE created_at >= ?
        ORDER BY importance DESC
    ''', (week_ago,)).fetchall()
    
    # 从 working_memory 补充
    wm_rows = conn.execute('''
        SELECT id, type, title, content, importance, created_at
        FROM working_memory
        WHERE created_at >= ?
        ORDER BY importance DESC
        LIMIT 50
    ''', (week_ago,)).fetchall()
    
    conn.close()
    
    all_entries = list(ltm_rows) + list(wm_rows)
    print(f"📝 从 memory.db 读取 {len(all_entries)} 条记录")
    print(f"   LTM: {len(ltm_rows)} 条 | WM: {len(wm_rows)} 条")
    
    if not all_entries:
        print("⚠️  没有近期数据，跳过更新")
        return
    
    # 提取实体
    print("\n🔍 提取实体...")
    all_candidates: Counter = Counter()
    all_texts = []
    
    for row in all_entries:
        text = f"{row['title'] or ''} {row['content'] or ''}"
        all_texts.append(text)
        candidates = extract_entities(text)
        all_candidates.update(candidates)
    
    print(f"   提取到 {len(all_candidates)} 个候选实体")
    
    # 合并全文用于关系分析
    full_text = ' '.join(all_texts)
    
    # 写入 knowledge.db（自动迁移旧 schema）
    print("\n📦 写入 knowledge.db...")
    kconn = sqlite3.connect(knowledge_db)
    
    # 确保表存在 + 自动迁移旧 schema
    kconn.execute('''
        CREATE TABLE IF NOT EXISTS entities (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            type TEXT NOT NULL DEFAULT 'concept',
            description TEXT DEFAULT '',
            aliases TEXT DEFAULT '[]',
            properties TEXT DEFAULT '{}',
            importance REAL DEFAULT 0.5,
            freshness REAL DEFAULT 1.0,
            last_mentioned TEXT DEFAULT (datetime('now')),
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        )
    ''')
    
    # 迁移：旧 schema 缺少新列时自动添加（SQLite 不支持非常量 default）
    columns = [row[1] for row in kconn.execute('PRAGMA table_info(entities)').fetchall()]
    migrations = [
        ('description', "TEXT"),
        ('aliases', "TEXT"),
        ('properties', "TEXT"),
        ('importance', 'REAL'),
        ('freshness', 'REAL'),
        ('last_mentioned', "TEXT"),
        ('updated_at', "TEXT"),
    ]
    for col, col_type in migrations:
        if col not in columns:
            kconn.execute(f'ALTER TABLE entities ADD COLUMN {col} {col_type}')
            # 设置默认值（ADD COLUMN 后再 UPDATE）
            if col in ('importance', 'freshness'):
                kconn.execute(f'UPDATE entities SET {col} = 0.5 WHERE {col} IS NULL')
            elif col in ('last_mentioned', 'updated_at'):
                kconn.execute(f"UPDATE entities SET {col} = datetime('now') WHERE {col} IS NULL")
            elif col in ('aliases', 'properties'):
                kconn.execute(f"UPDATE entities SET {col} = '[]' WHERE {col} IS NULL")
            else:
                kconn.execute(f"UPDATE entities SET {col} = '' WHERE {col} IS NULL")
            print(f"   🔧 迁移: entities 添加 {col} 列")
    
    kconn.execute('''
        CREATE TABLE IF NOT EXISTS relations (
            id TEXT PRIMARY KEY,
            source_id TEXT NOT NULL,
            target_id TEXT NOT NULL,
            type TEXT NOT NULL DEFAULT 'related',
            strength REAL DEFAULT 0.5,
            evidence TEXT DEFAULT '[]',
            discovered_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (source_id) REFERENCES entities(id),
            FOREIGN KEY (target_id) REFERENCES entities(id)
        )
    ''')
    
    # relations 表迁移
    rel_columns = [row[1] for row in kconn.execute('PRAGMA table_info(relations)').fetchall()]
    rel_migrations = [
        ('type', "TEXT"),
        ('strength', 'REAL'),
        ('evidence', "TEXT"),
        ('discovered_at', "TEXT"),
    ]
    for col, col_type in rel_migrations:
        if col not in rel_columns:
            kconn.execute(f'ALTER TABLE relations ADD COLUMN {col} {col_type}')
            if col == 'strength':
                kconn.execute(f'UPDATE relations SET {col} = 0.5 WHERE {col} IS NULL')
            elif col == 'discovered_at':
                kconn.execute(f"UPDATE relations SET {col} = datetime('now') WHERE {col} IS NULL")
            elif col == 'evidence':
                kconn.execute(f"UPDATE relations SET {col} = '[]' WHERE {col} IS NULL")
            else:
                kconn.execute(f"UPDATE relations SET {col} = 'related' WHERE {col} IS NULL")
            print(f"   🔧 迁移: relations 添加 {col} 列")
    
    # 获取现有实体
    existing = dict(kconn.execute('SELECT id, name FROM entities').fetchall())
    existing_names = set(existing.values())
    print(f"   现有实体: {len(existing_names)} 个")
    
    # 添加新实体
    added = 0
    updated = 0
    entity_map = dict(existing)  # name → id
    
    for word, count in all_candidates.most_common():
        if count < 2:  # 至少出现 2 次才收录
            continue
            
        if word not in existing_names:
            entity_id = f"ent_{uuid.uuid4().hex[:8]}"
            entity_type = get_entity_type(word)
            
            kconn.execute('''
                INSERT INTO entities (id, name, type, importance, last_mentioned, updated_at)
                VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
            ''', (entity_id, word, entity_type, min(1.0, count * 0.2)))
            
            entity_map[word] = entity_id
            existing_names.add(word)
            added += 1
        else:
            # 更新已有实体的提及时间和重要性
            entity_id = entity_map[word]
            kconn.execute('''
                UPDATE entities 
                SET last_mentioned = datetime('now'),
                    importance = MIN(1.0, importance + 0.1),
                    updated_at = datetime('now')
                WHERE id = ?
            ''', (entity_id,))
            updated += 1
    
    print(f"   新增实体: {added}")
    print(f"   更新实体: {updated}")
    
    # 构建关系（共现分析）
    print("\n🔗 构建关系...")
    relations_added = 0
    
    # 获取所有实体 ID
    all_entities = dict(kconn.execute('SELECT id, name FROM entities').fetchall())
    name_to_id = {v: k for k, v in all_entities.items()}
    
    # 对每条记录做共现分析
    for text in all_texts:
        text_entities = [e for e in name_to_id.keys() if e.lower() in text.lower()]
        
        for i, e1 in enumerate(text_entities):
            for e2 in text_entities[i+1:]:
                # 检查关系是否已存在
                exists = kconn.execute('''
                    SELECT id FROM relations 
                    WHERE (source_id = ? AND target_id = ?) 
                       OR (source_id = ? AND target_id = ?)
                ''', (name_to_id[e1], name_to_id[e2], name_to_id[e2], name_to_id[e1])).fetchone()
                
                if not exists:
                    rel_id = f"rel_{uuid.uuid4().hex[:8]}"
                    kconn.execute('''
                        INSERT INTO relations (id, source_id, target_id, type, strength, discovered_at)
                        VALUES (?, ?, ?, 'related', 0.3, datetime('now'))
                    ''', (rel_id, name_to_id[e1], name_to_id[e2]))
                    relations_added += 1
    
    print(f"   新增关系: {relations_added}")
    
    kconn.commit()
    
    # 统计
    total_entities = kconn.execute('SELECT COUNT(*) FROM entities').fetchone()[0]
    total_relations = kconn.execute('SELECT COUNT(*) FROM relations').fetchone()[0]
    
    kconn.close()
    
    print(f"\n✅ 知识图谱更新完成")
    print(f"   总实体: {total_entities}")
    print(f"   总关系: {total_relations}")
    print(f"   知识图谱: {knowledge_db}")


if __name__ == "__main__":
    main()
