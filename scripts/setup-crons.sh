#!/bin/bash
# Evo-Cortex Cron Setup Script
# 自动为指定 agent 配置进化相关的定时任务
# 
# 用法:
#   bash setup-crons.sh <agent-id> [basic|standard|full]
#
# 配置级别:
#   basic    - 仅核心任务（3 个）
#   standard - 核心 + 增强（7 个）← 默认
#   full     - 全部任务（9 个）

set -e

AGENT_ID="${1:-main}"
LEVEL="${2:-standard}"
VERBOSE="${3:-false}"

echo "🧬 Evo-Cortex Cron 配置工具"
echo "Agent: $AGENT_ID"
echo "配置级别：$LEVEL"
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

# 添加定时任务
add_cron() {
    local name=$1
    local cron_expr=$2
    local message=$3
    local priority=${4:-MEDIUM}
    
    if check_existing "$name"; then
        return 0
    fi
    
    echo "✅ [$priority] 创建任务：$name"
    
    openclaw cron add \
        --name "$name-$AGENT_ID" \
        --agent "$AGENT_ID" \
        --cron "$cron_expr" \
        --message "$message" \
        --session isolated \
        --description "Evo-Cortex: $name" \
        2>/dev/null
    
    if [ "$VERBOSE" = "true" ]; then
        echo "      调度：$cron_expr"
        echo "      消息：${message:0:60}..."
    fi
}

# ========== 核心任务（HIGH 优先级）==========
add_core_tasks() {
    echo ""
    echo "📋 配置核心任务（HIGH 优先级）..."
    
    add_cron "hourly-fractal" "0 * * * *" \
        "请运行分形思考，分析最近的对话模式，识别重复的行为和决策模式，生成 1-3 条元规则（meta-rules）。将规则保存到 evolution 目录。" \
        "HIGH"
    
    add_cron "daily-review" "0 9 * * *" \
        "请审查知识图谱，识别重复、过时或低质量的知识实体。清理无用知识，合并相似实体，优化知识结构。" \
        "HIGH"
    
    add_cron "active-learning" "0 4 * * *" \
        "请检测学习机会：分析最近对话中的知识缺口，识别需要补充的领域，提出具体的学习计划。" \
        "HIGH"
}

# ========== 增强任务（MEDIUM 优先级）==========
add_enhanced_tasks() {
    echo ""
    echo "📋 配置增强任务（MEDIUM 优先级）..."
    
    add_cron "daily-compress" "0 9:30 * * *" \
        "请压缩昨天的记忆，生成每日摘要。保留重要事件，合并相似对话，清理临时记忆。" \
        "MEDIUM"
    
    add_cron "weekly-compress" "0 3 * * 0" \
        "请压缩本周的记忆，生成本周摘要。保留重要事件，合并相似对话，清理临时记忆。" \
        "MEDIUM"
    
    add_cron "weekly-kg-expansion" "0 5 * * 0" \
        "请扩展知识图谱：基于本周的对话和学习，添加新的概念和关系，丰富知识网络。" \
        "MEDIUM"
    
    add_cron "monthly-cycle" "0 2 1 * *" \
        "请执行月度进化周期：整合本月生成的所有元规则，评估规则的实用性，refine 过时的规则，生成本月进化报告。" \
        "MEDIUM"
}

# ========== 可选任务（LOW 优先级）==========
add_advanced_tasks() {
    echo ""
    echo "📋 配置高级任务（LOW 优先级）..."
    
    add_cron "nightly-evolution" "0 23 * * *" \
        "请进行每日进化总结：回顾今天的对话，提取关键洞察，更新元规则，为明天做准备。" \
        "LOW"
    
    add_cron "session-scan" "0 */2 * * *" \
        "请扫描最近的会话，将有价值的内容保存到记忆系统。每 2 小时执行一次。" \
        "LOW"
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
        echo "支持的级别：basic, standard, full"
        exit 1
        ;;
esac

echo ""
echo "✅ 配置完成！"
echo ""
echo "📊 配置摘要:"
if [ "$LEVEL" = "basic" ]; then
    echo "  • 核心任务：3 个"
elif [ "$LEVEL" = "standard" ]; then
    echo "  • 核心任务：3 个"
    echo "  • 增强任务：4 个"
else
    echo "  • 核心任务：3 个"
    echo "  • 增强任务：4 个"
    echo "  • 高级任务：2 个"
fi
echo ""
echo "查看任务列表:"
echo "  openclaw cron list | grep $AGENT_ID"
echo ""
echo "手动触发测试:"
echo "  openclaw cron run <task-id>"
echo ""
echo "删除任务:"
echo "  openclaw cron remove <task-id>"
echo ""
echo "💡 提示："
echo "  • basic    - 仅核心进化能力（适合资源有限的环境）"
echo "  • standard - 完整的自进化系统（推荐）"
echo "  • full     - 最大化进化能力（适合高频使用场景）"
