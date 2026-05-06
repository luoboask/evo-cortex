# Evo-Cortex

> **给您的智能体一个大脑** — 为 OpenClaw 智能体提供持久记忆、持续学习和进化能力。

[![Version](https://img.shields.io/npm/v/@evo-agents/evo-cortex?color=blue&logo=npm)](https://www.npmjs.com/package/@evo-agents/evo-cortex)
[![License](https://img.shields.io/npm/l/@evo-agents/evo-cortex?color=green)](./LICENSE)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-2026.3.24--beta.2+-orange?logo=openclaw)](https://github.com/openclaw/openclaw)
[![GitHub stars](https://img.shields.io/github/stars/luoboask/evo-cortex?style=social)](https://github.com/luoboask/evo-cortex/stargazers)

**[English](./README.md)** · **[完整文档](./docs/)** · **[快速开始](#-快速开始)**

---

## 什么是 Evo-Cortex？

Evo-Cortex 将 AI 智能体从**被动应答者**转变为**主动学习者**。它提供完整的大脑系统，包括持久记忆、经验提炼、知识图谱和自动化进化周期。

### 为什么选择 Evo-Cortex？

| 问题 | 解决方案 |
|------|----------|
| 智能体每次会话后忘记一切 | **持久记忆** + 语义搜索 |
| 无法从重复经验中学习 | **经验提炼** 自动提取元规则 |
| 知识杂乱无章 | **知识图谱** 自动构建关系 |
| 能力静态不变 | **进化调度器** 持续自我优化 |

### 关键成果

```
成本：  ~$0.00/天  (大部分任务纯脚本执行)
速度：  95% 任务 <1 秒
记忆：  <100ms 语义搜索召回
学习：  持续进化 — 随时间变得更聪明
```

---

## 快速开始

### 1. 安装

```bash
# 通过 npm 安装（推荐）
openclaw plugins install @evo-agents/evo-cortex

# 或直接使用安装脚本
bash ~/.openclaw/extensions/evo-cortex/scripts/install.sh <你的智能体名称>
```

### 2. 配置

`install.sh` 脚本处理所有步骤：

```bash
bash ~/.openclaw/extensions/evo-cortex/scripts/install.sh my-agent
```

**它做了什么：**
- 创建智能体工作区（`SOUL.md`、`USER.md`、`AGENTS.md` 模板）
- 向 OpenClaw 注册智能体
- 初始化记忆和知识数据库
- 创建 7 个自动化定时任务

### 3. 验证

```bash
# 检查插件是否加载
openclaw plugins list | grep evo-cortex

# 查看活动的定时任务
openclaw cron list | grep <你的智能体ID>

# 或使用辅助脚本
bash ~/.openclaw/extensions/evo-cortex/scripts/list-agent-crons.sh <你的智能体ID>
```

**完成！** 你的智能体现在有了会学习和记忆的大脑。

---

## 定时任务

| 任务 | 频率 | 用途 |
|------|------|------|
| `nightly-evolution` | 每天 | 从高价值记忆中提取元规则 |
| `active-learning` | 每天 | 模式识别和偏好提取 |
| `daily-review` | 每天 | 知识图谱健康检查 |
| `daily-compress` | 每天 | 记忆压缩和整合 |
| `weekly-compress` | 每周 | 周归档和总结 |
| `weekly-kg-expansion` | 每周 | 知识图谱扩展 |
| `monthly-cycle` | 每月 | 全面清理、统计和进化 |

所有任务均为纯脚本运行（无需 LLM 调用）— 运营成本 $0.00/天。

---

## 核心功能

### 持久记忆系统

基于 SQLite 的语义记忆，自动捕获和检索所有会话的上下文。

- 自动从 JSONL 日志扫描会话
- 基于嵌入的语义搜索（当可用时）
- 工作记忆、短期记忆和长期记忆分层
- 记忆压缩保持数据库精简

### 知识图谱

从互动中自动构建结构化知识。

- 从对话历史中提取实体
- 自动发现关系
- 图谱健康指标（密度、连通性）
- 每个周期增量更新

### 经验提炼

从重复模式中自动提取元规则和最佳实践。

```markdown
## 规则：动态路径解析
**何时**: 在脚本中配置路径时
**做法**: 使用动态解析而非硬编码
**原因**: 跨环境可移植性
**置信度**: 98%（观察到 15 次）
```

### 进化系统

进化周期确保智能体随时间变得更聪明：

1. **收集** 记忆中高-importance 事件
2. **分类** 事件类型（错误、模式、偏好等）
3. **提炼** 重复模式为元规则
4. **存储** 带置信度的规则
5. **应用** 规则到未来行为

---

## 架构

```
┌─────────────────────────────────────────────────────┐
│                    OpenClaw 智能体                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │ memory.db │  │knowledge.│  │  工作区文件       │   │
│  │          │  │   db     │  │  SOUL/USER/AGENT │   │
│  └────┬─────┘  └────┬─────┘  └────────┬─────────┘   │
│       │             │                 │             │
│  ┌────┴─────────────┴─────────────────┴──────────┐  │
│  │            定时任务（纯脚本执行）               │  │
│  │  扫描 → 学习 → 进化 → 压缩 → 扩展              │  │
│  └────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### 数据流

```
对话 → JSONL 日志 → 会话扫描器 → memory.db
                                             ↓
                                       主动学习
                                             ↓
                                      knowledge.db
                                             ↓
                                       进化系统
                                             ↓
                                       元规则
```

---

## 工作区文件

每个智能体工作区包含引导行为的文件：

| 文件 | 用途 |
|------|------|
| `SOUL.md` | 智能体人设、内容风格、核心原则 |
| `USER.md` | 用户画像、目标、偏好 |
| `AGENTS.md` | 工作区规则、内容指南、质量标准 |
| `memory.db` | 持久记忆存储 |
| `knowledge.db` | 知识图谱存储 |
| `memory/` | 每日 Markdown 记忆文件 |
| `knowledge/` | 实体和关系导出 |
| `evolution/` | 主动学习报告和元规则 |

---

## 性能表现

| 指标 | 值 |
|------|-----|
| 每天成本 | ~$0.00（脚本任务） |
| 响应时间 | 大部分操作 <1s |
| 记忆召回 | <100ms 语义搜索 |
| 磁盘使用 | 最少 ~100MB |
| 依赖 | sqlite3, @sinclair/typebox |

---

## 包详情

| 属性 | 值 |
|------|-----|
| **包名** | `@evo-agents/evo-cortex` |
| **版本** | 1.3.0 |
| **许可证** | MIT |
| **兼容性** | OpenClaw 2026.3.24-beta.2+ |
| **Node.js** | v18+（推荐 v20+） |

---

## 常见问题

**定时任务超时失败？**
在 `setup_crons.py` 中增加超时时间 — 隔离会话初始化需要更长时间。默认：大部分任务 180s，nightly-evolution 300s。

**知识图谱为空？**
新智能体的正常现象。系统需要对话数据来提取实体。建议活跃使用 1-2 周后查看。

**进化系统找到 0 个事件？**
新智能体的预期行为。元规则从重复的高价值模式中出现 — 需要先积累足够的对话历史。

**记忆没有被召回？**
检查会话扫描器是否在运行（`openclaw cron list`）。记忆文件应存在于 `memory/` 目录中。

---

## 参与贡献

1. Fork 并克隆: `git clone https://github.com/luoboask/evo-cortex.git`
2. 创建分支: `git checkout -b feature/your-feature`
3. 修改并提交
4. 推送并创建 PR

详见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

---

## 许可证

[MIT 许可证](./LICENSE) — 可自由使用、修改和分发。

---

<div align="center">

**准备好给您的智能体一个大脑了吗？**

```bash
openclaw plugins install @evo-agents/evo-cortex
```

[开始使用](#快速开始) · [查看文档](./docs/) · [GitHub 加星](https://github.com/luoboask/evo-cortex/stargazers)

---

由 **Evo-Agents Team** 用心打造 | v1.3.0

[返回顶部](#evo-cortex)

</div>
