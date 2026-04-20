# 🔧 Rate Limit 处理与降级策略

## 📋 问题描述

当 Evo-Cortex 的定时任务遇到 LLM API rate limit 时，会导致：
- ❌ 任务执行失败
- ❌ 错过重要的记忆整理时机
- ❌ 用户体验下降

## 🎯 解决方案

### 方案一：Cron 级别降级（推荐）⭐

**原理**: 为每个 LLM 任务配置一个延迟的 Script 模式备用任务

```
主任务 (LLM):     0 * * * *  →  分形思考（智能分析）
                   ↓ 如果失败
备用任务 (Script): 5 * * * *  →  基础统计（无 LLM）
```

**配置方法**:
```bash
# 使用增强版配置脚本
ENABLE_FALLBACK=true \
FALLBACK_MODE=script \
bash ~/.openclaw/extensions/evo-cortex/scripts/setup-crons-with-fallback.sh <agent-name>
```

**环境变量**:
| 变量 | 选项 | 说明 |
|------|------|------|
| `ENABLE_FALLBACK` | `true`/`false` | 是否启用降级 |
| `FALLBACK_MODE` | `skip`/`script` | 降级模式 |
| `MAX_RETRIES` | 数字 (默认 3) | 最大重试次数 |
| `RETRY_DELAY` | 秒数 (默认 60) | 重试延迟 |

---

### 方案二：任务内部重试

在任务执行代码中添加自动重试逻辑：

```typescript
async function executeWithRetry(
  task: () => Promise<void>,
  options = {
    maxRetries: 3,
    delay: 60000, // 60 秒
    backoff: 2.0  // 指数退避
  }
): Promise<void> {
  let lastError: Error;
  
  for (let attempt = 1; attempt <= options.maxRetries; attempt++) {
    try {
      await task();
      return; // 成功，退出
    } catch (error) {
      lastError = error as Error;
      
      // 检查是否是 rate limit 错误
      if (isRateLimitError(error)) {
        console.log(`[Retry] Rate limit hit, attempt ${attempt}/${options.maxRetries}`);
        
        if (attempt < options.maxRetries) {
          const delay = options.delay * Math.pow(options.backoff, attempt - 1);
          console.log(`[Retry] Waiting ${delay}ms before retry...`);
          await sleep(delay);
        }
      } else {
        // 非 rate limit 错误，直接抛出
        throw error;
      }
    }
  }
  
  // 所有重试都失败了
  console.error(`[Retry] All ${options.maxRetries} attempts failed`);
  throw lastError;
}

function isRateLimitError(error: any): boolean {
  const message = error?.message?.toLowerCase() || '';
  const status = error?.status || error?.response?.status;
  
  return (
    status === 429 ||
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    message.includes('quota exceeded')
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

---

### 方案三：混合执行模式优化

对于已经启用的混合模式任务，进一步优化 Script 和 LLM 的比例：

#### 当前配置
```
简单任务 (95%) → Script Mode → <1s, $0.001
复杂任务 (5%)  → LLM Mode   → ~5s, $0.05
```

#### 优化建议
在 rate limit 期间临时调整阈值：

```bash
# 检测到 rate limit 时
export EVO_CORTEX_LLM_THRESHOLD=0.95  # 提高到 95%，更多用 Script

# 正常时期
export EVO_CORTEX_LLM_THRESHOLD=0.80  # 默认 80%
```

---

## 🛠️ 实用工具脚本

### 1. 检查 Rate Limit 状态

```bash
#!/bin/bash
# check-rate-limit.sh

echo "🔍 检查最近的任务失败情况..."

# 获取失败的 cron 任务
failed_tasks=$(openclaw cron list 2>/dev/null | grep "error" | wc -l)

if [ "$failed_tasks" -gt 0 ]; then
  echo "⚠️  发现 $failed_tasks 个失败的任务"
  echo ""
  echo "可能的原因:"
  echo "  1. API Rate Limit"
  echo "  2. 网络问题"
  echo "  3. Agent 未注册"
  echo ""
  echo "建议操作:"
  echo "  - 查看任务日志：openclaw cron runs <task-id>"
  echo "  - 启用降级模式：ENABLE_FALLBACK=true bash scripts/setup-crons-with-fallback.sh <agent>"
  echo "  - 降低任务频率：修改 cron 表达式"
else
  echo "✅ 所有任务运行正常"
fi
```

### 2. 临时禁用 LLM 任务

```bash
#!/bin/bash
# disable-llm-tasks.sh

AGENT="${1:-}"

if [ -z "$AGENT" ]; then
  echo "用法：$0 <agent-name>"
  exit 1
fi

echo "⏸️  临时禁用 $AGENT 的 LLM 任务..."

# 获取所有 LLM 相关的 cron 任务
openclaw cron list 2>/dev/null | grep "$AGENT" | grep -E "(fractal|review|learning|compress|expansion|cycle)" | while read line; do
  task_id=$(echo "$line" | awk '{print $1}')
  task_name=$(echo "$line" | awk '{print $2}')
  
  echo "   暂停：$task_name"
  openclaw cron update "$task_id" --enabled false 2>/dev/null || true
done

echo ""
echo "✅ 已暂停所有 LLM 任务"
echo ""
echo "恢复命令:"
echo "  openclaw cron list | grep $AGENT | awk '{print \$1}' | xargs -I {} openclaw cron update {} --enabled true"
```

### 3. 查看任务执行日志

```bash
#!/bin/bash
# view-task-logs.sh

TASK_ID="${1:-}"

if [ -z "$TASK_ID" ]; then
  echo "用法：$0 <task-id>"
  echo ""
  echo "可用任务:"
  openclaw cron list 2>/dev/null | grep -E "(fractal|review|scan|index)" | head -10
  exit 1
fi

echo "📋 查看任务 $TASK_ID 的运行日志..."
echo ""

openclaw cron runs "$TASK_ID" --limit 5 2>&1 | tail -50
```

---

## 📊 最佳实践

### 1. 预防胜于治疗

**配置建议**:
```bash
# 生产环境配置
ENABLE_FALLBACK=true      # 始终启用降级
FALLBACK_MODE=script      # 优先使用 Script 模式
MAX_RETRIES=3             # 重试 3 次
RETRY_DELAY=120           # 等待 2 分钟
```

### 2. 监控与告警

定期检查任务状态：
```bash
# 添加到 crontab，每小时检查一次
0 * * * * ~/.openclaw/extensions/evo-cortex/scripts/check-rate-limit.sh >> /tmp/evo-cortex-health.log 2>&1
```

### 3. 渐进式降级

```
正常状态:
  LLM 任务：80%
  Script 任务：20%

轻度过载:
  LLM 任务：50%
  Script 任务：50%

重度过载:
  LLM 任务：20%
  Script 任务：80%

紧急状态:
  LLM 任务：0% (全部暂停)
  Script 任务：100%
```

---

## 🔍 故障排查流程

### Step 1: 确认问题

```bash
# 查看失败任务
openclaw cron list | grep error

# 查看详细日志
openclaw cron runs <task-id> --limit 3
```

### Step 2: 判断原因

**Rate Limit 特征**:
- ❌ 错误信息包含 "429", "rate limit", "too many requests"
- ❌ 多个任务同时失败
- ❌ 失败时间集中

**其他问题**:
- ❌ 网络超时：检查网络连接
- ❌ Agent 未注册：`openclaw agents add <agent>`
- ❌ 配置错误：检查 cron 表达式

### Step 3: 应用解决方案

```bash
# 方案 A: 启用降级模式
ENABLE_FALLBACK=true bash scripts/setup-crons-with-fallback.sh <agent>

# 方案 B: 临时禁用 LLM 任务
bash scripts/disable-llm-tasks.sh <agent>

# 方案 C: 降低任务频率
# 编辑 setup-crons-hybrid.sh，修改 cron 表达式
# 例如：*/5 * * * * → */10 * * * *
```

### Step 4: 验证修复

```bash
# 等待下一个执行周期
sleep 300

# 检查任务状态
openclaw cron list | grep <agent>

# 查看最新日志
openclaw cron runs <task-id> --limit 1
```

---

## 📈 性能对比

### 无降级策略
```
API Rate Limit 发生时:
  - 任务失败率：100%
  - 数据丢失：是
  - 用户感知：明显
```

### 有降级策略
```
API Rate Limit 发生时:
  - 任务失败率：0% (Fallback 接管)
  - 数据丢失：否
  - 用户感知：轻微延迟（+5 分钟）
```

---

## 🎯 总结

**核心原则**:
1. ✅ **始终启用降级** - 不要依赖单一的 LLM 执行
2. ✅ **快速失败** - 检测到 rate limit 立即切换到 Script 模式
3. ✅ **优雅降级** - 提供有限但可用的功能
4. ✅ **自动恢复** - rate limit 解除后自动切回 LLM 模式

**推荐配置**:
```bash
# 生产环境一键配置
export ENABLE_FALLBACK=true
export FALLBACK_MODE=script
export MAX_RETRIES=3
export RETRY_DELAY=120

bash ~/.openclaw/extensions/evo-cortex/scripts/setup-crons-with-fallback.sh <your-agent>
```

---

**最后更新**: 2026-04-21  
**版本**: v1.0.0
