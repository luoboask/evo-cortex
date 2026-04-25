#!/bin/bash
# Initialize evo-cortex database schema
set -e

DATA_DIR="$1"
if [ -z "$DATA_DIR" ]; then
  # Default: find data directory
  WORKSPACE_DIR="${2:-}"
  AGENT_ID="${3:-cortex-test-agent}"
  if [ -z "$WORKSPACE_DIR" ]; then
    WORKSPACE_DIR="$HOME/.openclaw/workspace-$AGENT_ID"
  fi
  DATA_DIR="$WORKSPACE_DIR/data/$AGENT_ID"
fi

mkdir -p "$DATA_DIR"
DB_PATH="$DATA_DIR/cortex.db"

echo "📦 Initializing evo-cortex database at: $DB_PATH"

sqlite3 "$DB_PATH" << 'SQL'
-- Working Memory: short-term conversation context (2h TTL)
CREATE TABLE IF NOT EXISTS working_memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL DEFAULT 'default',
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  message_count INTEGER DEFAULT 1
);

-- Index for fast working memory queries
CREATE INDEX IF NOT EXISTS idx_working_session ON working_memory(session_id);
CREATE INDEX IF NOT EXISTS idx_working_expires ON working_memory(expires_at);

-- Session messages: persistent conversation log
CREATE TABLE IF NOT EXISTS session_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,  -- 'user' or 'assistant'
  content TEXT NOT NULL,
  tool TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  message_index INTEGER
);
CREATE INDEX IF NOT EXISTS idx_session_id ON session_messages(session_id);

-- User preferences (already exists but ensure schema)
CREATE TABLE IF NOT EXISTS preferences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  source TEXT,
  confidence REAL DEFAULT 0.5,
  extracted_at TEXT DEFAULT (datetime('now')),
  confirmed INTEGER DEFAULT 0,
  UNIQUE(category, key)
);

-- Scan log (already exists but ensure schema)
CREATE TABLE IF NOT EXISTS scan_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scanned_at TEXT DEFAULT (datetime('now')),
  files_scanned INTEGER,
  new_entries INTEGER,
  updated_entries INTEGER,
  duration_ms INTEGER
);

-- Embedding cache: store computed embeddings to avoid re-calling API
CREATE TABLE IF NOT EXISTS embedding_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text_hash TEXT NOT NULL UNIQUE,
  embedding TEXT NOT NULL,  -- JSON array
  dimensions INTEGER,
  source TEXT DEFAULT 'dashscope',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_embedding_hash ON embedding_cache(text_hash);

-- Memory index: track which memories have embeddings
CREATE TABLE IF NOT EXISTS memory_embeddings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  embedding_source TEXT DEFAULT 'dashscope',
  dimensions INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_memory_id ON memory_embeddings(memory_id);
SQL

echo "✅ Database initialized"
sqlite3 "$DB_PATH" ".tables"
