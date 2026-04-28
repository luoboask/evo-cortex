#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
incremental_index_update.py - 增量索引自动更新

扫描 memory 目录，对比 file_hashes，找出新增/修改的文件，
更新 memory.db 的 FTS5 索引和工作记忆，调用 Ollama 更新向量索引。

用法：
    python3 incremental_index_update.py cortex-test-agent
"""

import sys
import os
import json
import sqlite3
import hashlib
import re
from pathlib import Path
from datetime import datetime, timedelta


class Config:
    """配置管理器 - 多 agent 隔离"""
    def __init__(self, agent_id: str):
        self.agent_id = agent_id
        self.home = Path.home()
        self.openclaw_root = self.home / '.openclaw'
        self.workspace = self.openclaw_root / f'workspace-{agent_id}'
        self.memory_dir = self.workspace / 'memory' / agent_id
        self.data_dir = self.workspace / 'data' / agent_id
        self.db_path = self.data_dir / 'memory.db'
        self.ollama_url = os.environ.get('OLLAMA_URL', 'http://localhost:11434/v1/embeddings')
        self.embedding_model = os.environ.get('EMBEDDING_MODEL', 'bge-m3')


def extract_title(content: str) -> str:
    """从 Markdown 提取标题"""
    match = re.search(r'^#\s+(.+)$', content, re.MULTILINE)
    return match.group(1).strip() if match else ''


def scan_memory_files(memory_dir: Path) -> dict:
    """扫描所有 .md 文件，返回 {rel_path: info}"""
    files = {}
    if not memory_dir.exists():
        return files
    for md_file in sorted(memory_dir.rglob('*.md')):
        try:
            content = md_file.read_text(encoding='utf-8')
            stat = md_file.stat()
            files[str(md_file.relative_to(memory_dir))] = {
                'content': content,
                'hash': hashlib.md5(content.encode()).hexdigest(),
                'size': stat.st_size,
                'mtime': stat.st_mtime,
            }
        except Exception as e:
            print(f"[incremental-update] ⚠️ Cannot read {md_file.name}: {e}")
    return files


def get_indexed_hashes(conn: sqlite3.Connection) -> dict:
    """获取已索引文件的 {file_path: hash}"""
    try:
        return {row[0]: row[1] for row in conn.execute("SELECT file_path, hash FROM file_hashes")}
    except sqlite3.OperationalError:
        return {}


def update_fts(conn: sqlite3.Connection, rel_path: str, file_info: dict):
    """更新 FTS5 索引（DELETE + INSERT，避免 FTS5 UPSERT 问题）"""
    title = extract_title(file_info['content'])
    # 删除旧记录（FTS5 外部内容模式会自动同步触发器）
    conn.execute("DELETE FROM fts_docs WHERE file_path = ?", (rel_path,))
    conn.execute(
        "INSERT INTO fts_docs (file_path, title, content) VALUES (?, ?, ?)",
        (rel_path, title, file_info['content']),
    )
    # 更新 hash
    conn.execute("DELETE FROM file_hashes WHERE file_path = ?", (rel_path,))
    conn.execute(
        "INSERT INTO file_hashes (file_path, hash, size, mtime) VALUES (?, ?, ?, ?)",
        (rel_path, file_info['hash'], file_info['size'], file_info['mtime']),
    )


def update_working_memory(conn: sqlite3.Connection, rel_path: str, file_info: dict):
    """写入工作记忆（按 session_id 隔离，过期时间 14 天）"""
    title = extract_title(file_info['content'])
    snippet = file_info['content'][:2000]
    session_id = rel_path.replace('/', '_').replace('.md', '')
    expires_at = (datetime.now() + timedelta(days=14)).isoformat()

    conn.execute("DELETE FROM working_memory WHERE session_id = ?", (session_id,))
    conn.execute(
        "INSERT INTO working_memory (session_id, content, expires_at) VALUES (?, ?, ?)",
        (session_id, f"# {title}\n{snippet}", expires_at),
    )


def update_vector(conn: sqlite3.Connection, rel_path: str, content: str, config: Config) -> bool:
    """调用 Ollama 生成向量"""
    try:
        import urllib.request
        payload = json.dumps({"model": config.embedding_model, "input": content[:2000]}).encode()
        req = urllib.request.Request(
            config.ollama_url, data=payload, headers={'Content-Type': 'application/json'}
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read())
            embedding = result['data'][0]['embedding']

        # 存储为 JSON（TEXT 列）
        conn.execute("DELETE FROM vector_embeddings WHERE file_path = ?", (rel_path,))
        conn.execute(
            "INSERT INTO vector_embeddings (file_path, embedding, model) VALUES (?, ?, ?)",
            (rel_path, json.dumps(embedding), config.embedding_model),
        )
        return True
    except Exception as e:
        if 'Connection refused' not in str(e):
            print(f"[incremental-update] ⚠️ Vector failed for {rel_path}: {e}")
        return False


def main():
    if len(sys.argv) < 2:
        print(f"Usage: python3 {sys.argv[0]} <agent-id>")
        sys.exit(1)

    agent_id = sys.argv[1]
    config = Config(agent_id)

    print(f"[incremental-update] agent={agent_id}")
    print(f"[incremental-update] memory_dir={config.memory_dir}")

    if not config.memory_dir.exists():
        print(f"[incremental-update] ⚠️ Memory dir not found")
        sys.exit(0)

    fs_files = scan_memory_files(config.memory_dir)
    if not fs_files:
        print("[incremental-update] No .md files found")
        sys.exit(0)

    stats = {'scanned': len(fs_files), 'new': 0, 'updated': 0, 'deleted': 0, 'errors': 0, 'vectors': 0}
    print(f"[incremental-update] filesystem: {stats['scanned']} files")

    if config.db_path.exists():
        conn = sqlite3.connect(str(config.db_path))
        conn.execute("PRAGMA journal_mode=WAL")
        try:
            # 确保 FTS5 触发器存在（外部内容模式需要手动同步）
            conn.executescript("""
                CREATE TRIGGER IF NOT EXISTS fts_docs_ai AFTER INSERT ON fts_docs BEGIN
                    INSERT INTO fts_content(rowid, title, content) VALUES (NEW.doc_id, NEW.title, NEW.content);
                END;
                CREATE TRIGGER IF NOT EXISTS fts_docs_ad AFTER DELETE ON fts_docs BEGIN
                    INSERT INTO fts_content(fts_content, rowid, title, content) VALUES('delete', OLD.doc_id, OLD.title, OLD.content);
                END;
                CREATE TRIGGER IF NOT EXISTS fts_docs_au AFTER UPDATE ON fts_docs BEGIN
                    INSERT INTO fts_content(fts_content, rowid, title, content) VALUES('delete', OLD.doc_id, OLD.title, OLD.content);
                    INSERT INTO fts_content(rowid, title, content) VALUES (NEW.doc_id, NEW.title, NEW.content);
                END;
            """)
            db_hashes = get_indexed_hashes(conn)
            fs_paths = set(fs_files.keys())
            db_paths = set(db_hashes.keys())

            new_files = fs_paths - db_paths
            modified = [p for p in fs_paths if p in db_hashes and db_hashes[p] != fs_files[p]['hash']]
            deleted = db_paths - fs_paths

            print(f"[incremental-update] diff: new={len(new_files)}, modified={len(modified)}, deleted={len(deleted)}")

            # 新增 + 修改
            for path in sorted(new_files | set(modified)):
                try:
                    update_fts(conn, path, fs_files[path])
                    update_working_memory(conn, path, fs_files[path])
                    if update_vector(conn, path, fs_files[path]['content'], config):
                        stats['vectors'] += 1
                    stats['new' if path in new_files else 'updated'] += 1
                except Exception as e:
                    stats['errors'] += 1
                    print(f"[incremental-update] ❌ Failed {path}: {e}")

            # 删除
            for path in sorted(deleted):
                try:
                    conn.execute("DELETE FROM fts_docs WHERE file_path = ?", (path,))
                    conn.execute("DELETE FROM file_hashes WHERE file_path = ?", (path,))
                    conn.execute("DELETE FROM vector_embeddings WHERE file_path = ?", (path,))
                    stats['deleted'] += 1
                except Exception as e:
                    stats['errors'] += 1

            conn.commit()
        finally:
            conn.close()

    print(f"[incremental-update] ✅ scanned={stats['scanned']}, new={stats['new']}, "
          f"updated={stats['updated']}, deleted={stats['deleted']}, "
          f"errors={stats['errors']}, vectors={stats['vectors']}")
    sys.exit(1 if stats['errors'] > 0 else 0)


if __name__ == '__main__':
    main()
