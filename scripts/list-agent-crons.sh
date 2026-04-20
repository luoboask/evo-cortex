#!/bin/bash
# 列出指定 Agent 的所有 Cron 任务（完整显示，不截断）

AGENT_ID="${1:-}"

if [ -z "$AGENT_ID" ]; then
  echo "用法：$0 <agent-id>"
  echo ""
  echo "示例:"
  echo "  $0 plugin-demo-agent"
  echo "  $0 cortex-test-agent"
  exit 1
fi

echo "📋 Agent '$AGENT_ID' 的 Cron 任务列表"
echo "======================================"
echo ""

# 获取所有 cron 任务，过滤出指定 agent 的任务
TASKS=$(openclaw cron list --json 2>/dev/null | grep -v "^\[" | jq -r ".[] | select(.agent == \"$AGENT_ID\")" 2>/dev/null)

if [ -z "$TASKS" ] || [ "$TASKS" = "null" ]; then
  # jq 失败，尝试用文本方式解析
  echo "正在使用文本模式解析..."
  echo ""
  
  openclaw cron list 2>/dev/null | grep -v "^\[" | while read -r line; do
    if echo "$line" | grep -q "$AGENT_ID"; then
      # 提取任务 ID 和名称
      TASK_ID=$(echo "$line" | awk '{print $1}')
      TASK_NAME=$(echo "$line" | awk '{print $2}')
      SCHEDULE=$(echo "$line" | awk '{print $4, $5, $6, $7}')
      STATUS=$(echo "$line" | awk '{print $9}')
      
      printf "✅ %s\n   名称：%s\n   调度：%s\n   状态：%s\n\n" "$TASK_ID" "$TASK_NAME" "$SCHEDULE" "$STATUS"
    fi
  done
  
  COUNT=$(openclaw cron list 2>/dev/null | grep -v "^\[" | grep -c "$AGENT_ID" || echo "0")
else
  # 使用 jq 解析
  echo "$TASKS" | jq -r '{name: .name, schedule: .schedule, status: .status.state} | "✅ \(.name)\n   调度：\(.schedule.expr // \(.schedule.every))\n   状态：\(.status)"'
  
  COUNT=$(echo "$TASKS" | jq -s 'length')
fi

echo "======================================"
echo "总计：$COUNT 个任务"
echo ""

# 显示任务类型分布
echo "📊 任务类型分布:"
openclaw cron list 2>/dev/null | grep -v "^\[" | grep "$AGENT_ID" | awk '{print $2}' | sed 's/-[a-z0-9]*$//' | sort | uniq -c | sort -rn
