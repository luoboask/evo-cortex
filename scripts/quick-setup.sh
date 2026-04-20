#!/bin/bash
# Evo-Cortex 一键配置向导
# 自动完成所有配置步骤

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_ID="${1:-main}"

echo "🧬 Evo-Cortex 一键配置向导"
echo "=========================="
echo ""
echo "将为 Agent '$AGENT_ID' 配置完整的进化系统"
echo ""

# 询问配置级别
echo "选择配置级别:"
echo "  1) basic    - 3 个核心任务（快速上手）"
echo "  2) standard - 7 个任务（推荐）"
echo "  3) full     - 9 个任务（完整功能）"
read -p "请输入选项 (1-3, 默认 2): " LEVEL_CHOICE

case "${LEVEL_CHOICE:-2}" in
  1) LEVEL="basic" ;;
  2) LEVEL="standard" ;;
  3) LEVEL="full" ;;
  *) echo "无效选项，使用 standard"; LEVEL="standard" ;;
esac

# 询问执行模式
echo ""
echo "选择执行模式:"
echo "  1) script - 快速、免费（推荐）"
echo "  2) llm    - 智能、付费"
echo "  3) hybrid - 混合模式（平衡）"
read -p "请输入选项 (1-3, 默认 1): " MODE_CHOICE

case "${MODE_CHOICE:-1}" in
  1) MODE="script" ;;
  2) MODE="llm" ;;
  3) MODE="hybrid" ;;
  *) echo "无效选项，使用 script"; MODE="script" ;;
esac

echo ""
echo "开始配置..."
echo ""

# 执行配置
bash "$SCRIPT_DIR/setup-crons-hybrid.sh" "$AGENT_ID" "$LEVEL" "$MODE"

echo ""
echo "✅ 配置完成！"
echo ""
echo "下一步:"
echo "  1. 查看任务列表："
echo "     openclaw cron list | grep $AGENT_ID"
echo ""
echo "  2. 手动测试一次："
echo "     openclaw cron run <task-id>"
echo ""
echo "  3. 等待自动执行："
echo "     下一个整点将执行 hourly-fractal"
echo ""
echo "  4. 查看进化结果（执行后）："
echo "     cat ~/.openclaw/workspace-$AGENT_ID/evolution/$AGENT_ID/meta-rules-*.md"
echo ""
