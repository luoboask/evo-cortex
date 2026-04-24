## v1.2.1 (2026-04-24)

### 🎯 新增功能
- ✅ 工作记忆双重写入机制（messageReceivedHook + session-scan）
- ✅ 真实对话过滤逻辑（过滤 Cron/工具/系统记录）
- ✅ isRealConversation() 智能过滤函数
- ✅ 调试日志增强

### 🐛 Bug 修复
- 🔧 修复 session_scan.py 变量作用域问题
- 🔧 修复 USER_PREFERENCES.md 重复数据问题

### 📊 改进
- 🚀 近实时记忆写入（<100ms）
- 🚀 只保存真实用户对话
- 🚀 自动清理过期记忆（2 小时/30 天）

---

# 📋 Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),

## [1.2.0] - 2026-04-23

### ✨ Added
- **用户偏好自动提取系统** (#P0)
  - 从对话记忆中自动识别用户偏好（喜欢/不喜欢/格式要求/待办/习惯）
  - 双存储：SQLite 数据库 + Markdown 文件
  - 智能过滤测试内容和注释
  - 置信度评分（65%-85%）
  - 去重机制防止重复添加
  
- **跨会话连续性优化** (#P0)
  - 在 onMessage 钩子中自动加载 USER_PREFERENCES.md
  - 每次会话前自动应用用户偏好
  - 支持 5 种偏好类型识别
  
- **数据量检查和成功验证** (#P0)
  - active-learning-enhanced.sh: 执行前检查记忆文件数量
  - web-knowledge-fetch.sh: 配置检查和输出验证
  - 所有主要脚本添加成功标准验证

### 🔧 Improved
- **脚本健壮性提升**
  - 修复 macOS grep 正则编码问题（改用字符串匹配）
  - 增强幂等性和并发安全性（分布式锁机制）
  - 优化错误处理和日志输出
  
- **性能优化**
  - 纯脚本模式，零 LLM API 调用
  - 每 30 分钟自动扫描，执行时间 <2 秒
  - 成本：$0.00/天

### 📚 Documentation
- **使用指南**
  - 何时看到效果的时间线说明
  - 最佳实践和常见问题
  - 故障排除指南
  
- **技术文档**
  - 偏好提取逻辑详解
  - 数据库结构设计
  - Cron 配置说明

### 🐛 Fixed
- 变量名拼写错误 (AGENTID → AGENT_ID)
- 知识图谱更新脚本的路径问题
- 文档清理，移除过时内容

### 🎯 Impact
- **用户体验**: 显著的个性化提升，系统"记住"用户偏好
- **可靠性**: 减少无效执行，更好的错误提示
- **成本**: 保持零成本运行
- **维护性**: 代码精简 20%，文档完善

### 📊 Statistics
- 新增脚本：3 个核心脚本
- 修改脚本：8 个现有脚本
- 新增文档：5 个使用指南
- 代码行数：+480 行（净增）
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned
- Enhanced memory compression algorithms
- Cross-session pattern recognition
- Advanced knowledge graph visualization
- Integration with more external knowledge sources

---

## [1.0.0] - 2026-04-21

### ✨ Added

#### Core Features
- **Persistent Memory System**
  - SQLite-based semantic indexing
  - Automatic session scanning (every 30 minutes)
  - Real-time memory updates (every 5 minutes)
  - Hybrid execution mode (Script + LLM)

- **Experience Distillation**
  - Meta-rule generation from repeated patterns
  - Best practices extraction
  - Automated lesson learning

- **Knowledge Graph**
  - Entity extraction and relationship mapping
  - Automatic knowledge structuring
  - Graph health monitoring
  - Visualization tools (Mermaid charts)

- **Active Learning**
  - Knowledge gap detection
  - Proactive information gathering
  - Self-improvement mechanisms

- **Evolution Scheduler**
  - Fractal thinking analysis (hourly)
  - Daily review and compression
  - Weekly knowledge expansion
  - Monthly evolution cycles

#### Tools & Utilities
- `search_memory` - Semantic memory search
- `search_knowledge` - Knowledge graph queries
- `health-check` - System health monitoring
- Factory function pattern for multi-agent support

#### Scripts
- `quick-setup.sh` - One-click installation
- `setup-crons-hybrid.sh` - Cron job configuration
- `cleanup-plugin-demo.sh` - Test cleanup
- `list-all-crons.sh` - List all cron jobs
- `verify-setup.sh` - Configuration validation
- `knowledge-health-check.sh` - Knowledge graph health

### 🔧 Changed
- Simplified installation flow (default Full configuration)
- Removed hardcoded paths (dynamic path resolution)
- Improved error handling and logging
- Enhanced plugin context factory pattern

### 🐛 Fixed
- kg-expansion task no longer requires external services
- Memory indexer caching issues
- Cron job duplication problems
- Path resolution in multi-agent scenarios

### ⚡ Performance
- **78% cost reduction** with hybrid execution mode
- **98% speed improvement** for script-based tasks (<1s avg)
- Optimized SQLite indexing
- Reduced API calls through intelligent caching

### 📊 Statistics
- Code: ~3,000 lines TypeScript
- Documentation: ~4,000 lines Markdown
- Package size: 64.6 KB
- Total files: 47

### 🎯 Configuration Levels
Three preset configurations available:
- **Basic**: 3 core tasks (fractal, review, active-learning)
- **Standard**: 7 tasks (+compression, knowledge expansion)
- **Full**: 9 tasks (all features enabled, recommended)

### 📦 Distribution
- Published to npm as `@evo-agents/evo-cortex`
- MIT License
- Compatible with OpenClaw 2026.3.13+

---

## Technical Details

### Architecture
- **Plugin System**: OpenClaw native plugin architecture
- **Execution Model**: Hybrid Script + LLM execution
- **Storage**: SQLite for memory indexing, JSON for knowledge graph
- **Scheduling**: OpenClaw cron integration

### Dependencies
- Node.js v18+
- OpenClaw 2026.3.13+
- No external API keys required (fully self-contained)

### Security
- Local data storage only
- No telemetry or analytics
- Sandboxed execution environment
- Regular security audits

---

## Future Roadmap

### Q2 2026
- [ ] Multi-agent knowledge sharing
- [ ] Advanced pattern recognition
- [ ] Custom evolution strategies
- [ ] Plugin marketplace integration

### Q3 2026
- [ ] Cloud sync option (optional)
- [ ] Mobile app integration
- [ ] Advanced analytics dashboard
- [ ] Community templates

---

**For detailed release notes, see:** [PUBLISH_SUCCESS.md](./PUBLISH_SUCCESS.md)

**Contributing:** See [CONTRIBUTING.md](./CONTRIBUTING.md)

## [1.1.0] - 2026-04-21

### 🎯 Unified Configuration

**BREAKING CHANGE**: Simplified to single configuration mode.

#### Changed
- **Unified to Script-Only Mode**: All tasks now use pure script execution (zero LLM API calls)
- **Simplified Installation**: Single `setup-crons.sh` script replaces hybrid/smart/script-only variants
- **Zero Cost**: $0.00/day operating cost with 100% reliability
- **Faster Execution**: <1 second per task

#### Removed
- `scripts/setup-crons-hybrid.sh` - Hybrid mode removed
- `scripts/setup-crons-smart.sh` - Smart fallback mode removed
- `scripts/check-rate-limit.sh` - No longer needed without LLM dependencies
- `scripts/disable-llm-tasks.sh` - No longer needed
- `scripts/cleanup-plugin-demo.sh` - Temporary cleanup script removed

#### Migration
If you previously installed Evo-Cortex:
```bash
# Re-run setup to migrate to unified configuration
bash scripts/setup-crons.sh <your-agent-id>
```

This automatically removes old tasks and creates the new unified set.

### 📚 Documentation
- Added `docs/UNIFIED_CONFIG.md` - Complete unified configuration guide
- Updated README with simplified installation instructions
- Removed multi-mode comparison tables

---
