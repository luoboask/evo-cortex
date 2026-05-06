#!/usr/bin/env python3
# ═══════════════════════════════════════════════════
# 🧬 Evo-Cortex OpenClaw Cron 配置（跨平台 Python 版）
# ═══════════════════════════════════════════════════
"""
用法: python3 setup_crons.py <agent-name>
"""
import sys
import subprocess
import json
from pathlib import Path

def run(cmd: str) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, shell=True, capture_output=True, text=True)

def main():
    agent_name = sys.argv[1] if len(sys.argv) > 1 else None
    if not agent_name:
        print("❌ 错误：请指定 Agent 名称")
        print("用法：python3 setup_crons.py <agent-name>")
        sys.exit(1)

    evo_cortex_root = Path(__file__).resolve().parent.parent
    scripts_dir = evo_cortex_root / "scripts"

    print("╔══════════════════════════════════════════════════╗")
    print("║  🧬 Evo-Cortex Cron 配置 (7 任务)                  ║")
    print("╚══════════════════════════════════════════════════╝")
    print()
    print(f"📦 Agent: {agent_name}")
    print(f"📁 插件目录: {evo_cortex_root}")
    print()

    # 清理旧任务
    print("🧹 清理旧任务...")
    result = run(f"openclaw cron list --json")
    if result.returncode == 0:
        try:
            data = json.loads(result.stdout)
            for job in data.get("jobs", []):
                if job.get("agentId") == agent_name:
                    job_id = job["id"]
                    run(f"openclaw cron remove {job_id}")
                    print(f"   已删除: {job_id[:8]}")
        except (json.JSONDecodeError, KeyError):
            pass
    print()

    # 任务定义
    tasks = [
        {
            "name": "nightly-evolution",
            "cron": "0 23 * * *",
            "message": f"执行夜间进化。运行: python3 {scripts_dir}/activate-evolution.py {agent_name}",
            "timeout": 300,
        },
        {
            "name": "active-learning",
            "cron": "0 4 * * *",
            "message": f"Run: python3 {scripts_dir}/active_learning.py {agent_name}\nOutput the script output as-is. No analysis.",
            "timeout": 180,
        },
        {
            "name": "daily-review",
            "cron": "0 9 * * *",
            "message": f"执行: python3 {scripts_dir}/kg_auto_update.py {agent_name}",
            "timeout": 180,
        },
        {
            "name": "monthly-cycle",
            "cron": "0 2 1 * *",
            "message": f"Run: python3 {scripts_dir}/monthly_cycle.py {agent_name}\nOutput the script output as-is. No analysis.",
            "timeout": 180,
        },
        {
            "name": "weekly-compress",
            "cron": "0 3 * * 0",
            "message": f"Run: python3 {scripts_dir}/weekly_compress.py {agent_name}\nOutput the script output as-is. No analysis.",
            "timeout": 180,
        },
        {
            "name": "weekly-kg-expansion",
            "cron": "0 5 * * 0",
            "message": f"执行知识图谱扩展。运行: python3 {scripts_dir}/kg_auto_update.py {agent_name}",
            "timeout": 180,
        },
        {
            "name": "daily-compress",
            "cron": "30 9 * * *",
            "message": f"执行记忆压缩。调用工具：memory_compress {{\"granularity\": \"daily\"}}",
            "timeout": 180,
        },
    ]

    print("📋 配置 cron 任务...\n")

    for task in tasks:
        cmd = (
            f'openclaw cron add '
            f'--cron "{task["cron"]}" '
            f'--agent "{agent_name}" '
            f'--message "{task["message"]}" '
            f'--name "{agent_name}-{task["name"]}" '
            f'--session isolated '
            f'--no-deliver '
            f'--timeout-seconds {task["timeout"]}'
        )
        result = run(cmd)
        status = "✅ 已创建" if result.returncode == 0 else "❌ 失败"
        print(f"   - {task['name']} ({task['cron']})... {status}")

    print()
    print("╔══════════════════════════════════════════════════╗")
    print("║  ✅ 配置完成！7 个 OpenClaw Cron 任务               ║")
    print("╚══════════════════════════════════════════════════╝")
    print()
    print("   任务                  调度          超时    说明")
    print("   " + "─" * 55)
    for t in tasks:
        print(f"   {t['name']:<22}{t['cron']:<14}{t['timeout']}s")
    print()

    run("openclaw cron list 2>/dev/null | grep " + agent_name)

if __name__ == "__main__":
    main()
