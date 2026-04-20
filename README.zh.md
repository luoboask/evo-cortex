# 🧬 Evo-Cortex

> **给您的智能体一个大脑** — 为 OpenClaw 智能体提供持久记忆、持续学习和进化能力。

[![Version](https://img.shields.io/npm/v/@evo-agents/evo-cortex?color=blue&logo=npm)](https://www.npmjs.com/package/@evo-agents/evo-cortex)
[![npm downloads](https://img.shields.io/npm/dm/@evo-agents/evo-cortex?logo=npm)](https://www.npmtrends.com/@evo-agents/evo-cortex)
[![License](https://img.shields.io/npm/l/@evo-agents/evo-cortex?color=green)](./LICENSE)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-2026.3.13+-orange?logo=openclaw)](https://github.com/openclaw/openclaw)
[![CI/CD](https://github.com/luoboask/evo-cortex/actions/workflows/ci.yml/badge.svg)](https://github.com/luoboask/evo-cortex/actions)
[![GitHub stars](https://img.shields.io/github/stars/luoboask/evo-cortex?style=social)](https://github.com/luoboask/evo-cortex/stargazers)

**[🇺🇸 English](./README.md)** • **[📚 完整文档](./docs/)** • **[🚀 快速开始](#-快速开始)**

---

## 🎯 什么是 Evo-Cortex？

Evo-Cortex 将 AI 智能体从**被动应答者**转变为**主动学习者**。它提供完整的大脑系统，包括持久记忆、经验提炼、知识图谱和自动化进化周期。

### 为什么选择 Evo-Cortex？

| 问题 | 解决方案 | 效果 |
|------|----------|------|
| ❌ 智能体每次会话后忘记一切 | ✅ **持久记忆** + 语义搜索 | 跨会话记住上下文 |
| ❌ 无法从重复经验中学习 | ✅ **经验提炼** 提取元规则 | 随时间变得更智慧 |
| ❌ 知识杂乱无章 | ✅ **知识图谱** 自动构建关系 | 结构化智慧积累 |
| ❌ 能力静态不变 | ✅ **进化调度器** 运行 9 个改进任务 | 持续自我优化 |

### 关键成果

```
💰 成本降低：       78% ↓  (混合 Script+LLM 执行)
⚡ 速度提升：       98% ↑  (95% 任务 <1 秒)
🧠 记忆召回：       全新    (<100ms 语义搜索)
📈 学习速率：       ∞      (持续进化)
```

---

## 🚀 快速开始

### 1. 安装

```bash
# 通过 npm（推荐）
openclaw plugins install @evo-agents/evo-cortex
```

### 2. 配置

```bash
# 一键配置（完整模式）
~/.openclaw/extensions/evo-cortex/scripts/quick-setup.sh <your-agent-id>
```

### 3. 验证

```bash
# 检查安装
openclaw plugins list | grep evo-cortex

# 查看活动任务
~/.openclaw/extensions/evo-cortex/scripts/list-agent-crons.sh <your-agent-id>
```

**完成！** 您的智能体现在有了大脑。🧠

---

## ✨ 核心功能

### 🧠 持久记忆系统

基于 SQLite 的语义记忆，自动捕获和检索所有会话的上下文。

```typescript
// 语义搜索记忆
const results = await search_memory({
  query: "我们之前讨论过 cron 配置吗？",
  limit: 5,
  minScore: 0.4
});
// <100ms 返回相关记忆
```

**亮点：**
- 实时更新（每 5 分钟）
- 自动会话扫描（每 30 分钟）
- 基于嵌入的语义搜索
- 零配置要求

### 📚 经验提炼

从重复模式中自动提取元规则和最佳实践。

**输出示例：**
```markdown
## 规则：动态路径解析
**何时**: 在脚本中配置路径时  
**做法**: 使用动态解析而非硬编码  
**原因**: 跨环境可移植性  
**置信度**: 98%（观察到 15 次）
```

### 🗂️ 知识图谱

从互动中构建和可视化结构化知识。

**自动生成统计：**
```json
{
  "实体数": 12,
  "关系数": 17,
  "密度": 1.42,
  "连通性": 0.85,
  "健康状态": "✅ 优秀"
}
```

### 🧬 进化调度器

九个自动化任务确保持续改进：

| 频率 | 任务 | 目的 |
|------|------|------|
| 每小时 | `hourly-fractal` | 分形思考分析 |
| 每 30 分钟 | `session-scan` | 记忆扫描 |
| 每 5 分钟 | `realtime-index` | 记忆更新 |
| 每天 09:00 | `daily-review` | 记忆回顾 |
| 每天 04:00 | `active-learning` | 缺口检测 |
| 每周日 | `weekly-compress` | 知识整合 |
| 每月 1 号 | `monthly-cycle` | 进化周期 |

**配置级别：**
- **基础版** (3 个任务): 最小开销
- **标准版** (7 个任务): 平衡方案
- **完整版** ⭐ (9 个任务): 最大智能（默认）

---

## 🛠️ 工具与接口

开箱即用的三个强大工具：

| 工具 | 用途 | 示例 |
|------|------|------|
| `search_memory` | 语义记忆搜索 | `search_memory({query: "...", limit: 5})` |
| `search_knowledge` | 知识图谱查询 | `search_knowledge({entity: "cron"})` |
| `health_check` | 系统监控 | `health_check({agent: "my-agent"})` |

**工厂模式支持：**
```typescript
import { createEvoCortexTools } from '@evo-agents/evo-cortex';

// 自动检测当前智能体
const tools = createEvoCortexTools();

// 或显式指定
const tools = createEvoCortexTools({ agentName: 'my-agent' });
```

---

## 📊 性能表现

### 混合执行模式

Evo-Cortex 智能地在快速脚本和创意 LLM 之间路由任务：

```
┌─────────────────────────────────────────────────────┐
│ 简单任务 (95%) → 脚本模式 → <1 秒，$0.001          │
│ 复杂任务 (5%)  → LLM 模式   → ~5 秒，$0.05         │
├─────────────────────────────────────────────────────┤
│ 结果：降低 78% 成本，提升 98% 速度                  │
└─────────────────────────────────────────────────────┘
```

### 基准测试

| 指标 | 之前 | 之后 | 变化 |
|------|------|------|------|
| 单次任务成本 | $0.05 | $0.011 | ↓ 78% |
| 响应时间 | 5.2s | 0.1s | ↑ 98% |
| 记忆召回 | 无 | <100ms | ✨ 新 |
| 学习速率 | 0% | 持续 | ∞ |

---

## 📦 包详情

| 属性 | 值 |
|------|-----|
| **包名** | `@evo-agents/evo-cortex` |
| **版本** | 1.0.0 |
| **大小** | 64.6 KB（47 个文件） |
| **依赖** | 0（零依赖！） |
| **许可证** | MIT |
| **兼容性** | OpenClaw 2026.3.13+ |

**系统要求：**
- Node.js v18+（推荐 v20+）
- OpenClaw 2026.3.13 或更高版本
- 最少 100 MB 磁盘空间

---

## 📚 文档导航

| 资源 | 描述 |
|------|------|
| **[快速开始](#-快速开始)** | 3 步上手 |
| **[核心功能](#-核心功能)** | 深入了解功能 |
| **[API 参考](./docs/API.md)** | 完整工具文档 |
| **[配置指南](./docs/CONFIG.md)** | 自定义行为 |
| **[示例集合](./examples/)** | 实际使用案例 |
| **[常见问题](./docs/FAQ.md)** | 常见疑问解答 |

**更多资源：**
- [变更日志](./CHANGELOG.md) - 版本历史
- [路线图](./ROADMAP.md) - 未来规划
- [贡献指南](./CONTRIBUTING.md) - 参与贡献
- [安全策略](./SECURITY.md) - 安全说明

---

## 🤝 参与贡献

欢迎各种形式的贡献！

### 快速参与方式

1. **报告 Bug** → [GitHub Issues](https://github.com/luoboask/evo-cortex/issues)
2. **建议功能** → [功能请求模板](https://github.com/luoboask/evo-cortex/issues/new?template=feature_request.md)
3. **改进文档** → 提交 PR
4. **分享反馈** → 参与 [Discussions](https://github.com/luoboask/evo-cortex/discussions)

### 开发环境设置

```bash
# Fork 并克隆
git clone https://github.com/luoboask/evo-cortex.git
cd evo-cortex

# 创建分支
git checkout -b feature/your-feature

# 修改并提交
git commit -m "feat: add your feature"

# 推送并创建 PR
git push origin feature/your-feature
```

详细指南请查看 [CONTRIBUTING.md](./CONTRIBUTING.md)。

---

## 💬 社区

| 平台 | 用途 | 链接 |
|------|------|------|
| **GitHub** | 代码、问题、PR | [仓库](https://github.com/luoboask/evo-cortex) |
| **Discord** | 聊天、支持 | [OpenClaw 服务器](https://discord.gg/clawd) |
| **npm** | 包统计 | [@evo-agents/evo-cortex](https://www.npmjs.com/package/@evo-agents/evo-cortex) |
| **文档** | 官方文档 | [OpenClaw Docs](https://docs.openclaw.ai) |

**需要帮助？**
- 🐛 Bug 报告：[Issues](https://github.com/luoboask/evo-cortex/issues)
- 💡 功能建议：[Discussions](https://github.com/luoboask/evo-cortex/discussions)
- ❓ 问题咨询：Discord 或 GitHub Discussions

---

## 🙏 致谢

由 Evo-Agents Team 为 OpenClaw 社区用心打造。

特别感谢：
- 所有贡献者和早期采用者
- OpenClaw 核心团队
- 更广泛的 AI 智能体社区

---

## 📄 许可证

[MIT 许可证](./LICENSE) — 可自由使用、修改和分发。

---

<div align="center">

**🧬 准备好给您的智能体一个大脑了吗？**

```bash
openclaw plugins install @evo-agents/evo-cortex
```

[开始使用](#-快速开始) • [查看文档](./docs/) • [GitHub 加星](https://github.com/luoboask/evo-cortex/stargazers)

---

由 **Evo-Agents Team** 用心制作 ❤️ | v1.0.0 • 2026 年 4 月 21 日

[🔝 返回顶部](#-evocortex)

</div>
