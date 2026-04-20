#!/bin/bash
# 将 agent 注册到 openclaw.json

AGENT_ID="${1:-}"

if [ -z "$AGENT_ID" ]; then
  echo "用法：$0 <agent-id>"
  exit 1
fi

OPENCLAW_CONFIG="$HOME/.openclaw/openclaw.json"
WORKSPACE_DIR="$HOME/.openclaw/workspace-$AGENT_ID"

# 检查工作区是否存在
if [ ! -d "$WORKSPACE_DIR" ]; then
  echo "❌ 工作区不存在：$WORKSPACE_DIR"
  exit 1
fi

# 检查是否已注册
if grep -q "\"id\":\"$AGENT_ID\"" "$OPENCLAW_CONFIG"; then
  echo "✅ Agent '$AGENT_ID' 已注册"
  exit 0
fi

# 添加到 agents.list
echo "正在注册 agent '$AGENT_ID'..."

# 使用 node/jq 添加（如果有 jq）
if command -v jq &> /dev/null; then
  jq ".agents.list += [{\"id\": \"$AGENT_ID\", \"workspace\": \"$WORKSPACE_DIR\"}]" "$OPENCLAW_CONFIG" > "$OPENCLAW_CONFIG.tmp" && \
  mv "$OPENCLAW_CONFIG.tmp" "$OPENCLAW_CONFIG"
  echo "✅ 注册成功"
else
  echo "⚠️  未安装 jq，请手动添加以下配置到 openclaw.json:"
  echo ""
  echo "{\"id\": \"$AGENT_ID\", \"workspace\": \"$WORKSPACE_DIR\"}"
  echo ""
  echo "添加到 agents.list 数组中"
fi
