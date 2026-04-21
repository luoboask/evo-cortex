# 📁 Evo-Cortex Workspace 结构说明

## 标准目录结构

```
~/.openclaw/workspace-{agent-id}/
├── .git/                    # Git 仓库（可选）
├── .openclaw/               # OpenClaw 配置
├── memory/                  # ✅ 日常记忆文件
│   ├── YYYY-MM-DD.md       # 每日记忆日志
│   ├── fractal-analysis-*.md  # 分形分析报告
│   └── archive/            # 压缩归档
├── knowledge/               # ✅ 知识图谱
│   ├── {agent-id}/
│   │   ├── entities.json   # 实体定义
│   │   └── relationships.json  # 关系定义
│   └── backup/             # 定期备份
├── evolution/               # ✅ 进化数据
│   ├── meta-rules-*.md     # 元规则
│   ├── daily-review-*.md   # 审查报告
│   └── compress-*.md       # 压缩摘要
├── data/                    # ✅ 运行时数据
│   ├── memory_index/       # SQLite 索引
│   └── .session_scan_state.json
└── archives/                # ✅ 周度/月度归档
    ├── YYYY-Www/           # 按周归档
    └── monthly/            # 按月归档
```

## ❌ 不应该出现的目录

### sessions/

**问题**: `sessions` 目录不应该出现在 workspace 下。

**原因**:
- OpenClaw 的原生会话存储在 `~/.codex/sessions/` 或 `~/.openclaw/storage/agents/{agent}/sessions/`
- Evo-Cortex 的 `session-scan` 任务只**读取**这些原生会话
- 不会在 workspace 下创建 `sessions` 目录

**如果发现了 sessions 目录**:
```bash
# 这是测试遗留文件，可以安全删除
rm -rf ~/.openclaw/workspace-{agent-id}/sessions/
```

**典型特征**:
- 文件名格式：`sim-session-XXXX-timestamp.json`
- 内容包含测试数据：`"Test message 1"`, `"Response to test 1"`
- 明显是模拟数据，不是真实会话

### tmp/ 或 test/

**问题**: 临时文件或测试文件不应持久化。

**解决**: 这些目录应该在测试完成后删除。

---

## 各目录详细说明

### memory/

存储日常记忆文件，由以下任务生成：

| 文件 | 生成任务 | 频率 |
|------|----------|------|
| `YYYY-MM-DD.md` | session-scan, realtime-index | 实时 |
| `fractal-analysis-*.md` | hourly-fractal | 每小时 |
| `analysis-*.md` | active-learning | 每天 |
| `archive/*.md` | daily-compress | 每天 |

### knowledge/

存储知识图谱数据，由以下任务维护：

| 文件 | 生成任务 | 频率 |
|------|----------|------|
| `entities.json` | weekly-kg-expansion | 每周 |
| `relationships.json` | weekly-kg-expansion | 每周 |
| `backup/*.backup` | weekly-kg-expansion | 每周 |

### evolution/

存储进化数据，由以下任务生成：

| 文件 | 生成任务 | 频率 |
|------|----------|------|
| `meta-rules-*.md` | active-learning | 每天 |
| `daily-review-*.md` | daily-review | 每天 |
| `compress-*.md` | daily-compress, weekly-compress | 每天/每周 |

### data/

存储运行时数据：

| 文件/目录 | 用途 |
|-----------|------|
| `memory_index/` | SQLite 索引数据库 |
| `.session_scan_state.json` | session-scan 状态追踪 |

### archives/

按时间归档所有输出文件：

```
archives/
├── 2026-W16/           # 第 16 周 (4 月 15-21 日)
│   ├── fractal-analysis-*.md
│   ├── 2026-04-21.md
│   └── analysis-*.md
└── monthly/
    └── 2026-04-monthly-summary.md
```

---

## OpenClaw 原生会话位置

Evo-Cortex **读取**的会话文件位于：

```
~/.codex/sessions/{session-id}.json
```

或

```
~/.openclaw/storage/agents/{agent-id}/sessions/
```

这些是 OpenClaw 框架的原生会话存储，Evo-Cortex 通过 `session-scan` 任务扫描这些文件并提取信息到记忆中。

**重要**: Evo-Cortex **不会**在 workspace 下创建 `sessions` 目录。

---

## 清理指南

如果发现 workspace 下有不应该存在的目录：

```bash
# 检查
ls -la ~/.openclaw/workspace-{agent-id}/

# 删除 sessions 目录（如果是测试遗留）
rm -rf ~/.openclaw/workspace-{agent-id}/sessions/

# 删除 tmp 目录
rm -rf ~/.openclaw/workspace-{agent-id}/tmp/

# 删除 test 目录
rm -rf ~/.openclaw/workspace-{agent-id}/test/
```

**验证清理后结构**:
```bash
# 应该只看到标准目录
ls -la ~/.openclaw/workspace-{agent-id}/
# .git  .openclaw  memory  knowledge  evolution  data  archives
```

---

## 故障排除

### Q: session-scan 任务报错找不到 sessions？

**A**: 这是正常的。如果还没有任何 OpenClaw 原生会话，session-scan 会返回空结果，但不会失败。

```
[SessionScanner] No sessions directory found for agent {agent-id}
```

这表示还没有真实会话产生，任务仍然成功执行，只是没有数据可处理。

### Q: 如何确认 workspace 结构正确？

**A**: 运行以下命令：

```bash
# 查看目录结构
tree -L 2 ~/.openclaw/workspace-{agent-id}/

# 或者使用 ls
ls -la ~/.openclaw/workspace-{agent-id}/
```

应该只看到标准目录，没有 `sessions/`、`tmp/`、`test/` 等。

---

**最后更新**: 2026-04-21  
**版本**: v1.1.0
