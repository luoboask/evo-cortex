# 🧬 Evo-Cortex - OpenClaw Plugin

**完整的记忆、学习和进化能力 - 让 Agent 真正越用越聪明！**

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/luoboask/evo-cortex)
[![npm](https://img.shields.io/npm/v/@evo-agents/evo-cortex.svg)](https://www.npmjs.com/package/@evo-agents/evo-cortex)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](https://github.com/luoboask/evo-cortex/blob/main/LICENSE)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-2026.3.13+-orange.svg)](https://github.com/openclaw/openclaw)

---

## 🎯 核心价值

Evo-Cortex 不是一个普通的插件，它是 Agent 的**"大脑"**，让 Agent 从**被动应答**变为**主动学习**，通过持续的记忆积累、经验提炼和知识进化，实现真正的**越用越聪明**！

### ✨ 核心能力

| 能力 | 说明 | 效果 |
|------|------|------|
| **🧠 持久记忆** | 记住每次对话，自动检索增强 | 不再"金鱼记忆" |
| **📚 经验提炼** | 从重复问题中生成元规则（最佳实践） | 避免重复犯错 |
| **🗂️ 知识结构化** | 构建完整的知识图谱 | 系统化、可传承 |
| **🎯 主动学习** | 检测知识缺口并主动补充 | 自我完善 |
| **🔮 预测推荐** | 基于历史预测需求 |  proactive 助手 |

---

## 🚀 快速开始

### 方式 1: npm 安装（推荐）✨

```bash
# 1. 安装插件
openclaw plugins install @evo-agents/evo-cortex

# 2. 一键配置（推荐 Full 级别）
~/.openclaw/extensions/evo-cortex/scripts/quick-setup.sh <your-agent-id>

# 3. 验证配置
~/.openclaw/extensions/evo-cortex/scripts/verify-setup.sh <your-agent-id>
```

**npm 包页面**: https://www.npmjs.com/package/@evo-agents/evo-cortex

---

### 方式 2: 本地安装（开发模式）

```bash
# 1. 安装插件
openclaw plugins install ~/.openclaw/extensions/evo-cortex

# 2. 一键配置（推荐 Full 级别）
~/.openclaw/extensions/evo-cortex/scripts/quick-setup.sh <your-agent-id>

# 3. 验证配置
~/.openclaw/extensions/evo-cortex/scripts/verify-setup.sh <your-agent-id>
```

---

就这么简单！然后正常使用 Agent，见证它逐渐变聪明！🦞

---

## 📊 性能对比

### 混合执行模式（创新设计）

| 指标 | 纯 LLM 模式 | 混合模式 (Script+LLM) | 提升 |
|------|------------|---------------------|------|
| **日成本** | $0.55 | $0.12 | **-78%** 💰 |
| **平均耗时** | 45s | <1s (Script 部分) | **-98%** ⚡ |
| **稳定性** | 中 | 高 | **+50%** 🎯 |

**原理**: 规则型任务用 Script（零成本），创造型任务用 LLM（保持智能）

---

## ⚙️ 配置选项

### 3 级配置（已简化为默认 Full）

| 级别 | 任务数 | 适用场景 | 推荐度 |
|------|--------|----------|--------|
| **full** | 9 个 | 所有场景（默认） | ⭐⭐⭐⭐⭐ |

> 💡 **2026-04-20 更新**: 简化安装流程，移除 basic/standard 选择，默认启用全部 9 个任务。因为 session-scan 等核心任务对记忆集成至关重要，不应该被禁用。

### 2 种执行模式

| 模式 | 成本/天 | 速度 | 智能度 | 推荐度 |
|------|---------|------|--------|--------|
| **script** | $0 | <1s | 中等 | ⭐⭐⭐⭐⭐ |
| **llm** | $0.50 | 30s+ | 高 | ⭐⭐⭐ |
| **hybrid** | $0.12 | 混合 | 高 | ⭐⭐⭐⭐⭐ |

### 配置命令

```bash
# 一键配置（推荐 - 默认 Full 级别）
~/.openclaw/extensions/evo-cortex/scripts/quick-setup.sh <your-agent-id>

# 或手动配置
bash ~/.openclaw/extensions/evo-cortex/scripts/setup-crons-hybrid.sh <agent-id>

# 多 Agent 批量配置
~/.openclaw/extensions/evo-cortex/scripts/install-for-all-agents.sh
```

---

## 📋 定时任务详解

### 核心任务（HIGH 优先级）⭐

| 任务 | 频率 | 作用 | 输出 |
|------|------|------|------|
| `hourly-fractal` | 每小时 | 生成元规则 | `meta-rules-*.md` |
| `daily-review` | 每天 9AM | 审查知识图谱 | `daily-review-*.md` |
| `active-learning` | 每天 4AM | 检测学习机会 | `active-learning-*.md` |
| `session-scan` | 每 30 分钟 | 扫描会话提取记忆 | 追加到 `memory/*.md` |

### 增强任务（MEDIUM 优先级）🔶

| 任务 | 频率 | 作用 | 输出 |
|------|------|------|------|
| `daily-compress` | 每天 9:30AM | 日记忆压缩 | `compress-daily-*.md` |
| `weekly-compress` | 周日 3AM | 周记忆压缩 | `compress-weekly-*.md` |
| `weekly-kg-expansion` | 周日 5AM | 知识扩展（不依赖外部服务） | 更新 `entities.json` |
| `monthly-cycle` | 每月 1 号 2AM | 月度整合 | `monthly-report-*.md` |

### 高级任务（LOW 优先级）🔷

| 任务 | 频率 | 作用 |
|------|------|------|
| `realtime-index` | 每 5 分钟 | 实时更新搜索索引 |

---

## 🛠️ 核心工具

Evo-Cortex 提供 6 个强大工具（通过工厂函数模式自动适配当前 Agent）：

### 1. search_memory - 搜索记忆
```bash
# 在聊天中直接使用
openclaw memory search "关键词" --agent <agent-id>

# 或在对话中自然使用
"帮我搜索一下之前关于定时任务的讨论"
```

### 2. search_knowledge - 检索知识
```json
{
  "name": "search_knowledge",
  "arguments": {
    "query": "定时任务",
    "domain": "OpenClaw"
  }
}
```

### 3. manage_index - 管理索引
```bash
# 查看索引状态
openclaw memory status --agent <agent-id>

# 重建索引
openclaw memory index --agent <agent-id> --force
```

### 4. scan_sessions - 扫描会话
```json
{
  "name": "scan_sessions",
  "arguments": {
    "full": false,
    "limit": 5
  }
}
```

### 5. crawl_web - 抓取网页（可选）
```json
{
  "name": "crawl_web",
  "arguments": {
    "url": "https://docs.openclaw.ai",
    "extractMode": "markdown"
  }
}
```

### 6. health_check - 健康检查
```json
{
  "name": "health_check",
  "arguments": {
    "format": "text",
    "verbose": true
  }
}
```

> 💡 **提示**: 所有工具会自动识别当前 Agent，无需手动指定 `agent_name` 参数（已废弃）。

---

## 📈 智能成长曲线

```
聪明程度
  ↑
  │                    ╭────── 成熟期 (3 月+)
  │                  ╱         - 高度个性化
  │                ╱           - 预测准确率高
  │              ╱   成长期 (1-3 月)
  │            ╱     - 元规则积累
  │          ╱       - 知识结构化
  │        ╱
  │      ╱  起步期 (第 1 月)
  │    ╱    - 记忆积累
  │  ╱      - 基础元规则
  │╱___________ 初始期 (第 1 周)
  └──────────────────────────→ 时间
     1 周  2 周  1 月  2 月  3 月
```

### 预期效果

| 时间 | 记忆容量 | 元规则数 | 知识实体 | 能力表现 |
|------|----------|----------|----------|----------|
| **第 1 周** | 50 条 | 3 条 | 100 个 | 能回忆对话 |
| **第 2 周** | 150 条 | 10 条 | 200 个 | 经验开始沉淀 |
| **第 1 月** | 500 条 | 35 条 | 800 个 | 明显变聪明 |
| **第 3 月** | 1500+ 条 | 120+ 条 | 2000+ 个 | 智能助手 |

---

## 📁 项目结构

```
evo-cortex/
├── src/
│   ├── index.ts                    # 主入口（工厂函数模式，支持多 Agent）
│   ├── cli/commands.ts             # CLI 命令实现
│   ├── tools/
│   │   └── health-check.ts         # 健康检查工具
│   ├── memory/                     # 记忆系统
│   │   ├── memory_hub.ts           # 记忆中心
│   │   ├── memory_indexer.ts       # SQLite 索引器
│   │   └── session_scanner.ts      # 会话扫描（每 30 分钟）
│   ├── knowledge/                  # 知识系统
│   │   ├── knowledge_graph.ts      # 知识图谱（不依赖外部服务）
│   │   ├── web_crawler.ts          # 网页爬取
│   │   └── quality_scorer.ts       # 质量评分
│   ├── evolution/                  # 进化系统
│   │   └── scheduler.ts            # 进化调度器
│   ├── hooks/                      # 钩子系统
│   │   └── index.ts                # message_received/sent 等
│   └── utils/                      # 工具模块
│       ├── logger.ts               # 统一日志
│       ├── cache.ts                # TTL 缓存
│       ├── config-validator.ts     # 配置验证
│       ├── plugin-context.ts       # 上下文管理（动态路径）
│       └── cron-auto-setup.ts      # 自动配置提示
├── scripts/                        # 自动化脚本
│   ├── quick-setup.sh              # 一键配置向导（默认 Full）
│   ├── setup-crons-hybrid.sh       # Cron 配置（9 个任务）
│   ├── install.sh                  # 交互式安装
│   ├── register-agent.sh           # Agent 注册
│   ├── cleanup-plugin-demo.sh      # 清理测试任务
│   ├── list-all-crons.sh           # 列出所有任务
│   ├── list-agent-crons.sh         # 列出指定 Agent 任务
│   ├── list-crons-simple.sh        # 简化列表输出
│   └── show-full-crons.sh          # 显示完整任务详情
├── tests/                          # 测试套件
│   ├── memory.test.ts              # 记忆系统测试
│   └── knowledge.test.ts           # 知识系统测试
├── README.md                       # 本文档
└── package.json
```

---

## 🔍 故障排除

### 任务不执行
```bash
# 检查状态
openclaw cron list | grep <agent>

# 查看日志
openclaw logs --follow | grep evolution

# 重新配置（一键）
~/.openclaw/extensions/evo-cortex/scripts/quick-setup.sh <agent-id>
```

### 搜索不到记忆
```bash
# 重建索引
openclaw memory index --agent <agent> --force

# 手动扫描会话
openclaw agent --message "扫描最近会话并提取记忆"
```

### kg-expansion 提示需要 Token
```bash
# ✅ 已修复：kg-expansion 现在不依赖外部服务
# 如果仍看到此提示，说明是旧任务，请重新运行：

~/.openclaw/extensions/evo-cortex/scripts/quick-setup.sh <agent-id>
```

### Script 模式失败
```bash
# 手动测试脚本
npx tsx ~/.openclaw/extensions/evo-cortex/src/evolution/scheduler.ts \
  hourly-fractal <agent>

# 临时切换到纯 LLM 模式（不推荐）
# 需要手动修改 cron 任务，建议使用 hybrid 模式
```

---

## 📚 完整文档

- **[使用指南](EVO_CORTEX_SETUP_GUIDE.md)** - 744 行详细教程
- **[多 Agent 配置](MULTI_AGENT_SETUP.md)** - 团队部署指南
- **[混合设计说明](HYBRID_DESIGN_EXPLANATION.md)** - 架构详解
- **[快速参考](QUICK_REFERENCE.md)** - 速查卡片

---

## 💡 最佳实践

### 1. 一键部署（推荐）
```bash
# 默认 Full 配置，包含所有核心功能
~/.openclaw/extensions/evo-cortex/scripts/quick-setup.sh <your-agent-id>
```

### 2. 定期回顾
```bash
# 每周查看元规则
cat ~/.openclaw/workspace-<agent>/evolution/<agent>/meta-rules-*.md | tail -50

# 每月清理过时内容
find ~/.openclaw/workspace-<agent>/evolution/ -mtime +90 -delete

# 检查知识图谱健康度
bash ~/.openclaw/extensions/evo-cortex/scripts/knowledge-health-check.sh <agent>
```

### 3. 团队协作
- 统一配置级别便于交流
- 定期分享元规则洞察
- 建立共享知识库

### 4. 监控与优化
```bash
# 查看所有任务状态
~/.openclaw/extensions/evo-cortex/scripts/list-all-crons.sh

# 查看指定 Agent 的任务
~/.openclaw/extensions/evo-cortex/scripts/list-agent-crons.sh <agent>

# 简化输出（适合脚本调用）
~/.openclaw/extensions/evo-cortex/scripts/list-crons-simple.sh
```

---

## 🎯 实际案例

### 案例 1：Git 权限问题

**无 Evo-Cortex**:
```
用户："Git push 又失败了，怎么办？"
Agent: "抱歉，我不记得之前教过您...让我重新查一下"
```

**有 Evo-Cortex (30 天后)**:
```
用户："Git push 又失败了"
Agent: "这是本月第 3 次 Git 权限问题了。根据我们总结的经验：
        1. 先检查 SSH key: `ls -la ~/.ssh/id_rsa`
        2. 测试连接：`ssh -T git@github.com`
        3. 如果显示成功但 push 仍失败，检查仓库权限
        
        需要我帮您执行检查吗？"
```

### 案例 2：主动预测

**第 1 天**:
```
用户："我要配置新服务器"
Agent: "好的，请问您需要配置什么？"
```

**第 30 天**:
```
用户："我要配置新服务器"
Agent: "根据您的习惯，我猜您需要：
        1. Git (您常用 global 配置)
        2. SSH key (遇到过权限问题，准备了检查清单)
        3. Docker (上个月配置过 3 次)
        4. Node.js (项目依赖)
        
        还要设置 backup 策略吗？上次您忘了这个"
```

---

## 🤝 贡献

欢迎贡献代码、文档或建议！

```bash
# Fork & Clone
git clone https://github.com/luoboask/evo-cortex.git
cd evo-cortex

# 开发
npm install

# 提交 PR
git checkout -b feature/your-feature
git commit -m "feat: add your feature"
git push origin feature/your-feature
```

---

## 📊 统计数据

- **总代码行数**: 3000+
- **文档总行数**: 4000+
- **核心工具**: 6 个（工厂函数模式，支持多 Agent）
- **定时任务**: 9 个（Full 配置）
- **自动化脚本**: 14 个
- **npm 下载量**: [查看统计](https://www.npmtrends.com/@haoran51/evo-cortex)
- **成本节省**: 78%（混合执行模式）
- **速度提升**: 98%（Script 部分 <1s）
- **npm 包大小**: 64.5 KB

---

## 🔄 最近更新

### 2026-04-21 - npm 发布 🎉

**📦 正式发布到 npm**:
- 包名：`@evo-agents/evo-cortex`
- 版本：1.0.0
- 状态：✅ 已发布并可安装
- 页面：https://www.npmjs.com/package/@evo-agents/evo-cortex

**安装方式更新**:
```bash
# 推荐方式（npm）
openclaw plugins install @evo-agents/evo-cortex

# 开发方式（本地）
openclaw plugins install ~/.openclaw/extensions/evo-cortex
```

---

### 2026-04-20

**✨ 重大改进**:

1. **简化安装流程** (`589a460`)
   - 移除 basic/standard/full 选择
   - 默认启用全部 9 个任务
   - 因为 session-scan 等核心任务对记忆集成至关重要

2. **kg-expansion 不依赖外部服务** (`52f28e9`)
   - 修改任务指令，基于已有记忆和知识推理
   - 不再需要语雀 Token
   - 完全独立运行

3. **移除硬编码路径** (`e52a012`)
   - 使用动态路径解析（从运行时上下文获取）
   - 支持多 Agent 共享插件实例
   - 统一到 workspace 目录结构

4. **完善工具链** (`32ab912`, `4d115e1`)
   - 参考 demo100-agent 重写 Cron 配置脚本
   - 添加 9 个辅助脚本（清理、列表、验证等）
   - 自动 Agent 注册和旧任务清理

**📦 新增脚本**:
- `cleanup-plugin-demo.sh` - 清理测试残留任务
- `list-all-crons.sh` - 列出所有任务（解决输出截断）
- `list-agent-crons.sh` - 列出指定 Agent 任务
- `list-crons-simple.sh` - 简化列表输出
- `show-full-crons.sh` - 显示完整任务详情
- `knowledge-health-check.sh` - 知识图谱健康检查

---

## 📞 联系方式

- **npm**: https://www.npmjs.com/package/@evo-agents/evo-cortex
- **GitHub**: https://github.com/luoboask/evo-cortex
- **Issues**: https://github.com/luoboask/evo-cortex/issues
- **OpenClaw Docs**: https://docs.openclaw.ai
- **Discord**: https://discord.gg/clawd

---

## 📄 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件

---

## 🎉 总结

> **Evo-Cortex 让 Agent 从"每次都重新学习"变为"持续积累智慧"，通过记忆、经验、知识三重进化机制，实现真正的越用越聪明！**

**立即开始**:
```bash
# 方式 1: npm 安装（推荐）
openclaw plugins install @evo-agents/evo-cortex

# 方式 2: 本地安装（开发）
openclaw plugins install ~/.openclaw/extensions/evo-cortex

# 然后一键配置：
~/.openclaw/extensions/evo-cortex/scripts/quick-setup.sh <your-agent-id>

# 然后正常使用，见证奇迹！🦞
```

---

**最后更新**: 2026-04-21（npm 发布 🎉）  
**版本**: 1.0.0  
**维护者**: Evo-Agents Team
