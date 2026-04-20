#!/bin/bash
# 个人用户推荐配置脚本

set -e

AGENT_ID="${1:-main}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "🧬 Evo-Cortex 个人用户配置"
echo "=========================="
echo ""
echo "Agent: $AGENT_ID"
echo "配置：standard + script（推荐）"
echo ""

# 配置 standard 级别 + script 模式
bash "$SCRIPT_DIR/setup-crons-hybrid.sh" "$AGENT_ID" standard script

echo ""
echo "✅ 个人用户配置完成！"
echo ""
echo "下一步:"
echo "  1. 验证配置：$SCRIPT_DIR/verify-setup.sh $AGENT_ID"
echo "  2. 查看任务：openclaw cron list | grep $AGENT_ID"
echo "  3. 正常使用，等待进化！"
