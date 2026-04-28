# evo-cortex 核心流程文档

> v1.3.0 — 2026-04-28

## 1. 架构总览

```
┌─────────────────────────────────────────────────────────┐
│                    OpenClaw Gateway                      │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │   Hooks     │  │    Tools     │  │    Cron      │   │
│  │             │  │              │  │              │   │
│  │ message_rcv │  │search_memory │  │nightly-evol  │   │
│  │ message_sent│  │search_know   │  │active-learn  │   │
│  │ agent_end   │  │manage_index  │  │daily-review  │   │
│  │ before_tool │  │manage_mem    │  │daily-compress│   │
│  └─────┬───────┘  └──────┬───────┘  └──────┬───────┘   │
│        │                 │                 │            │
│  ┌─────▼─────────────────▼─────────────────▼──────┐   │
│  │              核心子系统                          │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │   │
│  │  │ 记忆系统  │  │ 知识系统  │  │  进化系统     │  │   │
│  │  │MemoryHub │  │Knowledge │  │Evolution     │  │   │
│  │  │MemorySys │  │System    │  │Scheduler     │  │   │
│  │  │IndexBuild│  │WebCrawler│  │Fractal/Causal│  │   │
│  │  └──────────┘  └──────────┘  └──────────────┘  │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │              共享基础设施                          │  │
│  │  MemoryIndexer │ IndexBuilder │ EmbeddingProvider│  │
│  │  FTS Index     │ Vector Index │ Semantic Search  │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### 数据存储路径

| 数据类型 | 路径 | 格式 |
|---------|------|------|
| 工作记忆 DB | `~/.openclaw/extensions/evo-cortex/data/<agentId>/memory.db` | SQLite (WAL) |
| 知识图谱 DB | `~/.openclaw/extensions/evo-cortex/data/<agentId>/knowledge.db` | SQLite (WAL) |
| 长期记忆文件 | `~/.openclaw/workspace-<agentId>/memory/YYYY-MM-DD.md` | Markdown |
| FTS 索引 | `data/<agentId>/fts_index.db` | SQLite FTS5 |
| 向量索引 | `data/<agentId>/vector_index.db` | SQLite BLOB |
| RAG 评估 | `data/<agentId>/rag_metrics.json` | JSON |

### 多 Agent 隔离

所有共享实例使用 `Map<agentId, Instance>` 隔离：
- `sharedMemoryIndexers` — MemoryIndexer
- `sharedIndexBuilders` — IndexBuilder
- `hubCache` / `msCache` / `ksCache` — MemoryHub / MemorySystem / KnowledgeSystem
- `prefCache` — 用户偏好缓存

---

## 2. 记忆系统流程

### 2.1 写入流程（实时）

```
用户提问 ──→ message_received Hook
                 │
                 ├── ① 加载用户偏好 (knowledge.db, 5min TTL 缓存)
                 ├── ② 最近记忆摘要 (WM 最新 5 条 + LTM 最近 2 天)
                 ├── ③ 元规则匹配 (confidence ≥ 0.6, 关键词匹配)
                 ├── ④ 语义检索增强 (触发词检测 → 2s 超时保护)
                 │     ├── MemorySystem.search() / MemoryHub.search()
                 │     └── KnowledgeSystem.searchEntities()
                 │
                 └── system_prompt_addition 注入上下文
                        │
                        ▼
                    AI 生成回复
                        │
                        ▼
                   message_sent Hook
                        │
                        ├── 记录完整对话对到 working_memory
                        └── importance 自动评分
                                │
                                ▼
                           agent_end Hook
                                │
                                ├── 从 messages 提取 User/AI 对话对
                                ├── 清洗元数据 (TUI header, code fence)
                                ├── MemorySystem.record() 写入 working_memory
                                │     └── 重要性 = BASE(3.0) + 类型权重 + 来源权重 + 关键词加成
                                ├── persistToMarkdown() → memory/YYYY-MM-DD.md
                                └── fire-and-forget: IndexBuilder.buildFromDb()
                                      └── 更新 FTS5 + Vector 索引
```

**重要性评分公式：**
```
score = 3.0 + type_weight + source_weight + keyword_bonus (max 10)

type_weight:    decision=3, bugfix=2.5, preference=2.5
                insight=2, error=1.5, observation=1, conversation=0.5
source_weight:  manual=2, hook=1, scan=0.5, cron=0.3
keyword_bonus:  1.5 (当内容包含"记住/重要/必须/关键/偏好"等关键词)
```

### 2.2 压缩流程（Cron 触发）

```
daily_compress.py (09:30 CST)
        │
        ├── consolidate() — 工作记忆 → 长期记忆
        │     │
        │     ├── 候选: importance ≥ 5.0 AND id NOT IN (最新 100 条)
        │     ├── 去重: content 相似度 (difflib.SequenceMatcher ≥ 0.85)
        │     ├── 合并: 同 title 条目合并内容
        │     ├── 写入 long_term_memory
        │     ├── 记录 consolidation_log
        │     └── 标记 working_memory 为 expired
        │
        ├── promote_to_markdown() — 长期记忆 → Markdown
        │     └── 写入 memory/YYYY-MM-DD.md
        │
        └── cleanup_expired() — 清理过期记录
              └── 保留最新 100 条未过期记录
```

**位置保护机制（最新 100 条）：**
```sql
-- 晋升查询
SELECT * FROM working_memory
WHERE importance >= 5.0
  AND id NOT IN (SELECT id FROM working_memory ORDER BY created_at DESC LIMIT 100)

-- 清理删除
DELETE FROM working_memory
WHERE expires_at < datetime('now')
  AND id NOT IN (SELECT id FROM working_memory ORDER BY created_at DESC LIMIT 100)
```

### 2.3 搜索流程

```
search_memory(query, top_k=5)
        │
        ▼
  MemoryHub.search()
        │
        ├── IndexBuilder 可用? ──Yes──→ unifiedSearch()
        │     │
        │     ├── FTS5 搜索 (权重 0.4)
        │     ├── 向量搜索 (权重 0.6, Ollama bge-m3)
        │     └── 融合排序
        │
        └── No ──→ 降级搜索
              │
              ├── 关键词匹配 (FTS5 only)
              └── 分层搜索 (Day → Week → Month Markdown 文件)
                    └── 本地 TF-IDF 评分
```

**嵌入降级链：**
```
Ollama (localhost:11434/v1/embeddings)
  ↓ 失败
OpenAI 兼容 (127.0.0.1:10999/v1/embeddings)
  ↓ 失败
DashScope 原生 (dashscope.aliyuncs.com)
```

### 2.4 会话扫描（按需触发）

```
scanNewSessions() — 从 agent_end Hook 触发
        │
        ├── 扫描 ~/.openclaw/agents/<agentId>/sessions/*.jsonl
        ├── 提取未处理的对话
        ├── MemoryHub.processSession() 写入 working_memory
        ├── consolidateWorkingMemory() — 按 session_id 分组去重合并
        │     └── 最新 100 条位置保护
        └── fire-and-forget: IndexBuilder.update() — 增量索引更新
```

---

## 3. 知识系统流程

### 3.1 知识图谱构建

```
knowledge.db
  ├── entities (实体)
  │     id, name, type, description, domain, confidence, created_at
  ├── relations (关系)
  │     id, source, target, type, weight, created_at
  └── rules (元规则)
        id, type, title, condition, action, confidence, created_at
```

**知识提取流程：**
```
文本输入
  │
  ▼
KnowledgeSystem.extractKnowledge(text)
  │
  ├── 实体提取 (正则 + 关键词匹配)
  │     └── 名称、类型、描述、领域
  │
  ├── 关系发现 (共现分析)
  │     └── 同窗口出现的实体建立关系
  │
  └── 规则评估
        └── 基于置信度筛选和模式匹配
```

### 3.2 知识自动更新 (Cron)

```
kg_auto_update.py (weekly, 05:00 CST 周日)
        │
        ├── 从 memory.db 读取所有 long_term_memory 条目
        ├── 提取实体和关系
        ├── 计算共现关系 (同一记忆中出现的实体)
        ├── 写入 knowledge.db
        │     ├── INSERT OR REPLACE entities
        │     ├── INSERT OR REPLACE relations
        │     └── 共现关系 weight = 出现次数
        └── 旧 schema 迁移 (entities → entities_v2)
```

### 3.3 Web 爬虫

```
WebCrawler.fetch(url)
  │
  ├── 缓存检查 (SHA-256 哈希文件名, TTL)
  ├── 未命中 → web_fetch 获取
  ├── 提取标题、正文、元数据
  ├── 保存缓存
  └── 返回结构化内容
```

---

## 4. 进化系统流程

### 4.1 夜间进化流水线

```
nightly-evolution (23:00 CST 每日, timeout 180s)
        │
        ├── activate-evolution.py
        │     │
        │     ├── extract_events() — 从 memory.db 提取高价值事件
        │     ├── 事件分析 (重要性、影响、模式)
        │     ├── write_rules() — 生成元规则写入 knowledge.db.rules
        │     │     └── condition + action + confidence
        │     └── 元规则反哺 message_received Hook 上下文
        │
        └── 输出: 高价值事件 + 模式 + 元规则
```

### 4.2 主动学习

```
active_learning.py (04:00 CST 每日, timeout 180s)
        │
        ├── 分析近期记忆中的知识缺口
        ├── 识别高频术语和概念
        ├── 生成学习建议
        └── 写入 knowledge.db 或 memory
```

### 4.3 分形思考 & 因果推理

```
FractalThinking — 事件管理和模式分析
  ├── 记录事件到 events 表
  ├── 分析事件间关联
  └── 生成元规则

CausalReasoning — 贝叶斯网络和反事实推理
  ├── 构建共现网络
  ├── 计算条件概率
  └── 发现因果链
```

---

## 5. Hook 系统详细流程

### 5.1 message_received (用户消息到达)

```
触发时机: 用户发送消息
优先级: 默认
超时: 各步骤独立 2s 超时

步骤 1: 用户偏好加载
  ├── 从 knowledge.db.preferences 读取 (confidence ≥ 0.3)
  ├── 5min TTL 内存缓存
  └── 失败 → 静默跳过

步骤 2: 最近记忆摘要
  ├── MemoryHub.getRecentDailySummary(2)
  │     ├── WM: 最新 5 条工作记忆 (importance 排序)
  │     └── LTM: 最近 2 天 Markdown 文件标题
  └── 失败 → 静默跳过

步骤 3: 元规则匹配
  ├── 从 knowledge.db.rules 读取 (confidence ≥ 0.6)
  ├── 关键词匹配用户消息
  ├── 匹配成功 → 注入适用规则
  └── 失败 → 静默跳过

步骤 4: 语义检索增强
  ├── shouldEnhanceMessage() 触发词检测 (15+ 中英文关键词)
  ├── 需要增强:
  │     ├── MemorySystem.search() (2s 超时)
  │     └── KnowledgeSystem.searchEntities() (剩余时间)
  └── 不需要增强 → 跳过

输出: system_prompt_addition = 所有注入部分拼接
```

### 5.2 message_sent (AI 回复发送)

```
触发时机: AI 回复消息发送到聊天表面
优先级: 50

流程:
  ├── 从 session JSONL 文件提取最后一条 user 消息
  ├── 获取 AI 回复内容
  ├── 过滤系统消息/工具结果
  └── MemorySystem.record() 写入对话对
        └── type: 'conversation', source: 'hook'
```

### 5.3 agent_end (AI 处理完成)

```
触发时机: AI 完成一次完整对话回合
优先级: 50

流程:
  ├── 从 event.messages 提取最后一条 user 和 assistant 消息
  ├── cleanContent() 清洗元数据:
  │     ├── 去除 TUI metadata header
  │     ├── 去除 code fence
  │     ├── 去除 JSON 信封
  │     └── 提取时间戳后的纯文本
  ├── MemorySystem.record() 写入对话对
  ├── persistToMarkdown() → memory/YYYY-MM-DD.md
  └── fire-and-forget: IndexBuilder.buildFromDb()
        └── 更新 FTS5 + Vector 索引
```

### 5.4 before_tool_call (工具调用前)

```
触发时机: 任何工具调用前

流程:
  ├── 检查是否为敏感工具
  └── 返回 { block: true/false }
```

---

## 6. Cron 任务全景

| # | 任务 | 调度 (CST) | Timeout | 功能 |
|---|------|-----------|---------|------|
| 1 | nightly-evolution | 23:00 每日 | 180s | 事件提取 + 元规则生成 |
| 2 | active-learning | 04:00 每日 | 180s | 知识缺口分析 + 学习建议 |
| 3 | daily-review | 09:00 每日 | 600s | 记忆回顾 + 重要性重估 |
| 4 | daily-compress | 30 9 * * * | 90s | 工作记忆压缩 + 晋升 |
| 5 | weekly-compress | 03:00 周日 | 180s | 周度压缩 |
| 6 | weekly-kg-expansion | 05:00 周日 | 90s | 知识图谱自动更新 |
| 7 | monthly-cycle | 02:00 每月1日 | 180s | 月度统计 + 报告 |

**注意：** `setup_crons.py` 中 `"0 9:30 * * *"` 已修复为 `"30 9 * * *"`（cron 小时字段不支持冒号）。

---

## 7. 数据流全景

```
用户输入
  │
  ├─→ message_received Hook ──→ 上下文增强 ──→ AI 回复
  │                                    │
  │                                    ▼
  ├─→ message_sent Hook ───────→ working_memory 记录
  │                                    │
  │                                    ▼
  └─→ agent_end Hook ──────────→ working_memory + Markdown + 索引更新
                                       │
                                       ▼
                              ┌────────────────┐
                              │   Cron Tasks   │
                              │                │
                              │ daily_compress │──→ long_term_memory
                              │ session_scan   │──→ 增量索引
                              │ active_learning│──→ 知识建议
                              │ nightly-evol   │──→ 元规则
                              └────────────────┘
                                       │
                                       ▼
                              knowledge.db (实体/关系/规则)
                                       │
                                       ▼
                              message_received Hook (元规则注入)
                              ──→ 自进化闭环 ──→
```

---

## 8. 关键设计决策

| 决策 | 说明 |
|------|------|
| ESM 兼容 | sqlite3 必须用 `createRequire(import.meta.url)('sqlite3').verbose()` |
| FTS5 rowid | 必须是整数，字符串 docId 需要映射列 `fts_rowid INTEGER` |
| 多 Agent 隔离 | 所有共享实例使用 `Map<agentId, Instance>` |
| Hook 降级 | 每步独立 try/catch，失败不影响整体流程 |
| 位置保护 | 最新 100 条 WM 记录不参与压缩/清理（按 created_at） |
| 嵌入降级 | Ollama → OpenAI 兼容 → DashScope 原生 |
| 搜索融合 | FTS5 权重 0.4 + 向量权重 0.6 |
| 超时保护 | 语义检索 2s 超时，各子步骤独立降级 |
| WAL 模式 | SQLite 启用 WAL + busy_timeout=5000 |
| fire-and-forget | agent_end 的持久化和索引更新不阻塞用户响应 |
