#!/bin/bash
# =============================================================================
# Evo-Cortex P0 Automation Setup
# 功能：将 P0 优化脚本配置为自动运行的 Cron 任务
# 用法：bash setup-p0-automation.sh <agent-id>
# =============================================================================

set -e

AGENT_ID="${1:-}"
if [ -z "$AGENT_ID" ]; then
  echo "❌ 错误：请提供 agent-id"
  echo "用法：$0 <agent-id>"
  exit 1
fi

echo "╔════════════════════════════════════════════════════════╗"
echo "║  🤖 Evo-Cortex P0 Automation Setup                     ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""
echo "📦 Agent: $AGENT_ID"
echo ""

# 确保 agent 已注册
echo "📝 检查 Agent 注册状态..."
if ! openclaw agents list 2>/dev/null | grep -q "$AGENT_ID"; then
  echo "   ⚠️  Agent 未注册，正在注册..."
  openclaw agents add "$AGENT_ID" 2>/dev/null || true
  echo "   ✅ 已注册"
else
  echo "   ✅ 已注册"
fi

echo ""
echo "🧹 清理旧的 P0 相关任务..."

# 删除可能存在的旧任务

# 任务 2: 每天 4AM 运行增强主动学习
echo ""
echo "🧠 任务 2: 增强主动学习（偏好 + 待办）"
create_p0_task \
  "active-learning-enhanced" \
  "0 4 * * *" \
  "运行增强版主动学习脚本：
1. 词频分析（Top 30）
2. 识别用户偏好（'我喜欢 X'等）
3. 提取待办事项（'我要'、'记得'等）
4. 更新 USER_PREFERENCES.md
5. 更新 action-items.md
6. 生成学习报告

无需 LLM，纯脚本执行。
bash ~/.openclaw/extensions/evo-cortex/scripts/active-learning-enhanced.sh $AGENT_ID"

# 任务 3: 每周日 3AM 运行知识图谱更新
echo ""
echo "🕸️  任务 3: 知识图谱自动更新"
create_p0_task \
  "kg-auto-update" \
  "0 3 * * 0" \
  "运行知识图谱自动更新脚本：
1. 扫描最近 3 天的记忆文件
2. 提取高频技术术语（候选实体）
3. 过滤已有实体，识别新实体
4. 自动添加高置信度实体（频次≥5）
5. 生成实体关系建议
6. 创建备份和更新报告

无需 LLM，纯脚本执行。
bash ~/.openclaw/extensions/evo-cortex/scripts/kg-auto-update.sh $AGENT_ID"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✨ P0 自动化配置完成！"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📊 配置摘要:"
echo "   新建任务：$CREATED 个"
echo "   跳过任务：$SKIPPED 个"
echo ""
echo "⏰ 任务调度:"
echo "   • 每天 04:00 - 增强主动学习（偏好 + 待办）"
echo "   • 每天 05:00 - 代码片段提取"
echo "   • 每周日 03:00 - 知识图谱更新"
echo ""
echo "💰 运行成本：\$0.00/天（纯脚本模式）"
echo ""
echo "📋 验证命令:"
echo "   openclaw cron list | grep $AGENT_ID"
echo ""
echo "🦞 P0 已配置为自动运行！"

