#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Evo-Cortex 偏好数据库操作库

提供统一的 API 用于：
- 添加偏好
- 查询偏好
- 更新状态
- 全文搜索
- 统计分析

用法：from preferences_db import PreferencesDB
"""

import sqlite3
import json
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Optional, Any

class PreferencesDB:
    """用户偏好数据库操作类"""
    
    def __init__(self, agent_id: str):
        """初始化数据库连接"""
        self.agent_id = agent_id
        self.db_path = self._get_db_path()
        self.conn = self._connect()
    
    def _get_db_path(self) -> Path:
        """获取数据库文件路径（合并后使用 cortex.db）"""
        home = Path.home()
        workspace = home / f".openclaw/workspace-{self.agent_id}"
        return workspace / "data" / "cortex.db"
    
    def _connect(self) -> sqlite3.Connection:
        """建立数据库连接"""
        if not self.db_path.exists():
            raise FileNotFoundError(f"数据库不存在：{self.db_path}")
        
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn
    
    def close(self):
        """关闭连接"""
        self.conn.close()
    
    # ────────────────────────────────────────────────
    # 写入操作
    # ────────────────────────────────────────────────
    
    def add_preference(self, text: str, category: str, confidence: float = 0.7,
                      source: str = "", metadata: Optional[Dict] = None) -> int:
        """添加一条偏好"""
        cursor = self.conn.cursor()
        
        try:
            cursor.execute("""
            INSERT INTO preferences (text, category, confidence, source, metadata)
            VALUES (?, ?, ?, ?, ?)
            """, (text, category, confidence, source, json.dumps(metadata or {}, ensure_ascii=False)))
            
            pref_id = cursor.lastrowid
            
            # 记录变更日志
            cursor.execute("""
            INSERT INTO preference_change_log (preference_id, action, new_value, reason)
            VALUES (?, 'created', ?, '自动提取')
            """, (pref_id, text))
            
            self.conn.commit()
            return pref_id
            
        except sqlite3.IntegrityError:
            # 已存在，返回现有 ID
            cursor.execute("SELECT id FROM preferences WHERE text = ? AND category = ?", (text, category))
            row = cursor.fetchone()
            return row['id'] if row else -1
    
    def update_status(self, pref_id: int, status: str, reason: str = "") -> bool:
        """更新偏好状态"""
        valid_statuses = {'pending', 'confirmed', 'rejected', 'deprecated'}
        if status not in valid_statuses:
            raise ValueError(f"无效状态：{status}，必须是 {valid_statuses}")
        
        cursor = self.conn.cursor()
        
        # 获取旧值
        cursor.execute("SELECT status, text FROM preferences WHERE id = ?", (pref_id,))
        row = cursor.fetchone()
        if not row:
            return False
        
        old_status = row['status']
        text = row['text']
        
        # 更新状态
        cursor.execute("""
        UPDATE preferences 
        SET status = ?, updated_at = CURRENT_TIMESTAMP,
            confirmed_at = CASE WHEN ? = 'confirmed' THEN CURRENT_TIMESTAMP ELSE confirmed_at END
        WHERE id = ?
        """, (status, status, pref_id))
        
        # 记录变更日志
        cursor.execute("""
        INSERT INTO preference_change_log (preference_id, action, old_value, new_value, reason)
        VALUES (?, ?, ?, ?, ?)
        """, (pref_id, f'status_{status}', old_status, status, reason))
        
        self.conn.commit()
        return True
    
    def confirm(self, pref_id: int) -> bool:
        """确认偏好"""
        return self.update_status(pref_id, 'confirmed', '用户确认')
    
    def reject(self, pref_id: int, reason: str = "") -> bool:
        """拒绝偏好"""
        return self.update_status(pref_id, 'rejected', reason)
    
    # ────────────────────────────────────────────────
    # 查询操作
    # ────────────────────────────────────────────────
    
    def get_preferences(self, status: Optional[str] = None, 
                       category: Optional[str] = None,
                       limit: int = 100) -> List[Dict]:
        """查询偏好列表"""
        cursor = self.conn.cursor()
        
        query = "SELECT * FROM preferences WHERE 1=1"
        params = []
        
        if status:
            query += " AND status = ?"
            params.append(status)
        
        if category:
            query += " AND category = ?"
            params.append(category)
        
        query += " ORDER BY confidence DESC, created_at DESC LIMIT ?"
        params.append(limit)
        
        cursor.execute(query, params)
        
        return [dict(row) for row in cursor.fetchall()]
    
    def search(self, query_text: str, limit: int = 20) -> List[Dict]:
        """全文搜索偏好"""
        cursor = self.conn.cursor()
        
        # 使用 FTS5 全文搜索
        cursor.execute("""
        SELECT p.* FROM preferences p
        INNER JOIN preferences_fts fts ON p.id = fts.rowid
        WHERE fts.text MATCH ?
        ORDER BY rank
        LIMIT ?
        """, (query_text, limit))
        
        return [dict(row) for row in cursor.fetchall()]
    
    def get_by_category(self, category: str) -> List[Dict]:
        """按类别获取偏好"""
        return self.get_preferences(category=category)
    
    def get_pending(self) -> List[Dict]:
        """获取所有待确认偏好"""
        return self.get_preferences(status='pending')
    
    def get_confirmed(self) -> List[Dict]:
        """获取所有已确认偏好"""
        return self.get_preferences(status='confirmed')
    
    # ────────────────────────────────────────────────
    # 统计操作
    # ────────────────────────────────────────────────
    
    def get_stats(self) -> Dict[str, Any]:
        """获取统计信息"""
        cursor = self.conn.cursor()
        
        stats = {}
        
        # 总数
        cursor.execute("SELECT COUNT(*) as count FROM preferences")
        stats['total'] = cursor.fetchone()['count']
        
        # 按状态分组
        cursor.execute("SELECT status, COUNT(*) as count FROM preferences GROUP BY status")
        stats['by_status'] = {row['status']: row['count'] for row in cursor.fetchall()}
        
        # 按类别分组
        cursor.execute("SELECT category, COUNT(*) as count FROM preferences GROUP BY category")
        stats['by_category'] = {row['category']: row['count'] for row in cursor.fetchall()}
        
        # 最近 7 天新增
        cursor.execute("""
        SELECT COUNT(*) as count FROM preferences 
        WHERE created_at >= datetime('now', '-7 days')
        """)
        stats['last_7_days'] = cursor.fetchone()['count']
        
        # 平均置信度
        cursor.execute("SELECT AVG(confidence) as avg_conf FROM preferences")
        stats['avg_confidence'] = round(cursor.fetchone()['avg_conf'] or 0, 2)
        
        return stats
    
    def get_user_profile(self) -> Dict[str, Any]:
        """获取简化的用户画像（用于快速加载）"""
        cursor = self.conn.cursor()
        
        profile = {
            'confirmed_preferences': [],
            'top_categories': [],
            'recent_changes': []
        }
        
        # 已确认偏好
        cursor.execute("""
        SELECT text, category, confidence 
        FROM preferences 
        WHERE status = 'confirmed'
        ORDER BY confidence DESC, confirmed_at DESC
        LIMIT 20
        """)
        profile['confirmed_preferences'] = [dict(row) for row in cursor.fetchall()]
        
        # 主要类别
        cursor.execute("""
        SELECT category, COUNT(*) as count
        FROM preferences
        WHERE status = 'confirmed'
        GROUP BY category
        ORDER BY count DESC
        LIMIT 5
        """)
        profile['top_categories'] = [dict(row) for row in cursor.fetchall()]
        
        # 最近变化
        cursor.execute("""
        SELECT cl.action, p.text, cl.created_at
        FROM change_log cl
        JOIN preferences p ON cl.preference_id = p.id
        ORDER BY cl.created_at DESC
        LIMIT 10
        """)
        profile['recent_changes'] = [dict(row) for row in cursor.fetchall()]
        
        return profile
    
    # ────────────────────────────────────────────────
    # 导出/导入
    # ────────────────────────────────────────────────
    
    def export_to_json(self, output_path: Path) -> Path:
        """导出为 JSON"""
        cursor = self.conn.cursor()
        
        cursor.execute("SELECT * FROM preferences ORDER BY created_at DESC")
        preferences = [dict(row) for row in cursor.fetchall()]
        
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump({
                'agent_id': self.agent_id,
                'exported_at': datetime.now().isoformat(),
                'preferences': preferences
            }, f, indent=2, ensure_ascii=False)
        
        return output_path
    
    def import_from_json(self, input_path: Path) -> int:
        """从 JSON 导入"""
        with open(input_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        imported = 0
        for pref in data.get('preferences', []):
            self.add_preference(
                text=pref['text'],
                category=pref['category'],
                confidence=pref['confidence'],
                source=pref.get('source', ''),
                metadata=pref.get('metadata')
            )
            imported += 1
        
        self.conn.commit()
        return imported
    
    def sync_to_markdown(self, md_path: Path):
        """同步到 Markdown 文件（生成人类可读版本）"""
        # 确保目录存在
        md_path.parent.mkdir(parents=True, exist_ok=True)
        
        # 如果文件不存在，创建模板
        if not md_path.exists():
            with open(md_path, 'w', encoding='utf-8') as f:
                f.write("# 👤 用户偏好设置\n\n")
                f.write(f"**最后更新**: {datetime.now().strftime('%Y-%m-%d %H:%M')}\n")
                f.write("**来源**: SQLite 数据库自动同步\n\n")
                f.write("---\n\n")
        
        # 读取现有内容（保留手动编辑的部分）
        with open(md_path, 'r', encoding='utf-8') as f:
            existing_content = f.read()
        
        # 生成新的自动部分
        auto_section = "## 📊 数据库同步的偏好\n\n"
        auto_section += f"_最后同步时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}_\n\n"
        
        # 按类别分组
        cursor = self.conn.cursor()
        cursor.execute("""
        SELECT category, text, confidence, status, created_at
        FROM preferences
        WHERE status IN ('confirmed', 'pending')
        ORDER BY category, confidence DESC, created_at DESC
        """)
        
        current_category = None
        for row in cursor.fetchall():
            category, text, confidence, status, created_at = row
            
            if category != current_category:
                auto_section += f"\n### {category}\n\n"
                current_category = category
            
            checkbox = "[x]" if status == 'confirmed' else "[ ]"
            conf_percent = int(confidence * 100)
            date_str = created_at[:10] if created_at else "未知"
            
            auto_section += f"- {checkbox} {text} ({conf_percent}%, {date_str})\n"
        
        # 查找并替换自动部分
        if "## 📊 数据库同步的偏好" in existing_content:
            # 替换现有部分
            start_idx = existing_content.find("## 📊 数据库同步的偏好")
            end_idx = existing_content.find("\n## ", start_idx + 1)
            if end_idx == -1:
                end_idx = len(existing_content)
            
            new_content = existing_content[:start_idx] + auto_section + "\n---\n\n" + existing_content[end_idx:]
        else:
            # 追加到末尾
            new_content = existing_content + "\n\n" + auto_section
        
        # 写回文件
        with open(md_path, 'w', encoding='utf-8') as f:
            f.write(new_content)

# ────────────────────────────────────────────────
# 便捷函数
# ────────────────────────────────────────────────

def quick_search(agent_id: str, query: str) -> List[Dict]:
    """快速搜索"""
    db = PreferencesDB(agent_id)
    results = db.search(query)
    db.close()
    return results

def quick_stats(agent_id: str) -> Dict:
    """快速获取统计"""
    db = PreferencesDB(agent_id)
    stats = db.get_stats()
    db.close()
    return stats

def quick_profile(agent_id: str) -> Dict:
    """快速获取用户画像"""
    db = PreferencesDB(agent_id)
    profile = db.get_user_profile()
    db.close()
    return profile

# ────────────────────────────────────────────────
# CLI 入口
# ────────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 3:
        print("用法：python3 preferences_db.py <agent-id> <command> [args]")
        print("命令:")
        print("  stats              显示统计")
        print("  profile            显示用户画像")
        print("  search <query>     搜索偏好")
        print("  list [status]      列出偏好")
        print("  export <file>      导出为 JSON")
        sys.exit(1)
    
    agent_id = sys.argv[1]
    command = sys.argv[2]
    
    db = PreferencesDB(agent_id)
    
    try:
        if command == "stats":
            stats = db.get_stats()
            print(json.dumps(stats, indent=2, ensure_ascii=False))
        
        elif command == "profile":
            profile = db.get_user_profile()
            print(json.dumps(profile, indent=2, ensure_ascii=False))
        
        elif command == "search":
            if len(sys.argv) < 4:
                print("❌ 请提供搜索关键词")
                sys.exit(1)
            query = sys.argv[3]
            results = db.search(query)
            print(json.dumps(results, indent=2, ensure_ascii=False))
        
        elif command == "list":
            status = sys.argv[3] if len(sys.argv) > 3 else None
            prefs = db.get_preferences(status=status)
            print(json.dumps(prefs, indent=2, ensure_ascii=False))
        
        elif command == "export":
            if len(sys.argv) < 4:
                print("❌ 请提供输出文件路径")
                sys.exit(1)
            output_path = Path(sys.argv[3])
            db.export_to_json(output_path)
            print(f"✅ 已导出到：{output_path}")
        
        else:
            print(f"❌ 未知命令：{command}")
            sys.exit(1)
    
    finally:
        db.close()
