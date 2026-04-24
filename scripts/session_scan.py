#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
session_scan.py - Evo-Cortex 会话扫描与日报整理系统

功能：
1. 扫描 OpenClaw 原生会话 (*.jsonl) → 存储到 SQLite
2. 扫描记忆文件 → 提取用户偏好 → 保存到数据库
3. 同步偏好到 Markdown (USER_PREFERENCES.md)
4. 自动整理日报 → memory/YYYY-MM-DD.md
5. 显示完整统计报告

用法：
    python3 session_scan.py cortex-test-agent

频率：每 30 分钟（Cron 定时任务）
成本：$0 (纯脚本，无 LLM API 调用)
"""

import sys
import os
import json
import sqlite3
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Set
import re

# ────────────────────────────────────────────────
# 配置和路径
# ────────────────────────────────────────────────

class Config:
    """配置管理器 - 支持多 Agent 隔离"""
    
    def __init__(self, agent_id: str):
        self.agent_id = agent_id
        self.home = Path.home()
        self.openclaw_root = self.home / '.openclaw'
        self.workspace = self.openclaw_root / f'workspace-{agent_id}'
        
        # 目录 - 全部按 agent 隔离
        self.memory_dir = self.workspace / 'memory' / agent_id  # agent 隔离的记忆目录
        self.data_dir = self.workspace / 'data' / agent_id      # agent 隔离的数据目录
        
        # 文件 - 都在 agent 隔离目录下
        self.db_path = self.data_dir / 'cortex.db'
        self.pref_file = self.memory_dir / 'USER_PREFERENCES.md'
        self.today = datetime.now().strftime('%Y-%m-%d')
        self.daily_report = self.memory_dir / f'{self.today}.md'
        
        # 确保目录存在
        self.memory_dir.mkdir(parents=True, exist_ok=True)
        self.data_dir.mkdir(parents=True, exist_ok=True)


# ────────────────────────────────────────────────
# 第 1 部分：会话扫描器
# ────────────────────────────────────────────────

class SessionScanner:
    """OpenClaw 原生会话扫描器"""
    
    def __init__(self, config: Config):
        self.config = config
        self.sessions_path = config.openclaw_root / 'agents' / config.agent_id / 'sessions'
        self.state_file = config.data_dir / '.session_scan_state.json'
        self.state = self._load_state()
        
        # 导入 MemoryHub
        libs_path = config.workspace / 'libs'
        if str(libs_path) not in sys.path:
            sys.path.insert(0, str(libs_path))
        
        try:
            from memory_hub import MemoryHub
            self.memory_hub = MemoryHub(agent_name=config.agent_id)
        except ImportError as e:
            print(f"⚠️  无法导入 MemoryHub: {e}")
            self.memory_hub = None
    
    def _load_state(self) -> Dict:
        """加载扫描状态"""
        if self.state_file.exists():
            try:
                return json.loads(self.state_file.read_text())
            except:
                pass
        return {'processed_sessions': {}}
    
    def _save_state(self):
        """保存扫描状态"""
        self.state_file.write_text(json.dumps(self.state, indent=2, ensure_ascii=False))
    
    def scan(self) -> int:
        """扫描并存储新会话"""
        if not self.sessions_path.exists():
            print(f"⏭️  会话目录不存在：{self.sessions_path}")
            return 0
        
        if not self.memory_hub:
            print("⏭️  MemoryHub 未初始化，跳过会话扫描")
            return 0
        
        # 获取所有会话文件
        session_files = list(self.sessions_path.glob('*.jsonl'))
        new_count = 0
        
        for session_file in session_files:
            session_id = session_file.stem
            
            # 检查是否已处理
            if session_id in self.state.get('processed_sessions', {}):
                continue
            
            # 读取会话内容
            try:
                messages = []
                with open(session_file, 'r', encoding='utf-8') as f:
                    for line in f:
                        if line.strip():
                            messages.append(json.loads(line))
                
                if not messages:
                    continue
                
                # 合并会话内容为单个记忆
                content_parts = []
                for msg in messages[:20]:  # 限制前 20 条消息
                    role = msg.get('message', {}).get('role', 'unknown')
                    content = msg.get('message', {}).get('content', '')
                    if content and len(content) < 500:
                        content_parts.append(f"[{role}]: {content[:200]}")
                
                full_content = '\n\n'.join(content_parts)
                
                # 🆕 P0 修复：过滤 Cron 自动任务，只保存真实用户对话
                if '[cron:' in full_content or 'SCRIPT MODE' in full_content:
                    print(f"⏭️  跳过 Cron 任务：{session_id}")
                    continue  # 不保存到数据库
                
                # 计算重要性评分
                importance = self._calculate_importance(messages)
                
                # 提取标签
                tags = self._extract_tags(full_content)
                
                # 🆕 P1: 新会话先存入工作记忆
                conn = sqlite3.connect(str(self.config.data_dir / 'cortex.db'))
                cursor = conn.cursor()
                
                # 计算过期时间（对话结束后 2 小时）
                from datetime import datetime, timedelta
                expires_at = (datetime.now() + timedelta(hours=2)).isoformat()
                
                cursor.execute("""
                    INSERT INTO working_memory (session_id, content, created_at, expires_at, message_count)
                    VALUES (?, ?, ?, ?, ?)
                """, (session_id, full_content, datetime.now().isoformat(), expires_at, len(messages)))
                
                conn.commit()
                conn.close()
                
                print(f"   ✅ 已存入工作记忆 #{cursor.lastrowid} (过期：{expires_at})")
                
                # 同时备份到短期记忆（防止工作记忆丢失）
                self.memory_hub.add(
                    content=full_content,
                    memory_type='session',
                    importance=importance,
                    tags=tags,
                    metadata={'session_id': session_id, 'message_count': len(messages)}
                )
                
                # 标记为已处理
                self.state['processed_sessions'][session_id] = {
                    'scanned_at': datetime.now().isoformat(),
                    'message_count': len(messages)
                }
                new_count += 1
                
            except Exception as e:
                print(f"⚠️  处理会话 {session_id} 失败：{e}")
                continue
        
        # 保存状态
        self._save_state()
        
        return new_count
    
    def _calculate_importance(self, messages: List[Dict]) -> float:
        """计算重要性评分 (0-10)"""
        score = 5.0  # 基础分
        
        # 长会话更重要
        if len(messages) > 20:
            score += 2.0
        elif len(messages) > 10:
            score += 1.0
        
        # 检查关键词
        content = str(messages)
        important_keywords = ['决定', '重要', '必须', '记住', '偏好', '喜欢', '不喜欢']
        for kw in important_keywords:
            if kw in content:
                score += 0.5
        
        return min(score, 10.0)
    
    def _extract_tags(self, content: str) -> List[str]:
        """提取标签"""
        tags = []
        
        # 技术标签
        tech_keywords = ['Python', 'JavaScript', 'TypeScript', 'SQL', 'API', '数据库', 'OpenClaw']
        for kw in tech_keywords:
            if kw.lower() in content.lower():
                tags.append(kw)
        
        # 话题标签
        topic_keywords = ['会议', '讨论', '决策', '问题', '修复', '优化']
        for kw in topic_keywords:
            if kw in content:
                tags.append(kw)
        
        return tags[:10]  # 限制最多 10 个标签


# ────────────────────────────────────────────────
# 第 2 部分：偏好提取器
# ────────────────────────────────────────────────

class PreferenceExtractor:
    """用户偏好提取器"""
    
    def __init__(self, config: Config):
        self.config = config
        self.db_path = config.db_path
        
        # 偏好模式
        self.patterns = {
            '明确表达过的喜好': {
                'keywords': ['我喜欢', '我偏好', '我倾向于'],
                'confidence': 0.80
            },
            '避免的回答方式': {
                'keywords': ['我不喜欢', '我讨厌', '我避免', '我反感'],
                'confidence': 0.85
            },
            '格式偏好': {
                'keywords': ['请用', '不要用', '别用', '使用', '不用'],
                'confidence': 0.75
            },
            '待办事项': {
                'keywords': ['我希望', '我想要', '我需要'],
                'confidence': 0.70
            },
            '个人习惯': {
                'keywords': ['我比较', '我通常', '我一般', '我经常'],
                'confidence': 0.65
            }
        }
    
    def extract_from_files(self, file_paths: List[Path]) -> int:
        """从文件中提取偏好"""
        if not file_paths:
            print("⏭️  没有文件需要分析")
            return 0
        
        extracted_count = 0
        
        for file_path in file_paths:
            try:
                content = file_path.read_text(encoding='utf-8')
                extracted = self._extract_from_content(content, file_path.name)
                extracted_count += len(extracted)
                
                if extracted:
                    self._save_to_db(extracted)
                    
            except Exception as e:
                print(f"⚠️  处理文件 {file_path} 失败：{e}")
        
        return extracted_count
    
    def _extract_from_content(self, content: str, source: str) -> List[Dict]:
        """从内容中提取偏好"""
        preferences = []
        lines = content.split('\n')
        
        for line in lines:
            line = line.strip()
            if len(line) < 10 or len(line) > 200:
                continue
            
            for category, config in self.patterns.items():
                for keyword in config['keywords']:
                    if keyword in line:
                        # 提取完整的句子
                        pref_text = line
                        if ':' in pref_text:
                            pref_text = pref_text.split(':', 1)[1].strip()
                        
                        preferences.append({
                            'text': pref_text,
                            'category': category,
                            'confidence': config['confidence'],
                            'source': source,
                            'timestamp': datetime.now().isoformat(),
                            'status': 'pending' if config['confidence'] < 0.85 else 'confirmed'
                        })
                        break
        
        return preferences
    
    def _save_to_db(self, preferences: List[Dict]):
        """保存到数据库"""
        if not preferences:
            return
        
        conn = sqlite3.connect(str(self.config.db_path))
        cursor = conn.cursor()
        
        # 创建表（如果不存在）
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS preferences (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                text TEXT NOT NULL,
                category TEXT,
                confidence REAL,
                source TEXT,
                timestamp TEXT,
                status TEXT DEFAULT 'pending'
            )
        ''')
        
        # 去重插入
        for pref in preferences:
            # 检查是否已存在
            cursor.execute('SELECT id FROM preferences WHERE text LIKE ?', (f'%{pref["text"][:50]}%',))
            if cursor.fetchone():
                continue
            
            cursor.execute('''
                INSERT INTO preferences (text, category, confidence, source, timestamp, status)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', (
                pref['text'],
                pref['category'],
                pref['confidence'],
                pref['source'],
                pref['timestamp'],
                pref['status']
            ))
        
        conn.commit()
        conn.close()


# ────────────────────────────────────────────────
# 第 3 部分：Markdown 同步
# ────────────────────────────────────────────────

class PreferencesSync:
    """偏好同步到 Markdown"""
    
    def __init__(self, config: Config):
        self.config = config
        self.db_path = config.db_path
    
    def sync(self):
        """同步偏好到 Markdown"""
        if not self.config.db_path.exists():
            print("⏭️  数据库不存在，跳过同步")
            return
        
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        # 获取所有偏好
        cursor.execute('SELECT * FROM preferences ORDER BY category, status DESC')
        preferences = cursor.fetchall()
        conn.close()
        
        if not preferences:
            print("⏭️  没有偏好需要同步")
            return
        
        # 构建 Markdown 内容
        md_content = self._build_markdown(preferences)
        
        # 写入文件
        self.config.pref_file.parent.mkdir(parents=True, exist_ok=True)
        self.config.pref_file.write_text(md_content, encoding='utf-8')
        
        print(f"✅ 已同步 {len(preferences)} 条偏好到 Markdown")
    
    def _build_markdown(self, preferences) -> str:
        """构建 Markdown 内容"""
        header = """# 👤 用户偏好设置

> 此文件由 Evo-Cortex 自动维护，记录用户的沟通偏好、项目上下文和历史教训。
> 每次对话前会读取此文件以调整回复风格。

"""
        
        # 按类别分组
        by_category = {}
        for pref in preferences:
            cat = pref['category']
            if cat not in by_category:
                by_category[cat] = []
            by_category[cat].append(pref)
        
        # 生成内容
        sections = [header]
        
        for category, prefs in sorted(by_category.items()):
            sections.append(f"\n## {category}\n")
            
            for pref in prefs:
                checkbox = '[x]' if pref['status'] == 'confirmed' else '[ ]'
                sections.append(f"- {checkbox} {pref['text']} ({int(pref['confidence']*100)}%, {pref['status']})\n")
        
        return ''.join(sections)


# ────────────────────────────────────────────────
# 第 4 部分：自动日报整理
# ────────────────────────────────────────────────

class DailyReportGenerator:
    """自动日报生成器"""
    
    def __init__(self, config: Config):
        self.config = config
        self.db_path = config.db_path
    
    def generate(self):
        """生成或更新日报"""
        if not self.config.db_path.exists():
            print("⏭️  数据库不存在，跳过日报生成")
            return
        
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        # 检查表是否存在
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='session_memories'")
        if not cursor.fetchone():
            print("⏭️  session_memories 表不存在")
            conn.close()
            return
        
        # 获取今天的记录
        today_start = datetime.now().strftime('%Y-%m-%d') + ' 00:00:00'
        cursor.execute("""
            SELECT id, session_id, content, importance, created_at, tags
            FROM session_memories
            WHERE date(created_at) = date(?)
            ORDER BY created_at ASC
        """, (today_start,))
        
        memories = cursor.fetchall()
        conn.close()
        
        if not memories:
            print("⏭️  今日暂无会话记录")
            return
        
        print(f"📊 找到 {len(memories)} 条今日会话记录")
        
        # 如果日报已存在，读取现有内容
        existing_events = []
        if self.config.daily_report.exists():
            content = self.config.daily_report.read_text(encoding='utf-8')
            existing_events = re.findall(r'- \[(.*?)\] (.+)', content)
            print(f"📄 日报已存在，检测到 {len(existing_events)} 个已有事件")
        
        # 提取新事件
        new_events = []
        for mem in memories:
            event = self._extract_event(mem)
            if event:
                # 检查是否重复
                is_dup = False
                for e_time, e_content in existing_events:
                    if event['time'] == e_time and event['summary'][:50] in e_content:
                        is_dup = True
                        break
                
                # 检查新事件之间的重复
                for existing in new_events:
                    if f"[{event['time']}]" in existing and event['summary'][:60] in existing:
                        is_dup = True
                        break
                
                if not is_dup:
                    new_events.append(f"- [{event['time']}] {event['summary']}")
        
        if not new_events:
            print("✅ 没有新事件需要添加")
            return
        
        # 构建或更新日报
        if self.config.daily_report.exists():
            # 追加到现有文件
            content = self.config.daily_report.read_text(encoding='utf-8')
            lines = content.split('\n')
            
            # 找到事件列表末尾
            insert_index = -1
            in_events = False
            for i, line in enumerate(lines):
                if line.startswith('## 📌'):
                    in_events = True
                elif in_events and line.startswith('##'):
                    insert_index = i
                    break
            
            if insert_index > 0:
                lines.insert(insert_index, "\n".join(new_events) + "\n")
                final_content = "\n".join(lines)
            else:
                final_content = content.rstrip() + "\n\n" + "\n".join(new_events) + "\n"
        else:
            # 创建新文件
            header = f"# {datetime.now().strftime('%Y-%m-%d')} - 会话记录\n\n"
            section = "## 📌 今日事件\n\n"
            final_content = header + section + "\n".join(new_events) + "\n"
        
        # 写入文件
        self.config.daily_report.parent.mkdir(parents=True, exist_ok=True)
        self.config.daily_report.write_text(final_content, encoding='utf-8')
        
        print(f"✅ 新增 {len(new_events)} 个事件到日报")
    
    def _extract_event(self, memory) -> Optional[Dict]:
        """从记忆中提取事件"""
        try:
            timestamp = memory['created_at']
            dt = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
            time_str = dt.strftime('%H:%M')
            
            content = memory['content']
            lines = content.split('\n')
            
            for line in lines:
                line = line.strip()
                if len(line) < 20 or len(line) > 300:
                    continue
                
                # 清理工具调用格式
                if '[toolResult]' in line or '[AI]' in line:
                    match = re.search(r"'text':\s*'([^']+)'", line)
                    if match:
                        line = match.group(1)[:150]
                    else:
                        continue
                
                # 清理 JSON 残留
                line = line.replace("{'type':", "").replace("'text':", "").strip()
                line = line.replace('\n', ' ').replace('"', '')[:150]
                
                if line and len(line) > 10:
                    return {
                        'time': time_str,
                        'summary': line
                    }
        except Exception as e:
            print(f"⚠️  提取事件失败：{e}")
        
        return None


# ────────────────────────────────────────────────
# 第 5 部分：统计报告
# ────────────────────────────────────────────────

class DataCleaner:
    """数据清理器 - 防止数据库膨胀"""
    
    def __init__(self, config: Config):
        self.config = config
    
    def cleanup_old_sessions(self, max_per_session: int = 100) -> int:
        """清理每个会话的旧记录，保留最新的 N 条
        
        Args:
            max_per_session: 每个 session 最多保留的记录数
            
        Returns:
            清理的记录数
        """
        import sqlite3
        
        conn = sqlite3.connect(str(self.config.db_path))
        cursor = conn.cursor()
        
        try:
            # 获取所有 session_id
            cursor.execute("SELECT DISTINCT session_id FROM session_memories")
            sessions = [row[0] for row in cursor.fetchall()]
            
            total_cleaned = 0
            
            for session_id in sessions:
                # 计算每个 session 的记录数
                cursor.execute(
                    "SELECT COUNT(*) FROM session_memories WHERE session_id = ?",
                    (session_id,)
                )
                count = cursor.fetchone()[0]
                
                if count > max_per_session:
                    # 删除最老的记录
                    to_delete = count - max_per_session
                    
                    cursor.execute("""
                        DELETE FROM session_memories
                        WHERE session_id = ?
                        AND id IN (
                            SELECT id FROM session_memories
                            WHERE session_id = ?
                            ORDER BY created_at ASC
                            LIMIT ?
                        )
                    """, (session_id, session_id, to_delete))
                    
                    cleaned = cursor.rowcount
                    total_cleaned += cleaned
                    
                    if cleaned > 0:
                        print(f"   📦 Session {session_id[:8]}...: 清理 {cleaned} 条旧记录 (保留{max_per_session}条)")
            
            conn.commit()
            
            if total_cleaned == 0 and len(sessions) > 0:
                print(f"   ✅ 所有 {len(sessions)} 个 session 的数据量都正常 (≤{max_per_session}条)")
            
            return total_cleaned
            
        except Exception as e:
            print(f"   ⚠️  清理失败：{e}")
            conn.rollback()
            return 0
        finally:
            conn.close()


class StatsReporter:
    """统计报告生成器"""
    
    def __init__(self, config: Config):
        self.config = config
    
    def show(self):
        """显示统计"""
        print("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
        print("📊 最终统计:")
        print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")
        
        if not self.config.db_path.exists():
            print("💾 数据库：不存在")
            return
        
        conn = sqlite3.connect(str(self.config.db_path))
        cursor = conn.cursor()
        
        # 偏好统计
        print("💾 偏好数据库:")
        cursor.execute("SELECT COUNT(*) FROM preferences")
        print(f"  • 总偏好数：{cursor.fetchone()[0]}")
        
        cursor.execute("SELECT COUNT(*) FROM preferences WHERE status='pending'")
        print(f"  • 待确认：{cursor.fetchone()[0]}")
        
        cursor.execute("SELECT COUNT(*) FROM preferences WHERE status='confirmed'")
        print(f"  • 已确认：{cursor.fetchone()[0]}")
        
        cursor.execute("SELECT AVG(confidence) FROM preferences WHERE confidence IS NOT NULL")
        avg_conf = cursor.fetchone()[0]
        if avg_conf:
            print(f"  • 平均置信度：{int(avg_conf*100)}%")
        
        print()
        
        # 会话统计
        print("💬 会话记忆:")
        try:
            cursor.execute("SELECT COUNT(*) FROM session_memories")
            print(f"  • 存储的会话记录：{cursor.fetchone()[0]} 条")
            
            cursor.execute("SELECT COUNT(*) FROM raw_sessions")
            print(f"  • 扫描的原始会话：{cursor.fetchone()[0]} 个")
        except:
            print("  • session_memories 表不存在")
        
        print()
        
        # 日报统计
        if self.config.daily_report.exists():
            event_count = 0
            try:
                with open(self.config.daily_report, 'r', encoding='utf-8') as f:
                    event_count = sum(1 for line in f if line.strip().startswith('- ['))
            except:
                pass
            
            file_size = self.config.daily_report.stat().st_size
            
            print("📰 今日日报:")
            print(f"  • 文件：{self.config.daily_report}")
            print(f"  • 事件数：{event_count} 个")
            print(f"  • 大小：{file_size} 字节")
        else:
            print("📰 今日日报：尚未生成")
        
        conn.close()
        print("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")


# ────────────────────────────────────────────────
# 主程序
# ────────────────────────────────────────────────

def main():
    """主入口"""
    import traceback
    from pathlib import Path
    from datetime import datetime
    
    if len(sys.argv) < 2:
        print("用法：python3 session_scan.py <agent-id>")
        sys.exit(1)
    
    agent_id = sys.argv[1]
    
    # 设置日志文件
    log_dir = Path.home() / '.openclaw' / 'extensions' / 'evo-cortex' / 'logs' / agent_id
    log_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    agent_id_for_log = sys.argv[1] if len(sys.argv) > 1 else 'unknown'
    log_file = log_dir / f'session-scan-{agent_id_for_log}-{timestamp}.log'
    
    try:
        # 重定向输出到日志
        original_stdout = sys.stdout
        original_stderr = sys.stderr
        
        class Logger:
            def __init__(self, filepath):
                self.terminal = sys.stdout
                self.log = open(filepath, 'w', encoding='utf-8')
            
            def write(self, message):
                self.terminal.write(message)
                self.log.write(message)
                self.log.flush()
            
            def flush(self):
                self.terminal.flush()
                self.log.flush()
        
        logger = Logger(log_file)
        sys.stdout = logger
        sys.stderr = logger
        
        # 原有的 main 逻辑
        _run_main_logic()
        
    except Exception as e:
        print(f"\n❌ 发生错误：{str(e)}")
        print(f"📝 详细日志已保存到：{log_file}")
        print("\n错误堆栈:")
        traceback.print_exc()
        sys.exit(1)

def _run_main_logic():
    """实际的主流程逻辑（从原来的 main 提取）"""
    if len(sys.argv) < 2:
        print("用法：python3 session_scan.py <agent-id>")
        sys.exit(1)
    
    agent_id = sys.argv[1]
    
    print("╔══════════════════════════════════════════════╗")
    print("║  📊 Session Scan - 会话扫描与日报整理        ║")
    print("╚══════════════════════════════════════════════╝")
    print("╚══════════════════════════════════════════════╝")
    print()
    print(f"📦 Agent: {agent_id}")
    print(f"🕐 时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"📅 今日：{datetime.now().strftime('%Y-%m-%d')}")
    print()
    
    # 初始化配置
    config = Config(agent_id)
    
    # 第 1 部分：会话扫描
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print("🐍 第 1 部分：扫描 OpenClaw 原生会话...")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")
    
    scanner = SessionScanner(config)
    scanned = scanner.scan()
    print(f"✅ 扫描完成：{scanned} 个新会话\n")
    
    # 第 2 部分：偏好提取
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print("🔍 第 2 部分：扫描记忆文件并提取偏好...")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")
    
    extractor = PreferenceExtractor(config)
    
    # 查找最近的文件（只扫描 agent 隔离目录）
    recent_files = []
    if config.memory_dir.exists():
        recent_files = [f for f in config.memory_dir.glob('*.md') 
                       if f.is_file() and (datetime.now() - datetime.fromtimestamp(f.stat().st_mtime)).seconds < 2100]
    
    if recent_files:
        print(f"🔍 发现 {len(recent_files)} 个新文件")
        extracted = extractor.extract_from_files(recent_files)
        print(f"✅ 提取到 {extracted} 条偏好\n")
    else:
        print("⏭️  最近无新文件，跳过偏好提取\n")
    
    # 第 2.5 部分：自动清理旧数据（新增）
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print("🧹 第 2.5 部分：自动清理旧数据...")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")
    
    cleaner = DataCleaner(config)
    cleaned_count = cleaner.cleanup_old_sessions(max_per_session=100)
    
    if cleaned_count > 0:
        print(f"   ✅ 清理了 {cleaned_count} 条旧记录")
    else:
        print("   ⏭️  无需清理（数据量正常）")
    
    print()
    
    # 第 3 部分：Markdown 同步
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print("📝 第 3 部分：同步偏好到 Markdown...")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")
    
    syncer = PreferencesSync(config)
    syncer.sync()
    print()
    
    # 第 4 部分：日报生成
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print("📰 第 4 部分：自动整理日报...")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")
    
    reporter = DailyReportGenerator(config)
    reporter.generate()
    print()
    
    # 第 5 部分：自进化分析（新增）
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print("🧬 第 5 部分：自进化分析...")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")
    
    try:
        # 直接运行 activate-evolution.py 脚本
        import subprocess
        result = subprocess.run(
            ['python3', str(Path(__file__).parent / 'activate-evolution.py'), config.agent_id],
            capture_output=True,
            text=True,
            timeout=60
        )
        
        # 输出结果
        if result.stdout:
            # 只保留关键行
            for line in result.stdout.split('\n'):
                if any(x in line for x in ['✅', '⏭️', '📄', '⚠️']):
                    print(f"   {line.strip()}")
        
        if result.returncode != 0 and result.stderr:
            print(f"   ⚠️  警告：{result.stderr[:200]}")
            
    except Exception as e:
        print(f"   ⚠️  进化分析失败：{e}")
    
    print()
    
    # 第 6 部分：统计
    stats = StatsReporter(config)
    stats.show()
    
    print("\n✅ Session Scan Unified V4 完成!")
    print("📋 下次执行：30 分钟后（通过 Cron）\n")


if __name__ == '__main__':
    main()


# ────────────────────────────────────────────────
# 第 6 部分：记忆分层整合（新增）
# ────────────────────────────────────────────────

class MemoryConsolidator:
    """记忆整合器 - 实现 4 层架构的自动流转"""
    
    def __init__(self, config: Config):
        self.config = config
        self.db_path = config.data_dir / 'cortex.db'
    
    def consolidate_all(self) -> Dict[str, int]:
        """执行完整的记忆整合流程"""
        stats = {
            'working_to_short': 0,
            'short_to_long': 0,
            'expired_cleaned': 0
        }
        
        # 1. 工作记忆 → 短期记忆（对话结束）
        stats['working_to_short'] = self._consolidate_working_to_short()
        
        # 2. 短期记忆 → 长期记忆（重要性≥7）
        stats['short_to_long'] = self._consolidate_short_to_long()
        
        # 3. 清理过期工作记忆（>2 小时）
        stats['working_expired'] = self._clean_expired_working_memory()
        
        # 4. 清理过期短期记忆（>30 天）
        stats['expired_cleaned'] = self._clean_expired_short_term()
        
        return stats
    
    def _consolidate_working_to_short(self) -> int:
        """将结束的工作记忆转移到短期记忆"""
        # 简化版：实际应该检测会话是否结束
        # 这里暂时跳过，因为当前没有使用 working_memory
        return 0
    
    def _consolidate_short_to_long(self) -> int:
        """将高重要性短期记忆整合到长期记忆"""
        conn = sqlite3.connect(str(self.db_path))
        cursor = conn.cursor()
        
        # 查找 importance >= 7 且未整合的记录
        cursor.execute('''
            INSERT OR IGNORE INTO long_term_memory 
            (session_id, content, memory_type, importance, tags, metadata, consolidated_from)
            SELECT 
                session_id,
                content,
                'important_event',
                importance,
                tags,
                metadata,
                'short_term'
            FROM short_term_memory
            WHERE importance >= 7.0
            AND session_id NOT IN (SELECT session_id FROM long_term_memory)
        ''')
        
        moved = cursor.rowcount
        conn.commit()
        conn.close()
        
        if moved > 0:
            print(f"   ✅ 整合 {moved} 条高重要性记忆到长期存储")
        
        return moved
    
    def _clean_expired_working_memory(self) -> int:
        """清理过期的工作记忆（>2 小时）"""
        conn = sqlite3.connect(str(self.db_path))
        cursor = conn.cursor()
        
        cursor.execute("""
            DELETE FROM working_memory
            WHERE expires_at < datetime('now')
        """)
        
        deleted = cursor.rowcount
        conn.commit()
        conn.close()
        
        if deleted > 0:
            print(f"   🗑️  清理 {deleted} 条过期工作记忆")
        
        return deleted
    
    def _clean_expired_short_term(self) -> int:
        """清理过期的短期记忆（>30 天）"""
        conn = sqlite3.connect(str(self.db_path))
        cursor = conn.cursor()
        
        cursor.execute('''
            DELETE FROM short_term_memory
            WHERE expires_at < datetime('now')
            AND session_id NOT IN (
                SELECT session_id FROM long_term_memory
            )
        ''')
        
        deleted = cursor.rowcount
        conn.commit()
        conn.close()
        
        if deleted > 0:
            print(f"   🗑️  清理 {deleted} 条过期短期记忆")
        
        return deleted
    
    def get_stats(self) -> Dict:
        """获取各层记忆的统计信息"""
        conn = sqlite3.connect(str(self.db_path))
        cursor = conn.cursor()
        
        stats = {}
        
        # 工作记忆
        cursor.execute('SELECT COUNT(*) FROM working_memory')
        stats['working_count'] = cursor.fetchone()[0]
        
        # 短期记忆
        cursor.execute('SELECT COUNT(*) FROM short_term_memory')
        stats['short_count'] = cursor.fetchone()[0]
        
        cursor.execute('SELECT COUNT(*) FROM short_term_memory WHERE expires_at < datetime("now", "+7 days")')
        stats['short_expiring_soon'] = cursor.fetchone()[0]
        
        # 长期记忆
        cursor.execute('SELECT COUNT(*) FROM long_term_memory')
        stats['long_count'] = cursor.fetchone()[0]
        
        cursor.execute('SELECT AVG(importance) FROM long_term_memory')
        stats['long_avg_importance'] = round(cursor.fetchone()[0] or 0, 2)
        
        conn.close()
        
        return stats


# ────────────────────────────────────────────────
# 在主函数中调用整合逻辑
# ────────────────────────────────────────────────

def run_consolidation(config: Config):
    """运行记忆整合流程"""
    print("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print("🧠 第 6 部分：记忆分层整合...")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")
    
    consolidator = MemoryConsolidator(config)
    stats = consolidator.consolidate_all()
    
    print(f"\n📊 整合结果:")
    print(f"   工作→短期：{stats['working_to_short']} 条")
    print(f"   短期→长期：{stats['short_to_long']} 条")
    print(f"   清理过期：{stats['expired_cleaned']} 条")
    
    # 显示各层统计
    layer_stats = consolidator.get_stats()
    print(f"\n💾 当前各层记忆:")
    print(f"   工作记忆：{layer_stats['working_count']} 条")
    print(f"   短期记忆：{layer_stats['short_count']} 条 ({layer_stats['short_expiring_soon']} 条即将过期)")
    print(f"   长期记忆：{layer_stats['long_count']} 条 (平均重要性⭐{layer_stats['long_avg_importance']})")
    
    return stats
