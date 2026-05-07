#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Evo-Cortex 偏好数据库操作库

使用 memory.db 中的 preferences 表，字段：
  id, category, key, value, source, confidence, extracted_at, confirmed
"""

import sqlite3
from pathlib import Path
from datetime import datetime


class PreferencesDB:
    def __init__(self, agent_id: str):
        self.agent_id = agent_id
        home = Path.home()
        self.db_path = home / '.openclaw' / f'workspace-{agent_id}' / 'data' / agent_id / 'memory.db'
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(self.db_path))
        self._ensure_table()

    def _ensure_table(self):
        self.conn.execute('''
            CREATE TABLE IF NOT EXISTS preferences (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category TEXT,
                key TEXT NOT NULL,
                value TEXT,
                source TEXT,
                confidence REAL DEFAULT 0.5,
                extracted_at TEXT DEFAULT (datetime('now')),
                confirmed INTEGER DEFAULT 0
            )
        ''')
        self.conn.commit()

    def add_preference(self, text: str, category: str, confidence: float,
                       source: str = '', metadata: dict = None) -> int:
        """添加一条偏好。text 同时作为 key 和 value 存储。"""
        # 去重：检查是否已有相似条目
        cur = self.conn.execute(
            'SELECT id FROM preferences WHERE key LIKE ?',
            (f'%{text[:50]}%',)
        )
        if cur.fetchone():
            return -1  # 已存在

        self.conn.execute('''
            INSERT INTO preferences (key, value, category, confidence, source, extracted_at, confirmed)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (text, text, category, confidence, source,
              datetime.now().isoformat(), 1 if confidence >= 0.85 else 0))
        self.conn.commit()
        return self.conn.execute('SELECT last_insert_rowid()').fetchone()[0]

    def close(self):
        if self.conn:
            self.conn.close()
