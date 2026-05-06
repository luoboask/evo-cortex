# Evo-Cortex

> **Give Your Agent a Brain** — Persistent memory, continuous learning, and evolutionary capabilities for OpenClaw agents.

[![Version](https://img.shields.io/npm/v/@evo-agents/evo-cortex?color=blue&logo=npm)](https://www.npmjs.com/package/@evo-agents/evo-cortex)
[![License](https://img.shields.io/npm/l/@evo-agents/evo-cortex?color=green)](./LICENSE)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-2026.3.24--beta.2+-orange?logo=openclaw)](https://github.com/openclaw/openclaw)
[![GitHub stars](https://img.shields.io/github/stars/luoboask/evo-cortex?style=social)](https://github.com/luoboask/evo-cortex/stargazers)

**[中文文档](./README.zh.md)** · **[Full Documentation](./docs/)** · **[Quick Start](#-quick-start)**

---

## What is Evo-Cortex?

Evo-Cortex transforms AI agents from **passive responders** into **active learners**. It provides a complete brain system with persistent memory, experience distillation, knowledge graphs, and automated evolution cycles.

### Why Evo-Cortex?

| Problem | Solution |
|---------|----------|
| Agents forget everything after each session | **Persistent Memory** with semantic search |
| No learning from repeated experiences | **Experience Distillation** extracts meta-rules |
| Unstructured knowledge | **Knowledge Graph** auto-builds relationships |
| Static capabilities | **Evolution Scheduler** runs continuous improvement |

### Key Results

```
Cost:  ~$0.00/day  (Pure script execution for most tasks)
Speed: <1s for 95% of tasks
Memory: <100ms semantic search recall
Learning: Continuous — gets wiser over time
```

---

## Quick Start

### 1. Install

```bash
# Via npm (recommended)
openclaw plugins install @evo-agents/evo-cortex

# Or use the install script directly for a specific agent
bash ~/.openclaw/extensions/evo-cortex/scripts/install.sh <your-agent-name>
```

### 2. Setup

The `install.sh` script handles everything:

```bash
bash ~/.openclaw/extensions/evo-cortex/scripts/install.sh my-agent
```

**What it does:**
- Creates agent workspace with `SOUL.md`, `USER.md`, `AGENTS.md` templates
- Registers the agent with OpenClaw
- Initializes memory and knowledge databases
- Creates 7 automated cron tasks

### 3. Verify

```bash
# Check plugin is loaded
openclaw plugins list | grep evo-cortex

# View active cron tasks
openclaw cron list | grep <your-agent-id>

# Or use helper script
bash ~/.openclaw/extensions/evo-cortex/scripts/list-agent-crons.sh <your-agent-id>
```

**That's it!** Your agent now has a brain that learns and remembers.

---

## Cron Tasks

| Task | Frequency | Purpose |
|------|-----------|---------|
| `nightly-evolution` | Daily | Extract meta-rules from high-value memories |
| `active-learning` | Daily | Pattern recognition and preference extraction |
| `daily-review` | Daily | Knowledge graph health check |
| `daily-compress` | Daily | Memory compression and consolidation |
| `weekly-compress` | Weekly | Weekly archive and summary |
| `weekly-kg-expansion` | Weekly | Knowledge graph expansion |
| `monthly-cycle` | Monthly | Full cleanup, stats, and evolution |

All tasks run as pure scripts (no LLM calls) — $0.00/day operational cost.

---

## Core Features

### Persistent Memory

SQLite-based semantic memory that automatically captures and retrieves context across all sessions.

- Automatic session scanning from JSONL logs
- Semantic search with embeddings (when available)
- Working memory, short-term memory, and long-term memory layers
- Memory compression to keep databases lean

### Knowledge Graph

Build structured knowledge from your interactions automatically.

- Entity extraction from conversation history
- Automatic relationship discovery
- Graph health metrics (density, connectivity)
- Incremental updates on each cycle

### Experience Distillation

Automatically extract meta-rules and best practices from repeated patterns.

```markdown
## Rule: Dynamic Path Resolution
**When**: Configuring paths in scripts
**Do**: Use dynamic resolution instead of hardcoding
**Why**: Portability across environments
**Confidence**: 98% (observed 15 times)
```

### Evolution System

The evolution cycle ensures the agent gets smarter over time:

1. **Collect** high-importance events from memory
2. **Classify** events by type (error, pattern, preference, etc.)
3. **Distill** recurring patterns into meta-rules
4. **Store** rules with confidence scores
5. **Apply** rules to future behavior

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    OpenClaw Agent                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │ memory.db │  │knowledge.│  │  Workspace Files │   │
│  │          │  │   db     │  │  SOUL/USER/AGENT │   │
│  └────┬─────┘  └────┬─────┘  └────────┬─────────┘   │
│       │             │                 │             │
│  ┌────┴─────────────┴─────────────────┴──────────┐  │
│  │            Cron Tasks (Pure Script)            │  │
│  │  scan → learn → evolve → compress → expand    │  │
│  └────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### Data Flow

```
Conversation → JSONL log → Session Scanner → memory.db
                                                    ↓
                                              Active Learning
                                                    ↓
                                              knowledge.db
                                                    ↓
                                            Evolution System
                                                    ↓
                                              Meta-Rules
```

---

## Workspace Files

Each agent workspace contains files that guide behavior:

| File | Purpose |
|------|---------|
| `SOUL.md` | Agent personality, content style, core principles |
| `USER.md` | User profile, goals, preferences |
| `AGENTS.md` | Workspace rules, content guidelines, quality standards |
| `memory.db` | Persistent memory storage |
| `knowledge.db` | Knowledge graph storage |
| `memory/` | Daily markdown memory files |
| `knowledge/` | Entity and relationship exports |
| `evolution/` | Active learning reports and meta-rules |

---

## Performance

| Metric | Value |
|--------|-------|
| Cost per day | ~$0.00 (script-based tasks) |
| Response time | <1s for most operations |
| Memory recall | <100ms semantic search |
| Disk usage | ~100MB minimum |
| Dependencies | sqlite3, @sinclair/typebox |

---

## Package Details

| Property | Value |
|----------|-------|
| **Package** | `@evo-agents/evo-cortex` |
| **Version** | 1.3.0 |
| **License** | MIT |
| **Compatibility** | OpenClaw 2026.3.24-beta.2+ |
| **Node.js** | v18+ (v20+ recommended) |

---

## Troubleshooting

**Cron tasks failing with timeout?**
Increase the timeout in `setup_crons.py` — isolated sessions take longer to initialize. Default: 180s for most tasks, 300s for nightly-evolution.

**Knowledge graph empty?**
Normal for new agents. The system needs conversation data to extract entities. Check after 1-2 weeks of active use.

**Evolution found 0 events?**
Expected for new agents. Meta-rules emerge from repeated high-value patterns — you need enough conversation history first.

**Memory not being recalled?**
Check that the session scanner is running (`openclaw cron list`). Memory files should exist in the `memory/` directory.

---

## Contributing

1. Fork and clone: `git clone https://github.com/luoboask/evo-cortex.git`
2. Create branch: `git checkout -b feature/your-feature`
3. Make changes and commit
4. Push and open PR

See [CONTRIBUTING.md](./CONTRIBUTING.md) for detailed guidelines.

---

## License

[MIT License](./LICENSE) — Free to use, modify, and distribute.

---

<div align="center">

**Ready to give your agent a brain?**

```bash
openclaw plugins install @evo-agents/evo-cortex
```

[Get Started](#quick-start) · [View Documentation](./docs/) · [Star on GitHub](https://github.com/luoboask/evo-cortex/stargazers)

---

Made with care by **Evo-Agents Team** | v1.3.0

[Back to Top](#evo-cortex)

</div>
