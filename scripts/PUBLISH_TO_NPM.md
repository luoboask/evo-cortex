# 📦 Evo-Cortex npm 发布指南

**版本**: 1.0.0  
**包名**: `@evo-agents/evo-cortex`

---

## 📋 发布前检查清单

### 1. 验证 package.json
```bash
# 检查必要字段
cat package.json | jq '{name, version, license, repository}'

# 应该输出:
# {
#   "name": "@evo-agents/evo-cortex",
#   "version": "1.0.0",
#   "license": "MIT",
#   "repository": {...}
# }
```

### 2. 检查 .npmignore
确保以下文件**不会**被发布：
- ❌ node_modules/
- ❌ tests/
- ❌ .git/
- ❌ .env*
- ❌ 开发配置文件

确保以下文件**会被**发布：
- ✅ src/
- ✅ scripts/
- ✅ README.md
- ✅ LICENSE

### 3. 运行测试
```bash
npm test
npm run lint
```

所有测试必须通过！

### 4. 更新版本号
```bash
# 根据语义化版本规则
npm version patch  # 1.0.0 → 1.0.1 (bug 修复)
# 或
npm version minor  # 1.0.0 → 1.1.0 (新功能)
# 或
npm version major  # 1.0.0 → 2.0.0 (破坏性变更)
```

---

## 🚀 发布步骤

### 步骤 1: 登录 npm
```bash
npm login
```

输入你的 npm 用户名、密码和邮箱。

**注意**: 
- 如果没有 npm 账号，先注册：https://www.npmjs.com/signup
- 建议启用双因素认证

### 步骤 2: 本地打包测试
```bash
# 生成 tarball 文件
npm pack

# 应该生成：evo-agents-evo-cortex-1.0.0.tgz

# 检查包内容
tar -tzf evo-agents-evo-cortex-1.0.0.tgz | head -20

# 删除测试文件
rm evo-agents-evo-cortex-1.0.0.tgz
```

### 步骤 3:  dry-run 发布（可选但推荐）
```bash
# 使用 --dry-run 预览发布内容
npm publish --dry-run
```

查看输出的文件列表，确保没有意外包含的文件。

### 步骤 4: 正式发布
```bash
# 发布到 npm registry
npm publish --access public
```

**成功标志**:
```
+ @evo-agents/evo-cortex@1.0.0
```

### 步骤 5: 验证发布
```bash
# 查看 npm 上的包
npm view @evo-agents/evo-cortex

# 或者在浏览器中查看
# https://www.npmjs.com/package/@evo-agents/evo-cortex
```

---

## 🔧 发布后操作

### 1. 创建 Git 标签
```bash
git tag -a v1.0.0 -m "Release v1.0.0"
git push origin v1.0.0
```

### 2. 更新 GitHub Release
在 https://github.com/luoboask/evo-cortex/releases 创建新版本

### 3. 通知用户
- 更新 README 中的安装说明
- 在 Issues/Discussions 中公告
- 更新 CHANGELOG.md

---

## ⚠️ 常见问题

### 问题 1: 包名已被占用
```bash
npm ERR! You cannot publish over the previously published versions: 1.0.0
```

**解决**: 修改 package.json 中的 version 字段，使用新版本号。

### 问题 2: 权限不足
```bash
npm ERR! Unable to authenticate, your auth token is stale.
```

**解决**: 
```bash
npm logout
npm login
```

### 问题 3: 包太大
```bash
npm WARN tarball tarball data for ... is too large
```

**解决**: 
- 检查 .npmignore 是否配置正确
- 移除不必要的大文件
- 使用 `npm pack --dry-run` 预览

### 问题 4: 网络问题
```bash
npm ERR! code ENOTFOUND
npm ERR! syscall getaddrinfo
npm ERR! errno ENOTFOUND
```

**解决**: 
- 检查网络连接
- 尝试切换 npm registry:
  ```bash
  npm config set registry https://registry.npmmirror.com
  # 或
  npm config set registry https://registry.npmjs.org
  ```

---

## 📊 发布后验证

### 用户可以这样安装
```bash
# 方式 1: 直接安装
openclaw plugins install @evo-agents/evo-cortex

# 方式 2: 指定版本
openclaw plugins install @evo-agents/evo-cortex@1.0.0

# 方式 3: 从 tarball 安装
openclaw plugins install /path/to/evo-agents-evo-cortex-1.0.0.tgz
```

### 验证安装
```bash
openclaw plugins info @evo-agents/evo-cortex
```

应该显示:
```
Evo-Cortex Plugin
Status: loaded
Version: 1.0.0
```

---

## 🎯 最佳实践

### 1. 语义化版本
遵循 [SemVer](https://semver.org/) 规范:
- **MAJOR.MINOR.PATCH** (例如：1.0.0)
- MAJOR: 破坏性变更
- MINOR: 向后兼容的新功能
- PATCH: 向后兼容的 bug 修复

### 2. 发布频率
- Bug 修复：及时发布 PATCH 版本
- 新功能：累积几个一起发布 MINOR 版本
- 破坏性变更：谨慎发布 MAJOR 版本，提前公告

### 3. Changelog
每次发布都更新 CHANGELOG.md，包含:
- 新增功能
- Bug 修复
- 破坏性变更及迁移指南

### 4. 测试
发布前必须:
- ✅ 所有单元测试通过
- ✅ Lint 检查通过
- ✅ 手动测试核心功能

---

## 📞 获取帮助

- npm 文档：https://docs.npmjs.com/
- 发布包指南：https://docs.npmjs.com/packages-and-modules/contributing-packages-to-the-registry
- OpenClaw 插件开发：https://docs.openclaw.ai/plugins

---

**祝发布顺利！** 🎉📦
