#!/bin/bash
# =============================================================================
# Evo-Cortex Active Learning (Enhanced)
# 功能：词频分析 + 用户偏好提取 + 待办事项识别
# 用法：bash active-learning-enhanced.sh <agent-id>
# =============================================================================

set -e

AGENT_ID="${1:-}"
if [ -z "$AGENT_ID" ]; then
  echo "❌ 错误：请提供 agent-id"
  echo "用法：$0 <agent-id>"
  exit 1
fi

WORKSPACE="$HOME/.openclaw/workspace-$AGENT_ID"
MEMORY_DIR="$WORKSPACE/memory"
PREFERENCES_FILE="$WORKSPACE/USER_PREFERENCES.md"
ACTION_ITEMS_FILE="$WORKSPACE/action-items.md"
OUTPUT_DIR="$WORKSPACE/evolution"

# 确保输出目录存在
mkdir -p "$OUTPUT_DIR"

echo "╔════════════════════════════════════════════════════════╗"
echo "║  🧠 Evo-Cortex Active Learning (Enhanced)              ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""
echo "📦 Agent: $AGENT_ID"
echo "📁 Workspace: $WORKSPACE"
echo ""

# =============================================================================
# 功能 1: 词频分析（原有功能）
# =============================================================================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "1️⃣  词频分析"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 获取最近 24 小时的记忆文件
YESTERDAY=$(date -v-1d +%Y-%m-%d 2>/dev/null || date -d "yesterday" +%Y-%m-%d)
TODAY=$(date +%Y-%m-%d)

echo "分析时间段：$YESTERDAY ~ $TODAY"
echo ""

# 合并所有记忆文件内容进行分析
TEMP_FILE=$(mktemp)
for f in "$MEMORY_DIR"/*.md "$MEMORY_DIR"/**/*.md; do
  if [ -f "$f" ]; then
    # 只分析最近 2 天的文件
    FILE_DATE=$(stat -f "%Sm" -t "%Y-%m-%d" "$f" 2>/dev/null || stat -c "%y" "$f" 2>/dev/null | cut -d' ' -f1)
    if [[ "$FILE_DATE" >= "$YESTERDAY" ]]; then
      cat "$f" >> "$TEMP_FILE"
      echo "  📄 $(basename "$f")"
    fi
  fi
done

echo ""
echo "正在分析词频..."

# 提取关键词（简单的词频统计）
WORD_FREQ=$(cat "$TEMP_FILE" | \
  grep -oE '\b[A-Za-z][A-Za-z0-9_-]{2,}\b' | \
  grep -vE '^(the|and|for|with|from|that|this|have|been|were|are|was|will|would|could|should|can|may|might|must|shall|need|dare|ought|used|let|say|said|get|got|make|made|go|went|come|came|take|took|see|saw|know|knew|think|thought|want|wanting|like|likes|liked|love|loves|loved|just|very|really|also|only|even|well|back|after|before|again|never|always|often|sometimes|usually|already|still|yet|then|when|where|why|how|what|which|who|whom|whose|into|over|such|some|any|each|all|both|few|many|much|no|yes|not|but|or|nor|so|if|in|on|at|to|of|by|as|is|it|its|he|she|they|them|their|his|her|we|us|our|you|your|i|my|me|a|an)$' | \
  sort | uniq -c | sort -rn | head -30)

echo ""
echo "Top 30 词频:"
echo "$WORD_FREQ" | while read count word; do
  printf "  %-30s %d\n" "$word" "$count"
done

# 保存词频报告
REPORT_FILE="$OUTPUT_DIR/active-learning-$(date +%Y-%m-%d-%H%M).md"
cat > "$REPORT_FILE" << EOF
# 📊 Active Learning Report

**生成时间**: $(date '+%Y-%m-%d %H:%M:%S')  
**分析时段**: $YESTERDAY ~ $TODAY

## Top 30 词频

\`\`\`
$WORD_FREQ
\`\`\`

## 洞察

<!-- 系统自动生成的洞察 -->
EOF

echo ""
echo "✅ 词频报告已保存：$REPORT_FILE"

# =============================================================================
# 功能 2: 用户偏好提取（新增功能）
# =============================================================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "2️⃣  用户偏好提取"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ ! -f "$PREFERENCES_FILE" ]; then
  echo "⚠️  未找到 USER_PREFERENCES.md，跳过偏好提取"
else
  echo "📄 读取偏好文件：$PREFERENCES_FILE"
  
  # 搜索偏好相关的表达
  echo ""
  echo "扫描偏好相关表达..."
  
  # 提取"我喜欢"、"我不喜欢"、"我偏好"等模式
  PREFERENCES_FOUND=""
  
  # 搜索中文偏好表达
  while IFS= read -r line; do
    if [ -n "$line" ]; then
      echo "  💡 发现偏好：$line"
      PREFERENCES_FOUND="$PREFERENCES_FOUND\n- $line"
    fi
  done < <(grep -hE "(我喜欢 | 我不喜欢 | 我偏好 | 我希望 | 我想要 | 我讨厌 | 我讨厌)" "$TEMP_FILE" 2>/dev/null | head -5 || true)
  
  # 搜索英文偏好表达
  while IFS= read -r line; do
    if [ -n "$line" ]; then
      echo "  💡 Found preference: $line"
      PREFERENCES_FOUND="$PREFERENCES_FOUND\n- $line"
    fi
  done < <(grep -hE "(I prefer|I like|I love|I don't like|I hate|I want|I need)" "$TEMP_FILE" 2>/dev/null | head -5 || true)
  
  if [ -n "$PREFERENCES_FOUND" ]; then
    echo ""
    echo "✅ 发现新的偏好表达，准备更新偏好文件..."
    
    # 添加到偏好文件的"自动提取的偏好"部分
    TEMP_PREF=$(mktemp)
    cat "$PREFERENCES_FILE" > "$TEMP_PREF"
    
    # 查找"### 最近提及的需求"部分并添加新内容
    if grep -q "### 最近提及的需求" "$PREFERENCES_FILE"; then
      # 在已有部分后添加
      sed -i.bak "/### 最近提及的需求/a\\
- $(date '+%Y-%m-%d'):$(echo -e "$PREFERENCES_FOUND" | head -3)" "$PREFERENCES_FILE"
    else
      echo "" >> "$PREFERENCES_FILE"
      echo "### 最近提及的需求" >> "$PREFERENCES_FILE"
      echo "- $(date '+%Y-%m-%d'):$(echo -e "$PREFERENCES_FOUND" | head -3)" >> "$PREFERENCES_FILE"
    fi
    
    rm -f "${PREFERENCES_FILE}.bak"
    echo "✅ 偏好文件已更新"
  else
    echo "ℹ️  未发现新的偏好表达"
  fi
fi

# =============================================================================
# 功能 3: 待办事项识别（新增功能）
# =============================================================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "3️⃣  待办事项识别"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

echo "扫描待办事项..."

# 提取待办相关的表达
TODO_FOUND=""

# 搜索中文待办表达
while IFS= read -r line; do
  if [ -n "$line" ]; then
    echo "  📌 发现待办：$line"
    TODO_FOUND="$TODO_FOUND\n- [ ] $line (来源：$(date '+%Y-%m-%d'))"
  fi
done < <(grep -hE "(我要 | 我需要 | 记得 | 稍后 | 晚点 | 下周 | 明天 | 待会 | 等一下)" "$TEMP_FILE" 2>/dev/null | grep -vE "^(#|\*|-)" | head -5 || true)

# 搜索英文待办表达
while IFS= read -r line; do
  if [ -n "$line" ]; then
    echo "  📌 Found TODO: $line"
    TODO_FOUND="$TODO_FOUND\n- [ ] $line (Source: $(date '+%Y-%m-%d'))"
  fi
done < <(grep -hE "(I need to|I should|I will|I'll|Remember to|Don't forget)" "$TEMP_FILE" 2>/dev/null | grep -vE "^(#|\*|-)" | head -5 || true)

if [ -n "$TODO_FOUND" ]; then
  echo ""
  echo "✅ 发现新的待办事项，更新待办文件..."
  
  # 创建或更新待办文件
  if [ ! -f "$ACTION_ITEMS_FILE" ]; then
    cat > "$ACTION_ITEMS_FILE" << 'TODO_HEADER'
# 📋 待办事项追踪

> 此文件由 Evo-Cortex 自动维护，记录对话中提取的待办事项。
> 系统会定期检查是否有逾期或已完成的待办。

**最后更新**: $(date '+%Y-%m-%d')

---

## 待办列表

TODO_HEADER
  fi
  
  # 添加新待办
  echo -e "\n### $(date '+%Y-%m-%d') 新增\n$TODO_FOUND" >> "$ACTION_ITEMS_FILE"
  
  echo "✅ 待办文件已更新：$ACTION_ITEMS_FILE"
else
  echo "ℹ️  未发现新的待办事项"
fi

# =============================================================================
# 清理
# =============================================================================
rm -f "$TEMP_FILE"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✨ Active Learning 完成！"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "生成的文件:"
echo "  📄 词频报告：$REPORT_FILE"
if [ -f "$PREFERENCES_FILE" ]; then
  echo "  📄 偏好文件：$PREFERENCES_FILE"
fi
if [ -f "$ACTION_ITEMS_FILE" ]; then
  echo "  📄 待办文件：$ACTION_ITEMS_FILE"
fi

echo ""
echo "🦞 学习完成！"
