# 🧬 Evo-Cortex

**给您的智能体一个大脑**

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/luoboask/evo-cortex)
[![npm](https://img.shields.io/npm/v/@evo-agents/evo-cortex.svg)](https://www.npmjs.com/package/@evo-agents/evo-cortex)
[![npm downloads](https://img.shields.io/npm/dm/@evo-agents/evo-cortex.svg)](https://www.npmtrends.com/@evo-agents/evo-cortex)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](https://github.com/luoboask/evo-cortex/blob/main/LICENSE)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-2026.3.13+-orange.svg)](https://github.com/openclaw/openclaw)
[![GitHub stars](https://img.shields.io/github/stars/luoboask/evo-cortex?style=social)](https://github.com/luoboask/evo-cortex/stargazers)
[![CI/CD](https://github.com/luoboask/evo-cortex/actions/workflows/ci.yml/badge.svg)](https://github.com/luoboask/evo-cortex/actions)

**[🇺🇸 English Documentation](./README.md)**

---

## 🎯 概述

Evo-Cortex 不只是一个普通的插件——它是 OpenClaw 智能体的**完整大脑系统**。它将 AI 智能体从被动应答者转变为主动学习者，拥有持久记忆、持续学习和进化能力。见证您的智能体在每次互动中变得更聪明！

### ✨ 核心价值

| 能力 | 描述 | 效果 |
|------|------|------|
| **🧠 持久记忆** | 基于 SQLite 的语义记忆，自动索引 | 不再"金鱼记忆" |
| **📚 经验提炼** | 从重复模式中自动提取元规则 | 持续积累智慧 |
| **🗂️ 知识图谱** | 自动实体提取和关系映射 | 结构化知识库 |
| **🧬 进化调度器** | 9 个专门任务实现持续改进 | 自我优化的智能体 |

---

## 🚀 快速开始

### 安装

**方式一：npm（推荐）**

```bash
# 安装插件
openclaw plugins install @evo-agents/evo-cortex

# 一键配置（完整配置）
~/.openclaw/extensions/evo-cortex/scripts/quick-setup.sh <your-agent-id>

# 验证配置
~/.openclaw/extensions/evo-cortex/scripts/verify-setup.sh <your-agent-id>
```

**方式二：本地安装（开发）**

```bash
# 克隆仓库
git clone https://github.com/luoboask/evo-cortex.git
cd evo-cortex

# 本地安装
openclaw plugins install ~/.openclaw/extensions/evo-cortex

# 配置
~/.openclaw/extensions/evo-cortex/scripts/quick-setup.sh <your-agent-id>
```

### 验证

```bash
# 检查插件状态
openclaw plugins list | grep evo-cortex

# 查看定时任务
~/.openclaw/extensions/evo-cortex/scripts/list-agent-crons.sh <your-agent-id>

# 查看健康状态
~/.openclaw/extensions/evo-cortex/scripts/verify-setup.sh <your-agent-id>
```

---

## 🧠 功能特性

### 1. 持久记忆系统

再也不丢失上下文。Evo-Cortex 使用基于 SQLite 的语义搜索，自动捕获、索引和检索所有会话的记忆。

**核心能力：**
- 🔄 实时记忆更新（每 5 分钟）
- 🔍 基于嵌入的语义搜索
- 💾 高效 SQLite 索引
- 📊 自动会话扫描（每 30 分钟）

**示例：**
```typescript
// 语义搜索记忆
const results = await search_memory({
  query: "我们之前讨论过 cron 配置吗？",
  limit: 5,
  minScore: 0.4
});
```

---

### 2. 经验提炼

将重复的经验转化为可执行的元规则和最佳实践。您的智能体从模式中学习，随时间变得更智慧。

**流程：**
```
经验 → 模式识别 → 元规则 → 最佳实践
```

**元规则示例：**
```markdown
## 规则：动态路径解析
- **触发**: 在脚本中配置路径时
- **行动**: 使用动态解析而非硬编码
- **好处**: 跨环境可移植
- **置信度**: 98%（观察到 15 次）
```

---

### 3. 知识图谱

从您的互动中自动构建和维护结构化知识图谱。可视化概念、实体和经验教训之间的关系。

**特性：**
- 🕸️ 自动实体提取
- 🔗 关系映射
- 📈 健康监控
- 🎨 Mermaid 可视化

**统计：**
```json
{
  "entities": 12,
  "relationships": 17,
  "density": 1.42,
  "connectivity": 0.85,
  "health": "✅ 优秀"
}
```

---

### 4. 进化调度器

九个专门的定时任务协同工作，确保持续改进。从每小时分形分析到每月进化周期，您的智能体永不停止学习。

#### 配置级别

| 级别 | 任务数 | 频率 | 适用场景 |
|------|--------|------|----------|
| **基础版** | 3 | 每小时 + 每天 | 最小开销 |
| **标准版** | 7 | + 每周 + 每月 | 平衡方案 |
| **完整版** ⭐ | 9 | + 实时 | 最大智能 |

#### 任务调度表

| 任务 | 频率 | 时间 | 描述 |
|------|------|------|------|
| 🌀 `hourly-fractal` | 每小时 | :00 | 分形思考分析 |
| 📝 `daily-review` | 每天 | 09:00 | 每日记忆回顾 |
| 🎯 `active-learning` | 每天 | 04:00 | 知识缺口检测 |
| 🗜️ `daily-compress` | 每天 | 09:30 | 记忆压缩 |
| 📦 `weekly-compress` | 每周 | 周日 03:00 | 每周整合 |
| 🌐 `weekly-kg-expansion` | 每周 | 周日 05:00 | 知识图谱扩展 |
| 🔄 `monthly-cycle` | 每月 | 1 号 02:00 | 每月进化周期 |
| 🔍 `session-scan` | 每 30 分钟 | :00,:30 | 会话记忆扫描 |
| ⚡ `realtime-index` | 每 5 分钟 | :00,:05 | 实时记忆更新 |

---

## 📊 性能表现

### 成本与速度

| 指标 | 之前 | 之后 | 提升 |
|------|------|------|------|
| **单次任务成本** | $0.05 | $0.011 | **↓ 78%** |
| **响应时间** | 5.2s | 0.1s | **↑ 98%** |
| **记忆召回** | 无 | <100ms | **全新** |
| **学习速率** | 0% | 持续 | **∞** |

### 混合执行模式

Evo-Cortex 采用 Script+LLM 混合执行模式。简单任务作为快速脚本运行（<1 秒），复杂推理利用 LLM 的创造力。

```
简单任务 (95%) → 脚本模式 → <1 秒，$0.001
复杂任务 (5%)  → LLM 模式   → ~5 秒，$0.05
                    ────────────────────────
                    平均：降低 78% 成本
```

---

## 🛠️ 工具与接口

### 可用工具

| 工具 | 描述 | 示例 |
|------|------|------|
| `search_memory` | 语义记忆搜索 | `search_memory({query: "...", limit: 5})` |
| `search_knowledge` | 知识图谱查询 | `search_knowledge({entity: "cron", type: "system"})` |
| `health_check` | 系统健康监控 | `health_check({agent: "my-agent"})` |

### 工厂函数模式

支持多智能体，自动上下文检测。无需硬编码智能体名称！

```typescript
import { createEvoCortexTools } from '@evo-agents/evo-cortex';

// 自动检测当前智能体
const tools = createEvoCortexTools();

// 或显式指定
const tools = createEvoCortexTools({ agentName: 'my-agent' });
```

---

## 📦 包信息

### 分发信息

| 属性 | 值 |
|------|-----|
| **包名** | `@evo-agents/evo-cortex` |
| **版本** | 1.0.0 |
| **许可证** | MIT |
| **大小** | 64.6 KB（47 个文件） |
| **依赖** | 0（零依赖！） |
| **注册表** | https://registry.npmjs.org |

### 系统要求

| 要求 | 最低 | 推荐 |
|------|------|------|
| **Node.js** | v18+ | v20+ |
| **OpenClaw** | 2026.3.13+ | 最新版 |
| **磁盘空间** | 100 MB | 500 MB |
| **内存** | 256 MB | 512 MB |

---

## 📚 文档

| 文档 | 描述 |
|------|------|
| [README](./README.md) | 英文文档 |
| [README.zh.md](./README.zh.md) | 中文文档（当前位置） |
| [CHANGELOG](./CHANGELOG.md) | 版本历史 |
| [ROADMAP](./ROADMAP.md) | 未来规划 |
| [CONTRIBUTING](./CONTRIBUTING.md) | 贡献指南 |
| [SECURITY](./SECURITY.md) | 安全策略 |
| [MEDIA](./MEDIA.md) | 媒体资源包 |
| [MILESTONES](./MILESTONES.md) | 项目里程碑 |
| [LOGO](./LOGO.md) | 品牌指南 |

---

## 🔧 脚本工具

Evo-Cortex 包含 16 个自动化脚本：

| 脚本 | 用途 |
|------|------|
| `quick-setup.sh` | 一键安装配置 |
| `setup-crons-hybrid.sh` | 配置定时任务 |
| `register-agent.sh` | 注册新智能体 |
| `verify-setup.sh` | 验证配置 |
| `list-all-crons.sh` | 列出所有定时任务 |
| `list-agent-crons.sh` | 列出智能体定时任务 |
| `cleanup-plugin-demo.sh` | 清理测试数据 |
| `knowledge-health-check.sh` | 检查知识图谱健康 |

---

## 🤝 贡献

欢迎贡献！无论是 Bug 报告、功能请求、文档改进还是代码贡献——每一份帮助都很重要。

### 如何贡献

1. **派生并克隆**
   ```bash
   git clone https://github.com/luoboask/evo-cortex.git
   cd evo-cortex
   ```

2. **创建分支**
   ```bash
   git checkout -b feature/your-feature
   ```

3. **进行修改**

4. **提交**
   ```bash
   git commit -m "feat: add your feature"
   ```

5. **推送并创建 Pull Request**
   ```bash
   git push origin feature/your-feature
   ```

详细指南请查看 [CONTRIBUTING.md](./CONTRIBUTING.md)。

---

## 📞 社区

| 平台 | 链接 |
|------|------|
| **npm** | [包页面](https://www.npmjs.com/package/@evo-agents/evo-cortex) |
| **GitHub** | [仓库](https://github.com/luoboask/evo-cortex) |
| **Discord** | [OpenClaw 服务器](https://discord.gg/clawd) |
| **文档** | [OpenClaw 文档](https://docs.openclaw.ai) |

### 支持

- 🐛 **Bug 报告**: [GitHub Issues](https://github.com/luoboask/evo-cortex/issues)
- 💡 **功能请求**: [功能请求模板](https://github.com/luoboask/evo-cortex/issues/new?template=feature_request.md)
- ❓ **问题**: [Discussions](https://github.com/luoboask/evo-cortex/discussions) 或 Discord

---

## 📄 许可证

MIT 许可证 - 可自由使用、修改和分发。详情见 [LICENSE](./LICENSE)。

---

## 🙏 致谢

为 OpenClaw 社区用心打造。特别感谢所有让这个项目成为可能的贡献者和早期采用者。

---

## 📈 星标历史

[![Star History Chart](https://api.star-history.com/svg?repos=luoboask/evo-cortex&type=Date)](https://star-history.com/#luoboask/evo-cortex&Date)

---

<div align="center">

### 🧬 Evo-Agents Team 用心制作

**版本 1.0.0** | 发布于：2026 年 4 月 21 日

[🇺🇸 English Documentation](./README.md) • [🔝 返回顶部](#-evo-cortex)

</div>
