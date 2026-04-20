#!/bin/bash
# 临时禁用 LLM 密集型任务（当遇到 Rate Limit 时）

set -e

AGENT="${1:-}"

if [ -z "$AGENT" ]; then
  echo "❌ 用法：$0 <agent-name>"
  echo ""
  echo "示例:"
  echo "   $0 cortex-test-agent"
  echo "   $0 plugin-demo-agent"
  exit 1
fi

echo "⏸️  临时禁用 $AGENT 的 LLM 密集型任务..."
echo ""

# 定义 LLM 密集型任务关键词
LLM_TASKS="fractal|review|learning|compress|expansion|cycle"

# 获取并禁用任务
disabled_count=0

openclaw cron list 2>/dev/null | grep "$AGENT" | grep -E "$LLM_TASKS" | while read line; do
  task_id=$(echo "$line" | awk '{print $1}')
  task_name=$(echo "$line" | awk '{print $2}')
  
  echo "   ⏸️  暂停：$task_name"
  
  if openclaw cron update "$task_id" --enabled false >/dev/null 2>&1; then
    ((disabled_count++)) || true
  else
    echo "      ⚠️  失败"
  fi
done

echo ""
echo "✅ 已暂停所有 LLM 密集型任务"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📝 说明:"
echo ""
echo "   被暂停的任务类型:"
echo "   - 分形思考 (fractal)"
echo "   - 日常审查 (review)"
echo "   - 主动学习 (learning)"
echo "   - 记忆压缩 (compress)"
echo "   - 知识扩展 (expansion)"
echo "   - 月度周期 (cycle)"
echo ""
echo "   保持运行的任务:"
echo "   - 会话扫描 (session-scan)"
echo "   - 实时索引 (realtime-index)"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔄 恢复命令:"
echo ""
echo "   # 恢复所有任务"
echo "   openclaw cron list 2>/dev/null | grep '$AGENT' | grep -E '$LLM_TASKS' | \\"
echo "     awk '{print \$1}' | xargs -I {} openclaw cron update {} --enabled true"
echo ""
echo "   # 或者重新配置（带降级保护）"
echo "   ENABLE_FALLBACK=true \\"
echo "   bash ~/.openclaw/extensions/evo-cortex/scripts/setup-crons-with-fallback.sh $AGENT"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "💡 提示:"
echo "   - 等待 5-10 分钟后再恢复任务"
echo "   - 考虑启用 Fallback 模式防止再次失败"
echo "   - 查看文档：cat ~/.openclaw/extensions/evo-cortex/docs/RATE_LIMIT_HANDLING.md"
echo ""
