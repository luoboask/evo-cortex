#!/usr/bin/env python3
# ═══════════════════════════════════════════════════
# 📅 Evo-Cortex 月度维护（跨平台 Python 版）
# ═══════════════════════════════════════════════════
import os
import sys
import sqlite3
import json
from pathlib import Path
from datetime import datetime, timedelta

def main():
    agent_id = sys.argv[1] if len(sys.argv) > 1 else "cortex-test-agent"
    home = Path.home()
    workspace = home / f".openclaw/workspace-{agent_id}"
    memory_dir = workspace / "memory" / agent_id
    data_dir = workspace / "data" / agent_id
    archive_dir = memory_dir / "archive"

    print(f"📅 月度维护 - Agent: {agent_id}")
    print("━" * 35)

    # 1. 月度记忆压缩
    print("\n📦 月度记忆压缩...")
    month_ago = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")
    current_month = datetime.now().strftime("%Y-%m")
    monthly_file = memory_dir / f"monthly-{current_month}.md"

    old_files = []
    if memory_dir.exists():
        for f in memory_dir.glob("????-??-??.md"):
            if f.stem < month_ago:
                old_files.append(f)

    if old_files:
        memory_dir.mkdir(parents=True, exist_ok=True)
        lines = [
            f"# 月度摘要 - {current_month}",
            "",
            f"生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
            "",
            f"## 包含的日记（{len(old_files)} 个文件）",
        ]
        # 提取关键词
        all_text = ""
        for f in old_files:
            lines.append(f"- {f.stem}")
            all_text += f.read_text(encoding="utf-8", errors="ignore")

        lines.extend(["", "## 月度关键词"])
        # 简单关键词提取（英文单词）
        import re
        words = re.findall(r'[A-Za-z]{4,}', all_text)
        from collections import Counter
        top_words = Counter(words).most_common(20)
        for word, count in top_words:
            lines.append(f"- {word} ({count})")

        monthly_file.write_text("\n".join(lines) + "\n", encoding="utf-8")
        print(f"✅ 月度摘要已生成: monthly-{current_month}.md")
        print(f"   汇总了 {len(old_files)} 个旧日记文件")

        # 归档
        archive_dir.mkdir(parents=True, exist_ok=True)
        for f in old_files:
            dest = archive_dir / f.name
            f.rename(dest)
            print(f"   已归档: {f.stem}")
    else:
        print("   无需压缩（30 天内无旧日记）")

    # 2. 归档清理
    print("\n🧹 归档清理...")
    two_months_ago = (datetime.now() - timedelta(days=60)).strftime("%Y-%m-%d")
    if archive_dir.exists():
        cleaned = 0
        for f in archive_dir.glob("????-??-??.md"):
            if f.stem < two_months_ago:
                f.unlink()
                cleaned += 1
        if cleaned > 0:
            print(f"   清理了 {cleaned} 个过期归档文件")
        else:
            print("   无需清理（归档文件都在保留期内）")
    else:
        print("   归档目录不存在，跳过")

    # 3. 统计报告
    print("\n📊 统计报告...")
    db_path = data_dir / "memory.db"
    if db_path.exists():
        conn = sqlite3.connect(str(db_path))
        try:
            cur = conn.cursor()
            for table, label in [
                ("working_memory", "工作记忆"),
                ("session_messages", "会话消息"),
                ("preferences", "偏好设置"),
                ("scan_log", "扫描日志"),
            ]:
                try:
                    cur.execute(f"SELECT COUNT(*) FROM {table}")
                    count = cur.fetchone()[0]
                    print(f"  {label}: {count} 条")
                except Exception:
                    print(f"  {label}: 表不存在")
        finally:
            conn.close()
    else:
        print("  数据库不存在")

    # 4. 临时文件清理
    print("\n🗑️  临时文件清理...")
    temp_files = list(workspace.glob("**/*.tmp")) + list(workspace.glob("**/*.bak"))
    if temp_files:
        for f in temp_files:
            f.unlink()
            print(f"  已删除: {f.name}")
    else:
        print("  无临时文件")

    print("\n✅ 月度维护完成")

if __name__ == "__main__":
    main()
