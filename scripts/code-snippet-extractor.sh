#!/bin/bash
# =============================================================================
# Evo-Cortex Code Snippet Extractor (简化版)
# 功能：从记忆文件中提取代码块，组织成可复用的代码库
# 用法：bash code-snippet-extractor.sh <agent-id>
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
SNIPPETS_DIR="$WORKSPACE/code-snippets"
INDEX_FILE="$SNIPPETS_DIR/INDEX.md"

echo "╔════════════════════════════════════════════════════════╗"
echo "║  💻 Evo-Cortex Code Snippet Extractor                  ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""
echo "📦 Agent: $AGENT_ID"
echo "📁 Workspace: $WORKSPACE"
echo ""

# 创建代码片段目录结构
mkdir -p "$SNIPPETS_DIR/typescript"
mkdir -p "$SNIPPETS_DIR/javascript"
mkdir -p "$SNIPPETS_DIR/bash"
mkdir -p "$SNIPPETS_DIR/sql"
mkdir -p "$SNIPPETS_DIR/python"
mkdir -p "$SNIPPETS_DIR/other"

echo "✅ 已创建代码片段目录结构"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "扫描记忆文件中的代码块..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

SNIPPET_COUNT=0

# 遍历所有记忆文件
for memory_file in "$MEMORY_DIR"/*.md "$MEMORY_DIR"/**/*.md; do
  if [ ! -f "$memory_file" ]; then
    continue
  fi
  
  FILE_NAME=$(basename "$memory_file")
  BASE_NAME=$(basename "$memory_file" .md)
  SAFE_NAME=$(echo "$BASE_NAME" | sed 's/[^A-Za-z0-9_-]/_/g')
  
  echo "📄 处理文件：$FILE_NAME"
  
  # 使用简单的状态机方法提取代码块
  IN_CODE=0
  CODE_LANG=""
  CODE_CONTENT=""
  SNIPPET_NUM=0
  
  while IFS= read -r line || [[ -n "$line" ]]; do
    # 检查是否是代码块开始
    if [[ "$line" =~ ^\`\`\`([a-zA-Z]*) ]]; then
      if [ $IN_CODE -eq 0 ]; then
        # 开始新代码块
        IN_CODE=1
        CODE_LANG="${BASH_REMATCH[1]}"
        if [ -z "$CODE_LANG" ]; then
          CODE_LANG="text"
        fi
        CODE_CONTENT=""
        SNIPPET_NUM=$((SNIPPET_NUM + 1))
      else
        # 结束代码块
        IN_CODE=0
        
        # 只保存至少有 20 字符的代码
        if [ ${#CODE_CONTENT} -gt 20 ]; then
          # 根据语言确定目标目录
          case "$CODE_LANG" in
            typescript|ts|tsx)
              TARGET_DIR="$SNIPPETS_DIR/typescript"
              EXT="ts"
              ;;
            javascript|js|jsx)
              TARGET_DIR="$SNIPPETS_DIR/javascript"
              EXT="js"
              ;;
            bash|sh|shell|zsh)
              TARGET_DIR="$SNIPPETS_DIR/bash"
              EXT="sh"
              ;;
            sql)
              TARGET_DIR="$SNIPPETS_DIR/sql"
              EXT="sql"
              ;;
            python|py)
              TARGET_DIR="$SNIPPETS_DIR/python"
              EXT="py"
              ;;
            *)
              TARGET_DIR="$SNIPPETS_DIR/other"
              EXT="txt"
              ;;
          esac
          
          # 写入代码文件
          OUTPUT_FILE="$TARGET_DIR/${SAFE_NAME}_snippet${SNIPPET_NUM}.${EXT}"
          echo "$CODE_CONTENT" > "$OUTPUT_FILE"
          echo "  ✅ 提取：$(basename "$OUTPUT_FILE") ($CODE_LANG)"
          SNIPPET_COUNT=$((SNIPPET_COUNT + 1))
        fi
        
        CODE_LANG=""
        CODE_CONTENT=""
      fi
    elif [ $IN_CODE -eq 1 ]; then
      # 累积代码内容
      CODE_CONTENT="$CODE_CONTENT$line"$'\n'
    fi
  done < "$memory_file"
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "生成索引文件"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 统计各语言的代码块数量
TS_COUNT=$(find "$SNIPPETS_DIR/typescript" -name "*.ts" 2>/dev/null | wc -l | tr -d ' ')
JS_COUNT=$(find "$SNIPPETS_DIR/javascript" -name "*.js" 2>/dev/null | wc -l | tr -d ' ')
BASH_COUNT=$(find "$SNIPPETS_DIR/bash" -name "*.sh" 2>/dev/null | wc -l | tr -d ' ')
SQL_COUNT=$(find "$SNIPPETS_DIR/sql" -name "*.sql" 2>/dev/null | wc -l | tr -d ' ')
PY_COUNT=$(find "$SNIPPETS_DIR/python" -name "*.py" 2>/dev/null | wc -l | tr -d ' ')
OTHER_COUNT=$(find "$SNIPPETS_DIR/other" -name "*.txt" 2>/dev/null | wc -l | tr -d ' ')
TOTAL_COUNT=$((TS_COUNT + JS_COUNT + BASH_COUNT + SQL_COUNT + PY_COUNT + OTHER_COUNT))

# 创建索引文件
cat > "$INDEX_FILE" << INDEX_HEADER
# 📚 代码片段库

> 此代码库由 Evo-Cortex 自动从记忆文件中提取生成。
> 所有代码片段都来自真实的对话和项目实施过程。

**最后更新**: $(date '+%Y-%m-%d %H:%M:%S')  
**代码总数**: $TOTAL_COUNT 个

---

## 📊 统计

| 语言 | 数量 |
|------|------|
| TypeScript | $TS_COUNT |
| JavaScript | $JS_COUNT |
| Bash/Shell | $BASH_COUNT |
| SQL | $SQL_COUNT |
| Python | $PY_COUNT |
| 其他 | $OTHER_COUNT |
| **总计** | **$TOTAL_COUNT** |

---

## 📁 目录结构

\`\`\`
code-snippets/
├── typescript/     ($TS_COUNT 个文件)
├── javascript/     ($JS_COUNT 个文件)
├── bash/           ($BASH_COUNT 个文件)
├── sql/            ($SQL_COUNT 个文件)
├── python/         ($PY_COUNT 个文件)
├── other/          ($OTHER_COUNT 个文件)
└── INDEX.md        # 本文件
\`\`\`

---

## 🔍 使用指南

### 按语言查找
- **TypeScript**: \`code-snippets/typescript/\`
- **JavaScript**: \`code-snippets/javascript/\`
- **Bash**: \`code-snippets/bash/\`
- **SQL**: \`code-snippets/sql/\`
- **Python**: \`code-snippets/python/\`

### 命名规则
文件格式：\`<源文件名>_snippet<序号>.<扩展名>\`

例如：
- \`2026-04-21-morning_snippet1.ts\` - 来自 2026-04-21-morning.md 的第 1 个代码块
- \`webhook-debug_snippet3.sh\` - 来自 webhook-debug.md 的第 3 个代码块

---

## 📝 最近添加的代码片段

INDEX_HEADER

# 列出最近提取的文件
echo "" >> "$INDEX_FILE"
if [ $TOTAL_COUNT -gt 0 ]; then
  echo "| 文件名 | 语言 | 大小 |" >> "$INDEX_FILE"
  echo "|--------|------|------|" >> "$INDEX_FILE"
  
  find "$SNIPPETS_DIR" -type f \( -name "*.ts" -o -name "*.js" -o -name "*.sh" -o -name "*.sql" -o -name "*.py" -o -name "*.txt" \) -mtime -1 2>/dev/null | head -20 | while read file; do
    FILENAME=$(basename "$file")
    LANG=$(echo "$file" | grep -oE '(typescript|javascript|bash|sql|python|other)' | head -1)
    SIZE=$(ls -lh "$file" | awk '{print $5}')
    echo "| \`$FILENAME\` | $LANG | $SIZE |" >> "$INDEX_FILE"
  done
else
  echo "_暂无代码片段_" >> "$INDEX_FILE"
fi

echo ""
echo "✅ 索引文件已生成：$INDEX_FILE"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✨ 代码片段提取完成！"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "统计结果:"
echo "  TypeScript: $TS_COUNT 个"
echo "  JavaScript: $JS_COUNT 个"
echo "  Bash/Shell: $BASH_COUNT 个"
echo "  SQL: $SQL_COUNT 个"
echo "  Python: $PY_COUNT 个"
echo "  其他：$OTHER_COUNT 个"
echo "  ─────────────"
echo "  总计：$TOTAL_COUNT 个"
echo ""
echo "存储位置：$SNIPPETS_DIR"
echo ""
echo "🦞 代码库构建完成！"
