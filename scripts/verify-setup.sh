#!/bin/bash
# Evo-Cortex 配置验证脚本
# 检查所有组件是否正确配置

set -e

AGENT_ID="${1:-main}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "🔍 Evo-Cortex 配置验证"
echo "======================"
echo "Agent: $AGENT_ID"
echo ""

PASS=0
FAIL=0
WARN=0

# 检查函数
check() {
  local name="$1"
  local cmd="$2"
  
  if eval "$cmd" > /dev/null 2>&1; then
    echo "✅ $name"
    ((PASS++))
  else
    echo "❌ $name"
    ((FAIL++))
  fi
}

warn() {
  local name="$1"
  local msg="$2"
  
  echo "⚠️  $name: $msg"
  ((WARN++))
}

# ========== 1. 插件安装检查 ==========
echo "📦 插件安装检查"
echo "--------------"

check "插件已安装" \
  "openclaw plugins info evo-cortex 2>&1 | grep -q 'Status: loaded'"

check "工具已注册" \
  "openclaw plugins info evo-cortex 2>&1 | grep -q 'search_memory'"

if [ -f "$SCRIPT_DIR/evolution-runner.ts" ]; then
  check "Runner 脚本存在" "test -f '$SCRIPT_DIR/evolution-runner.ts'"
else
  warn "Runner 脚本" "evolution-runner.ts 不存在，Script 模式将不可用"
fi

if [ -f "$SCRIPT_DIR/setup-crons-hybrid.sh" ]; then
  check "配置脚本存在" "test -f '$SCRIPT_DIR/setup-crons-hybrid.sh'"
else
  warn "配置脚本" "setup-crons-hybrid.sh 不存在"
fi

echo ""

# ========== 2. 定时任务检查 ==========
echo "⏰ 定时任务检查"
echo "--------------"

TASK_COUNT=$(openclaw cron list 2>&1 | grep -c "$AGENT_ID" || echo "0")
echo "发现 $TASK_COUNT 个属于 $AGENT_ID 的任务"

if [ "$TASK_COUNT" -ge 3 ]; then
  check "核心任务已配置" "[ $TASK_COUNT -ge 3 ]"
else
  warn "核心任务" "至少需要 3 个核心任务，当前只有 $TASK_COUNT 个"
fi

# 检查具体任务
for task in hourly-fractal daily-review active-learning; do
  if openclaw cron list 2>&1 | grep -q "$task-$AGENT_ID"; then
    check "任务 $task 已配置" "true"
  else
    warn "任务 $task" "未配置"
  fi
done

echo ""

# ========== 3. 目录结构检查 ==========
echo "📁 目录结构检查"
echo "--------------"

WORKSPACE_ROOT="$HOME/.openclaw/workspace-$AGENT_ID"

check "工作区目录存在" "test -d '$WORKSPACE_ROOT'"

check "记忆目录存在" "test -d '$WORKSPACE_ROOT/memory/$AGENT_ID'"
check "知识目录存在" "test -d '$WORKSPACE_ROOT/knowledge/$AGENT_ID'"
check "进化目录存在" "test -d '$WORKSPACE_ROOT/evolution/$AGENT_ID'"
check "数据目录存在" "test -d '$WORKSPACE_ROOT/data/$AGENT_ID'"

echo ""

# ========== 4. 功能测试 ==========
echo "🧪 功能测试"
echo "----------"

# 记忆搜索测试
if openclaw memory search "测试" --agent "$AGENT_ID" 2>&1 | grep -q -E "([0-9]+\.)|No matches"; then
  check "记忆搜索可用" "true"
else
  warn "记忆搜索" "可能未正确索引"
fi

# 索引状态检查
if openclaw memory status --agent "$AGENT_ID" 2>&1 | grep -q "Vector: ready"; then
  check "向量索引就绪" "true"
else
  warn "向量索引" "未就绪或未配置"
fi

if openclaw memory status --agent "$AGENT_ID" 2>&1 | grep -q "FTS: ready"; then
  check "全文索引就绪" "true"
else
  warn "全文索引" "未就绪或未配置"
fi

echo ""

# ========== 5. 文件权限检查 ==========
echo "🔐 文件权限检查"
echo "--------------"

if [ -x "$SCRIPT_DIR/quick-setup.sh" ]; then
  check "快速配置脚本可执行" "true"
else
  warn "快速配置脚本" "缺少执行权限"
fi

if [ -r "$WORKSPACE_ROOT/memory/$AGENT_ID" ] 2>/dev/null; then
  check "记忆目录可读" "true"
else
  warn "记忆目录" "不可读"
fi

if [ -w "$WORKSPACE_ROOT/evolution/$AGENT_ID" ] 2>/dev/null; then
  check "进化目录可写" "true"
else
  warn "进化目录" "不可写"
fi

echo ""

# ========== 总结 ==========
echo "======================"
echo "📊 验证结果"
echo "======================"
echo "✅ 通过：$PASS"
echo "❌ 失败：$FAIL"
echo "⚠️  警告：$WARN"
echo ""

if [ "$FAIL" -eq 0 ]; then
  echo "🎉 配置验证通过！系统已就绪。"
  echo ""
  echo "下一步:"
  echo "  • 等待定时任务自动执行"
  echo "  • 或手动触发：openclaw cron run <task-id>"
  echo "  • 查看结果：cat $WORKSPACE_ROOT/evolution/$AGENT_ID/meta-rules-*.md"
else
  echo "⚠️  发现 $FAIL 个问题，请根据上述提示修复。"
  echo ""
  echo "快速修复:"
  echo "  bash $SCRIPT_DIR/quick-setup.sh $AGENT_ID"
fi

echo ""
