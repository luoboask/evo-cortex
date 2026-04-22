#!/bin/bash

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 🧠 Evo-Cortex 用户偏好自动提取脚本 (阶段二)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 
# 功能：扫描最近的对话记忆，自动提取用户偏好表达
# 用法：bash ~/.openclaw/extensions/evo-cortex/scripts/extract-preferences.sh <agent-id>
# 
# 特点:
# - 纯脚本模式，零成本运行
# - 可选 LLM 增强模式（需要配置 API）
# - 生成待确认列表，避免误判
# - 支持增量更新

set -euo pipefail

# ───────────────────────────────────────────
# 1. 参数验证和初始化
# ───────────────────────────────────────────

AGENT_ID="${1:-}"

if [ -z "$AGENT_ID" ]; then
  echo "用法：$(basename "$0") <agent-id>" >&2
  exit 1
fi

WORKSPACE="$HOME/.openclaw/workspace-$AGENT_ID"
MEMORY_DIR="$WORKSPACE/memory"
DATA_DIR="$WORKSPACE/data"
PREF_FILE="$WORKSPACE/USER_PREFERENCES.md"
OUTPUT_FILE="$DATA_DIR/pending_preferences.txt"
TODAY=$(date +%Y-%m-%d)
TIMESTAMP=$(date +"%Y-%m-%d %H:%M:%S")

# 检查目录是否存在
if [ ! -d "$WORKSPACE" ]; then
  echo "❌ 错误：Workspace 不存在：$WORKSPACE" >&2
  exit 1
fi

if [ ! -d "$MEMORY_DIR" ]; then
  echo "❌ 错误：记忆目录不存在：$MEMORY_DIR" >&2
  exit 1
fi

# 创建数据目录（如果不存在）
mkdir -p "$DATA_DIR"

echo "╔══════════════════════════════════════════════╗"
echo "║                                              ║"
echo "║   🧠 用户偏好自动提取 (Evo-Cortex)           ║"
echo "║                                              ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo "📦 Agent: $AGENT_ID"
echo "📁 Workspace: $WORKSPACE"
echo "🕐 时间：$TIMESTAMP"
echo ""

# ───────────────────────────────────────────
# 2. 扫描最近的对话记忆
# ───────────────────────────────────────────

echo "🔍 扫描最近的对话记忆..."

# 获取最近 7 天的文件（最多 20 个）
RECENT_FILES=$(find "$MEMORY_DIR" -name "*.md" -type f -mtime -7 2>/dev/null | head -20)

if [ -z "$RECENT_FILES" ]; then
  echo "⚠️  没有找到最近 7 天的对话记录"
  echo "💡 建议：先进行一些对话，积累数据后再运行"
  exit 0
fi

FILE_COUNT=$(echo "$RECENT_FILES" | wc -l | tr -d ' ')
echo "✅ 找到 $FILE_COUNT 个记忆文件"
echo ""

# ───────────────────────────────────────────
# 3. 搜索偏好相关表达模式
# ───────────────────────────────────────────

echo "🔎 分析偏好表达模式..."
echo ""

CANDIDATES=""

# 模式 1: 明确喜好表达
echo "  • 搜索明确喜好表达（我喜欢/我不喜欢...）"
CANDIDATES+="$(grep -hE "我 (喜欢 | 偏好 | 讨厌 | 不喜欢 | 想要 | 希望)" $RECENT_FILES 2>/dev/null || true)"

# 模式 2: 指令性表达
echo "  • 搜索指令性表达（请用/不要用/最好用...）"
CANDIDATES+="$(grep -hE "(请用 | 不要用 | 别用 | 最好用 | 优先用 | 尽量|避免)" $RECENT_FILES 2>/dev/null || true)"

# 模式 3: 评价性表达
echo "  • 搜索评价性表达（这样更好/这样不对/不错...）"
CANDIDATES+="$(grep -hE "(这样更好 | 这样不对 | 不太好 | 很好 | 不错 | 不喜欢 | 满意)" $RECENT_FILES 2>/dev/null || true)"

# 模式 4: 重复出现的请求
echo "  • 搜索重复出现的请求模式..."
# 这个需要更复杂的分析，暂时跳过

# 去重
if [ -n "$CANDIDATES" ]; then
  UNIQUE_CANDIDATES=$(echo "$CANDIDATES" | grep -v "^$" | sort -u)
else
  UNIQUE_CANDIDATES=""
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ -z "$UNIQUE_CANDIDATES" ]; then
  echo "✅ 未发现新的偏好表达"
  echo ""
  echo "💡 可能的原因:"
  echo "  • 最近对话较少"
  echo "  • 对话中没有明确的偏好表达"
  echo "  • 偏好已经在 USER_PREFERENCES.md 中记录"
  exit 0
fi

# ───────────────────────────────────────────
# 4. 显示结果并保存
# ───────────────────────────────────────────

LINE_COUNT=$(echo "$UNIQUE_CANDIDATES" | wc -l | tr -d ' ')

echo "📋 发现 $LINE_COUNT 条潜在偏好（需人工确认）:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 编号显示
INDEX=1
while IFS= read -r line; do
  if [ -n "$line" ]; then
    # 截断过长的行
    if [ ${#line} -gt 120 ]; then
      line="${line:0:117}..."
    fi
    printf "%2d. %s\n" "$INDEX" "$line"
    ((INDEX++))
  fi
done <<< "$UNIQUE_CANDIDATES"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 保存到临时文件
echo "$UNIQUE_CANDIDATES" > "$OUTPUT_FILE"

echo "💾 已保存到：$OUTPUT_FILE"
echo ""

# ───────────────────────────────────────────
# 5. 提供操作建议
# ───────────────────────────────────────────

echo "📝 下一步操作建议:"
echo ""
echo "方案 A: 手动确认（推荐）"
echo "  1. 查看上面的列表"
echo "  2. 打开 $PREF_FILE"
echo "  3. 将确认的偏好添加到对应章节"
echo "  4. 勾选 [x]"
echo ""
echo "方案 B: 使用 LLM 自动整理（可选）"
echo "  如果配置了 OpenClaw LLM，可以运行:"
echo "  bash $0 $AGENT_ID --llm"
echo ""
echo "方案 C: 忽略"
echo "  如果都是误判，直接删除 $OUTPUT_FILE"
echo ""

# ───────────────────────────────────────────
# 6. LLM 增强模式（可选）
# ───────────────────────────────────────────

if [ "${1:-}" = "--llm" ]; then
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "🧠 启动 LLM 自动整理模式..."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  
  if command -v openclaw &> /dev/null; then
    echo "正在调用 OpenClaw LLM 进行分析..."
    
    # 构建提示词
    PROMPT="请从以下对话片段中提取用户的偏好，并按以下 JSON 格式输出：

{
  \"communication_style\": {
    \"style\": \"简洁/详细/平衡\",
    \"notes\": [\"具体说明\"]
  },
  \"format_preferences\": [\"bullet points\", \"代码示例\", \"表格\", ...],
  \"tech_stack\": {
    \"frontend\": [\"React\", \"Next.js\", ...],
    \"backend\": [\"Node.js\", \"Python\", ...],
    \"database\": [\"PostgreSQL\", \"MongoDB\", ...]
  },
  \"pet_peeves\": [\"不喜欢表格\", \"讨厌长段落\", ...],
  \"work_habits\": [\"晚上工作\", \"喜欢早上开会\", ...]
}

只输出 JSON，不要其他内容。

对话片段:
$UNIQUE_CANDIDATES"

    # 调用 LLM
    if LLM_OUTPUT=$(openclaw agent --message "$PROMPT" 2>/dev/null); then
      echo "✅ LLM 分析完成"
      echo ""
      
      # 保存 JSON 结果
      echo "$LLM_OUTPUT" | jq '.' > "$DATA_DIR/suggested_preferences.json" 2>/dev/null || \
        echo "$LLM_OUTPUT" > "$DATA_DIR/suggested_preferences_raw.txt"
      
      echo "💾 LLM 建议已保存:"
      echo "  - JSON 格式：$DATA_DIR/suggested_preferences.json"
      echo "  - 原始输出：$DATA_DIR/suggested_preferences_raw.txt"
      echo ""
      
      # 显示摘要
      echo "📊 提取到的偏好摘要:"
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      
      if [ -f "$DATA_DIR/suggested_preferences.json" ]; then
        echo "沟通风格：$(jq -r '.communication_style.style' "$DATA_DIR/suggested_preferences.json" 2>/dev/null || echo 'N/A')"
        echo "格式偏好：$(jq -r '.format_preferences | join(", ")' "$DATA_DIR/suggested_preferences.json" 2>/dev/null || echo 'N/A')"
        echo "技术栈：$(jq -r '.tech_stack | to_entries | map("\(.key): \(.value | join(", "))") | join("; ")' "$DATA_DIR/suggested_preferences.json" 2>/dev/null || echo 'N/A')"
      else
        echo "（JSON 解析失败，请查看原始输出文件）"
      fi
      
      echo ""
      echo "💡 你可以:"
      echo "  1. 审查 LLM 的建议"
      echo "  2. 手动添加到 $PREF_FILE"
      echo "  3. 或者等待下次运行时再次确认"
    else
      echo "⚠️  LLM 调用失败，可能是:"
      echo "  • 未配置 OpenClaw LLM"
      echo "  • API 配额用尽"
      echo "  • 网络问题"
      echo ""
      echo "继续使用手动确认方案即可。"
    fi
  else
    echo "⚠️  OpenClaw 命令行工具未安装"
    echo "请手动确认上面的偏好列表。"
  fi
fi

# ───────────────────────────────────────────
# 7. 完成
# ───────────────────────────────────────────

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✨ 偏好提取完成！"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📁 相关文件:"
echo "  • 待确认列表：$OUTPUT_FILE"
echo "  • 偏好文件：$PREF_FILE"
if [ "${1:-}" = "--llm" ] && [ -f "$DATA_DIR/suggested_preferences.json" ]; then
  echo "  • LLM 建议：$DATA_DIR/suggested_preferences.json"
fi
echo ""
echo "🦞 记得定期 review 和更新你的偏好文件哦！"
echo ""

exit 0
