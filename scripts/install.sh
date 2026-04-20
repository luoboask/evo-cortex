#!/bin/bash
# Evo-Cortex 一键安装脚本
# 参考 evo-agents/install.sh 结构

set -e

AGENT_NAME="${1:-}"
FORCE="${2:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EVO_CORTEX_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKSPACE_ROOT="$HOME/.openclaw/workspace-$AGENT_NAME"

# 检测系统语言
if locale | grep -q "zh_CN\|zh_CN\|Chinese"; then
    LANG="zh"
else
    LANG="en"
fi

# 欢迎信息
if [ "$LANG" = "zh" ]; then
    echo "╔════════════════════════════════════════════════════════╗"
    echo "║  Evo-Cortex 一键安装                                     ║"
    echo "║  完整的记忆、学习和进化能力                              ║"
    echo "╚════════════════════════════════════════════════════════╝"
    echo ""
    echo "📦 Agent: $AGENT_NAME"
    echo "📁 Workspace: $WORKSPACE_ROOT"
    echo ""
else
    echo "╔════════════════════════════════════════════════════════╗"
    echo "║  Evo-Cortex Quick Install                                ║"
    echo "╚════════════════════════════════════════════════════════╝"
    echo ""
    echo "📦 Agent: $AGENT_NAME"
    echo "📁 Workspace: $WORKSPACE_ROOT"
    echo ""
fi

# 检查 agent 名称
if [ -z "$AGENT_NAME" ]; then
    echo "❌ 错误：请指定 Agent 名称"
    echo ""
    echo "用法："
    echo "  $0 <agent-name>"
    echo "  $0 my-agent"
    echo ""
    exit 1
fi

# 检查工作区是否存在
if [ ! -d "$WORKSPACE_ROOT" ]; then
    if [ "$LANG" = "zh" ]; then
        echo "⚠️  Workspace 不存在，正在创建..."
    else
        echo "⚠️  Workspace not found, creating..."
    fi
    
    mkdir -p "$WORKSPACE_ROOT"
    
    # 创建基础文件
    if [ ! -f "$WORKSPACE_ROOT/SOUL.md" ]; then
        cp "$EVO_CORTEX_ROOT/templates/SOUL.md.template" "$WORKSPACE_ROOT/SOUL.md" 2>/dev/null || \
        echo "# SOUL.md\n\nEdit this file to define your agent's personality." > "$WORKSPACE_ROOT/SOUL.md"
    fi
    
    if [ ! -f "$WORKSPACE_ROOT/USER.md" ]; then
        echo "# USER.md\n\nEdit this file to describe your user." > "$WORKSPACE_ROOT/USER.md"
    fi
    
    if [ ! -f "$WORKSPACE_ROOT/AGENTS.md" ]; then
        echo "# AGENTS.md\n\nYour workspace guide." > "$WORKSPACE_ROOT/AGENTS.md"
    fi
    
    mkdir -p "$WORKSPACE_ROOT/memory"
    echo "   ✅ Workspace 创建完成"
fi

cd "$WORKSPACE_ROOT"

# 检查并安装插件
if [ "$LANG" = "zh" ]; then
    echo "📦 检查 Evo-Cortex 插件..."
else
    echo "📦 Checking Evo-Cortex plugin..."
fi

if ! openclaw plugins info evo-cortex &>/dev/null; then
    if [ "$LANG" = "zh" ]; then
        echo "⚠️  插件未安装，正在安装..."
    else
        echo "⚠️  Plugin not installed, installing..."
    fi
    
    openclaw plugins install "$EVO_CORTEX_ROOT"
    echo "   ✅ 插件安装完成"
else
    echo "   ✅ 插件已安装"
fi

# 配置定时任务
echo ""
if [ "$LANG" = "zh" ]; then
    echo "⏰ 配置 Evo-Cortex 定时任务"
else
    echo "⏰ Configuring Evo-Cortex cron tasks"
fi
echo ""

# 询问配置级别
if [ "$LANG" = "zh" ]; then
    echo "选择配置级别:"
    echo "  1) basic    - 3 个核心任务（快速上手）"
    echo "  2) standard - 7 个任务（推荐）"
    echo "  3) full     - 9 个任务（完整功能）"
    echo ""
    read -p "请输入选项 (1-3, 默认 2): " level_choice
else
    echo "Select configuration level:"
    echo "  1) basic    - 3 core tasks"
    echo "  2) standard - 7 tasks (recommended)"
    echo "  3) full     - 9 tasks"
    echo ""
    read -p "Enter choice (1-3, default 2): " level_choice
fi

case "${level_choice:-2}" in
    1) LEVEL="basic" ;;
    2) LEVEL="standard" ;;
    3) LEVEL="full" ;;
    *) 
       if [ "$LANG" = "zh" ]; then
           echo "无效选项，使用 standard"
       else
           echo "Invalid option, using standard"
       fi
       LEVEL="standard" 
       ;;
esac

# 执行配置
echo ""
bash "$SCRIPT_DIR/setup-crons-hybrid.sh" "$AGENT_NAME" "$LEVEL" script

# 完成
echo ""
if [ "$LANG" = "zh" ]; then
    echo "╔════════════════════════════════════════════════════════╗"
    echo "║  ✅ Evo-Cortex 安装完成！                                 ║"
    echo "╚════════════════════════════════════════════════════════╝"
    echo ""
    echo "📊 配置摘要:"
    echo "  Agent: $AGENT_NAME"
    echo "  级别：$LEVEL"
    echo ""
    echo "下一步:"
    echo "  1. 验证配置：$SCRIPT_DIR/verify-setup.sh $AGENT_NAME"
    echo "  2. 查看任务：openclaw cron list | grep $AGENT_NAME"
    echo "  3. 开始使用：正常与 Agent 对话即可"
    echo ""
else
    echo "╔════════════════════════════════════════════════════════╗"
    echo "║  ✅ Evo-Cortex Installation Complete!                    ║"
    echo "╚════════════════════════════════════════════════════════╝"
    echo ""
    echo "📊 Configuration Summary:"
    echo "  Agent: $AGENT_NAME"
    echo "  Level: $LEVEL"
    echo ""
    echo "Next Steps:"
    echo "  1. Verify: $SCRIPT_DIR/verify-setup.sh $AGENT_NAME"
    echo "  2. List tasks: openclaw cron list | grep $AGENT_NAME"
    echo "  3. Start using: Chat with your agent normally"
    echo ""
fi
