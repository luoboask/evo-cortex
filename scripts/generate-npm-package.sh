#!/bin/bash
# 生成可发布到 npm 的包

set -e

echo "📦 准备发布 Evo-Cortex 到 npm..."

# 检查 package.json
if [ ! -f "package.json" ]; then
  echo "❌ 错误：package.json 不存在"
  exit 1
fi

# 显示包信息
echo ""
echo "包信息:"
cat package.json | jq '{name, version, description, license}'

echo ""
echo "下一步操作:"
echo "1. 测试本地打包："
echo "   npm pack"
echo ""
echo "2. 发布到 npm (需要先登录):"
echo "   npm login"
echo "   npm publish --access public"
echo ""
echo "3. 发布后用户可以这样安装:"
echo "   openclaw plugins install @evo-agents/evo-cortex"
echo ""
