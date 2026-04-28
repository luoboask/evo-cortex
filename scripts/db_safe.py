#!/usr/bin/env python3
"""db_safe.py - Safe database connection helper with try/finally protection.

Usage:
    with safe_connect(db_path) as conn:
        cursor = conn.cursor()
        # ... operations ...
        # conn.close() is automatic in finally
"""

import sqlite3
from contextlib import contextmanager


@contextmanager
def safe_connect(db_path):
    """Context manager for safe SQLite connections.
    
    Usage:
        with safe_connect(path) as conn:
            cursor = conn.cursor()
            cursor.execute(...)
            conn.commit()
            # No need for conn.close() - handled in finally
    """
    conn = sqlite3.connect(str(db_path))
    try:
        yield conn
    finally:
        conn.close()
