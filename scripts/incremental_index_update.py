#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
incremental_index_update.py - 增量索引更新（占位）

当前版本不使用 FTS5 索引和向量索引。
此脚本保留为未来增量索引功能使用。

用法：
    python3 incremental_index_update.py <agent-id>
"""

import sys
from pathlib import Path


def main():
    if len(sys.argv) < 2:
        print("用法：python3 incremental_index_update.py <agent-id>")
        sys.exit(1)

    agent_id = sys.argv[1]
    print(f"⏭️  增量索引更新已禁用（{agent_id}）")
    print("   当前版本不使用 FTS5 和向量索引")


if __name__ == '__main__':
    main()
