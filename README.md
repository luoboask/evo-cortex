# 🧬 Evo-Cortex - OpenClaw Plugin

完整的记忆、学习和进化能力 - 让 Agent 拥有持续学习和自我进化的能力。

## ✨ 功能特性

### 🧠 记忆系统
- **自动存储**：对话后自动存储到记忆
- **智能检索**：对话前自动检索相关记忆（语义搜索 + 关键词匹配）
- **多层记忆**：session/daily/weekly/monthly 分层管理
- **持久化**：文件系统存储（Markdown 格式）+ SQLite 向量索引

### 📚 知识系统
- **知识图谱**：实体和关系管理
- **自动提取**：从对话中自动提取概念
- **领域分类**：支持按领域筛选知识
- **持久化**：JSON 格式存储

### 🔄 进化系统
- **分形思考**：每小时扫描事件，生成元规则
- **主动学习**：每天检测学习机会
- **记忆压缩**：每日/每周/月自动压缩
- **领域审查**：每周日自动审查知识质量

### 🔌 插件能力

| 能力 | 状态 | 说明 |
|------|------|------|
| Agent Tools | ✅ | `search_memory`, `search_knowledge`, `manage_index`, `scan_sessions`, `crawl_web` |
| Event Hooks | ✅ | `message_received`, `message_sent`, `before_tool_call` |
| Cron Jobs | ⚙️ | 需通过 `openclaw cron` 手动配置 |
| Security | ✅ | 工具调用前安全检查 |
| Multi-Agent | ✅ | 完全隔离，每个 agent 独立数据 |

---

## 🚀 快速开始

### 安装

```bash
# 本地安装（开发）
openclaw plugins install /path/to/evo-cortex

# 或从 npm 安装（生产）
openclaw plugins install @evo-agents/openclaw-plugin-evo-agents
```

### 配置

在 `~/.openclaw/openclaw.json` 中添加：

```json5
{
  "plugins": {
    "allow": ["evo-cortex"],
    "entries": {
      "evo-cortex": {
        "enabled": true,
        "config": {
          "verbose": false,  // 启用详细日志
          "memory": {
            "enabled": true,
            "top_k": 5,      // 搜索结果数量
            "auto_store": true
          },
          "knowledge": {
            "enabled": true,
            "auto_expand": true
          },
          "evolution": {
            "enabled": true,
            "fractal_thinking": true,
            "active_learning": true
          }
        }
      }
    }
  }
}
```

### 使用

#### 1. 记忆搜索（工具调用）

LLM 会自动调用 `search_memory` 工具：

```
用户：我记得之前讨论过插件重构的事情
Agent: [自动搜索记忆] 找到了！之前我们讨论了...
```

#### 2. 手动搜索（CLI）

```bash
openclaw memory search "关键词" --agent <agent-id>
```

#### 3. 查看索引状态

```bash
openclaw memory status --agent <agent-id>
```

---

## 🛠️ 工具列表

### search_memory
搜索历史记忆。

**参数：**
- `query` (string): 搜索查询
- `top_k` (number, optional): 返回结果数量，默认 5

**示例：**
```json
{
  "name": "search_memory",
  "arguments": {
    "query": "插件重构",
    "top_k": 3
  }
}
```

### search_knowledge
检索领域知识。

**参数：**
- `query` (string): 搜索查询
- `domain` (string, optional): 领域筛选

### manage_index
管理记忆索引。

**参数：**
- `action`: 操作类型（目前仅支持 `"stats"`）

### scan_sessions
扫描并导入 Agent 会话到记忆系统。

**参数：**
- `full` (boolean, optional): 是否全量扫描（重置状态）

### crawl_web
抓取网页内容并提取知识。

**参数：**
- `url` (string): 网页 URL

---

## 🪝 钩子说明

### message_received
在收到用户消息时触发，自动检索记忆和知识增强上下文。

**触发条件：**
- 消息包含触发词（"之前"、"记得"、"如何"等）
- 或消息长度 > 20 字符

**增强内容：**
- 最多 3 条相关历史记忆
- 最多 3 个相关知识实体

### message_sent
在发送回复时触发，自动存储对话到记忆并提取概念。

**执行操作：**
- 存储对话内容到记忆文件
- 提取技术术语到知识图谱

### before_tool_call
在调用工具前触发，进行安全检查。

**检查项目：**
- 敏感工具识别（`exec`, `delete_file` 等）
- 可添加自定义检查逻辑

---

## 📁 数据存储

所有数据存储在 `~/.openclaw/` 目录下，按 agent 隔离：

```
~/.openclaw/
├── memory/
│   ├── <agent-id>/           # 记忆文件（Markdown）
│   │   └── YYYY-MM-DD.md
│   └── <agent-id>.sqlite     # 向量索引
├── knowledge/
│   └── <agent-id>/           # 知识图谱（JSON）
│       ├── entities.json
│       └── relations.json
└── evolution/
    └── <agent-id>/           # 进化数据
        └── meta_rules.json
```

---

## ⚙️ 定时任务配置

通过 `openclaw cron` 配置进化系统的定时任务：

```bash
# 分形思考（每小时）
openclaw cron add \
  --schedule "0 * * * *" \
  --payload '{"kind":"agentTurn","message":"运行分形思考"}' \
  --sessionTarget isolated

# 记忆压缩（每天 2AM）
openclaw cron add \
  --schedule "0 2 * * *" \
  --payload '{"kind":"agentTurn","message":"压缩记忆"}' \
  --sessionTarget isolated

# 知识审查（每周日 6AM）
openclaw cron add \
  --schedule "0 6 * * 0" \
  --payload '{"kind":"agentTurn","message":"审查知识"}' \
  --sessionTarget isolated
```

---

## 🔧 高级配置

### verbose 模式

启用详细日志，适合调试：

```json5
{
  "plugins": {
    "entries": {
      "evo-cortex": {
        "config": {
          "verbose": true
        }
      }
    }
  }
}
```

启用后日志输出：
```
[DEBUG[cortex-test-agent]:search_memory] Searching for: "插件" (top_k: 5)
[INFO[cortex-test-agent]:search_memory] Found 1 results
[Hook[cortex-test-agent]:message_sent] Stored memory, extracted 3 concepts
```

### 自定义存储路径

默认存储在 `~/.openclaw/`，可通过环境变量修改：

```bash
export OPENCLAW_STATE_DIR=/custom/path
```

---

## 🐛 故障排除

### 问题：找不到记忆

**检查：**
1. 确认 agent ID 正确：`openclaw memory status --agent <agent-id>`
2. 检查记忆文件是否存在：`ls ~/.openclaw/memory/<agent-id>/`
3. 确认索引正常：查看 `Vector: ready` 和 `FTS: ready`

### 问题：钩子未触发

**说明：** 钩子仅在通道消息（WhatsApp/Discord 等）中触发，CLI 直接调用不触发钩子。这是设计如此。

### 问题：警告信息烦人

废弃警告（`'agent_name' config is deprecated`）只会显示一次。如需完全禁用，从配置中移除 `agent_name` 字段。

---

## 📊 性能建议

- **记忆文件较大时**：定期运行记忆压缩（cron 任务）
- **搜索速度慢**：检查嵌入模型是否正常（推荐 `bge-m3`）
- **存储空间不足**：清理旧的 `.md` 文件，保留 SQLite 索引即可

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

**开发环境设置：**
```bash
git clone https://github.com/evo-agents/openclaw-plugin-evo-agents
cd openclaw-plugin-evo-agents
npm install
openclaw plugins install ./
```

---

## 📄 许可证

MIT

---

## 📧 联系

- GitHub: https://github.com/evo-agents
- 文档：https://docs.openclaw.ai/plugins/evo-cortex

## ⚙️ 自动配置定时任务

Evo-Cortex 插件需要定时任务来执行进化功能。使用提供的脚本自动配置：

```bash
# 为指定 agent 配置定时任务
bash ~/.openclaw/extensions/evo-cortex/scripts/setup-crons.sh <agent-id> [basic|standard|full]

# 示例：为标准配置（推荐）
bash ~/.openclaw/extensions/evo-cortex/scripts/setup-crons.sh cortex-test-agent standard

# 基础配置（仅核心任务）
bash ~/.openclaw/extensions/evo-cortex/scripts/setup-crons.sh cortex-test-agent basic

# 完整配置（全部任务）
bash ~/.openclaw/extensions/evo-cortex/scripts/setup-crons.sh cortex-test-agent full
```

### 配置级别

| 级别 | 任务数 | 说明 | 适用场景 |
|------|--------|------|----------|
| **basic** | 3 个 | 仅核心进化能力 | 资源有限或初次尝试 |
| **standard** | 7 个 | 完整的自进化系统 | **推荐**，适合大多数用户 |
| **full** | 9 个 | 最大化进化能力 | 高频使用场景，需要全面进化 |

### 配置的任务

#### 核心任务（HIGH 优先级）⭐
所有级别都包含：
- `hourly-fractal` - 每小时分形思考，生成元规则 (`0 * * * *`)
- `daily-review` - 每日知识审查，优化知识结构 (`0 9 * * *`)
- `active-learning` - 每日主动学习，检测知识缺口 (`0 4 * * *`)

#### 增强任务（MEDIUM 优先级）🔶
standard 和 full 级别包含：
- `daily-compress` - 每日记忆压缩，生成摘要 (`0 9:30 * * *`)
- `weekly-compress` - 每周记忆压缩，生成本周摘要 (`0 3 * * 0`)
- `weekly-kg-expansion` - 每周知识图谱扩展 (`0 5 * * 0`)
- `monthly-cycle` - 每月进化周期，整合元规则 (`0 2 1 * *`)

#### 高级任务（LOW 优先级）🔷
仅 full 级别包含：
- `nightly-evolution` - 夜间进化总结 (`0 23 * * *`)
- `session-scan` - 每 2 小时会话扫描 (`0 */2 * * *`)

### 手动配置（可选）

如果不想使用脚本，也可以手动添加：

```bash
openclaw cron add \
  --name "my-hourly-fractal" \
  --agent "my-agent" \
  --cron "0 * * * *" \
  --message "运行分形思考，生成元规则" \
  --session isolated
```

### 监控和管理

```bash
# 查看所有任务
openclaw cron list | grep <agent-id>

# 手动触发测试
openclaw cron run <task-id>

# 查看执行历史
openclaw cron runs <task-id> --limit 5

# 删除任务
openclaw cron remove <task-id>
```
