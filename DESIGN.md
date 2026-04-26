# evo-cortex 设计定位

## 是什么

OpenClaw 插件 — 通过钩子系统**透明增强**已有 agent 的记忆、知识和自进化能力。

## 不是什么

- 不是独立 agent（不需要自己处理对话）
- 不是 skill 集合（OpenClaw 自带 skill 机制）
- 不是 8 个领域插件（那是 evo-agents 的事）

## 插件的核心优势

**钩子系统** — 这是独立 agent 没有的能力：

| 钩子 | 做什么 |
|------|--------|
| `messageReceivedHook` | 消息到达时：加载记忆、注入用户偏好 |
| `messageSentHook` | 消息发出时：记录工作记忆、提取概念 |
| `beforeToolCall` | 工具调用前：注入知识图谱上下文 |

## 聚焦的模块

| 模块 | 状态 | 说明 |
|------|------|------|
| 分层记忆 + 语义搜索 | ✅ | 月度→周度→日度，embedding/TF-IDF/keyword 三级降级 |
| 知识图谱 | ✅ | 实体关系、路径发现、中心性分析 |
| RAG 自动调优 | ✅ | 检索质量追踪、参数自适应 |
| Embedding 批量 | ✅ | API 批量调用、请求去重 |
| Hooks 增强 | 🔧 | 需要继续加强（熔断、错误恢复） |
| 自进化 | 🔧 | 应该通过 hooks 驱动，不是独立 cron |

## 不做的

- ❌ skills/ 目录（OpenClaw 自带）
- ❌ 8 个领域插件（不是插件的职责）
- ❌ 独立的 cron 调度（用 OpenClaw 的 cron）
