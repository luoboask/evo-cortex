#!/bin/bash
# =============================================================================
# Evo-Cortex Knowledge Graph Auto-Updater
# 功能：从记忆文件中自动提取新实体和关系，更新知识图谱
# 用法：bash kg-auto-update.sh <agent-id>
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
KG_DIR="$WORKSPACE/knowledge/$AGENT_ID"
ENTITIES_FILE="$KG_DIR/entities.json"
RELATIONSHIPS_FILE="$KG_DIR/relationships.json"
BACKUP_DIR="$KG_DIR/backup"

echo "╔════════════════════════════════════════════════════════╗"
echo "║  🧠 Evo-Cortex Knowledge Graph Auto-Updater            ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""
echo "📦 Agent: $AGENT_ID"
echo "📁 Workspace: $WORKSPACE"
echo ""

# 确保目录存在
mkdir -p "$BACKUP_DIR"

# 检查知识图谱文件是否存在
if [ ! -f "$ENTITIES_FILE" ]; then
  echo "⚠️  知识图谱文件不存在，创建初始结构..."
  cat > "$ENTITIES_FILE" << 'EOF'
{
  "entities": [],
  "metadata": {
    "createdAt": "2026-04-21",
    "lastUpdated": "2026-04-21",
    "version": "1.0.0"
  }
}
EOF
fi

if [ ! -f "$RELATIONSHIPS_FILE" ]; then
  echo "⚠️  关系文件不存在，创建初始结构..."
  cat > "$RELATIONSHIPS_FILE" << 'EOF'
{
  "relationships": [],
  "metadata": {
    "createdAt": "2026-04-21",
    "lastUpdated": "2026-04-21",
    "version": "1.0.0"
  }
}
EOF
fi

# 备份当前文件
echo "📦 备份当前知识图谱..."
cp "$ENTITIES_FILE" "$BACKUP_DIR/entities.json.$(date +%Y-%m-%d-%H%M).backup"
cp "$RELATIONSHIPS_FILE" "$BACKUP_DIR/relationships.json.$(date +%Y-%m-%d-%H%M).backup"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "1️⃣  扫描记忆文件，提取候选实体"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 获取最近 3 天的记忆文件
TEMP_FILE=$(mktemp)
for f in "$MEMORY_DIR"/*.md "$MEMORY_DIR"/**/*.md; do
  if [ -f "$f" ]; then
    FILE_DATE=$(stat -f "%Sm" -t "%Y-%m-%d" "$f" 2>/dev/null || stat -c "%y" "$f" 2>/dev/null | cut -d' ' -f1)
    THREE_DAYS_AGO=$(date -v-3d +%Y-%m-%d 2>/dev/null || date -d "3 days ago" +%Y-%m-%d)
    if [ "$FILE_DATE" \>= "$THREE_DAYS_AGO" ]; then
      cat "$f" >> "$TEMP_FILE"
      echo "  📄 $(basename "$f")"
    fi
  fi
done

echo ""
echo "正在提取技术术语和概念..."

# 提取候选实体（技术术语、项目名、工具名等）
# 模式：大写字母开头的单词、带连字符的术语、常见技术后缀
CANDIDATES=$(cat "$TEMP_FILE" | \
  grep -oE '\b[A-Z][a-zA-Z0-9_-]{2,}\b|\b[a-z]+-[a-z]+\b|\b[a-z]+\.(js|ts|tsx|jsx|py|sh|sql|md)\b' | \
  grep -vE '^(The|And|For|With|From|That|This|Have|Been|Were|Are|Was|Will|Would|Could|Should|Can|May|Might|Must|Shall|Need|Dare|Ought|Used|Let|Say|Said|Get|Got|Make|Made|Go|Went|Come|Came|Take|Took|See|Saw|Know|Knew|Think|Thought|Want|Like|Love|Just|Very|Really|Also|Only|Even|Well|Back|After|Before|Again|Never|Always|Often|Sometimes|Usually|Already|Still|Yet|Then|When|Where|Why|How|What|Which|Who|Whom|Whose|Into|Over|Such|Some|Any|Each|All|Both|Few|Many|Much|No|Yes|Not|But|Or|Nor|So|If|In|On|At|To|Of|By|As|Is|It|Its|He|She|They|Them|Their|His|Her|We|Us|Our|You|Your|I|My|Me|A|An|Memory|Session|Daily|Weekly|Monthly|File|Report|Test|Data|Code|Agent|Plugin|System|Task|Cron|Mode|Script|Index|Scan|Analysis|Learning|Review|Compress|Expansion|Cycle|Fractal|Active|Realtime|Knowledge|Graph|Entity|Relationship|Backup|Archive|Summary|Snippet|Library|Extractor|Enhanced|Auto|Update)$' | \
  sort | uniq -c | sort -rn | head -50)

echo ""
echo "Top 候选实体:"
echo "$CANDIDATES" | while read count word; do
  printf "  %-40s %d\n" "$word" "$count"
done

# 保存候选列表供后续处理
CANDIDATES_FILE="$WORKSPACE/data/candidate_entities.txt"
mkdir -p "$(dirname "$CANDIDATES_FILE")"
echo "$CANDIDATES" > "$CANDIDATES_FILE"

echo ""
echo "✅ 已提取 $(echo "$CANDIDATES" | wc -l | tr -d ' ') 个候选实体"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "2️⃣  过滤已有实体，识别新实体"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 读取已有实体名称
EXISTING_ENTITIES=$(cat "$ENTITIES_FILE" | grep -o '"name"[[:space:]]*:[[:space:]]*"[^"]*"' | cut -d'"' -f4 | sort -u)

echo "已有实体数量: $(echo "$EXISTING_ENTITIES" | grep -c . || echo 0)"

# 找出新实体
NEW_ENTITIES=""
while read count word; do
  if [ -n "$word" ]; then
    # 检查是否已存在
    if ! echo "$EXISTING_ENTITIES" | grep -q "^${word}$"; then
      # 只保留出现次数>=2 的候选（减少噪音）
      if [ "$count" -ge 2 ]; then
        NEW_ENTITIES="$NEW_ENTITIES$word ($count)\n"
        echo "  ✨ 新实体候选：$word (出现 $count 次)"
      fi
    fi
  fi
done <<< "$CANDIDATES"

if [ -z "$NEW_ENTITIES" ]; then
  echo "ℹ️  没有发现符合条件的新实体"
else
  echo ""
  echo "✅ 发现 $(echo -e "$NEW_ENTITIES" | grep -c . || echo 0) 个新实体候选"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "3️⃣  自动添加高置信度实体"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 定义实体类型映射（基于关键词）
get_entity_type() {
  local name="$1"
  case "$name" in
    *Management|*Tracking|*Compression|*Analysis|*Scheduler|*Limiting|*Resolution|*Fallback)
      echo "concept"
      ;;
    *Debugging|*Verification|*Mode|*Review|*Testing|*Deployment)
      echo "technique"
      ;;
    *Cache|*Storage|*Database|*Index|*Memory)
      echo "system"
      ;;
    *Pattern|*Strategy|*Approach|*Method)
      echo "pattern"
      ;;
    *Problem|*Issue|*Bug|*Error|*Challenge)
      echo "issue"
      ;;
    *Tool|*Framework|*Library|*Platform|*Service)
      echo "tool"
      ;;
    *)
      echo "concept"
      ;;
  esac
}

# 自动添加出现次数>=5 的高置信度实体
ADDED_COUNT=0
while read count word; do
  if [ -n "$word" ] && [ "$count" -ge 5 ]; then
    # 检查是否已存在
    if ! echo "$EXISTING_ENTITIES" | grep -q "^${word}$"; then
      TYPE=$(get_entity_type "$word")
      echo "  ➕ 添加实体：$word (类型：$TYPE, 频次：$count)"
      
      # 使用 Node.js 或 Python 更新 JSON（如果可用）
      if command -v node &> /dev/null; then
        node -e "
          const fs = require('fs');
          const file = '$ENTITIES_FILE';
          const data = JSON.parse(fs.readFileSync(file, 'utf8'));
          
          // 检查是否已存在
          const exists = data.entities.some(e => e.name === '$word');
          if (!exists) {
            data.entities.push({
              id: 'e' + (data.entities.length + 1),
              name: '$word',
              type: '$TYPE',
              properties: {
                frequency: $count,
                source: 'auto-extract',
                confidence: 'high'
              },
              createdAt: new Date().toISOString().split('T')[0],
              updatedAt: new Date().toISOString().split('T')[0]
            });
            
            data.metadata.lastUpdated = new Date().toISOString().split('T')[0];
            fs.writeFileSync(file, JSON.stringify(data, null, 2));
            console.log('✅ Added: $word');
          }
        " 2>/dev/null && ADDED_COUNT=$((ADDED_COUNT + 1))
      else
        # 如果没有 node，使用简单的 sed 方法（功能有限）
        echo "  ⚠️  Node.js 不可用，跳过自动添加"
      fi
    fi
  fi
done <<< "$CANDIDATES"

echo ""
echo "✅ 自动添加了 $ADDED_COUNT 个高置信度实体"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "4️⃣  生成实体关系建议"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 简单的共现分析：如果两个实体经常在同一段落出现，可能存在关系
echo "分析实体共现关系..."

# 这里简化处理，实际应该更复杂
# 暂时只添加一些预设的关系类型
RELATION_SUGGESTIONS=""

# 示例：如果同时有 "Webhook" 和 "Debugging"，建议建立关系
if echo "$CANDIDATES" | grep -q "Webhook" && echo "$CANDIDATES" | grep -q "Debugging"; then
  RELATION_SUGGESTIONS="$RELATION_SUGGESTIONS\n- Webhook → related_to → Debugging"
fi

if echo "$CANDIDATES" | grep -q "Service" && echo "$CANDIDATES" | grep -q "Worker"; then
  RELATION_SUGGESTIONS="$RELATION_SUGGESTIONS\n- Service Worker → implements → Caching"
fi

if echo "$CANDIDATES" | grep -q "Offline" && echo "$CANDIDATES" | grep -q "Mode"; then
  RELATION_SUGGESTIONS="$RELATION_SUGGESTIONS\n- Offline Mode → depends_on → Service Worker"
fi

if [ -n "$RELATION_SUGGESTIONS" ]; then
  echo "建议添加的关系:"
  echo -e "$RELATION_SUGGESTIONS"
else
  echo "ℹ️  暂无关系建议（需要更多数据）"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "5️⃣  生成更新报告"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

REPORT_FILE="$WORKSPACE/evolution/kg-update-$(date +%Y-%m-%d-%H%M).md"
mkdir -p "$(dirname "$REPORT_FILE")"

cat > "$REPORT_FILE" << REPORT_EOF
# 🧠 知识图谱自动更新报告

**生成时间**: $(date '+%Y-%m-%d %H:%M:%S')  
**分析时段**: 最近 3 天  
**Agent**: $AGENT_ID

---

## 📊 更新摘要

| 指标 | 数值 |
|------|------|
| 扫描文件数 | $(ls "$MEMORY_DIR"/*.md 2>/dev/null | wc -l | tr -d ' ') |
| 候选实体数 | $(echo "$CANDIDATES" | wc -l | tr -d ' ') |
| 新实体候选 | $(echo -e "$NEW_ENTITIES" | grep -c . || echo 0) |
| 自动添加实体 | $ADDED_COUNT |
| 关系建议 | $(echo -e "$RELATION_SUGGESTIONS" | grep -c . || echo 0) |

---

## ✨ 新增实体

$(if [ -n "$NEW_ENTITIES" ]; then echo -e "$NEW_ENTITIES"; else echo "_无新实体_"; fi)

---

## 🔗 关系建议

$(if [ -n "$RELATION_SUGGESTIONS" ]; then echo -e "$RELATION_SUGGESTIONS"; else echo "_无关系建议_"; fi)

---

## 📈 当前知识图谱状态

**实体总数**: $(cat "$ENTITIES_FILE" | grep -c '"id"' || echo 0)  
**最后更新**: $(date '+%Y-%m-%d')

---

## 💡 建议操作

1. **审查新实体**: 检查自动添加的实体是否准确
2. **手动添加关系**: 根据关系建议建立实体连接
3. **定期运行**: 建议每天或每周运行一次此脚本

---

**说明**: 
- 自动添加标准：出现频次 ≥ 5 次
- 实体类型基于命名模式自动判断
- 关系建议基于共现分析（简化版）
REPORT_EOF

echo "✅ 更新报告已生成：$REPORT_FILE"

# 清理临时文件
rm -f "$TEMP_FILE"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✨ 知识图谱自动更新完成！"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "生成的文件:"
echo "  📄 更新报告：$REPORT_FILE"
echo "  📄 候选列表：$CANDIDATES_FILE"
echo "  💾 备份文件：$BACKUP_DIR/"
echo ""
echo "统计结果:"
echo "  扫描文件：$(ls "$MEMORY_DIR"/*.md 2>/dev/null | wc -l | tr -d ' ') 个"
echo "  候选实体：$(echo "$CANDIDATES" | wc -l | tr -d ' ') 个"
echo "  新实体候选：$(echo -e "$NEW_ENTITIES" | grep -c . || echo 0) 个"
echo "  自动添加：$ADDED_COUNT 个"
echo ""
echo "🦞 知识图谱已更新！"
