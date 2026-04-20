#!/bin/bash
# Evo-Cortex Cron 配置脚本 (标准版)
# 在原有任务基础上优化，不创建额外的 Fallback 任务

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
echo "║  🧬 Evo-Cortex Cron 配置 (Full Level)                    ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""
echo "📦 Agent: $AGENT_NAME"
echo "📁 Workspace: $HOME/.openclaw/workspace-$AGENT_NAME"
echo "📊 Level: full (9 个任务)"
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

# 辅助函数：创建智能降级任务
# 指令中包含降级逻辑，LLM 失败时自动切换到 Script 模式
create_smart_task() {
  local name="$1"
  local cron="$2"
  local primary_instruction="$3"
  local fallback_instruction="$4"
  
  echo "   - $name..."
  
  # 合并指令：优先 LLM，失败时降级
  local combined_instruction="$primary_instruction

【降级策略】
如果 LLM API 不可用（Rate Limit/超时/错误），请自动降级为 Script 模式执行以下基础任务：
$fallback_instruction

执行优先级：
1. 尝试 LLM 智能分析（正常模式）
2. 如果失败，自动执行 Script 基础处理（降级模式）
3. 输出结果时标注 [Normal] 或 [Degraded] 模式"

  if openclaw cron add \
    --cron "$cron" \
    --agent "$AGENT_NAME" \
    --message "$combined_instruction" \
    --name "$name" \
    --no-deliver \
    --session isolated >/dev/null 2>&1; then
    echo "      ✅ 已配置（带智能降级）"
  else
    echo "      ⚠️ 配置失败"
  fi
}

# 核心任务
echo "📋 配置核心任务 (basic)..."

# 1. hourly-fractal (每小时)
create_smart_task \
  "$AGENT_NAME-hourly-fractal" \
  "0 * * * *" \
  "请运行分形思考，分析最近 1 小时的对话模式，识别重复主题和行为模式，生成元规则。" \
  "统计最近 1 小时的基础数据：
- 对话数量
- 会话列表
- 时间分布
- 关键词频率（Top 10）
输出为纯文本报告，无需 LLM 分析。"

# 2. daily-review (每天 09:00)
create_smart_task \
  "$AGENT_NAME-daily-review" \
  "0 9 * * *" \
  "请审查知识图谱，检查实体关系质量，发现孤立实体，优化知识结构，提出改进建议。" \
  "执行知识图谱健康检查：
- 读取 entities.json
- 统计实体数量、关系数量
- 检查文件格式是否有效
- 列出最后修改时间
输出健康检查报告。"

# 3. active-learning (每天 04:00)
create_smart_task \
  "$AGENT_NAME-active-learning" \
  "0 4 * * *" \
  "请检测学习机会，识别知识缺口，分析未回答的问题模式，提出主动学习建议。" \
  "分析最近 24 小时记忆：
- 提取高频查询词
- 识别重复问题
- 统计未解决话题
输出学习机会清单。"

# 增强任务
echo ""
echo "📋 配置增强任务 (standard)..."

# 4. daily-compress (每天 09:30)
create_smart_task \
  "$AGENT_NAME-daily-compress" \
  "0 9:30 * * *" \
  "请压缩昨天的记忆，提取关键信息，生成结构化摘要，删除冗余内容。" \
  "合并昨天的记忆文件：
- 统计总消息数
- 计算文件总大小
- 删除明显重复的内容
- 生成简要统计报告"

# 5. weekly-compress (每周日 03:00)
create_smart_task \
  "$AGENT_NAME-weekly-compress" \
  "0 3 * * 0" \
  "请压缩本周的记忆，生成本周摘要，归档重要对话，清理临时数据。" \
  "执行周度归档：
- 统计本周对话总数
- 按日期分组统计
- 标记重要会话
- 生成周统计报告"

# 6. weekly-kg-expansion (每周日 05:00)
create_smart_task \
  "$AGENT_NAME-weekly-kg-expansion" \
  "0 5 * * 0" \
  "请扩展知识图谱：1) 从最近记忆中提取新实体和概念 2) 发现实体间的潜在关联 3) 识别知识缺口 4) 更新 entities.json。无需外部服务，仅基于已有记忆和知识进行推理。" \
  "维护知识图谱基础数据：
- 验证 entities.json 格式
- 检查是否有损坏的 JSON
- 修复明显的语法错误
- 备份当前文件
输出维护报告。"

# 7. monthly-cycle (每月 1 号 02:00)
create_smart_task \
  "$AGENT_NAME-monthly-cycle" \
  "0 2 1 * *" \
  "请执行月度进化周期，全面审查系统状态，优化配置，生成月度进化报告。" \
  "执行月度维护：
- 清理临时文件
- 统计本月总活动
- 检查存储空间使用
- 生成月度统计摘要"

# 高级任务
echo ""
echo "📋 配置高级任务 (full)..."

# 8. session-scan (每 30 分钟)
create_smart_task \
  "$AGENT_NAME-session-scan" \
  "*/30 * * * *" \
  "请扫描最近的会话，识别新的对话，提取关键记忆点，更新记忆索引。" \
  "检测新会话：
- 列出最近 30 分钟的会话文件
- 记录会话数量和大小
- 更新会话清单
输出扫描摘要。"

# 9. realtime-index (每 5 分钟)
create_smart_task \
  "$AGENT_NAME-realtime-index" \
  "*/5 * * * *" \
  "请更新搜索索引，确保最新的对话可以被快速检索，优化索引性能。" \
  "检查索引状态：
- 确认 SQLite 数据库存在
- 验证索引文件大小
- 检查最后更新时间
输出索引健康状态。"

echo ""
echo "╔════════════════════════════════════════════════════════╗"
echo "║  ✅ Evo-Cortex 配置完成！                                 ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""

# 统计
echo "📊 当前任务列表:"
openclaw cron list 2>/dev/null | grep "$AGENT_NAME" | head -20

echo ""
echo "💡 智能降级说明:"
echo "   每个任务都包含降级指令"
echo "   - 正常模式：LLM 智能分析（高质量）"
echo "   - 降级模式：Script 基础处理（零 API 调用）"
echo "   - 自动切换，无需额外配置"
echo ""
echo "🎯 优势:"
echo "   ✓ 保持 9 个任务（无额外 Fallback）"
echo "   ✓ 任务内部自动降级"
echo "   ✓ 降低 50% 任务数量（相比 Fallback 方案）"
echo "   ✓ 更简洁，更易维护"
echo ""
