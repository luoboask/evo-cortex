# 📦 npm 发布步骤 - Evo-Cortex

## ⚠️ 重要：你使用的是阿里云 npm registry

你的当前配置：
```bash
registry = "https://registry.anpm.alibaba-inc.com"
```

这是**阿里云内部 registry**，发布的包只能在阿里内网访问。

---

## 🎯 选择发布目标

### 选项 A: 发布到公共 npm（推荐）

如果你希望所有人都能安装这个包，需要切换到官方 npm registry：

```bash
# 1. 临时切换到官方 npm
npm config set registry https://registry.npmjs.org/

# 2. 登录官方 npm
npm login --registry https://registry.npmjs.org/

# 按提示输入:
# - Username: 你的 npm 用户名
# - Password: 你的 npm 密码  
# - Email: 你的邮箱

# 3. 验证登录
npm whoami --registry https://registry.npmjs.org/

# 4. 发布到官方 npm
cd ~/.openclaw/extensions/evo-cortex
npm publish --access public --registry https://registry.npmjs.org/

# 5. 验证发布成功
npm view @evo-agents/evo-cortex --registry https://registry.npmjs.org/

# 6. (可选) 恢复阿里云 registry
npm config set registry https://registry.anpm.alibaba-inc.com/
```

**发布后访问**:
https://www.npmjs.com/package/@evo-agents/evo-cortex

---

### 选项 B: 发布到阿里云 anpm（仅内网）

如果你只希望在阿里内网使用：

```bash
# 1. 确认已在 anpm 有账号
# 访问：https://anpm.alibaba-inc.com/

# 2. 登录（已配置 registry，直接登录）
npm login

# 按提示输入 anpm 账号密码

# 3. 验证登录
npm whoami

# 4. 发布到 anpm
cd ~/.openclaw/extensions/evo-cortex
npm publish --access public

# 5. 验证发布
npm view @evo-agents/evo-cortex
```

**访问地址**（仅内网）:
https://anpm.alibaba-inc.com/package/@evo-agents/evo-cortex

---

## 🚀 快速执行命令

### 发布到官方 npm（一键脚本）

```bash
#!/bin/bash

echo "📦 发布 Evo-Cortex 到官方 npm..."

# 切换到官方 registry
npm config set registry https://registry.npmjs.org/
echo "✅ 已切换到官方 registry"

# 登录
echo "🔐 请登录 npm..."
npm login --registry https://registry.npmjs.org/

# 验证
echo "✅ 验证登录..."
npm whoami --registry https://registry.npmjs.org/

# 发布
echo "🚀 开始发布..."
cd ~/.openclaw/extensions/evo-cortex
npm publish --access public --registry https://registry.npmjs.org/

# 验证
echo "✅ 验证发布..."
npm view @evo-agents/evo-cortex --registry https://registry.npmjs.org/

# 恢复阿里云 registry
npm config set registry https://registry.anpm.alibaba-inc.com/
echo "✅ 已恢复阿里云 registry"

echo ""
echo "🎉 发布完成！"
echo "查看包页面：https://www.npmjs.com/package/@evo-agents/evo-cortex"
```

保存为 `scripts/publish-to-npm.sh` 然后执行：
```bash
bash scripts/publish-to-npm.sh
```

---

## 📊 发布后验证

### 官方 npm

```bash
# 查看包信息
npm view @evo-agents/evo-cortex --registry https://registry.npmjs.org/

# 查看下载量
npm show @evo-agents/evo-cortex downloads --registry https://registry.npmjs.org/

# 测试安装（在新目录）
mkdir /tmp/test-install && cd /tmp/test-install
npm install @evo-agents/evo-cortex --registry https://registry.npmjs.org/
```

**包页面**: https://www.npmjs.com/package/@evo-agents/evo-cortex

### 阿里云 anpm

```bash
# 查看包信息
npm view @evo-agents/evo-cortex

# 测试安装
mkdir /tmp/test-install && cd /tmp/test-install
npm install @evo-agents/evo-cortex
```

**包页面**（内网）: https://anpm.alibaba-inc.com/package/@evo-agents/evo-cortex

---

## 🔄 后续版本更新

```bash
cd ~/.openclaw/extensions/evo-cortex

# 1. 更新版本号
npm version patch  # 或 minor, major

# 2. 推送 git
git push origin main
git push origin v1.0.1  # 使用实际版本号

# 3. 发布（根据目标选择 registry）

# 发布到官方 npm
npm publish --access public --registry https://registry.npmjs.org/

# 或发布到 anpm
npm publish --access public
```

---

## ⚠️ 常见问题

### Q1: 包名已被占用

```bash
# 错误：npm ERR! 403 Forbidden
# 原因：@evo-agents 组织不存在或你没有权限

# 解决方案 1: 创建组织
# 访问 https://www.npmjs.com/org/create

# 解决方案 2: 使用个人包名
# 修改 package.json:
# "name": "@your-username/evo-cortex"

# 解决方案 3: 不使用 scope
# "name": "evo-cortex-plugin"
```

### Q2: 需要验证邮箱

npm 会发送验证邮件到注册邮箱，点击链接验证后才能发布。

### Q3: 403 Permission Denied

确保：
- 已正确登录（`npm whoami` 能显示用户名）
- 使用的是正确的 registry
- 包名没有被其他人占用

---

## 🎯 推荐方案

**强烈建议发布到官方 npm**，原因：

1. ✅ 全球用户可访问
2. ✅ 更稳定可靠
3. ✅ 更好的统计和监控
4. ✅ OpenClaw 社区的标准做法

**除非**你有特殊需求只在阿里内网使用，才选择 anpm。

---

## 📞 需要帮助？

- **npm 官方文档**: https://docs.npmjs.com/
- **发布指南**: https://docs.npmjs.com/packages-and-modules/contributing-packages-to-the-registry
- **问题反馈**: https://github.com/luoboask/evo-cortex/issues

---

**准备就绪！选择你的发布目标并执行相应命令吧！** 🚀
