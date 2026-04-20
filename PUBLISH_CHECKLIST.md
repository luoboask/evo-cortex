# 📦 npm 发布检查清单 - Evo-Cortex v1.0.0

## ✅ 准备工作已完成

- [x] package.json 配置完整
- [x] README.md 文档完善
- [x] LICENSE 文件存在
- [x] .npmignore 排除规则正确
- [x] 代码已提交到 GitHub
- [x] 打包测试通过（64.5KB, 47 文件）

---

## 🚀 发布步骤（手动执行）

### Step 1: 登录 npm

```bash
npm login
```

按提示输入：
- Username: `你的 npm 用户名`
- Password: `你的 npm 密码`
- Email: `你的邮箱`

验证登录：
```bash
npm whoami
# 应输出你的用户名
```

---

### Step 2: 发布包

```bash
cd ~/.openclaw/extensions/evo-cortex
npm publish --access public
```

预期输出：
```
+ @evo-agents/evo-cortex@1.0.0
```

---

### Step 3: 验证发布

**访问包页面**:
https://www.npmjs.com/package/@evo-agents/evo-cortex

**或命令行查看**:
```bash
npm view @evo-agents/evo-cortex
```

---

### Step 4: 创建 GitHub Release

```bash
# 使用 gh CLI
gh release create v1.0.0 \
  --title "v1.0.0 - Initial Release" \
  --notes "🎉 Evo-Cortex 首个稳定版本发布！

## 核心功能
- 🧠 持久记忆系统
- 📚 经验提炼（元规则生成）
- 🗂️ 知识图谱构建  
- 🎯 主动学习机制
- 🔮 预测推荐

## 安装
\`\`\`bash
openclaw plugins install @evo-agents/evo-cortex
\`\`\`

详细文档：https://github.com/luoboask/evo-cortex/blob/main/README.md"

# 或手动访问
# https://github.com/luoboask/evo-cortex/releases/new
```

---

### Step 5: 更新 README（可选）

发布成功后，可以更新 README 顶部的安装说明，将 npm 安装方式放在第一位：

```markdown
### 方式 1: npm 安装（推荐）✨

```bash
openclaw plugins install @evo-agents/evo-cortex
```

### 方式 2: 本地安装

```bash
openclaw plugins install ~/.openclaw/extensions/evo-cortex
```
```

---

## 📊 发布后验证

### 测试安装

```bash
# 在新目录测试
mkdir /tmp/test-install
cd /tmp/test-install

# 通过 OpenClaw 安装
openclaw plugins install @evo-agents/evo-cortex

# 验证
openclaw plugins list | grep evo-cortex
```

### 监控下载量

- **npm Trends**: https://www.npmtrends.com/@evo-agents/evo-cortex
- **npm Stats**: `npm stats @evo-agents/evo-cortex`

---

## 🔄 后续版本发布

```bash
cd ~/.openclaw/extensions/evo-cortex

# 1. 更新版本号（根据变更类型选择）
npm version patch  # bug 修复：1.0.0 → 1.0.1
npm version minor  # 新功能：1.0.0 → 1.1.0
npm version major  # 破坏性变更：1.0.0 → 2.0.0

# 2. 推送代码和标签
git push origin main
git push origin v1.0.1  # 使用实际的版本号

# 3. 发布到 npm
npm publish --access public

# 4. 创建 GitHub Release
gh release create v1.0.1 --generate-notes
```

---

## 📝 快速参考命令

```bash
# 查看当前包信息
npm pkg get name version license

# 预览打包结果
npm pack --dry-run

# 查看已发布版本
npm view @evo-agents/evo-cortex versions

# 下载量统计
npm show @evo-agents/evo-cortex downloads

# 取消发布（仅在发布后 24 小时内有效）
npm unpublish @evo-agents/evo-cortex@1.0.0
```

---

## ⚠️ 注意事项

1. **包名作用域**: `@evo-agents/evo-cortex` 需要组织权限
   - 如果失败，尝试个人包名：`@your-username/evo-cortex`
   
2. **版本号唯一**: 每个版本只能发布一次
   - 发错了需要用 `npm unpublish` 撤销
   
3. **文件大小**: 当前 64.5KB，远小于 npm 限制（~500MB）

4. **发布后无法修改**: 
   - 如果发现错误，需要发布新版本（patch/minor/major）

---

## 🎉 成功标志

发布成功后，用户应该能够：

```bash
# 1. 搜索到包
npm search evo-cortex

# 2. 查看详情
npm view @evo-agents/evo-cortex

# 3. 安装
openclaw plugins install @evo-agents/evo-cortex

# 4. 正常使用插件功能
```

---

**准备就绪！现在执行以下命令开始发布:**

```bash
npm login
cd ~/.openclaw/extensions/evo-cortex
npm publish --access public
```

**祝发布顺利！🚀**
