#!/bin/bash
# ═══════════════════════════════════════════════════════════
# 🌐 Evo-Cortex 网络知识自动获取脚本
# ═══════════════════════════════════════════════════════════
# 用途：从配置的 URL 列表抓取网页内容，提取知识并更新知识图谱
# 特点：幂等、并发安全、支持多 Agent 同时调用
# 用法：bash web-knowledge-fetch.sh <agent-id>
# ═══════════════════════════════════════════════════════════

set -euo pipefail

# 获取脚本目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 加载通用库
if [ -f "$SCRIPT_DIR/lib.sh" ]; then
  source "$SCRIPT_DIR/lib.sh"
else
  echo "[ERROR] 未找到 lib.sh 库文件：$SCRIPT_DIR/lib.sh"
  exit 1
fi

# ═══════════════════════════════════════════════════════════
# 主函数
# ═══════════════════════════════════════════════════════════

main() {
  # 解析参数
  if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
    show_usage
    exit 0
  fi
  
  # 验证 Agent ID
  local AGENT_ID
  AGENT_ID=$(validate_agent_id "${1:-}")
  
  log_info "🌐 Evo-Cortex 网络知识获取"
  log_info "Agent: $AGENT_ID"
  
  # 验证 Workspace
  local WORKSPACE
  WORKSPACE=$(validate_workspace "$AGENT_ID")
  log_info "Workspace: $WORKSPACE"
  
  # 检查依赖
  check_dependencies "npx"
  
  # 设置锁（防止同一 Agent 并发执行）
  local LOCK_NAME="web-knowledge-$AGENT_ID"
  
  if [ "${NO_LOCK:-false}" != "true" ]; then
    if ! acquire_lock "$LOCK_NAME" 300; then
      log_error "无法获取锁，可能有其他实例正在运行"
      exit 1
    fi
  else
    log_warning "已禁用锁机制（危险！）"
  fi
  
  # 记录开始时间
  start_timer
  
  # 执行 TypeScript 脚本
  local EXIT_CODE=0
  
  log_info "开始获取网络知识..."
  echo ""
  
  cd "$SCRIPT_DIR"
  export OPENCLAW_WORKSPACE="$WORKSPACE"
  
  # 使用 npx 运行 TypeScript（无需全局安装 ts-node）
  if npx ts-node web-knowledge-fetcher-simple.ts "$AGENT_ID"; then
    log_success "网络知识获取成功"
  else
    EXIT_CODE=$?
    log_error "网络知识获取失败 (退出码：$EXIT_CODE)"
  fi
  
  # 记录结束时间
  echo ""
  end_timer "网络知识获取"
  
  # 释放锁
  if [ "${NO_LOCK:-false}" != "true" ]; then
    release_lock "$LOCK_NAME"
  fi
  
  # 显示摘要
  print_summary 1 0 $((EXIT_CODE > 0 ? 1 : 0))
  
  exit $EXIT_CODE
}

show_usage() {
  cat << EOF
用法：$(basename "$0") <agent-id> [选项]

🌐 Evo-Cortex 网络知识获取脚本

参数:
  agent-id    OpenClaw Agent 的唯一标识符

选项:
  -h, --help     显示帮助信息
  --no-lock      禁用锁机制（不推荐，仅调试用）

功能:
  • 从 knowledge/sources.json 读取配置的 URL
  • 自动抓取网页内容
  • 提取标题、关键词和实体
  • 保存到 knowledge/web-sources/ 目录
  • 追加到当天的记忆文件
  • 生成详细的执行报告

示例:
  $(basename "$0") cortex-test-agent
  $(basename "$0") plugin-demo-agent --no-lock

配置:
  编辑 ~/.openclaw/extensions/evo-cortex/knowledge/sources.json
  添加或删除需要抓取的 URL

建议运行频率:
  • 每天凌晨 2 点：0 2 * * *
  • 每周一三五：0 3 * * 1,3,5
  • 每周日凌晨：0 4 * * 0

EOF
}

# ═══════════════════════════════════════════════════════════
# 启动
# ═══════════════════════════════════════════════════════════

main "$@"
