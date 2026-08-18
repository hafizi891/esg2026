import json
import sqlite3
import time
from pathlib import Path

DB_PATH = Path(__file__).parent / "readings.db"

DEFAULT_WINDOW_SECONDS = 24 * 60 * 60  # 24h, used when `since` isn't provided


def _connect():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS readings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sensor_id TEXT NOT NULL,
            timestamp REAL NOT NULL,
            value TEXT,
            online INTEGER
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_readings_sensor_time
        ON readings(sensor_id, timestamp)
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS automation_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            automation_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            success INTEGER NOT NULL,
            timestamp REAL NOT NULL
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_automation_events_automation_time
        ON automation_events(automation_id, timestamp)
    """)
    return conn


def log_reading(sensor_id, value, online):
    conn = _connect()
    try:
        conn.execute(
            "INSERT INTO readings (sensor_id, timestamp, value, online) VALUES (?, ?, ?, ?)",
            (sensor_id, time.time(), json.dumps(value), 1 if online else 0),
        )
        conn.commit()
    finally:
        conn.close()


def log_automation_event(automation_id, event_type, success):
    conn = _connect()
    try:
        conn.execute(
            "INSERT INTO automation_events (automation_id, event_type, success, timestamp) VALUES (?, ?, ?, ?)",
            (automation_id, event_type, 1 if success else 0, time.time()),
        )
        conn.commit()
    finally:
        conn.close()


def get_automation_events(automation_id, since=None):
    if since is None:
        since = time.time() - DEFAULT_WINDOW_SECONDS

    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT event_type, success, timestamp FROM automation_events "
            "WHERE automation_id = ? AND timestamp >= ? ORDER BY timestamp ASC",
            (automation_id, since),
        ).fetchall()
    finally:
        conn.close()

    return [{"event_type": et, "success": bool(s), "timestamp": ts} for et, s, ts in rows]


def get_all_automation_events(since=None, limit=200):
    """Cross-automation fire history for a log view — most recent first."""
    if since is None:
        since = time.time() - DEFAULT_WINDOW_SECONDS

    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT automation_id, event_type, success, timestamp FROM automation_events "
            "WHERE timestamp >= ? ORDER BY timestamp DESC LIMIT ?",
            (since, limit),
        ).fetchall()
    finally:
        conn.close()

    return [
        {"automation_id": aid, "event_type": et, "success": bool(s), "timestamp": ts}
        for aid, et, s, ts in rows
    ]


def get_readings(sensor_id, since=None):
    if since is None:
        since = time.time() - DEFAULT_WINDOW_SECONDS

    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT timestamp, value, online FROM readings "
            "WHERE sensor_id = ? AND timestamp >= ? ORDER BY timestamp ASC",
            (sensor_id, since),
        ).fetchall()
    finally:
        conn.close()

    return [
        {"timestamp": ts, "value": json.loads(value) if value is not None else None, "online": bool(online)}
        for ts, value, online in rows
    ]
