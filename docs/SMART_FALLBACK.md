# 🔄 智能降级策略

## 📋 核心理念

**不在外部创建 Fallback 任务，而在原有任务内部实现降级逻辑。**

---

## 🎯 方案对比

### ❌ 方案 A：双任务 Fallback（已废弃）

```
主任务：fractal-thinking (LLM)
  ↓ 失败
备用任务：fractal-thinking-fallback (Script)

缺点:
- 任务数量翻倍（9→18）
- 配置复杂
- 维护成本高
- 资源浪费（正常时 Fallback 闲置）
```

### ✅ 方案 B：单任务智能降级（推荐）

```
单个任务：fractal-thinking
  ├─ 正常模式：LLM 智能分析
  └─ 降级模式：Script 基础处理

优点:
- 保持 9 个任务
- 配置简洁
- 自动切换
- 资源高效
```

---

## 🔧 工作原理

### 指令结构

每个任务的指令包含两部分：

```bash
【主要指令】
请运行分形思考，分析最近 1 小时的对话模式...

【降级策略】
如果 LLM API 不可用（Rate Limit/超时/错误），
请自动降级为 Script 模式执行以下基础任务：
统计最近 1 小时的基础数据：
- 对话数量
- 会话列表
- 时间分布
- 关键词频率（Top 10）

执行优先级：
1. 尝试 LLM 智能分析（正常模式）
2. 如果失败，自动执行 Script 基础处理（降级模式）
3. 输出结果时标注 [Normal] 或 [Degraded] 模式
```

---

## 📊 执行流程

### 正常情况（API 可用）

```
09:00 → 触发 hourly-fractal 任务
        ↓
        Agent 读取指令
        ↓
        检测到 API 正常
        ↓
        执行 LLM 智能分析
        ↓
        输出：[Normal] 分形分析报告
        - 深度模式识别
        - 元规则生成
        - 关联分析
```

### 异常情况（API Rate Limit）

```
09:00 → 触发 hourly-fractal 任务
        ↓
        Agent 读取指令
        ↓
        检测到 API 失败 (429)
        ↓
        自动切换到降级模式
        ↓
        执行 Script 基础统计
        ↓
        输出：[Degraded] 基础统计报告
        - 对话数量：15
        - 关键词 Top 10
        - 时间分布图
```

---

## 🛠️ 使用方式

### 配置命令

```bash
# 使用智能降级脚本（推荐）
bash ~/.openclaw/extensions/evo-cortex/scripts/setup-crons-smart.sh <agent-name>

# 示例
bash scripts/setup-crons-smart.sh plugin-demo2-agent
```

### 任务数量对比

| 方案 | 任务数 | 配置复杂度 | 维护成本 |
|------|--------|------------|----------|
| 无降级 | 9 | 低 | 高（需人工干预） |
| 双任务 Fallback | 18 | 高 | 中 |
| **智能降级** | **9** | **低** | **低** ✅ |

---

## 📝 9 个任务的降级策略

### 1. hourly-fractal (每小时)

**正常模式**:
- LLM 深度分析对话模式
- 生成元规则
- 识别行为趋势

**降级模式**:
- 统计对话数量
- 列出会话清单
- 计算关键词频率

---

### 2. daily-review (每天 09:00)

**正常模式**:
- 审查知识图谱质量
- 发现孤立实体
- 提出优化建议

**降级模式**:
- 检查 entities.json 格式
- 统计实体/关系数量
- 验证文件完整性

---

### 3. active-learning (每天 04:00)

**正常模式**:
- 识别知识缺口
- 分析未回答问题
- 提出学习建议

**降级模式**:
- 提取高频查询词
- 识别重复问题
- 统计未解决话题

---

### 4. daily-compress (每天 09:30)

**正常模式**:
- 提取关键信息
- 生成结构化摘要
- 删除冗余内容

**降级模式**:
- 合并记忆文件
- 统计消息总数
- 生成简要统计

---

### 5. weekly-compress (每周日 03:00)

**正常模式**:
- 生成本周摘要
- 归档重要对话
- 清理临时数据

**降级模式**:
- 按日期分组统计
- 计算本周总量
- 生成周统计报告

---

### 6. weekly-kg-expansion (每周日 05:00)

**正常模式**:
- 提取新实体
- 发现潜在关联
- 识别知识缺口

**降级模式**:
- 验证 JSON 格式
- 修复语法错误
- 备份当前文件

---

### 7. monthly-cycle (每月 1 号 02:00)

**正常模式**:
- 全面系统审查
- 优化配置
- 生成进化报告

**降级模式**:
- 清理临时文件
- 统计月度活动
- 检查存储空间

---

### 8. session-scan (每 30 分钟)

**正常模式**:
- 识别新对话
- 提取关键记忆点
- 更新记忆索引

**降级模式**:
- 检测新会话文件
- 记录数量和大小
- 更新会话清单

---

### 9. realtime-index (每 5 分钟)

**正常模式**:
- 优化检索性能
- 更新语义索引
- 重构索引结构

**降级模式**:
- 检查数据库存在
- 验证文件大小
- 检查更新时间

---

## 💡 优势总结

### 简洁性
- ✅ 保持 9 个任务（不翻倍）
- ✅ 单一配置脚本
- ✅ 易于理解和维护

### 可靠性
- ✅ 自动降级，无需人工
- ✅ 基础功能始终可用
- ✅ 数据不丢失

### 经济性
- ✅ 减少 50% 任务执行
- ✅ 降低 Cron 调度开销
- ✅ 节省系统资源

### 灵活性
- ✅ 降级逻辑可定制
- ✅ 每个任务独立降级策略
- ✅ 易于调整和优化

---

## 🔍 监控与调试

### 查看任务状态

```bash
# 查看所有任务
openclaw cron list | grep <agent-name>

# 查看执行历史
openclaw cron runs <task-id> --limit 5

# 查看最新输出
openclaw cron runs <task-id> --limit 1
```

### 识别运行模式

在任务输出中查找标记：

- `[Normal]` - LLM 模式执行
- `[Degraded]` - Script 降级模式执行

示例：
```
📊 Hourly Fractal Analysis Report [Degraded]
Mode: Script-based basic statistics
Reason: API Rate Limit detected

Statistics:
- Total conversations: 15
- Top keywords: cron, agent, memory
- Time distribution: ...
```

---

## 🎯 最佳实践

### 1. 首次配置

```bash
# 使用智能降级脚本
bash scripts/setup-crons-smart.sh <agent-name>
```

### 2. 定期检查

```bash
# 每周检查一次任务健康状态
bash scripts/check-rate-limit.sh
```

### 3. 紧急处理

```bash
# 如果持续失败，临时禁用 LLM 密集型任务
bash scripts/disable-llm-tasks.sh <agent-name>
```

### 4. 恢复配置

```bash
# API 恢复正常后，重新配置
bash scripts/setup-crons-smart.sh <agent-name>
```

---

## 📈 演进历史

- **v1.0** (2026-04-20): 初始版本，无降级
- **v1.1** (2026-04-21 凌晨): 双任务 Fallback 方案（18 个任务）
- **v1.2** (2026-04-21 清晨): 智能降级方案（9 个任务）← 当前版本

---

## 🚀 快速开始

```bash
# 1. 克隆或更新到最新版本
cd ~/.openclaw/extensions/evo-cortex
git pull

# 2. 配置智能降级任务
bash scripts/setup-crons-smart.sh <your-agent>

# 3. 验证配置
openclaw cron list | grep <your-agent>

# 4. 监控运行状态
bash scripts/check-rate-limit.sh
```

---

**最后更新**: 2026-04-21  
**版本**: v1.2 (智能降级)  
**状态**: ✅ 生产就绪
