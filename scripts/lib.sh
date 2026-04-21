#!/bin/bash
# ═══════════════════════════════════════════════════════════
# Evo-Cortex 脚本库 - 提供通用工具函数
# ═══════════════════════════════════════════════════════════
# 用途：为所有脚本提供幂等性、并发控制、错误处理等通用功能
# 用法：source lib.sh
# ═══════════════════════════════════════════════════════════

set -euo pipefail

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ═══════════════════════════════════════════════════════════
# 日志函数
# ═══════════════════════════════════════════════════════════

log_info() {
  echo -e "${BLUE}[INFO]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $*"
}

log_success() {
  echo -e "${GREEN}[SUCCESS]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $*"
}

log_warning() {
  echo -e "${YELLOW}[WARNING]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $*"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $*" >&2
}

# ═══════════════════════════════════════════════════════════
# 参数验证
# ═══════════════════════════════════════════════════════════

validate_agent_id() {
  local agent_id="${1:-}"
  
  if [ -z "$agent_id" ]; then
    log_error "缺少 Agent ID 参数"
    echo "用法：$0 <agent-id>" >&2
    exit 1
  fi
  
  # 验证 agent ID 格式（允许字母、数字、连字符、下划线）
  if ! [[ "$agent_id" =~ ^[a-zA-Z0-9_-]+$ ]]; then
    log_error "无效的 Agent ID 格式：$agent_id"
    echo "Agent ID 只能包含字母、数字、连字符和下划线" >&2
    exit 1
  fi
  
  echo "$agent_id"
}

# ═══════════════════════════════════════════════════════════
# Workspace 验证
# ═══════════════════════════════════════════════════════════

validate_workspace() {
  local agent_id="$1"
  local workspace_dir="${OPENCLAW_ROOT:-$HOME/.openclaw}/workspace-$agent_id"
  
  if [ ! -d "$workspace_dir" ]; then
    log_error "Workspace 不存在：$workspace_dir"
    echo ""
    echo "可能的原因:"
    echo "  1. Agent 尚未创建"
    echo "  2. Agent ID 拼写错误"
    echo "  3. OpenClaw 未正确安装"
    echo ""
    echo "解决方案:"
    echo "  openclaw agents add $agent_id"
    exit 1
  fi
  
  echo "$workspace_dir"
}

# ═══════════════════════════════════════════════════════════
# 并发锁机制
# ═══════════════════════════════════════════════════════════

# 获取锁
# 用法：acquire_lock "lock-name" [timeout_seconds]
acquire_lock() {
  local lock_name="$1"
  local timeout="${2:-300}" # 默认 5 分钟超时
  local lock_file="/tmp/evo-cortex-${lock_name}.lock"
  local start_time=$(date +%s)
  
  # 尝试获取锁
  while true; do
    # 使用 mkdir 原子操作创建锁文件
    if mkdir "$lock_file" 2>/dev/null; then
      # 成功获取锁，写入 PID 和开始时间
      echo $$ > "$lock_file/pid"
      echo $(date +%s) > "$lock_file/start_time"
      echo $(date) > "$lock_file/start_human"
      log_info "已获取锁：$lock_name (PID: $$)"
      return 0
    fi
    
    # 检查锁是否超时（防止死锁）
    if [ -f "$lock_file/start_time" ]; then
      local lock_start=$(cat "$lock_file/start_time")
      local current_time=$(date +%s)
      local elapsed=$((current_time - lock_start))
      
      if [ $elapsed -gt $timeout ]; then
        log_warning "检测到超时锁（${elapsed}s > ${timeout}s），强制释放..."
        rm -rf "$lock_file"
        continue
      fi
      
      # 显示等待信息（每 10 秒显示一次）
      if [ $((elapsed % 10)) -eq 0 ] && [ $elapsed -gt 0 ]; then
        log_info "等待锁：$lock_name (已等待 ${elapsed}s)..."
      fi
    fi
    
    # 等待 1 秒后重试
    sleep 1
    
    # 检查是否超过最大等待时间（2 倍 timeout）
    local wait_elapsed=$(($(date +%s) - start_time))
    if [ $wait_elapsed -gt $((timeout * 2)) ]; then
      log_error "获取锁超时（等待超过 ${wait_elapsed}s）"
      return 1
    fi
  done
}

# 释放锁
# 用法：release_lock "lock-name"
release_lock() {
  local lock_name="$1"
  local lock_file="/tmp/evo-cortex-${lock_name}.lock"
  
  if [ -d "$lock_file" ]; then
    local lock_pid=$(cat "$lock_file/pid" 2>/dev/null || echo "unknown")
    rm -rf "$lock_file"
    log_info "已释放锁：$lock_name (原 PID: $lock_pid)"
  fi
}

# 清理本进程的所有锁（用于异常退出）
cleanup_locks() {
  for lock_dir in /tmp/evo-cortex-*.lock; do
    if [ -d "$lock_dir" ] && [ -f "$lock_dir/pid" ]; then
      local pid=$(cat "$lock_dir/pid")
      if [ "$pid" = "$$" ]; then
        local lock_name=$(basename "$lock_dir" .lock | sed 's/evo-cortex-//')
        release_lock "$lock_name"
      fi
    fi
  done
}

# 设置锁清理陷阱
setup_lock_cleanup() {
  trap cleanup_locks EXIT INT TERM
}

# ═══════════════════════════════════════════════════════════
# 幂等性检查
# ═══════════════════════════════════════════════════════════

# 检查 Cron 任务是否存在
# 用法：if cron_exists "task-name"; then ...
cron_exists() {
  local task_name="$1"
  local agent_id="$2"
  
  if openclaw cron list 2>/dev/null | grep -q "$task_name"; then
    return 0
  else
    return 1
  fi
}

# 检查文件是否存在且非空
# 用法：if file_exists_and_not_empty "file.txt"; then ...
file_exists_and_not_empty() {
  local file="$1"
  [ -f "$file" ] && [ -s "$file" ]
}

# 检查目录是否存在
# 用法：if dir_exists "directory"; then ...
dir_exists() {
  local dir="$1"
  [ -d "$dir" ]
}

# ═══════════════════════════════════════════════════════════
# 文件操作（安全版本）
# ═══════════════════════════════════════════════════════════

# 安全创建目录（如果不存在）
safe_mkdir() {
  local dir="$1"
  if [ ! -d "$dir" ]; then
    mkdir -p "$dir"
    log_info "已创建目录：$dir"
  fi
}

# 安全追加内容到文件（避免重复）
# 用法：safe_append_unique "file.txt" "content to append"
safe_append_unique() {
  local file="$1"
  local content="$2"
  
  if ! grep -qF "$content" "$file" 2>/dev/null; then
    echo "$content" >> "$file"
    log_info "已追加到：$file"
  else
    log_info "内容已存在，跳过：$file"
  fi
}

# 备份文件（如果存在）
backup_file() {
  local file="$1"
  if [ -f "$file" ]; then
    local backup="${file}.bak.$(date +%Y%m%d%H%M%S)"
    cp "$file" "$backup"
    log_info "已备份：$file -> $backup"
  fi
}

# ═══════════════════════════════════════════════════════════
# 性能统计
# ═══════════════════════════════════════════════════════════

# 记录开始时间
start_timer() {
  START_TIME=$(date +%s.%N)
  START_HUMAN=$(date '+%Y-%m-%d %H:%M:%S')
  log_info "任务开始：$START_HUMAN"
}

# 记录结束时间并显示耗时
end_timer() {
  local task_name="${1:-任务}"
  local END_TIME=$(date +%s.%N)
  local END_HUMAN=$(date '+%Y-%m-%d %H:%M:%S')
  
  # 计算耗时（秒）
  local ELAPSED=$(echo "$END_TIME - $START_TIME" | bc)
  local ELAPSED_INT=${ELAPSED%.*}
  
  log_success "$task_name 完成：$END_HUMAN (耗时：${ELAPSED}s)"
  
  # 如果耗时超过 60 秒，显示警告
  if [ "${ELAPSED_INT:-0}" -gt 60 ]; then
    log_warning "任务耗时较长（${ELAPSED}s），考虑优化"
  fi
}

# ═══════════════════════════════════════════════════════════
# 摘要报告
# ═══════════════════════════════════════════════════════════

print_summary() {
  local created="${1:-0}"
  local skipped="${2:-0}"
  local failed="${3:-0}"
  local total=$((created + skipped + failed))
  
  echo ""
  echo "╔════════════════════════════════════════════════════════╗"
  echo "║                    📊 执行摘要                         ║"
  echo "╚════════════════════════════════════════════════════════╝"
  echo ""
  echo "总任务数：$total"
  echo "  ✅ 新建：$created"
  echo "  ⏭️  跳过：$skipped"
  echo "  ❌ 失败：$failed"
  echo ""
  
  if [ $failed -gt 0 ]; then
    echo "⚠️  有 $failed 个任务失败，请检查日志"
    return 1
  else
    echo "✨ 所有任务成功完成！"
    return 0
  fi
}

# ═══════════════════════════════════════════════════════════
# 环境检查
# ═══════════════════════════════════════════════════════════

check_dependencies() {
  local deps=("$@")
  local missing=()
  
  for dep in "${deps[@]}"; do
    if ! command -v "$dep" &> /dev/null; then
      missing+=("$dep")
    fi
  done
  
  if [ ${#missing[@]} -gt 0 ]; then
    log_error "缺少依赖：${missing[*]}"
    echo ""
    echo "请安装缺失的命令："
    for dep in "${missing[@]}"; do
      case "$dep" in
        ts-node|npm)
          echo "  • $dep: npm install -g $dep"
          ;;
        jq)
          echo "  • $dep: brew install jq  (macOS)"
          echo "  • $dep: apt-get install jq  (Ubuntu)"
          ;;
        bc)
          echo "  • $dep: brew install bc  (macOS)"
          echo "  • $dep: apt-get install bc  (Ubuntu)"
          ;;
        *)
          echo "  • $dep"
          ;;
      esac
    done
    exit 1
  fi
}

# ═══════════════════════════════════════════════════════════
# 帮助信息
# ═══════════════════════════════════════════════════════════

show_usage() {
  cat << EOF
用法：$(basename "$0") <agent-id> [选项]

参数:
  agent-id    OpenClaw Agent 的唯一标识符

选项:
  -h, --help     显示帮助信息
  -v, --verbose  详细模式
  --no-lock      禁用锁机制（不推荐）

示例:
  $(basename "$0") my-agent
  $(basename "$0") cortex-test-agent --verbose

EOF
}

# ═══════════════════════════════════════════════════════════
# 初始化（自动执行）
# ═══════════════════════════════════════════════════════════

# 自动设置锁清理陷阱
setup_lock_cleanup

# 导出所有函数供子脚本使用
export -f log_info log_success log_warning log_error
export -f validate_agent_id validate_workspace
export -f acquire_lock release_lock cleanup_locks setup_lock_cleanup
export -f cron_exists file_exists_and_not_empty dir_exists
export -f safe_mkdir safe_append_unique backup_file
export -f start_timer end_timer print_summary
export -f check_dependencies show_usage
