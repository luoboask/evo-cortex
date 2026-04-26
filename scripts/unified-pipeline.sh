#!/bin/bash
# =============================================================================
# evo-cortex 统一调度脚本
# 功能：整合 session-scan + preference-extract + kg-update + evolution
# 用法：bash unified-pipeline.sh <agent-id> [mode]
#   mode: full (default) | scan-only | evolve-only
# =============================================================================

set -e

AGENT_ID="${1:-cortex-test-agent}"
MODE="${2:-full}"

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKSPACE="$HOME/.openclaw/workspace-$AGENT_ID"
DATA_DIR="$WORKSPACE/data/$AGENT_ID"
DB="$DATA_DIR/cortex.db"

echo "╔══════════════════════════════════════════════╗"
echo "║  🧬 Evo-Cortex Unified Pipeline              ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo "📦 Agent: $AGENT_ID"
echo "🕐 Time: $(date '+%Y-%m-%d %H:%M:%S')"
echo "🔧 Mode: $MODE"
echo ""

START_TIME=$(date +%s)

# ── 阶段 1: 会话扫描 + 工作记忆写入 ──
if [ "$MODE" = "full" ] || [ "$MODE" = "scan-only" ]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "📡 Phase 1: Session Scan & Memory Store"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    
    python3 "$SCRIPTS_DIR/session_scan.py" "$AGENT_ID" 2>&1 | tail -15
    echo ""
    
    # 显示扫描结果
    if [ -f "$DB" ]; then
        WM_COUNT=$(sqlite3 "$DB" "SELECT COUNT(*) FROM working_memory;" 2>/dev/null || echo 0)
        SM_COUNT=$(sqlite3 "$DB" "SELECT COUNT(*) FROM session_messages;" 2>/dev/null || echo 0)
        echo "   💾 working_memory: $WM_COUNT entries"
        echo "   💾 session_messages: $SM_COUNT entries"
    fi
    echo ""
fi

# ── 阶段 2: 偏好提取 ──
if [ "$MODE" = "full" ]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "🎯 Phase 2: Preference Extraction"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    
    # 从真实会话消息中提取偏好
    if [ -f "$DB" ]; then
        PREF_COUNT_BEFORE=$(sqlite3 "$DB" "SELECT COUNT(*) FROM preferences;" 2>/dev/null || echo 0)
        
        python3 -c "
import sqlite3, re
from pathlib import Path
from datetime import datetime

db_path = Path('$DB')
if not db_path.exists():
    print('   ⏭️  数据库不存在')
    exit(0)

conn = sqlite3.connect(str(db_path))
cursor = conn.cursor()

# 从 session_messages 中提取真实用户偏好
cursor.execute('''
    SELECT content FROM session_messages 
    WHERE role = 'user' 
    ORDER BY id DESC 
    LIMIT 100
''')

patterns = [
    ('明确喜好', r'(?:我|请)(?:喜欢|偏好|倾向|希望|想要|需要|想要).*?(?:[。.!！]|$)', 0.85),
    ('避免方式', r'(?:我|请|不要|别)(?:不喜欢|讨厌|避免|反感|不用|不要用|别用).*?(?:[。.!！]|$)', 0.85),
    ('格式偏好', r'(?:请用|用|使用|格式|不要用|别用).*?(?:[。.!！]|$)', 0.70),
]

found = 0
for (content,) in cursor.fetchall():
    if not content or len(content) < 10:
        continue
    for category, pattern, confidence in patterns:
        matches = re.findall(pattern, content, re.IGNORECASE)
        for match in matches:
            match = match.strip()
            if len(match) < 5 or len(match) > 200:
                continue
            # 过滤噪音
            if any(n in match for n in ['小时变更', '统计', '文件']):
                continue
            key = match[:80]
            try:
                cursor.execute('''
                    INSERT OR IGNORE INTO preferences (category, key, value, confidence, source, extracted_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                ''', (category, key, match, confidence, 'session_messages', datetime.now().isoformat()))
                if cursor.rowcount > 0:
                    found += 1
            except:
                pass

conn.commit()
conn.close()
print(f'   ✅ 从会话消息中提取了 {found} 条新偏好')
" 2>&1
        
        PREF_COUNT_AFTER=$(sqlite3 "$DB" "SELECT COUNT(*) FROM preferences;" 2>/dev/null || echo 0)
        echo "   📊 preferences: $PREF_COUNT_BEFORE → $PREF_COUNT_AFTER"
    fi
    echo ""
fi

# ── 阶段 3: 知识图谱更新 ──
if [ "$MODE" = "full" ]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "🕸️  Phase 3: Knowledge Graph Update"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    
    if [ -x "$SCRIPTS_DIR/kg-auto-update.sh" ]; then
        bash "$SCRIPTS_DIR/kg-auto-update.sh" "$AGENT_ID" 2>&1 | tail -10
    else
        echo "   ⏭️  kg-auto-update.sh 不存在，跳过"
    fi
    echo ""
fi

# ── 阶段 4: 自进化分析 ──
if [ "$MODE" = "full" ] || [ "$MODE" = "evolve-only" ]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "🧬 Phase 4: Self-Evolution"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    
    if [ -x "$SCRIPTS_DIR/activate-evolution.py" ]; then
        python3 "$SCRIPTS_DIR/activate-evolution.py" "$AGENT_ID" 2>&1 | tail -10
    else
        echo "   ⏭️  activate-evolution.py 不存在，跳过"
    fi
    echo ""
fi

# ── 最终统计 ──
END_TIME=$(date +%s)
DURATION=$(( END_TIME - START_TIME ))

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Pipeline 完成"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "⏱️  总耗时: ${DURATION}s"

if [ -f "$DB" ]; then
    echo ""
    echo "数据库状态:"
    echo "  • working_memory:    $(sqlite3 "$DB" 'SELECT COUNT(*) FROM working_memory;' 2>/dev/null || echo 0)"
    echo "  • session_messages:  $(sqlite3 "$DB" 'SELECT COUNT(*) FROM session_messages;' 2>/dev/null || echo 0)"
    echo "  • preferences:       $(sqlite3 "$DB" 'SELECT COUNT(*) FROM preferences;' 2>/dev/null || echo 0)"
    echo "  • scan_log:          $(sqlite3 "$DB" 'SELECT COUNT(*) FROM scan_log;' 2>/dev/null || echo 0)"
fi

echo ""
echo "✅ Pipeline 完成"
