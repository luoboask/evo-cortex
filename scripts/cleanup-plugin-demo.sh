#!/bin/bash
# 清理 plugin-demo-agent 的重复 cron 任务

AGENT_PATTERN="plugin-demo"
KEEP_PREFIX="plugin-demo-test-"

echo "🧹 清理 $AGENT_PATTERN 的重复任务"
echo "======================================"
echo ""

# 获取所有任务 ID
TASKS=$(openclaw cron list 2>/dev/null | grep -v "^\[" | grep "$AGENT_PATTERN" | awk '{print $1, $2}')

# 统计
TOTAL=$(echo "$TASKS" | wc -l | tr -d ' ')
KEEP=$(echo "$TASKS" | grep "$KEEP_PREFIX" | wc -l | tr -d ' ')
DELETE=$((TOTAL - KEEP))

echo "📊 统计:"
echo "  总计: $TOTAL 个任务"
echo "  保留: $KEEP 个 ($KEEP_PREFIX*)"
echo "  删除: $DELETE 个"
echo ""

# 执行删除
echo "🗑️  删除非标准任务..."
echo "$TASKS" | while read -r id name; do
  if echo "$name" | grep -q "$KEEP_PREFIX"; then
    echo "   ✅ 保留: $name"
  else
    openclaw cron remove "$id" >/dev/null 2>&1 && echo "   🗑️  删除: $name" || echo "   ❌ 失败: $name"
  fi
done

echo ""
echo "✅ 清理完成！"
echo ""

# 显示剩余任务
echo "📋 剩余任务:"
openclaw cron list 2>/dev/null | grep -v "^\[" | grep "$AGENT_PATTERN" | awk '{printf "  %-30s | %-20s\n", $2, $4" "$5" "$6" "$7}'

echo ""
REMAINING=$(openclaw cron list 2>/dev/null | grep -v "^\[" | grep -c "$AGENT_PATTERN" || echo "0")
echo "总计: $REMAINING 个任务"
