# evo-cortex 知识体系重构方案

> 版本: v2.0
> 日期: 2026-04-27
> 目标: 从零重构记忆系统 + 知识体系，替换现有混乱架构

---

## 一、现状问题

| 问题 | 说明 |
|------|------|
| working_memory 是"垃圾桶" | 5 个入口同时写入，格式不同，没有去重，没有分层 |
| 知识图谱 5 实体 0 关系 | 只做频率统计，没有语义关联 |
| 长期记忆 = 0 条 | `_consolidate_short_to_long()` 从未执行成功 |
| 重要性评分太粗糙 | 基础分 5 + 消息长度 + 关键词，没考虑召回和衰减 |
| working_memory 2 小时过期 | 固定时间，不符合异步对话节奏 |
| 进化报告不反哺系统 | 产出报告后无闭环，不反哺检索 |
| 数据散落 7 个文件/库 | cortex.db, entities.json, relationships.json, fts.sqlite, vectors.sqlite... |

---

## 二、架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                    知识体系 (Knowledge)                    │
│                                                         │
│  knowledge.db                                           │
│  ├── entities (实体)                                      │
│  ├── relations (关系)                                     │
│  └── rules (规则)                                         │
│                                                         │
│  ← 从长期记忆中抽象，反向指导检索                           │
└───────────────────────▲─────────────────────────────────┘
                        │
              [抽象 · 归纳 · 提炼]
                        │
┌───────────────────────┴─────────────────────────────────┐
│                  记忆系统 (Memory)                        │
│                                                         │
│  memory.db                                              │
│  ├── working_memory (工作记忆 · 1天+刷新)                 │
│  ├── long_term_memory (长期记忆 · 永久)                   │
│  └── consolidation_log (晋升日志)                         │
│                                                         │
│  ← 存发生了什么，提供检索                                  │
└───────────────────────▲─────────────────────────────────┘
                        │
              [提取 · 评分 · 缓冲]
                        │
┌───────────────────────┴─────────────────────────────────┐
│                    输入层 (Input)                         │
│                                                         │
│  cortex.db                                              │
│  └── session_messages (原始对话存档，不改)                 │
│                                                         │
│  输入源: user chat / file change / hook / cron / manual  │
└─────────────────────────────────────────────────────────┘
```

### 2.2 三个数据库职责

| 数据库 | 职责 | 读写频率 | 位置 |
|--------|------|----------|------|
| `cortex.db` | 原始对话存档（不改） | 低（只写） | `data/{agentId}/cortex.db` |
| `memory.db` | 工作记忆 + 长期记忆 | 高（读写频繁） | `data/{agentId}/memory.db` |
| `knowledge.db` | 实体 + 关系 + 规则 | 中（写异步，读频繁） | `data/{agentId}/knowledge.db` |

---

## 三、数据库 Schema

### 3.1 memory.db

```sql
-- ============================================
-- 工作记忆（短期缓冲，1天 + 活跃刷新）
-- ============================================
CREATE TABLE working_memory (
    id          TEXT PRIMARY KEY,    -- wm_20260427_001
    type        TEXT NOT NULL,       -- conversation | decision | bugfix | insight | preference | error | observation
    title       TEXT,                -- 一句话摘要
    content     TEXT NOT NULL,       -- 详细内容
    importance  REAL DEFAULT 5.0,    -- 0-10
    tags        TEXT,                -- JSON: ["bugfix", "database"]
    source      TEXT,                -- hook | scan | manual | cron
    source_ref  TEXT,                -- session_id / file_path 等
    created_at  TEXT DEFAULT (datetime('now')),
    expires_at  TEXT                 -- datetime('now', '+1 day')，活跃时刷新
);

-- ============================================
-- 长期记忆（永久，高重要性 ≥ 7.0）
-- ============================================
CREATE TABLE long_term_memory (
    id          TEXT PRIMARY KEY,    -- ltm_20260427_001
    type        TEXT NOT NULL,
    title       TEXT NOT NULL,
    content     TEXT NOT NULL,
    importance  REAL NOT NULL,       -- ≥ 7.0
    tags        TEXT,                -- JSON
    source      TEXT,
    source_ref  TEXT,
    recalled_at TEXT,                -- 最后被召回时间
    recall_count INTEGER DEFAULT 0,  -- 被召回次数
    created_at  TEXT DEFAULT (datetime('now')),
    consolidated_from TEXT           -- 来源 working_memory id
);

-- ============================================
-- 晋升日志（审计）
-- ============================================
CREATE TABLE consolidation_log (
    id              TEXT PRIMARY KEY,
    working_id      TEXT NOT NULL,
    long_term_id    TEXT NOT NULL,
    reason          TEXT,
    importance      REAL,
    created_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_wm_expires ON working_memory(expires_at);
CREATE INDEX idx_wm_importance ON working_memory(importance DESC);
CREATE INDEX idx_ltm_importance ON long_term_memory(importance DESC);
CREATE INDEX idx_ltm_recall ON long_term_memory(recalled_at);
```

### 3.2 knowledge.db

```sql
-- ============================================
-- 实体
-- ============================================
CREATE TABLE entities (
    id            TEXT PRIMARY KEY,  -- ent_fts5
    name          TEXT NOT NULL,
    type          TEXT NOT NULL,     -- concept | tool | project | person | preference | system
    description   TEXT,
    aliases       TEXT,              -- JSON
    importance    REAL DEFAULT 0.5,  -- 0-1
    mention_count INTEGER DEFAULT 0,
    last_mentioned TEXT,
    first_seen_from TEXT,            -- 首次出现的 ltm_id
    created_at    TEXT DEFAULT (datetime('now'))
);

-- ============================================
-- 关系
-- ============================================
CREATE TABLE relations (
    id          TEXT PRIMARY KEY,
    source_id   TEXT NOT NULL,
    target_id   TEXT NOT NULL,
    type        TEXT NOT NULL,       -- isa | partof | causes | requires | conflicts | related | prefers
    strength    REAL DEFAULT 0.5,
    evidence    TEXT,                -- JSON: ["ltm_xxx"]
    used_count  INTEGER DEFAULT 0,
    last_used   TEXT,
    created_at  TEXT DEFAULT (datetime('now')),
    UNIQUE(source_id, target_id, type)
);

-- ============================================
-- 规则
-- ============================================
CREATE TABLE rules (
    id            TEXT PRIMARY KEY,
    type          TEXT NOT NULL,     -- pattern | preference | principle | anti_pattern
    title         TEXT NOT NULL,
    condition     TEXT,
    action        TEXT NOT NULL,
    confidence    REAL DEFAULT 0.5,
    support_count INTEGER DEFAULT 0,
    violation_count INTEGER DEFAULT 0,
    used_count    INTEGER DEFAULT 0,
    last_used     TEXT,
    last_validated TEXT,
    created_at    TEXT DEFAULT (datetime('now'))
);

-- ============================================
-- 实体-长期记忆关联
-- ============================================
CREATE TABLE entity_ltm_links (
    entity_id  TEXT NOT NULL,
    ltm_id     TEXT NOT NULL,
    role       TEXT,                 -- subject | object | context
    PRIMARY KEY (entity_id, ltm_id)
);

CREATE INDEX idx_entities_type ON entities(type);
CREATE INDEX idx_entities_importance ON entities(importance DESC);
CREATE INDEX idx_relations_source ON relations(source_id);
CREATE INDEX idx_relations_target ON relations(target_id);
CREATE INDEX idx_rules_type ON rules(type);
CREATE INDEX idx_rules_confidence ON rules(confidence DESC);
```

### 3.3 cortex.db（保持不变）

```sql
-- session_messages 表保持现有结构，作为原始对话存档
-- 不参与新系统的读写，仅保留历史数据
```

---

## 四、核心流程

### 4.1 写流程

```
输入源（用户对话/文件变更/定时任务/手动）
    ↓
┌──────────────────────────────────────────┐
│  Step 1: 统一入口 MemorySystem.record()   │
│                                          │
│  - 标准化输入格式                          │
│  - 计算重要性评分                          │
│  - 生成事件 ID                            │
└──────────────────┬───────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│  Step 2: 写入工作记忆（同步）              │
│                                          │
│  INSERT INTO working_memory               │
│  - expires_at = now + 24h                │
│  - 同会话新消息刷新 expires_at            │
│                                          │
│  ← 立即返回 ID                            │
└──────────────────┬───────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│  Step 3: 晋升检查（异步，定时/超时触发）   │
│                                          │
│  触发条件：                               │
│    - 会话超时（30 分钟无新消息）           │
│    - 定时任务（每 30 分钟）                │
│                                          │
│  SELECT * FROM working_memory             │
│  WHERE expires_at < now                   │
│  AND importance >= 7.0                    │
│                                          │
│  对每条候选：                              │
│    → INSERT INTO long_term_memory         │
│    → INSERT INTO consolidation_log        │
│    → DELETE FROM working_memory           │
│    → 触发 Step 4                          │
│                                          │
│  清理：                                    │
│    DELETE WHERE expires_at < now          │
│    AND importance < 7.0                   │
└──────────────────┬───────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│  Step 4: 知识体系更新（异步）              │
│                                          │
│  对每条新长期记忆：                        │
│                                          │
│  4a. 实体提取                             │
│      - 从 content 中识别已知/新实体        │
│      - INSERT OR REPLACE INTO entities    │
│      - mention_count++                   │
│                                          │
│  4b. 实体链接                             │
│      - INSERT INTO entity_ltm_links       │
│                                          │
│  4c. 关系发现（共现分析）                  │
│      - 同事件中共现的实体两两组合          │
│      - INSERT OR UPDATE relations         │
│      - strength++ / evidence 追加          │
│                                          │
│  4d. 规则评估                             │
│      - 检查是否有足够事件支持新规则        │
│      - 更新已有规则的 support/violation   │
│                                          │
│  4e. 索引更新                             │
│      - 更新 FTS 索引                       │
│      - 更新向量索引                        │
└──────────────────────────────────────────┘
```

### 4.2 读流程

```
用户查询
    ↓
┌──────────────────────────────────────────┐
│  Step 1: 意图识别                         │
│                                          │
│  classifyIntent(query)                   │
│                                          │
│  返回：                                   │
│    - entity   → "X 是什么"                │
│    - event    → "之前发生过什么"          │
│    - relation → "X 和 Y 什么关系"        │
│    - rule     → "应该怎么做"              │
│    - general  → 通用搜索                  │
└──────────────────┬───────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│  Step 2: 路由到对应层                      │
│                                          │
│  intent = entity   → searchEntities()     │
│  intent = event    → searchLTM()          │
│  intent = relation → searchRelations()    │
│  intent = rule     → searchRules()        │
│  intent = general  → searchAll()          │
└──────────────────┬───────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│  Step 3: 执行搜索                          │
│                                          │
│  搜索策略：                               │
│    1. FTS 全文匹配（IndexBuilder）        │
│    2. 向量相似度（可选）                   │
│    3. 实体/关系图查询                      │
│    4. 融合结果                             │
└──────────────────┬───────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│  Step 4: 动态排序                          │
│                                          │
│  score = importance × 0.5                │
│        + min(recall_count × 0.15, 3)     │
│        + freshnessBoost(created_at)       │
│        + usageBoost(used_count)           │
│                                          │
│  按 score 降序排列                         │
└──────────────────┬───────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│  Step 5: 返回 + 记录使用                   │
│                                          │
│  对每个返回结果：                          │
│    - UPDATE ... SET recall_count++       │
│    - UPDATE ... SET recalled_at = now    │
│    - 实体 mention_count++                 │
│    - 关系/规则 used_count++               │
└──────────────────────────────────────────┘
```

### 4.3 对话集成（message_received hook）

```
用户发消息
    ↓
┌──────────────────────────────────────────┐
│  message_received hook                   │
│                                          │
│  1. 判断是否需要检索                       │
│     - 触发词匹配（还记得/之前/建议/如何）  │
│     - 或直接查询意图                       │
│                                          │
│  2. 如果需要 → 检索长期记忆                │
│     - memorySystem.search({text, limit})  │
│     - 意图路由：event/entity/rule         │
│                                          │
│  3. 格式化结果，注入 system prompt         │
│     → "📚 相关记忆：..."                  │
│                                          │
│  4. 如果不需要 → 返回空                    │
│     （不影响正常对话）                      │
│                                          │
│  5. 同时处理上一条对话的提取（异步）        │
│     - 从最近对话提取知识点                 │
│     - memorySystem.record() 写入工作记忆   │
│     - 刷新 expires_at                      │
└──────────────────────────────────────────┘
```

---

## 五、重要性评分

```typescript
function scoreImportance(entry: MemoryEntry): number {
  let score = 3.0;  // 基础分

  // 类型权重
  const typeWeights = {
    decision: 3.0,      // 决策：高价值
    bugfix: 2.5,        // Bug 修复：技术价值
    preference: 2.5,    // 用户偏好：直接影响行为
    insight: 2.0,       // 技术洞察：知识价值
    error: 1.5,         // 错误记录：教训价值
    observation: 1.0,   // 观察：一般价值
    conversation: 0.5   // 普通对话：低价值
  };
  score += typeWeights[entry.type] || 0;

  // 来源权重
  const sourceWeights = {
    manual: 2.0,    // 用户明确说的最重要
    hook: 1.0,      // 对话中自然产生的
    scan: 0.5,      // 自动扫描发现的
    cron: 0.3       // 定时任务生成的
  };
  score += sourceWeights[entry.source] || 0;

  // 关键词加成
  if (/\b(记住|重要|必须|关键|偏好|喜欢|决定)\b/.test(entry.content)) {
    score += 1.5;
  }

  return Math.min(score, 10.0);
}
```

---

## 六、生命周期

| 组件 | 创建 | 衰减 | 清理 | 结局 |
|------|------|------|------|------|
| 工作记忆 | record() 写入 | 无 | expires_at 到期 | 晋升或删除 |
| 长期记忆 | 从工作记忆晋升 | 重要性 ×0.95 / 30天无召回 | 永不删除 | 永久 |
| 实体 | 从长期记忆提取 | 重要性 ×0.95 / 30天未提及 | 永不删除 | 永久，可休眠 |
| 关系 | 实体共现发现 | strength ×0.9 / 60天无新证据 | strength<0.1 标记失效 | 永久 |
| 规则 | 模式归纳生成 | confidence 动态调整 | confidence<0.4 标记过时 | 永久 |

### 6.1 工作记忆过期策略

```
新消息 → expires_at = now + 24 小时
           ↓
     同会话新消息 → expires_at = now + 24 小时（刷新）
           ↓
     24 小时无新消息 → 触发晋升检查
           ↓
     重要性 ≥ 7 → 晋升长期记忆
     重要性 < 7  → 删除
```

### 6.2 调度任务

| 任务 | 调度 | 内容 |
|------|------|------|
| consolidate | 每 30 分钟 | 工作记忆晋升 + 清理 |
| decay_entities | 每天 04:00 | 实体重要性衰减更新 |
| decay_relations | 每天 04:30 | 关系强度衰减更新 |
| validate_rules | 每周日 | 规则验证 + 过时标记 |

---

## 七、文件结构

```
evo-cortex/
├── src/
│   ├── index.ts                    # 插件入口
│   ├── hooks/
│   │   ├── index.ts                # 钩子入口（改造）
│   │   ├── message_received.ts     # 对话前钩子（重写）
│   │   ├── message_sent.ts         # 对话后钩子（重写）
│   │   └── before_tool_call.ts     # 工具调用前钩子（保留）
│   ├── memory/
│   │   ├── memory_system.ts        # 统一记忆系统（NEW）
│   │   ├── memory_hub.ts           # 保留，作为兼容层
│   │   ├── index_builder.ts        # 保留，复用
│   │   ├── fts_index.ts            # 保留，复用
│   │   └── vector_index.ts         # 保留，复用
│   ├── knowledge/
│   │   ├── knowledge_system.ts     # 知识体系（NEW）
│   │   └── knowledge_graph.ts      # 保留，逐步迁移
│   ├── utils/
│   │   ├── config-validator.ts     # 保留
│   │   ├── plugin-context.ts       # 保留
│   │   ├── logger.ts               # 保留
│   │   └── cache.ts                # 保留
│   └── types/
│       └── openclaw.d.ts           # 类型定义（扩展）
├── scripts/
│   ├── consolidate.py              # 晋升任务（NEW）
│   ├── decay_updates.py            # 衰减任务（NEW）
│   └── ...                         # 其他脚本保留
├── docs/
│   └── REFACTOR_PLAN_v2.md         # 本文档
└── package.json
```

---

## 八、与现有系统衔接

| 现有组件 | 新方案处理 |
|----------|-----------|
| `cortex.db` / `session_messages` | 保留不改，原始存档 |
| `working_memory` 表（cortex.db） | 迁移到 `memory.db`，schema 升级 |
| `entities.json` | 一次性导入 `knowledge.db`，之后废弃 |
| FTS / 向量索引 | 复用现有 `IndexBuilder`，索引 `long_term_memory.content` |
| `MemoryHub` | 保留，作为 `MemorySystem.record()` 的调用入口 |
| `message_received` hook | 改造：检索长期记忆 + 注入上下文 + 异步提取 |
| `message_sent` hook | 改造：改为在 message_received 中延迟处理 |
| `session_scan.py` | 改为调用 `MemorySystem.record()` |
| Python cron 脚本 | 部分保留（晋升/衰减任务用 Python 或 TS 均可） |

---

## 九、实施计划

### Phase 1: 数据库 + Schema（1-2 天）

- [ ] 创建 `memory.db` 和 `knowledge.db`
- [ ] 执行上述所有 CREATE TABLE 语句
- [ ] 编写 migration 脚本：
  - 现有 working_memory → memory.db 的 working_memory
  - 现有 entities.json → knowledge.db 的 entities
  - 现有长期记忆（如果有）→ memory.db 的 long_term_memory
- [ ] 验证数据完整性

### Phase 2: 核心写入管道（2-3 天）

- [ ] 实现 `MemorySystem` 类
  - `record()` — 统一写入入口
  - `scoreImportance()` — 重要性评分
  - `refreshWorkingMemory()` — 活跃刷新
- [ ] 实现晋升逻辑 `consolidate()`
  - 查询过期工作记忆
  - 晋升到长期记忆
  - 清理不够格的条目
  - 记录 consolidation_log
- [ ] 实现知识体系更新 `KnowledgeSystem.updateFromLTM()`
  - 实体提取
  - 关系发现（共现分析）
  - 规则评估
- [ ] 集成 FTS/向量索引更新

### Phase 3: 检索系统（2-3 天）

- [ ] 实现 `MemorySystem.search()`
  - 意图识别 `classifyIntent()`
  - 路由到对应层
  - FTS + 向量融合搜索
- [ ] 实现动态排序 `rank()`
  - 综合重要性 + 召回频率 + 新鲜度 + 使用频次
- [ ] 实现使用记录 `recordUsage()`
  - 更新 recall_count / recalled_at
  - 更新 mention_count / used_count

### Phase 4: 对话集成（1-2 天）

- [ ] 改造 `message_received` hook
  - 检索长期记忆
  - 注入 system prompt
  - 异步提取上一条对话的知识点
  - 超时保护（1.5s）
- [ ] 改造 `message_sent` hook
  - 简化为仅记录日志
  - 主要写入逻辑移到 message_received 的延迟处理
- [ ] 测试各种触发场景

### Phase 5: 衰减 + 维护任务（1 天）

- [ ] 实现实体重要性衰减
- [ ] 实现关系强度衰减
- [ ] 实现规则验证
- [ ] 设置 cron 任务或 heartbeat 触发

### Phase 6: 测试 + 清理（1-2 天）

- [ ] 完整流程测试
- [ ] 性能测试
- [ ] 废弃旧代码路径
- [ ] 文档更新

---

## 十、关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 数据库分离 | 3 个独立 .db 文件 | 职责清晰，便于备份和维护 |
| 工作记忆过期 | 1 天 + 活跃刷新 | 适应异步对话节奏 |
| 晋升阈值 | importance ≥ 7.0 | 平衡数量和质量的经验值 |
| 重要性评分 | 多维度综合 | 避免单一维度偏差 |
| 关系发现 | 共现分析为主 | 简单有效，可逐步引入 LLM 推断 |
| 规则生成 | 事件计数 + 置信度 | 可证伪，动态调整 |
| 检索融合 | FTS + 向量 | 兼顾精确和模糊匹配 |
| 安全降级 | 超时 1.5s 返回空 | 不影响正常对话 |

---

## 十一、风险与应对

| 风险 | 影响 | 应对 |
|------|------|------|
| 迁移数据丢失 | 高 | 先备份，双写过渡，验证后再切换 |
| 性能下降 | 中 | 异步写入，索引优化，超时保护 |
| 实体提取不准 | 中 | 先关键词匹配，后续引入 LLM |
| 关系发现噪音多 | 低 | 初始 strength=0.3，多次共现才增强 |
| 规则误判 | 低 | confidence < 0.4 标记但不删除，可人工干预 |

---

## 十二、成功标准

| 指标 | 当前 | 目标 |
|------|------|------|
| 知识图谱关系数 | 0 | > 50 |
| 长期记忆条目 | 0 | > 100 |
| 检索命中率 | 未知 | > 80% |
| hook 响应时间 | < 2s | < 1.5s |
| 工作记忆晋升率 | 0% | > 20% |
| 规则数量 | 0 | > 10 |

---

*文档结束。本文档为重构指导文档，实施过程中可根据实际情况调整。*
