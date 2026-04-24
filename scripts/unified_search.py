#!/usr/bin/env python3
"""
统一搜索接口 - 跨数据源的统一搜索

功能:
- 同时搜索 session_memories + preferences + knowledge_graph
- 混合搜索（关键词 + 重要性排序）
- 结果去重和排序
- 分页支持

使用示例:
    python3 unified_search.py <agent-id> "搜索关键词" [--limit 10] [--type memories|preferences|all]
"""

import sys
import json
import sqlite3
from pathlib import Path
from datetime import datetime


class Config:
    """配置类"""
    def __init__(self, agent_id: str):
        self.agent_id = agent_id
        self.workspace = Path.home() / '.openclaw' / f'workspace-{agent_id}'
        self.data_dir = self.workspace / 'data' / agent_id
        self.db_path = self.data_dir / 'cortex.db'
        self.knowledge_dir = self.workspace / 'knowledge' / agent_id
        
        # 确保目录存在
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.knowledge_dir.mkdir(parents=True, exist_ok=True)


class UnifiedSearcher:
    """统一搜索器"""
    
    def __init__(self, config: Config):
        self.config = config
    
    def search(self, query: str, limit: int = 10, search_type: str = 'all') -> dict:
        """执行统一搜索
        
        Args:
            query: 搜索查询
            limit: 返回结果数量
            search_type: 搜索类型 (memories|preferences|knowledge|all)
            
        Returns:
            搜索结果字典
        """
        results = {
            'query': query,
            'timestamp': datetime.now().isoformat(),
            'total_results': 0,
            'results': []
        }
        
        if search_type in ['memories', 'all']:
            memories = self._search_memories(query, limit // 2)
            results['results'].extend(memories)
        
        if search_type in ['preferences', 'all']:
            prefs = self._search_preferences(query, limit // 4)
            results['results'].extend(prefs)
        
        if search_type in ['knowledge', 'all']:
            knowledge = self._search_knowledge(query, limit // 4)
            results['results'].extend(knowledge)
        
        # 按相关性排序
        results['results'].sort(key=lambda x: x.get('relevance', 0), reverse=True)
        results['results'] = results['results'][:limit]
        results['total_results'] = len(results['results'])
        
        return results
    
    def _search_memories(self, query: str, limit: int) -> list:
        """搜索会话记忆"""
        results = []
        
        try:
            conn = sqlite3.connect(str(self.config.db_path))
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            
            # FTS5 全文搜索
            cursor.execute("""
                SELECT sm.*, 
                       CASE 
                           WHEN sm.content LIKE ? THEN 3
                           WHEN sm.content LIKE ? THEN 2
                           ELSE 1
                       END as relevance
                FROM session_memories sm
                WHERE sm.content LIKE ?
                ORDER BY sm.importance DESC, sm.created_at DESC
                LIMIT ?
            """, (f'%{query}%', f'%{query.lower()}%', f'%{query}%', limit))
            
            for row in cursor.fetchall():
                results.append({
                    'type': 'memory',
                    'source': 'session_memories',
                    'id': row['id'],
                    'session_id': row['session_id'][:8] + '...',
                    'content': row['content'][:200] + '...' if len(row['content']) > 200 else row['content'],
                    'importance': row['importance'],
                    'tags': row['tags'],
                    'created_at': row['created_at'],
                    'relevance': row['relevance']
                })
            
            conn.close()
            
        except Exception as e:
            print(f"⚠️  搜索记忆失败：{e}", file=sys.stderr)
        
        return results
    
    def _search_preferences(self, query: str, limit: int) -> list:
        """搜索用户偏好"""
        results = []
        
        try:
            conn = sqlite3.connect(str(self.config.db_path))
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            
            # 简化查询（不关联 category 表）
            cursor.execute("""
                SELECT *,
                       CASE 
                           WHEN text LIKE ? THEN 3
                           WHEN text LIKE ? THEN 2
                           ELSE 1
                       END as relevance
                FROM preferences
                WHERE text LIKE ?
                ORDER BY confidence DESC, created_at DESC
                LIMIT ?
            """, (f'%{query}%', f'%{query.lower()}%', f'%{query}%', limit))
            
            for row in cursor.fetchall():
                results.append({
                    'type': 'preference',
                    'source': 'preferences',
                    'id': row['id'],
                    'text': row['text'],
                    'category': row['category'] if 'category' in row.keys() else 'N/A',
                    'confidence': row['confidence'],
                    'status': row['status'],
                    'created_at': row['created_at'],
                    'relevance': row['relevance']
                })
            
            conn.close()
            
        except Exception as e:
            print(f"⚠️  搜索偏好失败：{e}", file=sys.stderr)
        
        return results
    
    def _search_knowledge(self, query: str, limit: int) -> list:
        """搜索知识图谱"""
        results = []
        
        try:
            entities_file = self.config.knowledge_dir / 'entities.json'
            
            if not entities_file.exists():
                return results
            
            with open(entities_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            # 处理不同的 JSON 格式
            if isinstance(data, dict):
                entities = data.get('entities', [])
            elif isinstance(data, list):
                entities = data
            else:
                return results
            
            # 简单关键词匹配
            query_lower = query.lower()
            matched = []
            
            for entity in entities:
                if not isinstance(entity, dict):
                    continue
                    
                name = entity.get('name', '').lower()
                desc = entity.get('description', '').lower()
                
                relevance = 0
                if query_lower in name:
                    relevance = 3
                elif query_lower in desc:
                    relevance = 2
                elif any(q in name or q in desc for q in query_lower.split()):
                    relevance = 1
                
                if relevance > 0:
                    matched.append({
                        'type': 'knowledge',
                        'source': 'knowledge_graph',
                        'id': entity.get('id'),
                        'name': entity.get('name'),
                        'type_category': entity.get('type'),
                        'description': entity.get('description', '')[:200],
                        'properties': entity.get('properties', {}),
                        'relevance': relevance
                    })
            
            # 按相关性排序并限制数量
            matched.sort(key=lambda x: x['relevance'], reverse=True)
            results = matched[:limit]
            
        except Exception as e:
            print(f"⚠️  搜索知识图谱失败：{e}", file=sys.stderr)
        
        return results


def format_results(results: dict, verbose: bool = False):
    """格式化输出搜索结果"""
    print("\n" + "="*60)
    print(f"🔍 搜索结果：'{results['query']}'")
    print(f"📊 共找到 {results['total_results']} 条结果")
    print("="*60)
    
    if not results['results']:
        print("\n❌ 未找到匹配的结果")
        return
    
    for i, item in enumerate(results['results'], 1):
        source_icon = {'memory': '💬', 'preference': '⭐', 'knowledge': '📚'}.get(item['type'], '📄')
        relevance_stars = '★' * item.get('relevance', 1)
        
        print(f"\n{i}. {source_icon} [{item['type']}] (相关性：{relevance_stars})")
        print(f"   来源：{item['source']}")
        
        if item['type'] == 'memory':
            print(f"   会话：{item['session_id']}")
            print(f"   重要性：{'★' * int(item['importance'])}")
            print(f"   内容：{item['content']}")
            if item.get('tags'):
                print(f"   标签：{item['tags']}")
        
        elif item['type'] == 'preference':
            print(f"   类别：{item.get('category', 'N/A')}")
            print(f"   置信度：{item['confidence']:.0%}")
            print(f"   状态：{item['status']}")
            print(f"   内容：{item['text']}")
        
        elif item['type'] == 'knowledge':
            print(f"   实体：{item['name']} ({item['type_category']})")
            if item.get('description'):
                print(f"   描述：{item['description']}")
        
        if verbose and item.get('created_at'):
            print(f"   时间：{item['created_at']}")
    
    print("\n" + "="*60)


def main():
    if len(sys.argv) < 3:
        print("用法：python3 unified_search.py <agent-id> <搜索词> [--limit N] [--type TYPE] [--verbose]")
        print()
        print("参数:")
        print("  agent-id     Agent 的唯一标识符")
        print("  搜索词       要搜索的关键词")
        print("  --limit N    返回结果数量 (默认：10)")
        print("  --type TYPE  搜索类型：memories|preferences|knowledge|all (默认：all)")
        print("  --verbose    显示详细信息")
        print()
        print("示例:")
        print("  python3 unified_search.py cortex-test-agent \"TypeScript\"")
        print("  python3 unified_search.py cortex-test-agent \"偏好\" --limit 20")
        print("  python3 unified_search.py cortex-test-agent \"会议\" --type memories")
        sys.exit(1)
    
    agent_id = sys.argv[1]
    query = sys.argv[2]
    
    # 解析可选参数
    limit = 10
    search_type = 'all'
    verbose = False
    
    i = 3
    while i < len(sys.argv):
        if sys.argv[i] == '--limit' and i + 1 < len(sys.argv):
            limit = int(sys.argv[i + 1])
            i += 2
        elif sys.argv[i] == '--type' and i + 1 < len(sys.argv):
            search_type = sys.argv[i + 1]
            i += 2
        elif sys.argv[i] == '--verbose':
            verbose = True
            i += 1
        else:
            i += 1
    
    # 执行搜索
    config = Config(agent_id)
    searcher = UnifiedSearcher(config)
    results = searcher.search(query, limit=limit, search_type=search_type)
    
    # 输出结果
    format_results(results, verbose=verbose)
    
    # 保存结果到文件（可选）
    output_file = Path.home() / '.openclaw' / f'workspace-{agent_id}' / 'data' / f'search-{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
    output_file.parent.mkdir(parents=True, exist_ok=True)
    
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    
    print(f"\n💾 结果已保存到：{output_file}")


if __name__ == '__main__':
    main()
