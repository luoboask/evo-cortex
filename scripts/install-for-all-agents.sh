#!/bin/bash
# Evo-Cortex 多 Agent 批量安装配置脚本
# 为所有或指定的 Agent 一键安装和配置 Evo-Cortex 插件

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPENCLAW_ROOT="$HOME/.openclaw"

echo "🧬 Evo-Cortex 多 Agent 批量配置工具"
echo "===================================="
echo ""

# ========== 步骤 1: 获取要配置的 Agent 列表 ==========
echo "选择要配置的 Agent:"
echo ""

# 获取所有可用的 Agent
ALL_AGENTS=$(ls -1 "$OPENCLAW_ROOT" | grep "^workspace-" | sed 's/workspace-//')

if [ -z "$ALL_AGENTS" ]; then
  echo "❌ 未找到任何 Agent workspace"
  exit 1
fi

echo "发现以下 Agent:"
echo "$ALL_AGENTS" | nl
echo ""

# 询问配置方式
echo "选择配置方式:"
echo "  1) 配置所有 Agent"
echo "  2) 配置指定的 Agent"
echo "  3) 跳过某些 Agent"
read -p "请输入选项 (1-3, 默认 1): " SCOPE_CHOICE

case "${SCOPE_CHOICE:-1}" in
  1)
    AGENTS_TO_CONFIGURE="$ALL_AGENTS"
    ;;
  2)
    echo "请输入要配置的 Agent 名称（空格分隔）:"
    read -p "> " AGENT_LIST
    AGENTS_TO_CONFIGURE="$AGENT_LIST"
    ;;
  3)
    echo "请输入要跳过的 Agent 名称（空格分隔）:"
    read -p "> " SKIP_LIST
    AGENTS_TO_CONFIGURE=""
    for agent in $ALL_AGENTS; do
      if [[ ! " $SKIP_LIST " =~ " $agent " ]]; then
        AGENTS_TO_CONFIGURE="$AGENTS_TO_CONFIGURE $agent"
      fi
    done
    AGENTS_TO_CONFIGURE=$(echo "$AGENTS_TO_CONFIGURE" | xargs)
    ;;
  *)
    echo "无效选项，使用默认（所有 Agent）"
    AGENTS_TO_CONFIGURE="$ALL_AGENTS"
    ;;
esac

echo ""
echo "将配置以下 Agent:"
echo "$AGENTS_TO_CONFIGURE" | tr ' ' '\n' | nl
echo ""

# ========== 步骤 2: 确认配置选项 ==========
echo "选择配置级别:"
echo "  1) basic    - 3 个核心任务"
echo "  2) standard - 7 个任务（推荐）"
echo "  3) full     - 9 个任务"
read -p "请输入选项 (1-3, 默认 2): " LEVEL_CHOICE

case "${LEVEL_CHOICE:-2}" in
  1) LEVEL="basic" ;;
  2) LEVEL="standard" ;;
  3) LEVEL="full" ;;
  *) echo "无效选项，使用 standard"; LEVEL="standard" ;;
esac

echo ""
echo "选择执行模式:"
echo "  1) script - 快速、免费（推荐）"
echo "  2) llm    - 智能、付费"
echo "  3) hybrid - 混合模式"
read -p "请输入选项 (1-3, 默认 1): " MODE_CHOICE

case "${MODE_CHOICE:-1}" in
  1) MODE="script" ;;
  2) MODE="llm" ;;
  3) MODE="hybrid" ;;
  *) echo "无效选项，使用 script"; MODE="script" ;;
esac

echo ""
echo "======================"
echo "配置摘要:"
echo "  Agent 数量：$(echo "$AGENTS_TO_CONFIGURE" | wc -w | tr -d ' ')"
echo "  配置级别：$LEVEL"
echo "  执行模式：$MODE"
echo "======================"
echo ""

read -p "确认开始配置？(y/N): " CONFIRM
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
  echo "已取消"
  exit 0
fi

echo ""

# ========== 步骤 3: 批量配置 ==========
SUCCESS=0
FAILED=0
SKIPPED=0

for AGENT in $AGENTS_TO_CONFIGURE; do
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "正在配置：$AGENT"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  
  # 检查工作区是否存在
  if [ ! -d "$OPENCLAW_ROOT/workspace-$AGENT" ]; then
    echo "⚠️  跳过：工作区不存在"
    ((SKIPPED++))
    continue
  fi
  
  # 检查插件是否已为该 Agent 启用
  if openclaw plugins info evo-cortex 2>&1 | grep -q "Status: loaded"; then
    echo "✅ 插件已全局安装"
  else
    echo "⚠️  插件未安装，请先运行:"
    echo "   openclaw plugins install $SCRIPT_DIR/.."
    ((FAILED++))
    continue
  fi
  
  # 配置定时任务
  echo "⏳ 配置定时任务..."
  if bash "$SCRIPT_DIR/setup-crons-hybrid.sh" "$AGENT" "$LEVEL" "$MODE" 2>&1 | tail -5; then
    echo "✅ $AGENT 配置成功"
    ((SUCCESS++))
  else
    echo "❌ $AGENT 配置失败"
    ((FAILED++))
  fi
  
  echo ""
done

# ========== 步骤 4: 总结 ==========
echo "===================================="
echo "📊 配置完成总结"
echo "===================================="
echo "✅ 成功：$SUCCESS"
echo "❌ 失败：$FAILED"
echo "⚠️  跳过：$SKIPPED"
echo ""

if [ "$SUCCESS" -gt 0 ]; then
  echo "下一步操作:"
  echo ""
  echo "1. 验证所有 Agent 的任务:"
  echo "   openclaw cron list | grep -E \"$(echo $AGENTS_TO_CONFIGURE | tr ' ' '|')\""
  echo ""
  echo "2. 查看某个 Agent 的进化结果:"
  echo "   cat $HOME/.openclaw/workspace-<agent>/evolution/<agent>/meta-rules-*.md"
  echo ""
  echo "3. 监控所有 Agent 的任务执行:"
  echo "   openclaw logs --follow | grep evolution"
  echo ""
fi

# 生成配置报告
REPORT_FILE="$OPENCLAW_ROOT/evo-cortex-batch-config-$(date +%Y%m%d-%H%M%S).md"

cat << EOF > "$REPORT_FILE"
# Evo-Cortex 批量配置报告

**时间**: $(date)
**配置级别**: $LEVEL
**执行模式**: $MODE

## 配置的 Agent

$(echo "$AGENTS_TO_CONFIGURE" | tr ' ' '\n' | nl)

## 统计

- 成功：$SUCCESS
- 失败：$FAILED
- 跳过：$SKIPPED

## 验证命令

\`\`\`bash
# 查看所有配置的任务
openclaw cron list | grep -E "$(echo $AGENTS_TO_CONFIGURE | tr ' ' '|')"

# 验证单个 Agent
$HOME/.openclaw/extensions/evo-cortex/scripts/verify-setup.sh <agent-id>
\`\`\`

---
*此报告由 install-for-all-agents.sh 自动生成*
EOF

echo "📄 配置报告已保存到：$REPORT_FILE"
echo ""
echo "🎉 批量配置完成！"
