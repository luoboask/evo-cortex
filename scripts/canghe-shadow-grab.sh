#!/bin/bash

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 🥷 苍何影子学习 - 静默抓取脚本
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 
# 功能: 每天自动抓取 @canghe 的最新推文
# 特点: 零互动、纯后台、无日志输出（除非错误）
# 用法: bash ~/.openclaw/extensions/evo-cortex/scripts/canghe-shadow-grab.sh <agent-id>
#

set -euo pipefail

# ───────────────────────────────────────────
# 1. 参数验证
# ───────────────────────────────────────────

AGENT_ID="${1:-}"

if [ -z "$AGENT_ID" ]; then
  echo "用法：$(basename "$0") <agent-id>" >&2
  exit 1
fi

WORKSPACE="$HOME/.openclaw/workspace-$AGENT_ID"
MEMORY_DIR="$WORKSPACE/memory"
TODAY=$(date +%Y-%m-%d)
TIMESTAMP=$(date +"%Y-%m-%d %H:%M:%S")

# 检查 workspace 是否存在
if [ ! -d "$WORKSPACE" ]; then
  echo "错误：Workspace 不存在：$WORKSPACE" >&2
  exit 1
fi

# ───────────────────────────────────────────
# 2. 静默抓取
# ───────────────────────────────────────────

echo "[$TIMESTAMP] 开始抓取 @canghe..."

# 使用 bb-browser 抓取（静默模式，不输出到终端）
OUTPUT_FILE="$MEMORY_DIR/canghe-grab-$TODAY.json"

# 执行抓取（如果 bb-browser 可用）
if command -v bb-browser &> /dev/null; then
  # 静默执行，只保存结果到文件
  if bb-browser site x/canghe-monitor canghe --json --openclaw > "$OUTPUT_FILE" 2>/dev/null; then
    echo "[$TIMESTAMP] ✅ 抓取成功：$OUTPUT_FILE"
    
    # 提取关键信息并追加到主学习文档
    if command -v jq &> /dev/null; then
      TWEET_COUNT=$(jq '.count' "$OUTPUT_FILE" 2>/dev/null || echo "0")
      
      # 追加简要记录到 markdown 文件
      MARKDOWN_FILE="$MEMORY_DIR/canghe-shadow-learning.md"
      
      if [ -f "$MARKDOWN_FILE" ] && [ "$TWEET_COUNT" -gt 0 ]; then
        echo "" >> "$MARKDOWN_FILE"
        echo "### $TIMESTAMP - 自动抓取" >> "$MARKDOWN_FILE"
        echo "- **数量**: $TWEET_COUNT 条" >> "$MARKDOWN_FILE"
        echo "- **原始数据**: \`canghe-grab-$TODAY.json\`" >> "$MARKDOWN_FILE"
        echo "- **状态**: ✅ 成功" >> "$MARKDOWN_FILE"
        echo "" >> "$MARKDOWN_FILE"
      fi
    fi
  else
    echo "[$TIMESTAMP] ⚠️  抓取失败（可能是网络问题或页面结构变化）" >&2
    # 不退出，避免 cron 报错
  fi
else
  echo "[$TIMESTAMP] ⚠️  bb-browser 未安装，跳过抓取" >&2
fi

# ───────────────────────────────────────────
# 3. 清理旧数据（保留最近 30 天）
# ───────────────────────────────────────────

find "$MEMORY_DIR" -name "canghe-grab-*.json" -mtime +30 -delete 2>/dev/null || true

# ───────────────────────────────────────────
# 4. 完成
# ───────────────────────────────────────────

echo "[$TIMESTAMP] 影子学习任务完成"

exit 0
