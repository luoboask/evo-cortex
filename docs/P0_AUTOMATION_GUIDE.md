# 🤖 P0 自动化运行指南

## 📋 概述

P0 优化功能已配置为自动运行，无需手动执行脚本。

## ⏰ 自动调度

| 任务 | 频率 | 时间 | 功能 |
|------|------|------|------|
| **增强主动学习** | 每天 | 04:00 | 词频分析 + 偏好提取 + 待办追踪 |
| **代码片段提取** | 每天 | 05:00 | 从记忆中提取代码并整理入库 |
| **知识图谱更新** | 每周 | 周日 03:00 | 扫描新术语并更新知识图谱 |

## 💰 运行成本

**\$0.00/天** - 所有任务都是纯脚本模式，无 LLM API 调用。

## 📁 生成的文件

### 每天生成（04:00后）
- `memory/analysis-YYYY-MM-DD-HHMM.md` - 词频分析报告
- `evolution/active-learning-YYYY-MM-DD-HHMM.md` - 学习报告
- `USER_PREFERENCES.md` - 如有新偏好则更新
- `action-items.md` - 如有新待办则更新

### 每天生成（05:00后）
- `code-snippets/INDEX.md` - 代码片段索引（更新）
- `code-snippets/{language}/*.ts|.js|.sh` - 新增代码片段

### 每周生成（周日 03:00后）
- `evolution/kg-update-YYYY-MM-DD-HHMM.md` - 知识图谱更新报告
- `knowledge/{agent}/backup/entities.json.*.backup` - 备份文件
- `knowledge/{agent}/entities.json` - 实体列表（如有新实体则更新）

## 🔍 查看运行状态

### 查看任务列表
```bash
openclaw cron list | grep <agent-id>
```

### 查看任务执行历史
```bash
openclaw cron runs <task-id>
```

### 查看最新生成的文件
```bash
# 最新的学习报告
ls -lt ~/workspace-<agent>/evolution/active-learning-*.md | head -3

# 最新的代码片段
ls -lt ~/workspace-<agent>/code-snippets/*/ | head -10

# 最新的知识图谱更新报告
ls -lt ~/workspace-<agent>/evolution/kg-update-*.md | head -3
```

## 🛠️ 手动触发（如需测试）

### 手动运行代码片段提取
```bash
bash scripts/code-snippet-extractor.sh <agent-id>
```

### 手动运行增强主动学习
```bash
bash scripts/active-learning-enhanced.sh <agent-id>
```

### 手动运行知识图谱更新
```bash
bash scripts/kg-auto-update.sh <agent-id>
```

## 📊 预期效果

### 1 周后
- 代码片段库增加 5-10 个新片段
- USER_PREFERENCES.md 可能包含新发现的偏好
- action-items.md 记录待办事项

### 1 月后
- 代码片段库达到 50-100 个
- 知识图谱增加 3-5 个新实体
- 形成完整的个人代码知识库

### 3 月后
- 代码片段库达到 150-200 个
- 知识图谱反映你的技术领域全貌
- 用户偏好文件高度个性化
- 系统真正"懂你"

## ⚠️ 注意事项

1. **首次运行**: 配置后立即运行一次以生成初始数据
2. **定期 Review**: 建议每周花 5 分钟查看生成的文件
3. **知识图谱**: 新实体需要频次≥5 才会自动添加，这是正常的
4. **备份**: 所有更新都会创建备份，可安全回滚

## 🔄 禁用自动化

如需禁用某个任务：
```bash
openclaw cron remove <task-id>
```

或编辑 `~/.openclaw/gateway/cron.json` 将对应任务的 `enabled` 设为 `false`。

## 📞 故障排除

### Q: 任务没有运行？
A: 检查 Gateway 状态：
```bash
openclaw gateway status
```

### Q: 文件没有生成？
A: 检查任务执行日志：
```bash
openclaw cron runs <task-id>
```

### Q: 知识图谱没有新实体？
A: 这是正常的，需要高频术语（≥5 次）才会触发添加。

---

**最后更新**: 2026-04-21  
**版本**: v1.1.0
