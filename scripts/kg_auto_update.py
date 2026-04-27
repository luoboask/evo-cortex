#!/usr/bin/env python3
# ═══════════════════════════════════════════════════
# 🔬 Evo-Cortex 知识图谱自动更新（跨平台 Python 版）
# ═══════════════════════════════════════════════════
"""
功能：从记忆文件中自动提取新实体和关系，更新知识图谱
用法：python3 kg_auto_update.py <agent-id>
"""
import sys
import json
import re
from pathlib import Path
from datetime import datetime, timedelta
from collections import Counter

# 实体类型推断规则
ENTITY_TYPE_RULES = [
    (r'(?:React|Vue|Angular|Svelte|Next\.js|Nuxt|Node\.js|Python|TypeScript|JavaScript|Go|Rust|Java|Swift|Kotlin)', '框架/语言'),
    (r'(?:SQLite|PostgreSQL|MySQL|MongoDB|Redis)', '数据库'),
    (r'(?:Docker|Kubernetes|AWS|GCP|Azure)', '基础设施'),
    (r'(?:OpenClaw|Linux|macOS|Windows|Android|iOS)', '系统/平台'),
]

def get_entity_type(name: str) -> str:
    for pattern, entity_type in ENTITY_TYPE_RULES:
        if re.search(pattern, name, re.IGNORECASE):
            return entity_type
    return '概念'

def extract_entities(text: str, min_length: int = 4) -> list[str]:
    """从文本中提取候选实体"""
    # 英文单词（4+ 字母，首字母大写或全大写）
    en_words = re.findall(r'\b[A-Z][a-zA-Z]{%d,}\b|\b[A-Z]{2,}\b' % (min_length - 1), text)
    # 中文专有名词（简单启发：引号/书名号中的内容）
    cn_words = re.findall(r'[""「『《]([^""」』》]{2,10})[""」』》]', text)
    return list(set(en_words + cn_words))

def main():
    agent_id = sys.argv[1] if len(sys.argv) > 1 else "cortex-test-agent"
    home = Path.home()
    workspace = home / f".openclaw/workspace-{agent_id}"
    memory_dir = workspace / "memory" / agent_id
    kg_dir = workspace / "knowledge" / agent_id
    entities_file = kg_dir / "entities.json"

    print(f"🔬 知识图谱自动更新 - Agent: {agent_id}")
    print("=" * 50)

    # 确保目录存在
    kg_dir.mkdir(parents=True, exist_ok=True)

    # 加载现有实体
    if entities_file.exists():
        with open(entities_file, "r", encoding="utf-8") as f:
            try:
                data = json.load(f)
                if isinstance(data, dict):
                    entities = data.get("entities", [])
                    metadata = data.get("metadata", {})
                else:
                    entities = data
                    metadata = {}
            except json.JSONDecodeError:
                entities = []
                metadata = {}
    else:
        entities = []
        metadata = {}

    existing_names = {e["name"] for e in entities if isinstance(e, dict) and "name" in e}
    print(f"📂 现有实体: {len(existing_names)} 个")

    # 扫描记忆文件
    print("\n📝 扫描记忆文件...")
    three_days_ago = (datetime.now() - timedelta(days=3)).strftime("%Y-%m-%d")
    
    files_scanned = 0
    all_candidates: Counter = Counter()

    if memory_dir.exists():
        for f in memory_dir.glob("*.md"):
            if f.stem >= three_days_ago:
                text = f.read_text(encoding="utf-8", errors="ignore")
                candidates = extract_entities(text)
                all_candidates.update(candidates)
                files_scanned += 1

    print(f"   扫描了 {files_scanned} 个文件")
    print(f"   提取了 {len(all_candidates)} 个候选实体")

    # 过滤和添加
    print("\n➕ 添加新实体...")
    added = 0
    for word, count in all_candidates.most_common():
        if word not in existing_names and count >= 3:
            entity_type = get_entity_type(word)
            entity = {
                "id": f"e{len(entities) + 1}",
                "name": word,
                "type": entity_type,
                "properties": {
                    "frequency": count,
                    "source": "auto-extract",
                    "confidence": "high"
                },
                "createdAt": datetime.now().strftime("%Y-%m-%d"),
                "updatedAt": datetime.now().strftime("%Y-%m-%d")
            }
            entities.append(entity)
            existing_names.add(word)
            added += 1
            print(f"  ➕ {word} (类型: {entity_type}, 频次: {count})")

    print(f"\n   新增: {added} 个实体")

    # 保存
    output = {
        "entities": entities,
        "relations": [],
        "metadata": {
            **metadata,
            "lastUpdated": datetime.now().strftime("%Y-%m-%d"),
            "totalEntities": len(entities),
            "totalRelations": 0
        }
    }
    with open(entities_file, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\n✅ 知识图谱更新完成")
    print(f"   文件: {entities_file}")
    print(f"   总实体: {len(entities)}")

if __name__ == "__main__":
    main()
