#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
激活 Evo-Cortex 的自进化能力

功能:
1. 从 memory.db 的 working_memory + long_term_memory 提取进化事件
2. 识别模式并生成元规则
3. 元规则写回 knowledge.db 的 rules 表（闭环！）
4. 输出报告到 evolution/{agent_id}/ 目录

用法:
    python3 activate-evolution.py <agent-id>

变更日志:
    2026-04-27: 数据源 cortex.db → memory.db；新增规则写回 knowledge.db
    2026-04-28: 文档更新，确认 memory.db + knowledge.db 双库架构
    2026-04-27 v2: 增加数据清洗，过滤 session_scanner 垃圾数据
"""

import sys
import json
import sqlite3
import uuid
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, List, Optional
from collections import Counter

class Config:
    def __init__(self, agent_id: str):
        self.agent_id = agent_id
        self.workspace = Path.home() / '.openclaw' / f'workspace-{agent_id}'
        self.data_dir = self.workspace / 'data' / agent_id
        self.evolution_dir = self.workspace / 'evolution' / agent_id
        self.memory_db = self.data_dir / 'memory.db'
        self.knowledge_db = self.data_dir / 'knowledge.db'
        self.evolution_dir.mkdir(parents=True, exist_ok=True)
        self.data_dir.mkdir(parents=True, exist_ok=True)


def is_clean_content(content: str) -> bool:
    """过滤垃圾数据：空内容、session_scanner 原始 JSON"""
    if not content or not content.strip():
        return False
    # 过滤 session_scanner 导入的原始 JSON 格式 + 旧报告内容
    junk_prefixes = [
        '[user]: [{', '[assistant]: [{',
        '[user]: [', '[assistant]: [',
        '[user]: Sender', '[user]: {',
        'Sender (untrusted metadata):',
        '[Bootstrap pending]',
        "⚠️ Context limit exceeded",
        '```json',
        'session_messages', 'working_memory', 'scan_log',
        '# 👤 用户偏好设置',
        '# 记忆数据分析报告',
        '# 周统计报告', '# 周度摘要',
        '# 2026-04-',
    ]
    for prefix in junk_prefixes:
        if content.startswith(prefix):
            return False
    return True


class EvolutionEventExtractor:
    """进化事件提取器 — 从 memory.db 读取"""
    
    EVENT_PATTERNS = {
        'breakthrough': ['发现', '找到', '解决', '成功', '完成', '突破', '修复', '搞定'],
        'problem': ['问题', '错误', '失败', 'bug', '困难', '异常', '崩溃', '报错'],
        'lesson': ['学到', '明白', '理解', '经验', '教训', '心得', '记住'],
        'optimization': ['优化', '改进', '提升', '加速', '简化', '重构'],
        'decision': ['决定', '选择', '采用', '放弃', '优先', '策略']
    }
    
    def __init__(self, config: Config):
        self.config = config
    
    def extract_events(self, limit: int = 100, min_importance: float = 3.0) -> List[Dict]:
        if not self.config.memory_db.exists():
            print(f"❌ 数据库不存在：{self.config.memory_db}")
            return []
        
        conn = sqlite3.connect(self.config.memory_db)
        try:
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()

            events = []
            ltm_count = 0
            wm_count = 0

            # 1. 从 long_term_memory 提取（已筛选，质量最高）
            cur.execute('''
                SELECT id, type, title, content, importance, tags, source, source_ref, created_at
                FROM long_term_memory
                WHERE importance >= ?
                ORDER BY importance DESC, created_at DESC
                LIMIT ?
            ''', (min_importance, limit))

            for row in cur.fetchall():
                entry = dict(row)
                if is_clean_content(entry.get('content', '')):
                    event = self._classify_event(entry)
                    if event:
                        events.append(event)
                        ltm_count += 1

            # 2. WM 补充（过滤垃圾数据）
            remaining = limit - len(events)
            if remaining > 0:
                cur.execute('''
                    SELECT id, type, title, content, importance, tags, source, source_ref, created_at
                    FROM working_memory
                    WHERE importance >= ?
                      AND content IS NOT NULL AND content != ''
                    ORDER BY importance DESC, created_at DESC
                ''', (min_importance,))

                for row in cur.fetchall():
                    if len(events) >= limit:
                        break
                    entry = dict(row)
                    # 过滤垃圾内容
                    if not is_clean_content(entry.get('content', '')):
                        continue
                    event = self._classify_event(entry)
                    if event:
                        events.append(event)
                        wm_count += 1
        finally:
            conn.close()
        print(f"   📊 有效数据: LTM {ltm_count} 条, WM {wm_count} 条")
        return events
    
    def _classify_event(self, entry: Dict) -> Optional[Dict]:
        content = entry.get('content', '')
        title = entry.get('title', '')
        combined = f"{title} {content}"
        
        for event_type, keywords in self.EVENT_PATTERNS.items():
            if any(kw in combined for kw in keywords):
                return {
                    'type': event_type,
                    'title': title,
                    'content': content[:500],
                    'importance': entry.get('importance', 0),
                    'tags': entry.get('tags', ''),
                    'source_ref': entry.get('source_ref', ''),
                    'created_at': entry.get('created_at', '')
                }
        
        # 高重要性但未匹配关键词 → insight
        if entry.get('importance', 0) >= 7.0:
            return {
                'type': 'insight',
                'title': title,
                'content': content[:500],
                'importance': entry.get('importance', 0),
                'tags': entry.get('tags', ''),
                'source_ref': entry.get('source_ref', ''),
                'created_at': entry.get('created_at', '')
            }
        
        return None


class PatternRecognizer:
    """模式识别器"""
    
    def __init__(self, config: Config):
        self.config = config
    
    def recognize_patterns(self, events: List[Dict]) -> List[Dict]:
        type_counts = Counter(e['type'] for e in events)
        
        tag_counts = Counter()
        for event in events:
            tags = event.get('tags', '')
            if tags:
                if isinstance(tags, str):
                    tag_list = [t.strip() for t in tags.split(',') if t.strip()]
                else:
                    tag_list = tags
                tag_counts.update(tag_list)
        
        patterns = []
        
        for event_type, count in type_counts.most_common(5):
            if count >= 2:
                patterns.append({
                    'pattern_type': 'recurring_event',
                    'description': f'{event_type} 类事件频繁出现 ({count}次)',
                    'frequency': count,
                    'suggestion': self._get_suggestion(event_type, count)
                })
        
        for tag, count in tag_counts.most_common(5):
            if count >= 2 and tag:
                patterns.append({
                    'pattern_type': 'hot_topic',
                    'description': f'话题 "{tag}" 被频繁讨论 ({count}次)',
                    'frequency': count,
                    'suggestion': f'建议整理关于 "{tag}" 的知识文档'
                })
        
        return patterns
    
    def _get_suggestion(self, event_type: str, count: int) -> str:
        suggestions = {
            'breakthrough': '继续保持高效状态！记录突破的关键因素。',
            'problem': f'发现{count}个问题，建立问题追踪系统，定期复盘。',
            'lesson': '学到了很多！将经验整理成可复用的方法论。',
            'optimization': '持续优化！建立性能基线，量化改进效果。',
            'decision': '做了很多重要决策！记录决策依据和后续验证。',
            'insight': '有很多洞察！定期整理成文，形成知识资产。'
        }
        return suggestions.get(event_type, '继续保持关注和反思。')


class MetaRuleGenerator:
    """元规则生成器"""
    
    def __init__(self, config: Config):
        self.config = config
    
    def generate_rules(self, events: List[Dict], patterns: List[Dict]) -> List[Dict]:
        rules = []
        
        problem_events = [e for e in events if e['type'] == 'problem']
        if len(problem_events) >= 2:
            rules.append({
                'rule_id': f'rule_evo_{len(rules)+1}',
                'type': 'pattern',
                'title': '问题预防机制',
                'condition': '遇到类似问题时',
                'action': '先检查常见原因清单，避免重复踩坑',
                'confidence': min(0.9, 0.5 + len(problem_events) * 0.1),
                'evidence': [e['content'][:100] for e in problem_events[:2]]
            })
        
        breakthrough_events = [e for e in events if e['type'] == 'breakthrough']
        if len(breakthrough_events) >= 2:
            rules.append({
                'rule_id': f'rule_evo_{len(rules)+1}',
                'type': 'pattern',
                'title': '成功模式保持',
                'condition': '处理类似任务时',
                'action': '保持当前的工作方法，这是有效的',
                'confidence': min(0.9, 0.6 + len(breakthrough_events) * 0.1),
                'evidence': [e['content'][:100] for e in breakthrough_events[:2]]
            })
        
        for pattern in patterns:
            if pattern['pattern_type'] == 'recurring_event':
                rules.append({
                    'rule_id': f'rule_evo_{len(rules)+1}',
                    'type': 'awareness',
                    'title': f'模式提醒: {pattern["description"][:30]}',
                    'condition': '日常工作中',
                    'action': pattern['suggestion'],
                    'confidence': 0.7,
                    'evidence': []
                })
        
        return rules


class RuleWriter:
    """元规则写回 knowledge.db（闭环关键步骤）"""
    
    def __init__(self, config: Config):
        self.config = config
    
    def write_rules(self, rules: List[Dict]) -> Dict:
        if not self.config.knowledge_db.exists():
            print(f"   ⚠️ knowledge.db 不存在，跳过规则写回")
            return {'inserted': 0, 'updated': 0, 'skipped': 0}
        
        conn = sqlite3.connect(self.config.knowledge_db)
        try:
            cur = conn.cursor()
            # 自修复：确保 rules 表存在
            cur.execute('''CREATE TABLE IF NOT EXISTS rules (
                id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL,
                condition TEXT, action TEXT, confidence REAL DEFAULT 0.5,
                support_count INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now')))''')
            stats = {'inserted': 0, 'updated': 0, 'skipped': 0}

            for rule in rules:
                # 模糊匹配：提取 title 前缀（去掉计数字）
                title_prefix = rule['title'].split('(')[0].strip()
                cur.execute('SELECT id, confidence FROM rules WHERE title LIKE ?', (f'{title_prefix}%',))
                existing = cur.fetchone()

                if existing:
                    new_conf = max(existing[1], rule['confidence'])
                    cur.execute('''
                        UPDATE rules
                        SET confidence = ?, action = ?, updated_at = datetime('now'),
                            support_count = COALESCE(support_count, 0) + 1
                        WHERE id = ?
                    ''', (new_conf, rule['action'], existing[0]))
                    stats['updated'] += 1
                    print(f"   🔄 更新规则: {rule['title']} (置信度 {existing[1]:.0%} → {new_conf:.0%})")
                else:
                    rule_id = f"rule_{uuid.uuid4().hex[:8]}"
                    cur.execute('''
                        INSERT INTO rules (id, type, title, condition, action, confidence, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
                    ''', (rule_id, rule['type'], rule['title'], rule['condition'], rule['action'], rule['confidence']))
                    stats['inserted'] += 1
                    print(f"   ➕ 新规则: {rule['title']} (置信度 {rule['confidence']:.0%})")

            conn.commit()
        finally:
            conn.close()
        return stats


class SelfImprovementAdvisor:
    """自我改进建议生成器"""
    
    def __init__(self, config: Config):
        self.config = config
    
    def generate_advice(self, events: List[Dict], patterns: List[Dict], rules: List[Dict]) -> List[Dict]:
        advice_list = []
        
        problem_events = [e for e in events if e['type'] == 'problem']
        if len(problem_events) >= 2:
            advice_list.append({
                'category': 'problem_prevention',
                'priority': 'high',
                'action': '建立问题追踪清单',
                'details': f'发现{len(problem_events)}个类似问题，创建 checkList 避免重复犯错',
                'metrics': '问题复发率降低 50%'
            })
        
        breakthrough_events = [e for e in events if e['type'] == 'breakthrough']
        if len(breakthrough_events) >= 2:
            advice_list.append({
                'category': 'success_reinforcement',
                'priority': 'medium',
                'action': '记录成功模式',
                'details': f'{len(breakthrough_events)}次成功突破，总结关键因素并标准化',
                'metrics': '成功率提升 30%'
            })
        
        hot_topics = [p for p in patterns if p['pattern_type'] == 'hot_topic']
        for topic in hot_topics[:3]:
            topic_name = topic['description'].split(' ')[1] if ' ' in topic['description'] else '该话题'
            advice_list.append({
                'category': 'knowledge_building',
                'priority': 'medium',
                'action': f'整理"{topic_name}"主题知识',
                'details': topic['suggestion'],
                'metrics': '建立该主题的知识树'
            })
        
        if rules:
            advice_list.append({
                'category': 'rule_implementation',
                'priority': 'high',
                'action': '应用新生成的元规则',
                'details': f'生成{len(rules)}条元规则，建议在下次对话中主动应用',
                'metrics': '元规则应用率 >= 80%'
            })
        
        return advice_list


class EvolutionReporter:
    """进化报告生成器"""
    
    def __init__(self, config: Config):
        self.config = config
    
    def generate_report(self, events: List[Dict], patterns: List[Dict], rules: List[Dict],
                       rule_stats: Optional[Dict] = None):
        timestamp = datetime.now().strftime('%Y-%m-%d_%H%M%S')
        report_file = self.config.evolution_dir / f'evolution-report-{timestamp}.md'
        
        advisor = SelfImprovementAdvisor(self.config)
        advice_list = advisor.generate_advice(events, patterns, rules)
        
        with open(report_file, 'w', encoding='utf-8') as f:
            f.write(f"# 🧬 Evo-Cortex 自进化报告\n\n")
            f.write(f"**生成时间**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
            f.write(f"**Agent**: {self.config.agent_id}\n")
            f.write(f"**数据源**: memory.db (working_memory + long_term_memory)\n\n")
            
            if rule_stats:
                f.write(f"**规则写回**: ➕ {rule_stats['inserted']} 新增, ")
                f.write(f"🔄 {rule_stats['updated']} 更新, ")
                f.write(f"⏭️ {rule_stats['skipped']} 跳过\n\n")
                f.write("---\n\n")
            
            f.write("## 📌 进化事件摘要\n\n")
            f.write(f"共提取 **{len(events)}** 个高价值事件（已过滤垃圾数据）\n\n")
            
            by_type = Counter(e['type'] for e in events)
            for event_type, count in by_type.most_common():
                emoji = {'breakthrough': '🎉', 'problem': '⚠️', 'lesson': '💡', 
                        'optimization': '⚡', 'decision': '🎯', 'insight': '✨'}.get(event_type, '📋')
                f.write(f"- {emoji} **{event_type}**: {count} 个\n")
            f.write("\n---\n\n")
            
            f.write("## 🔍 识别的模式\n\n")
            if patterns:
                for i, pattern in enumerate(patterns, 1):
                    f.write(f"{i}. **{pattern['description']}**\n")
                    f.write(f"   - 💡 建议：{pattern['suggestion']}\n\n")
            else:
                f.write("暂无明显模式（数据量不足）\n\n")
            f.write("---\n\n")
            
            f.write("## 📜 生成的元规则\n\n")
            if rules:
                for rule in rules:
                    f.write(f"### {rule['rule_id']}: {rule['title']}\n\n")
                    f.write(f"**条件**: {rule.get('condition', 'N/A')}\n\n")
                    f.write(f"**行动**: {rule['action']}\n\n")
                    f.write(f"**置信度**: {rule['confidence']:.0%}\n\n")
                    if rule.get('evidence'):
                        f.write("**示例**:\n")
                        for ex in rule['evidence']:
                            f.write(f"- {ex}...\n")
                    f.write("\n")
            else:
                f.write("暂无元规则生成（需要更多高质量事件）\n\n")
            f.write("---\n\n")
            
            f.write("## 💡 自我改进建议\n\n")
            if advice_list:
                for i, advice in enumerate(advice_list, 1):
                    priority_emoji = {'high': '🔴', 'medium': '🟡', 'low': '🟢'}.get(advice['priority'], '⚪')
                    f.write(f"{i}. {priority_emoji} **{advice['action']}**\n\n")
                    f.write(f"   - 📝 详情：{advice['details']}\n")
                    f.write(f"   - 📊 指标：{advice.get('metrics', 'N/A')}\n")
                    f.write(f"   - 🏷️ 类别：{advice['category']}\n\n")
            else:
                f.write("暂无具体建议（需要积累更多数据）\n\n")
        
        return report_file


def main():
    if len(sys.argv) < 2:
        print("用法：python3 activate-evolution.py <agent-id>")
        sys.exit(1)
    
    agent_id = sys.argv[1]
    config = Config(agent_id)
    
    print("╔══════════════════════════════════════════════╗")
    print("║  🧬 Evo-Cortex 自进化能力激活                ║")
    print("║  数据源: memory.db | 闭环: knowledge.db      ║")
    print("║  数据清洗: 过滤 session_scanner 垃圾          ║")
    print("╚══════════════════════════════════════════════╝")
    print()
    
    print("📌 步骤 1: 提取进化事件（过滤垃圾数据）...")
    extractor = EvolutionEventExtractor(config)
    events = extractor.extract_events(limit=100)
    print(f"   ✅ 提取到 {len(events)} 个高价值事件")
    
    if not events:
        print("⚠️  未找到足够的高价值事件")
        print("   提示：新 hook 生效后，对话会自动产生高质量数据")
        sys.exit(0)
    
    print("\n🔍 步骤 2: 识别模式...")
    recognizer = PatternRecognizer(config)
    patterns = recognizer.recognize_patterns(events)
    print(f"   ✅ 识别到 {len(patterns)} 个模式")
    
    print("\n📜 步骤 3: 生成元规则...")
    generator = MetaRuleGenerator(config)
    rules = generator.generate_rules(events, patterns)
    print(f"   ✅ 生成 {len(rules)} 条元规则")
    
    print("\n🔗 步骤 4: 写回知识图谱（knowledge.db）...")
    rule_writer = RuleWriter(config)
    rule_stats = rule_writer.write_rules(rules)
    print(f"   ✅ 规则写回: ➕{rule_stats['inserted']} 🔄{rule_stats['updated']} ⏭️{rule_stats['skipped']}")
    
    print("\n💡 步骤 5: 生成自我改进建议...")
    advisor = SelfImprovementAdvisor(config)
    advice_list = advisor.generate_advice(events, patterns, rules)
    print(f"   ✅ 生成 {len(advice_list)} 条建议")
    
    print("\n📄 步骤 6: 生成进化报告...")
    reporter = EvolutionReporter(config)
    report_file = reporter.generate_report(events, patterns, rules, rule_stats)
    print(f"   ✅ 报告已保存：{report_file}")
    
    print("\n" + "="*50)
    print("📊 进化摘要:")
    print("="*50)
    print(f"• 高价值事件：{len(events)} 个")
    print(f"• 识别模式：{len(patterns)} 个")
    print(f"• 元规则：{len(rules)} 条")
    print(f"• 规则写回：➕{rule_stats['inserted']} 🔄{rule_stats['updated']}")
    print(f"• 改进建议：{len(advice_list)} 条")
    print(f"• 报告文件：{report_file.name}")
    print()
    print("🎉 自进化能力已激活！元规则已写回知识图谱。")
    if advice_list:
        print("💡 查看报告中的自我改进建议，立即行动！")
    print("="*50)


if __name__ == '__main__':
    main()
