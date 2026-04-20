#!/bin/bash
# 极速配置脚本（最简配置）

set -e

AGENT_ID="${1:-main}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "🚀 Evo-Cortex 极速配置"
echo "======================"
echo ""
echo "Agent: $AGENT_ID"
echo "配置：basic + script（最小化）"
echo ""

# 配置 basic 级别 + script 模式
bash "$SCRIPT_DIR/setup-crons-hybrid.sh" "$AGENT_ID" basic script

echo ""
echo "✅ 极速配置完成！"
echo ""
echo "已配置 3 个核心任务:"
echo "  • hourly-fractal - 每小时生成元规则"
echo "  • daily-review - 每日审查知识"
echo "  • active-learning - 每日主动学习"
echo ""
echo "升级配置:"
echo "  bash $SCRIPT_DIR/setup-crons-hybrid.sh $AGENT_ID standard script"
