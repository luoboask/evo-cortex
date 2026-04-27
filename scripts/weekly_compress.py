#!/usr/bin/env python3
# ═══════════════════════════════════════════════════
# 📊 Evo-Cortex 周度记忆压缩（跨平台 Python 版）
# ═══════════════════════════════════════════════════
import sys
import re
from pathlib import Path
from datetime import datetime, timedelta
from collections import Counter

def main():
    agent_id = sys.argv[1] if len(sys.argv) > 1 else "cortex-test-agent"
    home = Path.home()
    workspace = home / f".openclaw/workspace-{agent_id}"
    memory_dir = workspace / "memory" / agent_id
    weekly_dir = memory_dir / "weekly"
    archive_dir = memory_dir / "archive"

    print(f"📊 周度记忆压缩 - Agent: {agent_id}")
    print("━" * 35)

    # 统计本周记忆文件
    today = datetime.now().strftime("%Y-%m-%d")
    week_ago = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")

    week_files = []
    if memory_dir.exists():
        for f in memory_dir.glob("????-??-??.md"):
            if week_ago < f.stem < today:
                week_files.append(f)

    print(f"📁 找到 {len(week_files)} 个本周记忆文件")

    if week_files:
        weekly_dir.mkdir(parents=True, exist_ok=True)
        week_num = datetime.now().strftime("%Y-W%W")
        weekly_file = weekly_dir / f"weekly-{week_num}.md"

        lines = [
            f"# 周度摘要 - {week_num}",
            "",
            f"生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
            "",
            "## 包含的日记",
        ]

        all_text = ""
        for f in week_files:
            lines.append(f"- {f.stem}")
            all_text += f.read_text(encoding="utf-8", errors="ignore")

        lines.extend(["", "## 本周关键词"])
        words = re.findall(r'[A-Za-z]{4,}', all_text)
        top_words = Counter(words).most_common(20)
        for word, count in top_words:
            lines.append(f"- {word} ({count})")

        weekly_file.write_text("\n".join(lines) + "\n", encoding="utf-8")
        print(f"✅ 周度摘要已生成: weekly-{week_num}.md")
        print(f"   路径: {weekly_file}")

        # 归档超过 7 天的日记
        archive_dir.mkdir(parents=True, exist_ok=True)
        archived = 0
        if memory_dir.exists():
            for f in memory_dir.glob("????-??-??.md"):
                if f.stem < week_ago:
                    f.rename(archive_dir / f.name)
                    archived += 1
        if archived > 0:
            print(f"   已归档 {archived} 个旧日记到 archive/")
    else:
        print("   本周无新记忆文件，跳过")

    print("\n✅ 周度记忆压缩完成")

if __name__ == "__main__":
    main()
