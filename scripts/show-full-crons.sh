#!/bin/bash
# 完整显示 Agent 的 Cron 任务（解决输出截断问题）

AGENT_KEYWORD="${1:-plugin-demo}"

echo "📋 Agent '$AGENT_KEYWORD' 的所有 Cron 任务（完整显示）"
echo "======================================================"
echo ""

COUNT=0

# 获取所有任务，逐行处理
openclaw cron list 2>&1 | grep -v "^\[" | grep "$AGENT_KEYWORD" | while read -r LINE; do
  COUNT=$((COUNT + 1))
  
  # 提取各字段
  TASK_ID=$(echo "$LINE" | awk '{print $1}')
  TASK_NAME=$(echo "$LINE" | awk '{print $2}')
  CRON_EXPR=$(echo "$LINE" | awk '{print $4, $5, $6, $7}')
  NEXT_RUN=$(echo "$LINE" | awk '{print $8, $9}')
  LAST_RUN=$(echo "$LINE" | awk '{print $10, $11}')
  STATUS=$(echo "$LINE" | awk '{print $12}')
  AGENT=$(echo "$LINE" | awk '{print $14}' | sed 's/\.\.\.$//')
  
  echo "$COUNT. $TASK_NAME"
  echo "   ID: $TASK_ID"
  echo "   调度：$CRON_EXPR"
  echo "   下次执行：$NEXT_RUN"
  echo "   上次执行：$LAST_RUN"
  echo "   状态：$STATUS"
  echo "   Agent: $AGENT"
  echo ""
done

TOTAL=$(openclaw cron list 2>&1 | grep -v "^\[" | grep -c "$AGENT_KEYWORD")
echo "======================================================"
echo "✅ 总计：$TOTAL 个任务"
