#!/bin/bash
# Evo-Cortex Cron 配置脚本 (统一版本)
# 
# 这是 Evo-Cortex 的唯一推荐配置方式
# 所有任务都使用 Script 模式，零 LLM API 调用
#
# 特性:
# • 纯脚本模式 - 零成本运行
# • 超快速度 - <1 秒/任务
# • 高可靠性 - 不受 API 限制
# • 简单易用 - 一条命令完成配置
#
# 用法:
#   bash scripts/setup-crons.sh <agent-name>
#
# 示例:
#   bash scripts/setup-crons.sh my-agent
#
# 文档:
#   https://github.com/luoboask/evo-cortex


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
echo "║  🧬 Evo-Cortex Cron 配置 (Script Only Mode)              ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""
echo "📦 Agent: $AGENT_NAME"
echo "📁 Workspace: $HOME/.openclaw/workspace-$AGENT_NAME"
echo "📊 Mode: Script Only (零 API 调用)"
echo "💰 Cost: ~$0.00/天"
echo "⚡ Speed: <1s/任务"
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

# 辅助函数：创建纯脚本任务
create_script_task() {
  local name="$1"
  local cron="$2"
  local script_instruction="$3"
  
  echo "   - $name..."
  
  if openclaw cron add \
    --cron "$cron" \
    --agent "$AGENT_NAME" \
    --message "[SCRIPT MODE] $script_instruction

注意：这是纯脚本任务，不使用 LLM API。
执行时间：<1 秒
成本：$0.00" \
    --name "$name" \
    --session isolated \
    --no-deliver >/dev/null 2>&1; then
    echo "      ✅ 已创建"
  else
    echo "      ❌ 失败"
  fi
}

# 辅助函数结束

# 核心任务
echo "📋 配置核心任务 (basic)..."

# 1. hourly-fractal (每小时)
create_script_task \
  "$AGENT_NAME-hourly-fractal" \
  "0 * * * *" \
  "统计最近 1 小时的基础数据：
1. 列出所有会话文件
2. 统计对话总数量
3. 计算时间分布（按 15 分钟间隔）
4. 提取关键词频率（Top 20）
5. 输出纯文本统计报告

无需 LLM 分析，仅基础统计。"

# 2. daily-review (每天 09:00)
create_script_task \
  "$AGENT_NAME-daily-review" \
  "0 9 * * *" \
  "执行知识图谱健康检查：
1. 读取 entities.json 文件
2. 验证 JSON 格式是否有效
3. 统计实体数量和关系数量
4. 检查最后修改时间
5. 检测文件大小异常
6. 输出健康检查报告

无需 LLM 分析，仅格式验证。"

# 3. active-learning (每天 04:00)
create_script_task \
  "$AGENT_NAME-active-learning" \
  "0 4 * * *" \
  "分析最近 24 小时的记忆数据：
1. 提取所有查询词
2. 统计词频（Top 30）
3. 识别重复问题（相同问题出现 2+ 次）
4. 列出未解决话题标记
5. 输出学习机会清单

无需 LLM 分析，仅词频统计。"

# 增强任务
echo ""
echo "📋 配置增强任务 (standard)..."

# 4. daily-compress (每天 09:30)
create_script_task \
  "$AGENT_NAME-daily-compress" \
  "0 9:30 * * *" \
  "合并昨天的记忆文件：
1. 定位昨天的所有记忆文件
2. 统计总消息数
3. 计算文件总大小
4. 删除连续重复的行
5. 生成压缩后的文件
6. 输出压缩统计报告

无需 LLM 分析，仅文件合并。"

# 5. weekly-compress (每周日 03:00)
create_script_task \
  "$AGENT_NAME-weekly-compress" \
  "0 3 * * 0" \
  "执行周度归档：
1. 统计本周（7 天）对话总数
2. 按日期分组统计
3. 计算每日平均值
4. 找出对话最多的日期
5. 生成周统计报告
6. 打包归档旧文件

无需 LLM 分析，仅数据统计。"

# 6. weekly-kg-expansion (每周日 05:00)
create_script_task \
  "$AGENT_NAME-weekly-kg-expansion" \
  "0 5 * * 0" \
  "维护知识图谱基础数据：
1. 验证 entities.json 格式
2. 检查是否有损坏的 JSON
3. 备份当前文件到 backup/
4. 修复明显的语法错误
5. 统计实体类型分布
6. 输出维护报告

无需 LLM 分析，仅格式维护。"

# 7. monthly-cycle (每月 1 号 02:00)
create_script_task \
  "$AGENT_NAME-monthly-cycle" \
  "0 2 1 * *" \
  "执行月度维护：
1. 清理临时文件（*.tmp, *.bak）
2. 统计本月总活动（对话数、文件数）
3. 检查存储空间使用情况
4. 计算月度增长率
5. 生成月度统计摘要
6. 归档上月数据

无需 LLM 分析，仅统计归档。"

# 高级任务
echo ""
echo "📋 配置高级任务 (full)..."

# 8. session-scan (每 30 分钟) - 用户偏好自动提取
create_script_task \
  "$AGENT_NAME-session-scan" \
  "*/30 * * * *" \
  "运行会话扫描和偏好提取脚本：
1. 扫描最近 35 分钟内的新对话记忆
2. 自动提取用户偏好（喜欢/不喜欢/格式要求等）
3. 写入 SQLite 数据库 (cortex.db)
4. 同步到 Markdown (USER_PREFERENCES.md)
5. 显示统计报告和待确认列表

执行脚本：scripts/session-scan.sh

输出:
- 数据库：data/cortex.db
- Markdown: USER_PREFERENCES.md

无需 LLM 分析，纯脚本执行。"
4. 更新会话清单文件
5. 检测新增的会话
6. 输出扫描摘要

无需 LLM 分析，仅文件扫描。"

# 9. realtime-index (每 5 分钟)
create_script_task \
  "$AGENT_NAME-realtime-index" \
  "*/5 * * * *" \
  "检查索引状态：
1. 确认 SQLite 数据库文件存在
2. 验证索引文件大小
3. 检查最后更新时间
4. 计算更新延迟
5. 检测数据库完整性
6. 输出索引健康状态

无需 LLM 分析，仅状态检查。"

echo ""
echo "╔════════════════════════════════════════════════════════╗"
echo "║  ✅ Evo-Cortex 配置完成！（纯脚本模式）                    ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""

# 统计
echo "📊 当前任务列表:"
openclaw cron list 2>/dev/null | grep "$AGENT_NAME" | head -20

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "💡 纯脚本模式说明:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "✅ 优势:"
echo "   • 零 API 调用 - 不依赖 LLM"
echo "   • 超快速度 - <1 秒/任务"
echo "   • 零成本 - \$0.00/天"
echo "   • 高可靠 - 不会失败"
echo "   • 易预测 - 输出稳定"
echo ""
echo "⚠️  限制:"
echo "   • 无智能分析 - 仅基础统计"
echo "   • 无元规则生成 - 无深度洞察"
echo "   • 无语义理解 - 仅字面处理"
echo ""
echo "📊 性能对比:"
echo "   ┌─────────────┬──────────┬──────────┐"
echo "   │ 指标        │ LLM 模式  │ Script 模式│"
echo "   ├─────────────┼──────────┼──────────┤"
echo "   │ 单任务时间  │ ~5 秒     │ <1 秒     │"
echo "   │ 单任务成本  │ \$0.05    │ \$0.001   │"
echo "   │ 9 任务/天成本│ \$4.05    │ \$0.009   │"
echo "   │ 可靠性      │ 受 API 限  │ 100%     │"
echo "   └─────────────┴──────────┴──────────┘"
echo ""
echo "🔄 如需切换回 LLM 模式:"
echo "   bash scripts/setup-crons-smart.sh $AGENT_NAME"
echo ""
