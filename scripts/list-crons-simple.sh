#!/bin/bash
# 简单直接地列出 Agent 的所有 Cron 任务

AGENT_KEYWORD="${1:-}"

if [ -z "$AGENT_KEYWORD" ]; then
  echo "用法：$0 <agent-keyword>"
  echo "示例：$0 plugin-demo"
  exit 1
fi

echo "📋 $AGENT_KEYWORD 相关的 Cron 任务"
echo ""

# 使用宽输出模式，避免截断
openclaw cron list 2>&1 | grep -v "^\[" | grep "$AGENT_KEYWORD" | sed 's/\.\.\./[truncated]/g' | nl

echo ""
TOTAL=$(openclaw cron list 2>&1 | grep -v "^\[" | grep -c "$AGENT_KEYWORD")
echo "✅ 总计：$TOTAL 个任务"

# 如果需要更详细的信息，可以查看单个任务
echo ""
echo "💡 提示：查看单个任务详情使用:"
echo "   openclaw cron info <task-id>"
