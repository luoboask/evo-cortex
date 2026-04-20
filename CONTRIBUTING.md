# 贡献指南

首先，感谢你考虑为 Evo-Cortex 做出贡献！

## 🎯 如何贡献

### 报告 Bug
如果你发现了 Bug，请创建一个 Issue 并包含：
- 清晰的标题和描述
- 复现步骤
- 预期行为和实际行为
- 环境信息（OpenClaw 版本、Node.js 版本等）
- 相关日志或截图

### 提出新功能
新功能建议也通过 Issue 提出，请描述：
- 功能需求和使用场景
- 期望的行为
- 可能的实现方案（可选）

### 提交代码
1. **Fork 项目**
   ```bash
   git clone https://github.com/luoboask/evo-cortex.git
   cd evo-cortex
   ```

2. **创建分支**
   ```bash
   git checkout -b feature/amazing-feature
   # 或
   git checkout -b fix/bug-fix
   ```

3. **开发环境设置**
   ```bash
   npm install
   npm run dev  # 如果有开发模式
   ```

4. **编写代码**
   - 遵循现有的代码风格
   - 添加必要的注释
   - 编写单元测试（如果适用）

5. **提交更改**
   ```bash
   git add .
   git commit -m "feat: add amazing feature"
   # 或
   git commit -m "fix: resolve bug #123"
   ```

6. **推送到分支**
   ```bash
   git push origin feature/amazing-feature
   ```

7. **创建 Pull Request**
   - 在 GitHub 上创建 PR
   - 填写清晰的描述
   - 关联相关的 Issue

## 📝 代码规范

### TypeScript
- 使用 TypeScript 编写所有源代码
- 遵循 `tsconfig.json` 中的配置
- 避免使用 `any`，使用明确的类型

### 命名约定
- 文件和目录：kebab-case (`memory-hub.ts`)
- 类和接口：PascalCase (`MemoryHub`, `KnowledgeGraph`)
- 函数和变量：camelCase (`searchMemory`, `agentId`)
- 常量：UPPER_SNAKE_CASE (`MAX_ENTRIES`, `DEFAULT_TTL`)

### 注释
- 公共 API 必须有 JSDoc 注释
- 复杂逻辑需要解释原因
- 使用中文注释（因为主要用户是中文用户）

### 测试
- 新功能应添加相应的单元测试
- 确保所有测试通过
- 保持测试覆盖率

## 🔧 开发流程

```bash
# 1. 安装依赖
npm install

# 2. 运行测试（如果有）
npm test

# 3. 代码格式化
npm run lint
npm run format

# 4. 构建（如果需要）
npm run build
```

## 📚 文档贡献

文档同样重要！欢迎贡献：
- 修正拼写错误或语法问题
- 补充缺失的说明
- 添加示例代码
- 翻译文档（国际化）

## 💬 沟通

- 通过 GitHub Issues 讨论技术问题
- 通过 Discord 社区交流想法
- 保持友好和专业的沟通氛围

## 🎉 致谢

所有贡献者都将被记录在 README.md 的 Contributors 部分。

感谢你的贡献，让 Evo-Cortex 变得更好！🦞

---

*最后更新：2026-04-20*
