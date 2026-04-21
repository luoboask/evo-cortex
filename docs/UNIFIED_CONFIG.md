# 🔧 Unified Configuration Guide

## One Configuration Mode - Simple & Clean

Evo-Cortex now uses **one unified configuration mode**: **Script-Only Mode**.

### Why Script-Only?

| Metric | Value |
|--------|-------|
| **Cost** | $0.00/day (zero LLM API calls) |
| **Speed** | <1 second per task |
| **Reliability** | 100% (no API rate limits) |
| **Complexity** | Minimal (single config script) |

### Quick Setup

```bash
# One command to configure everything
bash scripts/setup-crons.sh <your-agent-id>
```

That's it! This single command:
1. Registers your agent with OpenClaw
2. Cleans up any old cron tasks
3. Creates 9 optimized script-mode tasks
4. Verifies the installation

### What Gets Configured?

After running `setup-crons.sh`, you get these 9 tasks:

| Task | Frequency | Purpose |
|------|-----------|---------|
| `realtime-index` | Every 5 min | Check index health |
| `session-scan` | Every 30 min | Scan for new sessions |
| `hourly-fractal` | Hourly | Conversation statistics |
| `active-learning` | Daily 04:00 | Word frequency analysis |
| `daily-review` | Daily 09:00 | Knowledge graph health check |
| `daily-compress` | Daily 09:30 | Merge yesterday's memories |
| `weekly-compress` | Sunday 03:00 | Weekly archive |
| `weekly-kg-expansion` | Sunday 05:00 | JSON maintenance |
| `monthly-cycle` | Monthly 01:00 | Cleanup & monthly stats |

### Verification

```bash
# List all tasks for your agent
bash scripts/list-agent-crons.sh <your-agent-id>

# Verify installation
bash scripts/verify-setup.sh <your-agent-id>
```

### Migration from Old Modes

If you previously used hybrid or smart modes, simply re-run the setup:

```bash
# This will clean old tasks and create new ones
bash scripts/setup-crons.sh <your-agent-id>
```

The script automatically removes any existing Evo-Cortex tasks before creating the new unified set.

---

## For Advanced Users

### Customizing Tasks

Edit `scripts/setup-crons.sh` to customize task instructions. Each task is defined with:

```bash
create_script_task \
  "$AGENT_NAME-task-name" \
  "0 * * * *" \
  "Your custom instruction here..."
```

### Monitoring

```bash
# View task execution history
openclaw cron runs <task-id> --limit 5

# Check memory files
ls -lh ~/.openclaw/workspace-<agent>/memory/

# View knowledge graph
cat ~/.openclaw/workspace-<agent>/knowledge/<agent>/entities.json
```

---

**Simple. Fast. Reliable.** 🚀

That's the Evo-Cortex way.
