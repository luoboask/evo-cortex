#!/bin/bash
# 完整列出 Agent 的所有 Cron 任务（解决输出截断问题）

AGENT_KEYWORD="${1:-plugin-demo}"

echo "📋 $AGENT_KEYWORD 相关的 Cron 任务列表"
echo "======================================"
echo ""

# 获取并格式化输出
openclaw cron list 2>&1 | grep -v "^\[" | grep "$AGENT_KEYWORD" | \
  awk 'BEGIN {printf "%-3s | %-35s | %-20s | %-8s\n", "No.", "Task Name", "Schedule", "Status"}
       BEGIN {print "----|-------------------------------------|----------------------|---------"}
       {
         printf "%-3d | %-35s | %-20s | %-8s\n", 
           NR, 
           $2, 
           $4" "$5" "$6" "$7, 
           $12
       }'

echo ""
TOTAL=$(openclaw cron list 2>&1 | grep -v "^\[" | grep -c "$AGENT_KEYWORD")
echo "✅ 总计：$TOTAL 个任务"
echo ""

# 显示任务类型统计
echo "📊 任务类型分布:"
openclaw cron list 2>&1 | grep -v "^\[" | grep "$AGENT_KEYWORD" | \
  awk '{print $2}' | sed 's/-[a-z0-9]*$//' | sort | uniq -c | sort -rn | \
  awk '{printf "  %2d x %s\n", $1, $2}'

echo ""
echo "💡 提示:"
echo "  • 查看任务详情：openclaw cron info <task-id>"
echo "  • 删除任务：openclaw cron remove <task-id>"
echo "  • 手动触发：openclaw cron run <task-id>"
