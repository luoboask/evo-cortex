#!/bin/bash
# 检查 Rate Limit 状态和任务健康度

set -e

echo "🔍 检查 Evo-Cortex 任务健康状态..."
echo ""

# 获取所有 Evo-Cortex 相关的任务
all_tasks=$(openclaw cron list 2>/dev/null | grep -E "(plugin-|cortex-)" || true)

if [ -z "$all_tasks" ]; then
  echo "⚠️  未找到 Evo-Cortex 相关的 Cron 任务"
  exit 0
fi

# 统计
total=$(echo "$all_tasks" | wc -l | tr -d ' ')
ok=$(echo "$all_tasks" | grep -c "ok" || echo "0")
error=$(echo "$all_tasks" | grep -c "error" || echo "0")
running=$(echo "$all_tasks" | grep -c "running" || echo "0")
idle=$(echo "$all_tasks" | grep -c "idle" || echo "0")

echo "📊 任务统计:"
echo "   总计：$total"
echo "   ✅ 正常：$ok"
echo "   ❌ 失败：$error"
echo "   🔄 运行中：$running"
echo "   ⏸️ 空闲：$idle"
echo ""

# 如果有失败的任务，显示详情
if [ "$error" -gt 0 ]; then
  echo "⚠️  发现 $error 个失败的任务:"
  echo ""
  
  echo "$all_tasks" | grep "error" | while read line; do
    task_id=$(echo "$line" | awk '{print $1}')
    task_name=$(echo "$line" | awk '{print $2}')
    last_run=$(echo "$line" | awk '{print $6}')
    
    echo "   ❌ $task_name"
    echo "      ID: $task_id"
    echo "      最后运行：$last_run"
    echo ""
  done
  
  echo "💡 建议操作:"
  echo ""
  echo "   1. 查看任务日志:"
  echo "      openclaw cron runs <task-id> --limit 3"
  echo ""
  echo "   2. 如果是 Rate Limit 问题:"
  echo "      ENABLE_FALLBACK=true \\"
  echo "      bash ~/.openclaw/extensions/evo-cortex/scripts/setup-crons-with-fallback.sh <agent-name>"
  echo ""
  echo "   3. 临时禁用 LLM 任务:"
  echo "      bash ~/.openclaw/extensions/evo-cortex/scripts/disable-llm-tasks.sh <agent-name>"
  echo ""
  echo "   4. 查看详细文档:"
  echo "      cat ~/.openclaw/extensions/evo-cortex/docs/RATE_LIMIT_HANDLING.md"
  echo ""
else
  echo "✅ 所有任务运行正常!"
  echo ""
fi

# 检查是否有降级任务配置
fallback_count=$(echo "$all_tasks" | grep -c "fallback" || echo "0")

if [ "$fallback_count" -gt 0 ]; then
  echo "🛡️  降级保护:"
  echo "   ✅ 已配置 $fallback_count 个 Fallback 任务"
  echo ""
else
  echo "⚠️  降级保护:"
  echo "   ❌ 未配置 Fallback 任务"
  echo ""
  echo "💡 建议启用降级策略:"
  echo "   ENABLE_FALLBACK=true \\"
  echo "   bash ~/.openclaw/extensions/evo-cortex/scripts/setup-crons-with-fallback.sh <agent-name>"
  echo ""
fi

# 显示最近的 API 调用情况（如果有）
echo "📈 最近活动:"
echo "$all_tasks" | head -5 | while read line; do
  task_name=$(echo "$line" | awk '{print $2}')
  last_status=$(echo "$line" | awk '{print $7}')
  last_run=$(echo "$line" | awk '{print $6}')
  
  status_icon="❓"
  if [ "$last_status" = "ok" ]; then
    status_icon="✅"
  elif [ "$last_status" = "error" ]; then
    status_icon="❌"
  elif [ "$last_status" = "running" ]; then
    status_icon="🔄"
  fi
  
  echo "   $status_icon $task_name - $last_run"
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "检查完成于：$(date '+%Y-%m-%d %H:%M:%S')"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
