#!/bin/bash
# Evo-Cortex Cron 配置脚本
# 默认 full 级别，创建所有 9 个任务

set -e

AGENT_NAME="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EVO_CORTEX_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -z "$AGENT_NAME" ]; then
  echo "❌ 错误：请指定 Agent 名称"
  echo "用法：$0 <agent-name>"
  exit 1
fi

echo "╔════════════════════════════════════════════════════════╗"
echo "║  🧬 Evo-Cortex Cron 配置 (Full)                          ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""
echo "📦 Agent: $AGENT_NAME"
echo "📁 Workspace: $HOME/.openclaw/workspace-$AGENT_NAME"
echo "📊 Level: full (默认，9 个任务)"
echo ""

# 注册到 OpenClaw
if ! openclaw agents list 2>/dev/null | grep -q "^$AGENT_NAME"; then
  echo "📝 注册 Agent 到 OpenClaw..."
  openclaw agents add "$AGENT_NAME" --workspace "$HOME/.openclaw/workspace-$AGENT_NAME" --non-interactive >/dev/null 2>&1 && echo "   ✅ 完成" || echo "   ⚠️ 失败"
  echo ""
fi

# 清理旧任务
echo "🧹 清理旧的 Cron 任务..."
openclaw cron list --json 2>/dev/null | jq -r ".[] | select(.agentId == \"$AGENT_NAME\") | .id" 2>/dev/null | while read job_id; do
  [ -n "$job_id" ] && openclaw cron remove "$job_id" >/dev/null 2>&1 && echo "   ✅ 已删除 $job_id" || true
done
echo "   ✅ 完成"
echo ""

# 核心任务
echo "📋 配置核心任务 (basic)..."

# 1. hourly-fractal (每小时)
echo "   - hourly-fractal (每小时)..."
openclaw cron add \
  --cron "0 * * * *" \
  --agent "$AGENT_NAME" \
  --message "请运行分形思考，分析对话模式，生成元规则" \
  --name "$AGENT_NAME-fractal-thinking" \
  --no-deliver \
  --session isolated >/dev/null 2>&1 && echo "      ✅ 完成" || echo "      ⚠️ 失败"

# 2. daily-review (每天 09:00)
echo "   - daily-review (每天 09:00)..."
openclaw cron add \
  --cron "0 9 * * *" \
  --agent "$AGENT_NAME" \
  --message "请审查知识图谱，优化知识结构" \
  --name "$AGENT_NAME-daily-review" \
  --no-deliver \
  --session isolated >/dev/null 2>&1 && echo "      ✅ 完成" || echo "      ⚠️ 失败"

# 3. active-learning (每天 04:00)
echo "   - active-learning (每天 04:00)..."
openclaw cron add \
  --cron "0 4 * * *" \
  --agent "$AGENT_NAME" \
  --message "请检测学习机会，识别知识缺口" \
  --name "$AGENT_NAME-active-learning" \
  --no-deliver \
  --session isolated >/dev/null 2>&1 && echo "      ✅ 完成" || echo "      ⚠️ 失败"

# 增强任务
echo ""
echo "📋 配置增强任务 (standard)..."

# 4. daily-compress (每天 09:30)
echo "   - daily-compress (每天 09:30)..."
openclaw cron add \
  --cron "0 9:30 * * *" \
  --agent "$AGENT_NAME" \
  --message "请压缩昨天的记忆，生成摘要" \
  --name "$AGENT_NAME-daily-compress" \
  --no-deliver \
  --session isolated >/dev/null 2>&1 && echo "      ✅ 完成" || echo "      ⚠️ 失败"

# 5. weekly-compress (每周日 03:00)
echo "   - weekly-compress (每周日 03:00)..."
openclaw cron add \
  --cron "0 3 * * 0" \
  --agent "$AGENT_NAME" \
  --message "请压缩本周的记忆，生成摘要" \
  --name "$AGENT_NAME-weekly-compress" \
  --no-deliver \
  --session isolated >/dev/null 2>&1 && echo "      ✅ 完成" || echo "      ⚠️ 失败"

# 6. weekly-kg-expansion (每周日 05:00)
echo "   - weekly-kg-expansion (每周日 05:00)..."
openclaw cron add \
  --cron "0 5 * * 0" \
  --agent "$AGENT_NAME" \
  --message "请扩展知识图谱，发现新关联" \
  --name "$AGENT_NAME-kg-expansion" \
  --no-deliver \
  --session isolated >/dev/null 2>&1 && echo "      ✅ 完成" || echo "      ⚠️ 失败"

# 7. monthly-cycle (每月 1 号 02:00)
echo "   - monthly-cycle (每月 1 号 02:00)..."
openclaw cron add \
  --cron "0 2 1 * *" \
  --agent "$AGENT_NAME" \
  --message "请执行月度进化周期，审查并优化" \
  --name "$AGENT_NAME-monthly-cycle" \
  --no-deliver \
  --session isolated >/dev/null 2>&1 && echo "      ✅ 完成" || echo "      ⚠️ 失败"

# 高级任务
echo ""
echo "📋 配置高级任务 (full)..."

# 8. session-scan (每 30 分钟)
echo "   - session-scan (每 30 分钟)..."
openclaw cron add \
  --cron "*/30 * * * *" \
  --agent "$AGENT_NAME" \
  --message "请扫描最近会话，提取关键记忆" \
  --name "$AGENT_NAME-session-scan" \
  --no-deliver \
  --session isolated >/dev/null 2>&1 && echo "      ✅ 完成" || echo "      ⚠️ 失败"

# 9. realtime-index (每 5 分钟)
echo "   - realtime-index (每 5 分钟)..."
openclaw cron add \
  --cron "*/5 * * * *" \
  --agent "$AGENT_NAME" \
  --message "请更新搜索索引" \
  --name "$AGENT_NAME-realtime-index" \
  --no-deliver \
  --session isolated >/dev/null 2>&1 && echo "      ✅ 完成" || echo "      ⚠️ 失败"

echo ""
echo "╔════════════════════════════════════════════════════════╗"
echo "║  ✅ Evo-Cortex 配置完成！                                 ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""

# 统计
echo "📊 当前任务列表:"
openclaw cron list 2>/dev/null | grep "$AGENT_NAME" | grep -E "fractal|review|learning|compress|expansion|cycle|scan|index" | while read line; do
  TASK_NAME=$(echo "$line" | awk '{print $2}')
  SCHEDULE=$(echo "$line" | awk '{print $4, $5, $6, $7}')
  echo "   ✅ $TASK_NAME | $SCHEDULE"
done

TOTAL=$(openclaw cron list --json 2>/dev/null | jq -r "[.[] | select(.agentId == \"$AGENT_NAME\")] | length" 2>/dev/null || echo "0")
echo ""
echo "✅ 总计：$TOTAL 个任务"
echo ""
echo "💡 提示:"
echo "   查看所有任务：openclaw cron list | grep $AGENT_NAME"
echo "   手动触发：openclaw cron run <task-id>"
echo "   删除任务：openclaw cron remove <task-id>"
echo ""

exit 0
