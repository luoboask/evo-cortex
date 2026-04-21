# 📦 npm 发布指南

## 🎯 目标

将 Evo-Cortex 插件发布到 npm，使用户可以通过以下命令安装：

```bash
openclaw plugins install @evo-agents/evo-cortex
```

---

## ✅ 发布前检查清单

### 1. 必要文件

- [x] `package.json` - 配置完整（名称、版本、许可证等）
- [x] `README.md` - 文档完整
- [x] `LICENSE` - MIT 许可证
- [x] `src/index.ts` - 主入口文件
- [x] `.npmignore` - 排除规则正确

### 2. package.json 关键配置

```json
{
  "name": "@evo-agents/evo-cortex",
  "version": "1.0.0",
  "license": "MIT",
  "main": "src/index.ts",
  "files": ["src", "scripts", "README.md", "LICENSE"],
  "repository": {
    "url": "https://github.com/luoboask/evo-cortex.git"
  }
}
```

### 3. 打包测试

```bash
cd ~/.openclaw/extensions/evo-cortex

# 预览打包结果
npm pack --dry-run

# 预期输出:
# - 包大小：~65KB
# - 文件数：~47 个
# - shasum 校验和
```

---

## 🚀 发布步骤

### 方式 1: 交互式登录（推荐）

```bash
# 1. 登录 npm
npm login

# 按提示输入:
# - Username: your_username
# - Password: your_password
# - Email: your_email@example.com

# 2. 验证登录
npm whoami
# 应输出你的用户名

# 3. 发布
cd ~/.openclaw/extensions/evo-cortex
npm publish --access public

# 4. 验证发布
npm view @evo-agents/evo-cortex
```

### 方式 2: 使用 Token（CI/CD）

```bash
# 1. 获取 npm Token
# 访问 https://www.npmjs.com/settings/YOUR_USERNAME/tokens
# 创建新 token (Automation 类型)

# 2. 设置环境变量
export NPM_TOKEN="npm_xxxxxxxxxxxxxxxxxxxxx"

# 3. 配置认证
npm set //registry.npmjs.org/:_authToken=$NPM_TOKEN

# 4. 发布
cd ~/.openclaw/extensions/evo-cortex
npm publish --access public
```

---

## 📊 发布后验证

### 1. 检查 npm 包页面

访问：https://www.npmjs.com/package/@evo-agents/evo-cortex

确认信息：
- ✅ 版本号正确（1.0.0）
- ✅ README 渲染正常
- ✅ 许可证显示 MIT
- ✅ 仓库链接正确

### 2. 测试安装

```bash
# 在新目录测试安装
mkdir /tmp/test-evo-cortex
cd /tmp/test-evo-cortex

# 通过 OpenClaw 安装
openclaw plugins install @evo-agents/evo-cortex

# 或手动安装
openclaw plugins install @evo-agents/evo-cortex --path ~/.openclaw/extensions/evo-cortex-npm

# 验证插件加载
openclaw plugins list | grep evo-cortex
```

### 3. 更新 GitHub Release

```bash
# 在 GitHub 创建 Release
# 访问 https://github.com/luoboask/evo-cortex/releases/new

# Tag version: v1.0.0
# Release title: v1.0.0 - Initial Release
# Description: 首个稳定版本，包含完整的记忆、学习和进化能力

# 或者使用 gh CLI
gh release create v1.0.0 \
  --title "v1.0.0 - Initial Release" \
  --notes "首个稳定版本发布到 npm"
```

---

## 🔄 后续版本发布

### 语义化版本控制

遵循 [Semantic Versioning](https://semver.org/)：

- **MAJOR.MINOR.PATCH** (例如：1.0.0 → 1.0.1 → 1.1.0 → 2.0.0)

**版本号规则**:
- **PATCH** (1.0.0 → 1.0.1): 向后兼容的 bug 修复
- **MINOR** (1.0.0 → 1.1.0): 向后兼容的新功能
- **MAJOR** (1.0.0 → 2.0.0): 不兼容的 API 变更

### 发布新版本

```bash
cd ~/.openclaw/extensions/evo-cortex

# 1. 更新版本号
npm version patch  # 或 minor, major

# 这会自动:
# - 更新 package.json 的 version
# - 创建 git commit
# - 创建 git tag

# 2. 推送代码和标签
git push origin main
git push origin v1.0.1

# 3. 发布到 npm
npm publish --access public
```

---

## 🛠️ 常见问题

### Q1: 发布失败 "403 Forbidden"

**原因**: 未登录或权限不足

**解决**:
```bash
npm login
# 重新登录后重试
```

### Q2: 包名已被占用

**原因**: `@evo-agents/evo-cortex` 已存在

**解决**:
- 方案 1: 联系当前所有者转让
- 方案 2: 使用其他 scope，如 `@your-username/evo-cortex`
- 方案 3: 使用不带 scope 的名称：`evo-cortex-plugin`

### Q3: 文件大小超限

**原因**: 包含了不必要的文件

**解决**:
```bash
# 检查 .npmignore
cat .npmignore

# 确保排除了:
# - node_modules/
# - tests/
# - .git/
# - *.test.ts
```

### Q4: README 未显示

**原因**: package.json 中未指定 files 或 README 被忽略

**解决**:
```json
// package.json
{
  "files": ["src", "scripts", "README.md", "LICENSE"]
}
```

---

## 📈 发布后的工作

### 1. 更新项目文档

修改 `README.md` 顶部的安装说明：

```markdown
### 方式 1: npm 安装（推荐）

```bash
openclaw plugins install @evo-agents/evo-cortex
```

### 方式 2: 本地安装

```bash
openclaw plugins install ~/.openclaw/extensions/evo-cortex
```
```

### 2. 通知用户

在以下渠道发布消息：

- GitHub Issues/ Discussions
- OpenClaw Discord 社区
- 相关社交媒体

### 3. 监控下载量

```bash
# 查看下载统计
npm stats @evo-agents/evo-cortex

# 或使用网站
https://www.npmtrends.com/@evo-agents/evo-cortex
```

---

## 🎉 发布完成！

发布成功后，用户可以通过以下命令安装：

```bash
openclaw plugins install @evo-agents/evo-cortex
```

**包页面**: https://www.npmjs.com/package/@evo-agents/evo-cortex  
**GitHub**: https://github.com/luoboask/evo-cortex

---

**最后更新**: 2026-04-20  
**维护者**: Evo-Agents Team
