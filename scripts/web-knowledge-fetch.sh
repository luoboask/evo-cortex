#!/bin/bash
# 🌐 网络知识自动获取脚本
# 用法：bash web-knowledge-fetch.sh <agent-id>

set -e

AGENT_ID="${1:-}"

if [ -z "$AGENT_ID" ]; then
  echo "❌ 用法：bash $0 <agent-id>"
  exit 1
fi

WORKSPACE="$HOME/.openclaw/workspace-$AGENT_ID"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "╔════════════════════════════════════════════════════════╗"
echo "║  🌐 Evo-Cortex 网络知识获取                             ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""
echo "📦 Agent: $AGENT_ID"
echo "📁 Workspace: $WORKSPACE"
echo ""

# 检查工作区是否存在
if [ ! -d "$WORKSPACE" ]; then
  echo "❌ Workspace 不存在：$WORKSPACE"
  echo "请先创建 agent 或检查 agent ID 是否正确"
  exit 1
fi

# 检查 TypeScript 环境
if ! command -v ts-node &> /dev/null; then
  echo "⚠️  ts-node 未安装，尝试使用 npx..."
  TS_CMD="npx ts-node"
else
  TS_CMD="ts-node"
fi

# 执行 TypeScript 脚本
export OPENCLAW_WORKSPACE="$WORKSPACE"
cd "$SCRIPT_DIR"

echo "🚀 开始获取网络知识..."
echo ""

$TS_CMD web-knowledge-fetcher.ts "$AGENT_ID"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✨ 完成!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
