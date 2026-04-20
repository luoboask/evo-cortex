#!/bin/bash
# 团队推荐配置脚本

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ $# -eq 0 ]; then
  echo "❌ 错误：请提供至少一个 Agent ID"
  echo "用法：$0 <agent1> [agent2] [agent3] ..."
  exit 1
fi

echo "🧬 Evo-Cortex 团队配置"
echo "======================"
echo ""
echo "Agents: $*"
echo "配置：full + hybrid（完整功能）"
echo ""

SUCCESS=0
FAILED=0

for AGENT in "$@"; do
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "配置：$AGENT"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  
  if bash "$SCRIPT_DIR/setup-crons-hybrid.sh" "$AGENT" full hybrid 2>&1 | tail -5; then
    ((SUCCESS++))
  else
    ((FAILED++))
  fi
  
  echo ""
done

echo "===================================="
echo "📊 配置完成总结"
echo "===================================="
echo "✅ 成功：$SUCCESS"
echo "❌ 失败：$FAILED"
echo ""

if [ "$FAILED" -eq 0 ]; then
  echo "🎉 所有 Agent 配置成功！"
else
  echo "⚠️  有 $FAILED 个 Agent 配置失败，请检查错误信息"
fi
