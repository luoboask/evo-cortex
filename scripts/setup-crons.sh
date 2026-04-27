#!/bin/bash
# ═══════════════════════════════════════════════════
# 🧬 Evo-Cortex Cron 配置入口（转发到 Python 版）
# ═══════════════════════════════════════════════════
# 跨平台：macOS / Linux / Windows (Git Bash)
# 用法: bash setup-crons.sh <agent-name>
#       python3 setup_crons.py <agent-name>
# ═══════════════════════════════════════════════════

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 尝试 Python 优先
if command -v python3 &> /dev/null; then
    exec python3 "$SCRIPT_DIR/setup_crons.py" "$@"
elif command -v python &> /dev/null; then
    exec python "$SCRIPT_DIR/setup_crons.py" "$@"
else
    echo "❌ 错误：需要 Python 3"
    exit 1
fi
