#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从记忆文件中提取用户偏好并添加到数据库（优化版）

用法：python3 extract_prefs_from_file.py <agent-id> <memory-file>
"""

import sys
import re
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from preferences_db import PreferencesDB

def clean_text(text: str) -> str:
    """清理文本噪音"""
    # 移除 Markdown 标记
    text = re.sub(r'\*\*|\*|`|~~', '', text)
    
    # 移除对话标记（分两次替换）
    text = re.sub(r'用户：\s*', '', text)
    text = re.sub(r'用户:\s*', '', text)
    text = re.sub(r'AI:\s*', '', text)
    
    # 移除列表标记和序号
    text = re.sub(r'^\s*[-•*]\s*', '', text, flags=re.MULTILINE)
    text = re.sub(r'^\s*\d+[\.、)\)]\s*', '', text, flags=re.MULTILINE)
    
    # 移除表情符号
    text = re.sub(r'[✅❌⏭️💡📊✨🔄🦞]', '', text)
    text = re.sub(r'→|=>', '', text)
    
    # 清理空格
    text = re.sub(r'\s+', ' ', text).strip()
    
    return text

def is_valid_dialogue(line: str) -> bool:
    """判断是否是有效的对话行"""
    line = line.strip()
    if not line: return False
    
    # 排除 Markdown 格式的行（已经是提取结果的）
    if line.startswith('- [ ]') or line.startswith('- [x]'):
        return False
    
    # 排除提取记录格式
    if '条 - "' in line or line.startswith('> ') or line.startswith('###'):
        return False
    
    if line.startswith('#'): return False
    if line.startswith('//') or line.startswith('<!--'): return False
    if re.match(r'^\d+\.\s*[✅❌]', line): return False
    if '测试目标' in line: return False
    if '预期提取' in line: return False
    if line.startswith('**时间') or line.startswith('**Agent'): return False
    if line.startswith('---') or line.startswith('==='): return False
    if line.startswith('```'): return False
    if len(line) < 3: return False
    if len(line) > 200: return False
    
    # 排除纯数字或符号
    if re.match(r'^[\d\s\-\.,]+$', line):
        return False
    
    return True

def extract_preferences(text: str):
    """从文本中提取偏好 - 使用简单字符串匹配避免正则问题"""
    lines = text.split('\n')
    found = []
    seen = set()
    
    for line in lines:
        if not is_valid_dialogue(line):
            continue
        
        cleaned = clean_text(line)
        if len(cleaned) < 5 or len(cleaned) > 150:
            continue
        
        category = None
        confidence = 0.7
        
        # 模式 1: 明确表达喜好（用字符串匹配代替正则）
        if '我喜欢' in cleaned or '我偏好' in cleaned or '我倾向于' in cleaned:
            category = "明确表达过的喜好"
            confidence = 0.8
        
        # 模式 2: 明确表达厌恶
        elif '我不喜欢' in cleaned or '我讨厌' in cleaned or '我避免' in cleaned or '我反感' in cleaned:
            category = "避免的回答方式"
            confidence = 0.85
        
        # 模式 3: 格式要求
        elif '请用' in cleaned or '不要用' in cleaned or '别用' in cleaned or '使用' in cleaned or '不用' in cleaned:
            category = "格式偏好"
            confidence = 0.75
        
        # 模式 4: 希望/期望
        elif '我希望' in cleaned or '我想要' in cleaned or '我需要' in cleaned:
            category = "待办事项"
            confidence = 0.7
        
        # 模式 5: 习惯/风格
        elif '我比较' in cleaned or '我通常' in cleaned or '我一般' in cleaned or '我经常' in cleaned:
            category = "个人习惯"
            confidence = 0.65
        
        if category:
            content_key = cleaned[:50]
            if content_key not in seen:
                seen.add(content_key)
                found.append((cleaned, category, confidence))
    
    return found

def main():
    if len(sys.argv) < 3:
        print("用法：python3 extract_prefs_from_file.py <agent-id> <memory-file>")
        sys.exit(1)
    
    agent_id = sys.argv[1]
    memory_file = sys.argv[2]
    
    with open(memory_file, 'r', encoding='utf-8') as f:
        content = f.read()
    
    lines = content.split('\n')
    recent_lines = lines[-50:] if len(lines) > 50 else lines
    recent_content = '\n'.join(recent_lines)
    
    prefs = extract_preferences(recent_content)
    filename = Path(memory_file).name
    
    if not prefs:
        print(f"  ⏭️  {filename}: 未发现新偏好")
        return
    
    print(f"  📄 {filename}:")
    
    db = PreferencesDB(agent_id)
    added = 0
    
    for text, category, confidence in prefs:
        # 二次过滤：排除明显的垃圾数据
        if text.startswith('- [ ]') or text.startswith('- [x]'):
            print(f"  ⏭️  跳过 Markdown 格式：{text[:50]}...")
            continue
        if '条 - "' in text or text.startswith('> '):
            print(f"  ⏭️  跳过提取记录：{text[:50]}...")
            continue
        if text.count('(') > 3 or text.count('pending') > 1:
            print(f"  ⏭️  跳过重复格式：{text[:50]}...")
            continue
        
        pref_id = db.add_preference(
            text=text,
            category=category,
            confidence=confidence,
            source=filename,
            metadata={'extraction_method': 'string_match'}
        )
        
        if pref_id > 0:
            display_text = text[:60] + "..." if len(text) > 60 else text
            print(f"    ✨ {display_text} ({category}, {int(confidence*100)}%)")
            added += 1
        else:
            print(f"    ⏭️  已存在：{text[:40]}...")
    
    db.close()
    
    if added > 0:
        print(f"\n  ✨ 本轮提取：{added} 条")

if __name__ == "__main__":
    main()
