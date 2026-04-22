#!/bin/bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 📊 Evo-Cortex Session Scan (Database 版)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 
# 功能：
# 1. 扫描最近对话记忆文件
# 2. 自动提取用户偏好
# 3. 写入 SQLite 数据库（主存储）
# 4. 同步到 Markdown（人类可读备份）
#
# 用法：bash scripts/session-scan.sh <agent-id>
# 频率：每 30 分钟（Cron）
# 成本：$0

set -euo pipefail

AGENT_ID="${1:-cortex-test-agent}"
WORKSPACE="$HOME/.openclaw/workspace-$AGENT_ID"
MEMORY_DIR="$WORKSPACE/memory"
DATA_DIR="$WORKSPACE/data"
DB_PATH="$DATA_DIR/cortex.db"
PREF_FILE="$WORKSPACE/USER_PREFERENCES.md"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "╔══════════════════════════════════════════════╗"
echo "║  📊 Session Scan + 偏好提取                    ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo "📦 Agent: $AGENT_ID"
echo "🕐 时间：$(date '+%Y-%m-%d %H:%M:%S')"
echo ""

# ────────────────────────────────────────────────
# 0. 检查数据库是否存在
# ────────────────────────────────────────────────

if [ ! -f "$DB_PATH" ]; then
  echo "⚠️  数据库不存在！"
  echo ""
  echo "💡 如果是新 Agent，请先创建数据库："
  echo "   sqlite3 $DB_PATH \"CREATE TABLE preferences (id INTEGER PRIMARY KEY, text TEXT);\""
  echo ""
  exit 1
fi

# ────────────────────────────────────────────────
# 1. 扫描最近的记忆文件
# ────────────────────────────────────────────────

recent_files=$(find "$MEMORY_DIR" -name "*.md" -type f -mmin -35 2>/dev/null | head -10 || true)

if [ -z "$recent_files" ]; then
  echo "⏭️  最近 35 分钟无新对话，跳过"
  exit 0
fi

file_count=$(echo "$recent_files" | wc -l | tr -d ' ')
echo "🔍 发现 $file_count 个新文件，开始分析..."
echo ""

total_extracted=0

for file in $recent_files; do
  filename=$(basename "$file")
  echo "📄 $filename:"
  
  # 使用 Python 脚本提取偏好
  python3 "$SCRIPT_DIR/extract_prefs_from_file.py" "$AGENT_ID" "$file" || true
  
  ((total_extracted++)) || true
done

echo ""

# ────────────────────────────────────────────────
# 2. 同步到 Markdown
# ────────────────────────────────────────────────

echo "🔄 同步到 Markdown..."

python3 << PYEOF
import sys
sys.path.insert(0, '$SCRIPT_DIR')
from preferences_db import PreferencesDB
from pathlib import Path

db = PreferencesDB('$AGENT_ID')
md_path = Path('$PREF_FILE')
db.sync_to_markdown(md_path)
db.close()
PYEOF

# ────────────────────────────────────────────────
# 3. 显示统计
# ────────────────────────────────────────────────

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 统计:"

python3 << PYEOF
import sys
sys.path.insert(0, '$SCRIPT_DIR')
from preferences_db import PreferencesDB

db = PreferencesDB('$AGENT_ID')
stats = db.get_stats()

print(f"  • 总偏好数：{stats['total']}")
print(f"  • 待确认：{stats['by_status'].get('pending', 0)}")
print(f"  • 已确认：{stats['by_status'].get('confirmed', 0)}")
print(f"  • 已拒绝：{stats['by_status'].get('rejected', 0)}")
print(f"  • 平均置信度：{int(stats['avg_confidence']*100)}%")

if stats['last_7_days'] > 0:
    print(f"  • 最近 7 天新增：{stats['last_7_days']}")

db.close()
PYEOF

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ────────────────────────────────────────────────
# 4. 显示待确认列表
# ────────────────────────────────────────────────

pending_count=$(python3 << PYEOF
import sys
sys.path.insert(0, '$SCRIPT_DIR')
from preferences_db import PreferencesDB
db = PreferencesDB('$AGENT_ID')
prefs = db.get_pending()
print(len(prefs))
db.close()
PYEOF
)

if [ "$pending_count" -gt 0 ]; then
  echo "💡 有待确认的偏好（Top 5）："
  echo ""
  
  python3 << PYEOF
import sys
sys.path.insert(0, '$SCRIPT_DIR')
from preferences_db import PreferencesDB

db = PreferencesDB('$AGENT_ID')
prefs = db.get_pending()

for i, pref in enumerate(prefs[:5], 1):
    text = pref['text'][:50] + "..." if len(pref['text']) > 50 else pref['text']
    conf = int(pref['confidence'] * 100)
    print(f"  {i}. {text} ({conf}%)")

if len(prefs) > 5:
    print(f"  ... 还有 {len(prefs) - 5} 条")

db.close()
PYEOF
  
  echo ""
fi

echo "🦞 下次执行：30 分钟后（通过 Cron）"
echo ""

exit 0
