#!/bin/bash
# Evo-Cortex Cron 配置脚本 - 整合版（4 阶段）
#
# 用法:
#   bash scripts/setup-crons.sh <agent-name>
#

set -e

AGENT_NAME="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EVO_CORTEX_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -z "$AGENT_NAME" ]; then
  echo "❌ 错误：请指定 Agent 名称"
  echo "用法：$0 <agent-name>"
  exit 1
fi

echo "╔══════════════════════════════════════════════════════╗"
echo "║  🧬 Evo-Cortex Cron 配置 (4 阶段整合版)               ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "📦 Agent: $AGENT_NAME"
echo "📁 Pipeline: $EVO_CORTEX_ROOT/scripts/unified-pipeline.sh"
echo ""

# 注册 Agent
if ! openclaw agents list 2>/dev/null | grep -q "^$AGENT_NAME"; then
  openclaw agents add "$AGENT_NAME" --workspace "$HOME/.openclaw/workspace-$AGENT_NAME" --non-interactive >/dev/null 2>&1
fi

# 清理旧任务
echo "🧹 清理旧任务..."
openclaw cron list 2>/dev/null | grep "$AGENT_NAME" | awk '{print $1}' | while read id; do
  openclaw cron remove "$id" >/dev/null 2>&1 && echo "   已删除: ${id:0:8}"
done
echo ""

PIPELINE="bash $EVO_CORTEX_ROOT/scripts/unified-pipeline.sh $AGENT_NAME"

# ── 阶段 1: 扫描（每 5 分钟）──
echo "📡 Phase 1: Session Scan (每5分钟)..."
openclaw cron add \
  --cron "*/5 * * * *" \
  --agent "$AGENT_NAME" \
  --message "执行: $PIPELINE scan-only" \
  --name "phase-scan" \
  --session isolated \
  --no-deliver \
  --timeout-seconds 90 >/dev/null 2>&1 && echo "   ✅" || echo "   ❌"

# ── 阶段 2: 每日（09:00）──
echo "📋 Phase 2: Daily Review (09:00)..."
openclaw cron add \
  --cron "0 9 * * *" \
  --agent "$AGENT_NAME" \
  --message "执行: $PIPELINE daily" \
  --name "phase-daily" \
  --session isolated \
  --no-deliver \
  --timeout-seconds 90 >/dev/null 2>&1 && echo "   ✅" || echo "   ❌"

# ── 阶段 3: 夜间进化（23:00）──
echo "🧬 Phase 3: Nightly Evolution (23:00)..."
openclaw cron add \
  --cron "0 23 * * *" \
  --agent "$AGENT_NAME" \
  --message "执行: $PIPELINE evolve" \
  --name "phase-evolve" \
  --session isolated \
  --no-deliver \
  --timeout-seconds 90 >/dev/null 2>&1 && echo "   ✅" || echo "   ❌"

# ── 阶段 4: 每周维护（周日 03:00）──
echo "🔧 Phase 4: Weekly Maintenance (周日 03:00)..."
openclaw cron add \
  --cron "0 3 * * 0" \
  --agent "$AGENT_NAME" \
  --message "执行: $PIPELINE weekly" \
  --name "phase-weekly" \
  --session isolated \
  --no-deliver \
  --timeout-seconds 90 >/dev/null 2>&1 && echo "   ✅" || echo "   ❌"

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  ✅ 配置完成！4 阶段整合                                 ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
openclaw cron list 2>/dev/null | grep "$AGENT_NAME"
