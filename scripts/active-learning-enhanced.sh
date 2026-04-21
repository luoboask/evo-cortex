#!/bin/bash
# ═══════════════════════════════════════════════════════════
# 🧠 Evo-Cortex 主动学习（增强版）
# ═══════════════════════════════════════════════════════════
# 功能：词频分析 + 用户偏好提取 + 待办事项识别
# 特点：幂等、并发安全、支持多 Agent 同时调用
# 用法：bash active-learning-enhanced.sh <agent-id>
# ═══════════════════════════════════════════════════════════

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 加载通用库
if [ -f "$SCRIPT_DIR/lib.sh" ]; then
  source "$SCRIPT_DIR/lib.sh"
else
  echo "[ERROR] 未找到 lib.sh 库文件：$SCRIPT_DIR/lib.sh"
  exit 1
fi

main() {
  # 解析参数
  if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
    show_usage
    exit 0
  fi
  
  # 验证 Agent ID
  local AGENT_ID
  AGENT_ID=$(validate_agent_id "${1:-}")
  
  log_info "🧠 Evo-Cortex 主动学习 (Enhanced)"
  log_info "Agent: $AGENT_ID"
  
  # 验证 Workspace
  local WORKSPACE
  WORKSPACE=$(validate_workspace "$AGENT_ID")
  log_info "Workspace: $WORKSPACE"
  
  # 定义路径
  local MEMORY_DIR="$WORKSPACE/memory"
  local PREFERENCES_FILE="$WORKSPACE/USER_PREFERENCES.md"
  local ACTION_ITEMS_FILE="$WORKSPACE/action-items.md"
  local OUTPUT_DIR="$WORKSPACE/evolution"
  
  # 检查依赖
  check_dependencies "awk" "sort" "uniq"
  
  # 设置锁
  local LOCK_NAME="active-learning-$AGENT_ID"
  if [ "${NO_LOCK:-false}" != "true" ]; then
    if ! acquire_lock "$LOCK_NAME" 300; then
      log_error "无法获取锁，可能有其他实例正在运行"
      exit 1
    fi
  fi
  
  # 记录开始时间
  start_timer
  
  # 确保输出目录存在
  safe_mkdir "$OUTPUT_DIR"
  safe_mkdir "$MEMORY_DIR"
  
  # ────────────────────────────────────────────────────────
  # 🔍 执行前检查：数据量是否足够
  # ────────────────────────────────────────────────────────
  
  log_info "🔍 执行前检查..."
  
  local MEMORY_COUNT
  MEMORY_COUNT=$(ls -1 "$MEMORY_DIR"/*.md 2>/dev/null | wc -l)
  
  if [ "$MEMORY_COUNT" -lt 3 ]; then
    log_warning "记忆文件不足 ($MEMORY_COUNT < 3)，跳过本次执行"
    log_info "💡 建议：先进行一些对话，积累数据后再运行"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "📊 执行摘要"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "总任务数：1"
    echo "  ⏭️  跳过：1 (数据不足)"
    echo "  ✅ 新建：0"
    echo "  ❌ 失败：0"
    echo ""
    echo "✨ 已跳过，等待更多数据"
    exit 0
  fi
  
  log_success "数据量检查通过 ($MEMORY_COUNT 个记忆文件)"
  
  # 检查记忆文件总大小
  local TOTAL_SIZE
  TOTAL_SIZE=$(du -sm "$MEMORY_DIR" 2>/dev/null | cut -f1)
  
  if [ "${TOTAL_SIZE:-0}" -lt 1 ]; then
    log_warning "记忆数据总量过小 (${TOTAL_SIZE}MB)，分析结果可能有限"
  else
    log_success "数据总量检查通过 (${TOTAL_SIZE}MB)"
  fi
  
  echo ""
  
  local CREATED=0
  local SKIPPED=0
  local FAILED=0
  
  echo ""
  log_info "开始主动学习..."
  echo ""
  
  # ────────────────────────────────────────────────────────
  # 步骤 1: 词频分析
  # ────────────────────────────────────────────────────────
  
  log_info "步骤 1: 词频分析..."
  
  local TODAY=$(date +%Y-%m-%d)
  local WORD_FREQ_OUTPUT="$OUTPUT_DIR/word-frequency-$TODAY.txt"
  
  if file_exists_and_not_empty "$WORD_FREQ_OUTPUT"; then
    log_warning "词频分析已存在，跳过：$WORD_FREQ_OUTPUT"
    ((SKIPPED++))
  else
    # 合并所有记忆文件并统计词频
    if [ -d "$MEMORY_DIR" ]; then
      cat "$MEMORY_DIR"/*.md 2>/dev/null | \
        tr '[:upper:]' '[:lower:]' | \
        tr -cs '[:alpha:]' '\n' | \
        grep -E '^[a-z]{4,20}$' | \
        sort | uniq -c | sort -rn | head -50 > "$WORD_FREQ_OUTPUT"
      
      if [ -s "$WORD_FREQ_OUTPUT" ]; then
        log_success "词频分析完成：${#WORD_FREQ_OUTPUT}"
        ((CREATED++))
      else
        log_warning "未找到有效的词频数据"
        ((FAILED++))
      fi
    else
      log_warning "记忆目录不存在：$MEMORY_DIR"
      ((FAILED++))
    fi
  fi
  
  # ────────────────────────────────────────────────────────
  # 步骤 2: 用户偏好提取
  # ────────────────────────────────────────────────────────
  
  log_info "步骤 2: 用户偏好提取..."
  
  if [ -f "$PREFERENCES_FILE" ]; then
    log_info "用户偏好文件已存在：$PREFERENCES_FILE"
    
    # 追加新的偏好（如果检测到）
    local NEW_PREFS=""
    
    # 搜索"我喜欢"、"我不喜欢"等模式
    if grep -q "我喜欢\|I like\|I prefer" "$MEMORY_DIR"/*.md 2>/dev/null; then
      NEW_PREFS=$(grep -h "我喜欢\|I like\|I prefer" "$MEMORY_DIR"/*.md 2>/dev/null | sort -u)
    fi
    
    if [ -n "$NEW_PREFS" ]; then
      log_info "发现新的偏好表达，追加到文件..."
      echo "" >> "$PREFERENCES_FILE"
      echo "## 【$TODAY】新增偏好" >> "$PREFERENCES_FILE"
      echo "$NEW_PREFS" >> "$PREFERENCES_FILE"
      log_success "已更新用户偏好"
      ((CREATED++))
    else
      log_info "未发现新的偏好表达"
      ((SKIPPED++))
    fi
  else
    # 创建新的偏好文件
    log_info "创建用户偏好模板..."
    cat > "$PREFERENCES_FILE" << EOF
# USER_PREFERENCES.md - 用户偏好配置

**Agent**: $AGENT_ID  
**创建时间**: $TODAY  
**最后更新**: $TODAY

---

## 🎯 沟通风格

- [ ] 简洁（只说重点）
- [x] 平衡（解释 + 示例）
- [ ] 详细（全面深入）

## 💬 代码示例

- [x] 优先提供代码示例
- [ ] 仅在需要时提供
- [ ] 不需要代码示例

## 🛠️ 技术栈偏好

### 前端
- [ ] React
- [ ] Vue
- [ ] Svelte
- [x] Next.js

### 后端
- [x] Node.js
- [ ] Python
- [ ] Go
- [ ] Rust

### 数据库
- [ ] PostgreSQL
- [x] Prisma
- [ ] MongoDB
- [ ] SQLite

## 📝 格式偏好

- [x] 使用 bullet points
- [ ] 使用编号列表
- [x] 使用表格展示对比
- [ ] 避免使用表格

## ⏰ 工作时间

- 工作日：09:00 - 18:00
- 周末：灵活

## 🚫 明确表达过的不喜欢

- （待补充）

---

## 📅 历史更新

### $TODAY
- 初始创建

EOF
    log_success "已创建用户偏好文件：$PREFERENCES_FILE"
    ((CREATED++))
  fi
  
  # ────────────────────────────────────────────────────────
  # 步骤 3: 待办事项识别
  # ────────────────────────────────────────────────────────
  
  log_info "步骤 3: 待办事项识别..."
  
  if [ -f "$ACTION_ITEMS_FILE" ]; then
    log_info "待办文件已存在：$ACTION_ITEMS_FILE"
  fi
  
  # 搜索待办模式："我要"、"记得"、"稍后"、"TODO"
  local ACTION_ITEMS=""
  
  if grep -q "我要\|我需要\|记得\|稍后\|TODO\|to-do" "$MEMORY_DIR"/*.md 2>/dev/null; then
    ACTION_ITEMS=$(grep -h "我要\|我需要\|记得\|稍后\|TODO\|to-do" "$MEMORY_DIR"/*.md 2>/dev/null | sort -u)
  fi
  
  if [ -n "$ACTION_ITEMS" ]; then
    log_info "发现待办事项，更新文件..."
    
    if [ ! -f "$ACTION_ITEMS_FILE" ]; then
      cat > "$ACTION_ITEMS_FILE" << EOF
# Action Items - 待办事项追踪

**Agent**: $AGENT_ID  
**创建时间**: $TODAY  
**最后更新**: $TODAY

---

## 📋 待办列表

EOF
    fi
    
    # 追加新的待办（去重）
    echo "### $TODAY 新增" >> "$ACTION_ITEMS_FILE"
    echo "$ACTION_ITEMS" | while read -r line; do
      if ! grep -qF "$line" "$ACTION_ITEMS_FILE"; then
        echo "- [ ] $line" >> "$ACTION_ITEMS_FILE"
      fi
    done
    
    log_success "已更新待办事项"
    ((CREATED++))
  else
    log_info "未发现新的待办事项"
    ((SKIPPED++))
  fi
  
  # ────────────────────────────────────────────────────────
  # 步骤 4: 生成学习报告
  # ────────────────────────────────────────────────────────
  
  log_info "步骤 4: 生成学习报告..."
  
  local REPORT_FILE="$OUTPUT_DIR/active-learning-$TODAY.md"
  
  cat > "$REPORT_FILE" << EOF
# Active Learning Report - $TODAY

**Agent**: $AGENT_ID  
**执行时间**: $(date '+%Y-%m-%d %H:%M:%S')  

---

## 📊 词频 Top 30

$(head -30 "$WORD_FREQ_OUTPUT" 2>/dev/null | awk '{printf "%-30s %d\n", $2, $1}' || echo "无数据")

---

## 💡 洞察

$(
  if [ -s "$WORD_FREQ_OUTPUT" ]; then
    local top_word=$(head -1 "$WORD_FREQ_OUTPUT" | awk '{print $2}')
    local top_count=$(head -1 "$WORD_FREQ_OUTPUT" | awk '{print $1}')
    echo "• 最高频词汇：**$top_word** ($top_count 次)"
    echo "• 这表明你最近关注 ${top_word}相关的话题"
  else
    echo "• 暂无足够数据进行词频分析"
  fi
)

---

## ✅ 本次执行

- 词频分析：$([ -s "$WORD_FREQ_OUTPUT" ] && echo "✅" || echo "❌")
- 用户偏好：$([ -f "$PREFERENCES_FILE" ] && echo "✅" || echo "❌")
- 待办事项：$([ -f "$ACTION_ITEMS_FILE" ] && echo "✅" || echo "❌")

---

*此报告由 Evo-Cortex 自动生成*
EOF
  
  log_success "已生成学习报告：$REPORT_FILE"
  ((CREATED++))
  
  # ────────────────────────────────────────────────────────
  # ✅ 执行后验证：成功标准检查
  # ────────────────────────────────────────────────────────
  
  echo ""
  log_info "✅ 验证执行结果..."
  
  local VERIFY_PASSED=0
  local VERIFY_FAILED=0
  
  # 验证 1: 词频文件是否生成且非空
  if [ -s "$WORD_FREQ_OUTPUT" ]; then
    log_success "✅ 词频分析成功 (Top $(wc -l < "$WORD_FREQ_OUTPUT") 个词)"
    ((VERIFY_PASSED++))
  else
    log_error "❌ 词频分析失败：文件为空或不存在"
    ((VERIFY_FAILED++))
  fi
  
  # 验证 2: 用户偏好文件是否存在
  if [ -f "$PREFERENCES_FILE" ]; then
    log_success "✅ 用户偏好文件存在"
    ((VERIFY_PASSED++))
  else
    log_error "❌ 用户偏好文件未创建"
    ((VERIFY_FAILED++))
  fi
  
  # 验证 3: 学习报告是否生成
  if [ -s "$REPORT_FILE" ]; then
    log_success "✅ 学习报告已生成"
    ((VERIFY_PASSED++))
  else
    log_error "❌ 学习报告未生成或为空"
    ((VERIFY_FAILED++))
  fi
  
  echo ""
  echo "验证结果：$VERIFY_PASSED 通过，$VERIFY_FAILED 失败"
  
  if [ $VERIFY_FAILED -gt 0 ]; then
    log_warning "⚠️  部分验证失败，请检查日志"
  fi
  
  # 记录结束时间
  echo ""
  end_timer "主动学习"
  
  # 释放锁
  if [ "${NO_LOCK:-false}" != "true" ]; then
    release_lock "$LOCK_NAME"
  fi
  
  # 显示摘要
  print_summary $CREATED $SKIPPED $((FAILED + VERIFY_FAILED))
}

show_usage() {
  cat << EOF
用法：$(basename "$0") <agent-id> [选项]

🧠 Evo-Cortex 主动学习（增强版）

参数:
  agent-id    OpenClaw Agent 的唯一标识符

选项:
  -h, --help     显示帮助信息
  --no-lock      禁用锁机制（不推荐）

功能:
  • 词频分析（Top 50）
  • 用户偏好提取（识别"我喜欢"等表达）
  • 待办事项识别（识别"我要"、"记得"等）
  • 生成详细学习报告

输出:
  • evolution/word-frequency-YYYY-MM-DD.txt
  • evolution/active-learning-YYYY-MM-DD.md
  • USER_PREFERENCES.md（如不存在则创建）
  • action-items.md（如不存在则创建）

建议运行频率:
  • 每天凌晨 4 点：0 4 * * *

EOF
}

main "$@"
