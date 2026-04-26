#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
激活 Evo-Cortex 的自进化能力

功能:
1. 从 working_memory/session_messages 提取进化事件
2. 识别模式并生成元规则
3. 生成自我改进建议
4. 输出到 evolution/{agent_id}/ 目录

用法:
    python3 activate-evolution.py <agent-id>
"""

import sys
import json
import sqlite3
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
        self.db_path = self.data_dir / 'cortex.db'
        
        # 确保目录存在
        self.evolution_dir.mkdir(parents=True, exist_ok=True)


class EvolutionEventExtractor:
    """进化事件提取器"""
    
    EVENT_PATTERNS = {
        'breakthrough': ['发现', '找到', '解决', '成功', '完成', '突破'],
        'problem': ['问题', '错误', '失败', 'bug', '修复', '困难'],
        'lesson': ['学到', '明白', '理解', '经验', '教训', '心得'],
        'optimization': ['优化', '改进', '提升', '加速', '简化', '重构'],
        'decision': ['决定', '选择', '采用', '放弃', '优先', '策略']
    }
    
    def __init__(self, config: Config):
        self.config = config
    
    def extract_events(self, limit: int = 100, min_importance: float = 3.0) -> List[Dict]:
        """从 working_memory 提取进化事件（适配实际 schema）
        
        Args:
            limit: 最多提取的事件数量
            min_importance: 最低重要性评分（默认 3.0，积累更多数据）
        """
        if not self.config.db_path.exists():
            print(f"❌ 数据库不存在：{self.config.db_path}")
            return []
        
        conn = sqlite3.connect(self.config.db_path)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        
        # working_memory 没有 importance 列，用 message_count + content 长度计算
        cur.execute('''
            SELECT id, session_id, content, message_count, created_at
            FROM working_memory
            ORDER BY message_count DESC, length(content) DESC
            LIMIT ?
        ''', (limit,))
        
        events = []
        for row in cur.fetchall():
            memory = dict(row)
            # 计算动态 importance（message_count + content 长度）
            msg_count = memory.get('message_count', 1)
            content_len = len(memory.get('content', ''))
            importance = min(10.0, msg_count * 0.5 + content_len / 500.0)
            memory['importance'] = importance
            memory['tags'] = ''  # 由 _classify_event 生成
            
            if importance >= min_importance:
                event = self._classify_event(memory)
                if event:
                    events.append(event)
        
        conn.close()
        return events
    
    def _classify_event(self, memory: Dict) -> Optional[Dict]:
        """分类事件类型"""
        content = memory.get('content', '')
        
        for event_type, keywords in self.EVENT_PATTERNS.items():
            if any(kw in content for kw in keywords):
                return {
                    'type': event_type,
                    'content': content[:500],  # 限制长度
                    'importance': memory.get('importance'),
                    'tags': memory.get('tags', []),
                    'session_id': memory.get('session_id'),
                    'created_at': memory.get('created_at')
                }
        
        # 如果没有匹配，但重要性很高，也记录下来
        if memory.get('importance', 0) >= 8:
            return {
                'type': 'insight',
                'content': content[:500],
                'importance': memory.get('importance'),
                'tags': memory.get('tags', []),
                'session_id': memory.get('session_id'),
                'created_at': memory.get('created_at')
            }
        
        return None


class PatternRecognizer:
    """模式识别器"""
    
    def __init__(self, config: Config):
        self.config = config
    
    def recognize_patterns(self, events: List[Dict]) -> List[Dict]:
        """识别重复出现的模式
        
        降低阈值：出现 2 次就记录（原来是 3 次）
        """
        # 按类型统计
        type_counts = Counter(e['type'] for e in events)
        
        # 按标签统计
        tag_counts = Counter()
        for event in events:
            tags = event.get('tags', [])
            if isinstance(tags, str):
                tags = [t.strip() for t in tags.split(',')]
            tag_counts.update(tags)
        
        patterns = []
        
        # 高频事件类型（降低到 2 次）
        for event_type, count in type_counts.most_common(5):
            if count >= 2:  # 至少出现 2 次就记录
                patterns.append({
                    'pattern_type': 'recurring_event',
                    'description': f'{event_type} 类事件频繁出现 ({count}次)',
                    'frequency': count,
                    'suggestion': self._get_suggestion(event_type, count)
                })
        
        # 高频标签（降低到 2 次）
        for tag, count in tag_counts.most_common(5):
            if count >= 2 and tag:  # 至少出现 2 次就记录
                patterns.append({
                    'pattern_type': 'hot_topic',
                    'description': f'话题 "{tag}" 被频繁讨论 ({count}次)',
                    'frequency': count,
                    'suggestion': f'建议整理关于 "{tag}" 的知识文档'
                })
        
        return patterns
    
    def _get_suggestion(self, event_type: str, count: int) -> str:
        """根据事件类型生成建议"""
        suggestions = {
            'breakthrough': '继续保持这种高效状态！考虑记录突破的关键因素。',
            'problem': f'发现了{count}个问题，建议建立问题追踪系统，定期复盘。',
            'lesson': '学到了很多！建议将经验整理成可复用的方法论。',
            'optimization': '持续优化的态度很好！建议建立性能基线，量化改进效果。',
            'decision': '做了很多重要决策！建议记录决策依据和后续验证。',
            'insight': '有很多洞察！建议定期整理成文，形成知识资产。'
        }
        return suggestions.get(event_type, '继续保持关注和反思。')


class MetaRuleGenerator:
    """元规则生成器"""
    
    def __init__(self, config: Config):
        self.config = config
    
    def generate_rules(self, events: List[Dict], patterns: List[Dict]) -> List[Dict]:
        """从事件和模式中提炼元规则"""
        rules = []
        
        # 从高频问题生成规则
        problem_events = [e for e in events if e['type'] == 'problem']
        if len(problem_events) >= 3:
            rules.append({
                'rule_id': f'rule_{len(rules)+1}',
                'category': 'problem_prevention',
                'statement': '当遇到类似问题时，先检查常见原因清单',
                'rationale': f'从{len(problem_events)}个问题中总结',
                'confidence': min(0.9, 0.5 + len(problem_events) * 0.1),
                'examples': [e['content'][:100] for e in problem_events[:2]]
            })
        
        # 从成功经验生成规则
        breakthrough_events = [e for e in events if e['type'] == 'breakthrough']
        if len(breakthrough_events) >= 2:
            rules.append({
                'rule_id': f'rule_{len(rules)+1}',
                'category': 'success_pattern',
                'statement': '保持当前的工作方法，这是有效的',
                'rationale': f'从{len(breakthrough_events)}次成功突破中总结',
                'confidence': min(0.9, 0.6 + len(breakthrough_events) * 0.1),
                'examples': [e['content'][:100] for e in breakthrough_events[:2]]
            })
        
        # 从模式生成规则
        for pattern in patterns:
            if pattern['pattern_type'] == 'recurring_event':
                rules.append({
                    'rule_id': f'rule_{len(rules)+1}',
                    'category': 'awareness',
                    'statement': f'注意：{pattern["description"]}',
                    'rationale': '模式识别自动发现',
                    'confidence': 0.7,
                    'action': pattern['suggestion']
                })
        
        return rules


class SelfImprovementAdvisor:
    """自我改进建议生成器"""
    
    def __init__(self, config: Config):
        self.config = config
    
    def generate_advice(self, events: List[Dict], patterns: List[Dict], rules: List[Dict]) -> List[Dict]:
        """基于进化数据生成自我改进建议"""
        advice_list = []
        
        # 从高频问题生成改进行动
        problem_events = [e for e in events if e['type'] == 'problem']
        if len(problem_events) >= 2:
            advice_list.append({
                'category': 'problem_prevention',
                'priority': 'high',
                'action': '建立问题追踪清单',
                'details': f'发现{len(problem_events)}个类似问题，建议创建 checkList 避免重复犯错',
                'metrics': '问题复发率降低 50%'
            })
        
        # 从成功经验生成强化建议
        breakthrough_events = [e for e in events if e['type'] == 'breakthrough']
        if len(breakthrough_events) >= 2:
            advice_list.append({
                'category': 'success_reinforcement',
                'priority': 'medium',
                'action': '记录成功模式',
                'details': f'{len(breakthrough_events)}次成功突破，建议总结关键因素并标准化',
                'metrics': '成功率提升 30%'
            })
        
        # 从热点话题生成学习建议
        hot_topics = [p for p in patterns if p['pattern_type'] == 'hot_topic']
        for topic in hot_topics[:3]:  # 最多 3 个
            # 提取话题名称（简化处理）
            topic_name = topic['description'].split(' ')[1] if ' ' in topic['description'] else '该话题'
            advice_list.append({
                'category': 'knowledge_building',
                'priority': 'medium',
                'action': f'整理"{topic_name}"主题知识',
                'details': topic['suggestion'],
                'metrics': '建立该主题的知识树'
            })
        
        # 从元规则生成执行建议
        if rules:
            advice_list.append({
                'category': 'rule_implementation',
                'priority': 'high',
                'action': '应用新生成的元规则',
                'details': f'本月生成{len(rules)}条元规则，建议在下次对话中主动应用',
                'metrics': '元规则应用率 >= 80%'
            })
        
        # 添加通用建议
        if len(events) >= 10:
            advice_list.append({
                'category': 'review_rhythm',
                'priority': 'low',
                'action': '建立定期 review 机制',
                'details': '已积累足够数据，建议每周 review 一次进化报告',
                'metrics': '每周固定时间 review'
            })
        
        return advice_list


class EvolutionReporter:
    """进化报告生成器"""
    
    def __init__(self, config: Config):
        self.config = config
    
    def generate_report(self, events: List[Dict], patterns: List[Dict], rules: List[Dict]):
        """生成完整的进化报告（包含自我改进建议）"""
        timestamp = datetime.now().strftime('%Y-%m-%d_%H%M%S')
        report_file = self.config.evolution_dir / f'evolution-report-{timestamp}.md'
        
        # 生成自我改进建议
        advisor = SelfImprovementAdvisor(self.config)
        advice_list = advisor.generate_advice(events, patterns, rules)
        
        with open(report_file, 'w', encoding='utf-8') as f:
            f.write(f"# 🧬 Evo-Cortex 自进化报告\n\n")
            f.write(f"**生成时间**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
            f.write(f"**Agent**: {self.config.agent_id}\n\n")
            
            # 进化事件摘要
            f.write("## 📌 进化事件摘要\n\n")
            f.write(f"共提取 **{len(events)}** 个高价值事件\n\n")
            
            by_type = Counter(e['type'] for e in events)
            for event_type, count in by_type.most_common():
                emoji = {'breakthrough': '🎉', 'problem': '⚠️', 'lesson': '💡', 
                        'optimization': '⚡', 'decision': '🎯', 'insight': '✨'}.get(event_type, '📋')
                f.write(f"- {emoji} **{event_type}**: {count} 个\n")
            f.write("\n---\n\n")
            
            # 识别的模式
            f.write("## 🔍 识别的模式\n\n")
            if patterns:
                for i, pattern in enumerate(patterns, 1):
                    f.write(f"{i}. **{pattern['description']}**\n")
                    f.write(f"   - 💡 建议：{pattern['suggestion']}\n\n")
            else:
                f.write("暂无明显模式（数据量不足）\n\n")
            f.write("---\n\n")
            
            # 生成的元规则
            f.write("## 📜 生成的元规则\n\n")
            if rules:
                for rule in rules:
                    f.write(f"### {rule['rule_id']}: {rule['category']}\n\n")
                    f.write(f"**内容**: {rule['statement']}\n\n")
                    f.write(f"**依据**: {rule['rationale']}\n\n")
                    f.write(f"**置信度**: {rule['confidence']:.0%}\n\n")
                    if 'action' in rule:
                        f.write(f"**行动**: {rule['action']}\n\n")
                    if 'examples' in rule:
                        f.write("**示例**:\n")
                        for ex in rule['examples']:
                            f.write(f"- {ex}...\n")
                    f.write("\n")
            else:
                f.write("暂无元规则生成（需要更多高质量事件）\n\n")
            f.write("---\n\n")
            
            # 自我改进建议（新增）
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
            f.write("---\n\n")
            
            # 下一步行动
            f.write("## 🚀 下一步行动建议\n\n")
            high_priority = [p for p in patterns if p.get('frequency', 0) >= 5]
            if high_priority:
                f.write("### 高优先级\n\n")
                for p in high_priority[:3]:
                    f.write(f"- [ ] {p['suggestion']}\n")
                f.write("\n")
            
            f.write("### 持续进行\n\n")
            f.write("- [ ] 继续记录高质量会话\n")
            f.write("- [ ] 定期review进化报告\n")
            f.write("- [ ] 将元规则应用到实际对话中\n")
        
        return report_file


def main():
    """主函数"""
    if len(sys.argv) < 2:
        print("用法：python3 activate-evolution.py <agent-id>")
        sys.exit(1)
    
    agent_id = sys.argv[1]
    config = Config(agent_id)
    
    print("╔══════════════════════════════════════════════╗")
    print("║  🧬 Evo-Cortex 自进化能力激活                ║")
    print("╚══════════════════════════════════════════════╝")
    print()
    
    # 1. 提取进化事件
    print("📌 步骤 1: 提取进化事件...")
    extractor = EvolutionEventExtractor(config)
    events = extractor.extract_events(limit=100)
    print(f"   ✅ 提取到 {len(events)} 个高价值事件")
    
    if not events:
        print("⚠️  未找到足够的高价值事件（需要 importance >= 7）")
        print("   提示：先运行几次 session-scan 积累数据")
        sys.exit(0)
    
    # 2. 识别模式
    print("\n🔍 步骤 2: 识别模式...")
    recognizer = PatternRecognizer(config)
    patterns = recognizer.recognize_patterns(events)
    print(f"   ✅ 识别到 {len(patterns)} 个模式")
    
    # 3. 生成元规则
    print("\n📜 步骤 3: 生成元规则...")
    generator = MetaRuleGenerator(config)
    rules = generator.generate_rules(events, patterns)
    print(f"   ✅ 生成 {len(rules)} 条元规则")
    
    # 4. 生成自我改进建议（新增）
    print("\n💡 步骤 4: 生成自我改进建议...")
    advisor = SelfImprovementAdvisor(config)
    advice_list = advisor.generate_advice(events, patterns, rules)
    print(f"   ✅ 生成 {len(advice_list)} 条建议")
    
    # 5. 生成报告
    print("\n📄 步骤 5: 生成进化报告...")
    reporter = EvolutionReporter(config)
    report_file = reporter.generate_report(events, patterns, rules)
    print(f"   ✅ 报告已保存：{report_file}")
    
    # 6. 显示摘要
    print("\n" + "="*50)
    print("📊 进化摘要:")
    print("="*50)
    print(f"• 高价值事件：{len(events)} 个")
    print(f"• 识别模式：{len(patterns)} 个")
    print(f"• 元规则：{len(rules)} 条")
    print(f"• 改进建议：{len(advice_list)} 条")
    print(f"• 报告文件：{report_file.name}")
    print()
    print("🎉 自进化能力已激活！")
    if advice_list:
        print("💡 查看报告中的自我改进建议，立即行动！")
    print("="*50)


if __name__ == '__main__':
    main()
