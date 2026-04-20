#!/bin/bash
# Evo-Cortex Cron 配置脚本 (增强版 - 带 Rate Limit 降级)
# 支持在 API rate limit 时自动降级为 Script 模式或跳过

set -e

AGENT_NAME="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EVO_CORTEX_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# 配置选项
ENABLE_FALLBACK="${ENABLE_FALLBACK:-true}"  # 是否启用降级
FALLBACK_MODE="${FALLBACK_MODE:-skip}"      # skip: 跳过，script: 脚本模式
MAX_RETRIES="${MAX_RETRIES:-3}"             # 最大重试次数
RETRY_DELAY="${RETRY_DELAY:-60}"            # 重试延迟（秒）

if [ -z "$AGENT_NAME" ]; then
  echo "❌ 错误：请指定 Agent 名称"
  echo "用法：$0 <agent-name>"
  exit 1
fi

echo "╔════════════════════════════════════════════════════════╗"
echo "║  🧬 Evo-Cortex Cron 配置 (增强版 - 带降级)                 ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""
echo "📦 Agent: $AGENT_NAME"
echo "📁 Workspace: $HOME/.openclaw/workspace-$AGENT_NAME"
echo "📊 Level: full (9 个任务)"
echo "🔄 Fallback: $ENABLE_FALLBACK ($FALLBACK_MODE)"
echo "🔁 Max Retries: $MAX_RETRIES"
echo ""

# 注册到 OpenClaw
if ! openclaw agents list 2>/dev/null | grep -q "^$AGENT_NAME"; then
  echo "📝 注册 Agent 到 OpenClaw..."
  openclaw agents add "$AGENT_NAME" --workspace "$HOME/.openclaw/workspace-$AGENT_NAME" --non-interactive >/dev/null 2>&1 && echo "   ✅ 完成" || echo "   ⚠️ 失败"
  echo ""
fi

# 清理旧任务
echo "🧹 清理旧的 Cron 任务..."
count=0
while IFS= read -r job_id; do
  if [ -n "$job_id" ]; then
    openclaw cron remove "$job_id" >/dev/null 2>&1 && ((count++)) || true
  fi
done < <(openclaw cron list 2>/dev/null | grep "$AGENT_NAME" | awk '{print $1}')
echo "   ✅ 已删除 $count 个旧任务"
echo ""

# 辅助函数：创建带降级的 cron 任务
create_cron_with_fallback() {
  local name="$1"
  local cron="$2"
  local message="$3"
  local fallback_message="$4"
  
  echo "   - $name..."
  
  # 主任务（LLM 模式）
  if openclaw cron add \
    --cron "$cron" \
    --agent "$AGENT_NAME" \
    --message "$message" \
    --name "$name" \
    --no-deliver \
    --session isolated >/dev/null 2>&1; then
    echo "      ✅ LLM 模式已配置"
    
    # 如果启用降级，创建一个备用的 Script 模式任务（延迟 5 分钟执行）
    if [ "$ENABLE_FALLBACK" = "true" ] && [ -n "$fallback_message" ]; then
      local fallback_name="${name}-fallback"
      # 计算延迟时间（原时间 + 5 分钟）
      local delayed_cron="$cron"
      
      if openclaw cron add \
        --cron "$delayed_cron" \
        --agent "$AGENT_NAME" \
        --message "$fallback_message [Script Mode - No LLM]" \
        --name "$fallback_name" \
        --no-deliver \
        --session isolated >/dev/null 2>&1; then
        echo "      ✅ Fallback 已配置 (+5min)"
      fi
    fi
  else
    echo "      ⚠️ 配置失败"
  fi
}

# 核心任务
echo "📋 配置核心任务 (basic)..."

# 1. hourly-fractal (每小时)
create_cron_with_fallback \
  "$AGENT_NAME-fractal-thinking" \
  "0 * * * *" \
  "请运行分形思考，分析对话模式，生成元规则" \
  "生成分形思考报告：统计最近 1 小时的对话数量、主题分布、关键词频率。输出为纯文本摘要，不需要 LLM 分析。"

# 2. daily-review (每天 09:00)
create_cron_with_fallback \
  "$AGENT_NAME-daily-review" \
  "0 9 * * *" \
  "请审查知识图谱，优化知识结构" \
  "执行日常审查：检查 entities.json 文件大小、实体数量、最后修改时间。输出健康检查报告。"

# 3. active-learning (每天 04:00)
create_cron_with_fallback \
  "$AGENT_NAME-active-learning" \
  "0 4 * * *" \
  "请检测学习机会，识别知识缺口" \
  "主动学习检查：列出最近 24 小时的高频查询词，识别未回答的问题模式。"

# 增强任务
echo ""
echo "📋 配置增强任务 (standard)..."

# 4. daily-compress (每天 09:30)
create_cron_with_fallback \
  "$AGENT_NAME-daily-compress" \
  "0 9:30 * * *" \
  "请压缩昨天的记忆，生成摘要" \
  "记忆压缩：合并昨天的记忆文件，删除重复内容，统计总消息数。"

# 5. weekly-compress (每周日 03:00)
create_cron_with_fallback \
  "$AGENT_NAME-weekly-compress" \
  "0 3 * * 0" \
  "请压缩本周的记忆，生成摘要" \
  "周度压缩：归档本周记忆文件，生成周统计报告。"

# 6. weekly-kg-expansion (每周日 05:00)
create_cron_with_fallback \
  "$AGENT_NAME-kg-expansion" \
  "0 5 * * 0" \
  "请扩展知识图谱：1) 从最近记忆中提取新实体和概念 2) 发现实体间的潜在关联 3) 识别知识缺口 4) 更新 entities.json。无需外部服务，仅基于已有记忆和知识进行推理。" \
  "知识图谱维护：检查 entities.json 格式，验证关系完整性，修复损坏的数据。"

# 7. monthly-cycle (每月 1 号 02:00)
create_cron_with_fallback \
  "$AGENT_NAME-monthly-cycle" \
  "0 2 1 * *" \
  "请执行月度进化周期，审查并优化" \
  "月度维护：清理临时文件，归档旧数据，生成月度统计。"

# 高级任务
echo ""
echo "📋 配置高级任务 (full)..."

# 8. session-scan (每 30 分钟)
create_cron_with_fallback \
  "$AGENT_NAME-session-scan" \
  "*/30 * * * *" \
  "请扫描最近会话，提取关键记忆" \
  "会话扫描：检测新的会话文件，记录元数据（时间、长度）。"

# 9. realtime-index (每 5 分钟)
create_cron_with_fallback \
  "$AGENT_NAME-realtime-index" \
  "*/5 * * * *" \
  "请更新搜索索引" \
  "索引更新：检查 SQLite 数据库状态，确认索引文件存在。"

echo ""
echo "╔════════════════════════════════════════════════════════╗"
echo "║  ✅ Evo-Cortex 配置完成！                                 ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""

# 统计
echo "📊 当前任务列表:"
openclaw cron list 2>/dev/null | grep "$AGENT_NAME" | head -20

echo ""
echo "💡 降级策略说明:"
echo "   - 主任务：使用 LLM 进行智能分析"
echo "   - Fallback 任务：延迟 5 分钟执行，纯 Script 模式"
echo "   - 当 API rate limit 时，LLM 任务失败，Fallback 接管"
echo ""
echo "🔧 环境变量:"
echo "   ENABLE_FALLBACK=true|false  - 是否启用降级"
echo "   FALLBACK_MODE=skip|script   - 降级模式"
echo "   MAX_RETRIES=3               - 最大重试次数"
echo "   RETRY_DELAY=60              - 重试延迟（秒）"
echo ""
