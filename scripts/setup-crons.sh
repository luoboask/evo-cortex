#!/bin/bash
# ⚠️  此脚本已废弃，请使用 setup-crons-hybrid.sh

echo "⚠️  警告：setup-crons.sh 已废弃"
echo "请使用 setup-crons-hybrid.sh 代替"
echo ""
echo "正在调用新脚本..."
echo ""

# 调用新脚本
exec "$(dirname "$0")/setup-crons-hybrid.sh" "$@"
