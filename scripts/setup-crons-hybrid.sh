#!/bin/bash
# Evo-Cortex Hybrid Cron Setup Script
# 支持两种执行模式：
# - LLM 模式：通过 agent 智能执行（灵活但慢）
# - Script 模式：直接运行脚本（快速但固定）
#
# 用法:
#   bash setup-crons-hybrid.sh <agent-id> [basic|standard|full] [llm|script]

set -e

AGENT_ID="${1:-main}"
LEVEL="${2:-standard}"
MODE="${3:-script}"  # 默认使用 script 模式

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER_SCRIPT="$SCRIPT_DIR/evolution-runner.ts"

echo "🧬 Evo-Cortex Hybrid Cron 配置工具"
echo "Agent: $AGENT_ID"
echo "配置级别：$LEVEL"
echo "执行模式：$MODE"
echo "---"

# 检查是否已存在相同的任务
check_existing() {
    local name=$1
    if openclaw cron list 2>/dev/null | grep -q "$name-$AGENT_ID"; then
        echo "⚠️  任务 '$name' 已存在，跳过"
        return 0
    else
        return 1
    fi
}

# 添加定时任务（LLM 模式）
add_cron_llm() {
    local name=$1
    local cron_expr=$2
    local message=$3
    
    if check_existing "$name"; then
        return 0
    fi
    
    echo "✅ [LLM] 创建任务：$name"
    
    openclaw cron add \
        --name "$name-$AGENT_ID" \
        --agent "$AGENT_ID" \
        --cron "$cron_expr" \
        --message "$message" \
        --session isolated \
        --description "Evo-Cortex (LLM): $name" \
        2>/dev/null
}

# 添加定时任务（Script 模式）
add_cron_script() {
    local name=$1
    local cron_expr=$2
    local task_type=$3
    
    if check_existing "$name"; then
        return 0
    fi
    
    echo "✅ [Script] 创建任务：$name"
    
    # 使用 system event 触发脚本执行
    openclaw cron add \
        --name "$name-$AGENT_ID" \
        --agent "$AGENT_ID" \
        --cron "$cron_expr" \
        --system-event "EXECUTE_SCRIPT:$RUNNER_SCRIPT:$task_type:$AGENT_ID" \
        --sessionTarget main \
        --description "Evo-Cortex (Script): $name" \
        2>/dev/null
}

# 根据模式选择添加方式
add_task() {
    local name=$1
    local cron_expr=$2
    local message=$3
    local task_type=$4
    
    if [ "$MODE" = "llm" ]; then
        add_cron_llm "$name" "$cron_expr" "$message"
    else
        add_cron_script "$name" "$cron_expr" "$task_type"
    fi
}

# ========== 核心任务 ==========
add_core_tasks() {
    echo ""
    echo "📋 配置核心任务..."
    
    add_task "hourly-fractal" "0 * * * *" \
        "请运行分形思考，分析对话模式，生成元规则" \
        "hourly-fractal"
    
    add_task "daily-review" "0 9 * * *" \
        "请审查知识图谱，优化知识结构" \
        "daily-review"
    
    add_task "active-learning" "0 4 * * *" \
        "请检测学习机会，识别知识缺口" \
        "active-learning"
}

# ========== 增强任务 ==========
add_enhanced_tasks() {
    echo ""
    echo "📋 配置增强任务..."
    
    add_task "daily-compress" "0 9:30 * * *" \
        "请压缩昨天的记忆，生成摘要" \
        "daily-compress"
    
    add_task "weekly-compress" "0 3 * * 0" \
        "请压缩本周的记忆，生成摘要" \
        "weekly-compress"
    
    add_task "weekly-kg-expansion" "0 5 * * 0" \
        "请扩展知识图谱" \
        "weekly-kg-expansion"
    
    add_task "monthly-cycle" "0 2 1 * *" \
        "请执行月度进化周期" \
        "monthly-cycle"
}

# ========== 高级任务 ==========
add_advanced_tasks() {
    echo ""
    echo "📋 配置高级任务..."
    
    add_task "nightly-evolution" "0 23 * * *" \
        "请进行每日进化总结" \
        "nightly-evolution"
    
    add_task "session-scan" "0 */2 * * *" \
        "请扫描最近的会话" \
        "session-scan"
}

# ========== 主流程 ==========
case "$LEVEL" in
    basic)
        add_core_tasks
        ;;
    standard)
        add_core_tasks
        add_enhanced_tasks
        ;;
    full)
        add_core_tasks
        add_enhanced_tasks
        add_advanced_tasks
        ;;
    *)
        echo "❌ 错误：未知的配置级别 '$LEVEL'"
        exit 1
        ;;
esac

echo ""
echo "✅ 配置完成！"
echo ""
echo "📊 配置摘要:"
echo "  执行模式：$MODE"
if [ "$MODE" = "llm" ]; then
    echo "  • 优点：灵活智能，可应对复杂情况"
    echo "  • 缺点：每次调用 LLM，成本较高，速度较慢"
else
    echo "  • 优点：快速高效，无 LLM 成本，结果一致"
    echo "  • 缺点：灵活性较低，依赖预定义逻辑"
fi
echo ""
echo "查看任务列表:"
echo "  openclaw cron list | grep $AGENT_ID"
echo ""
echo "切换模式:"
echo "  # 先删除现有任务"
echo "  openclaw cron remove <task-id>"
echo "  # 然后用另一种模式重新配置"
echo "  bash $0 $AGENT_ID $LEVEL llm"
