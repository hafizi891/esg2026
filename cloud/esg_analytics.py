"""Persistent operational metrics derived from ESP8266 MQTT events.

These are ESG-relevant usage proxies, not utility-grade energy or carbon data.
"""

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


class AnalyticsStore:
    def __init__(self, path):
        self.path = str(path)
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as db:
            db.execute(
                """CREATE TABLE IF NOT EXISTS esg_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp REAL NOT NULL,
                    kind TEXT NOT NULL,
                    data TEXT NOT NULL
                )"""
            )
            db.execute("CREATE INDEX IF NOT EXISTS idx_esg_events_time ON esg_events(timestamp)")

    def _connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.execute("PRAGMA journal_mode=WAL")
        return db

    def record(self, kind, timestamp, **data):
        if kind not in {"sound", "motion", "ac"}:
            raise ValueError("Unsupported analytics event")
        with self._connect() as db:
            db.execute(
                "INSERT INTO esg_events(timestamp, kind, data) VALUES (?, ?, ?)",
                (float(timestamp), kind, json.dumps(data, separators=(",", ":"))),
            )

    def summary(self, start, end):
        start, end = float(start), float(end)
        if end <= start:
            raise ValueError("End must be after start")
        with self._connect() as db:
            rows = db.execute(
                "SELECT timestamp, kind, data FROM esg_events WHERE timestamp < ? ORDER BY timestamp, id",
                (end,),
            ).fetchall()

        events = [(ts, kind, json.loads(data)) for ts, kind, data in rows]
        in_period = [(ts, kind, data) for ts, kind, data in events if ts >= start]
        sounds = [data["level"] for _, kind, data in in_period if kind == "sound" and isinstance(data.get("level"), (int, float))]

        motion_seconds = self._binary_duration(events, "motion", "active", start, end)
        ac_seconds, temperature_seconds = self._ac_duration(events, start, end)
        motion_events = sum(1 for _, kind, data in in_period if kind == "motion" and data.get("active") is True)

        daily = []
        first_day = int(start // 86400) * 86400
        day_start = first_day
        while day_start < end:
            day_end = min(day_start + 86400, end)
            day_events = [(ts, kind, data) for ts, kind, data in in_period if day_start <= ts < day_end]
            day_sounds = [data["level"] for _, kind, data in day_events if kind == "sound" and isinstance(data.get("level"), (int, float))]
            daily.append({
                "date": datetime.fromtimestamp(day_start, timezone.utc).date().isoformat(),
                "sound_events": len(day_sounds),
                "peak_sound_level": max(day_sounds) if day_sounds else None,
                "motion_events": sum(1 for _, kind, data in day_events if kind == "motion" and data.get("active") is True),
                "motion_active_seconds": round(self._binary_duration(events, "motion", "active", max(start, day_start), day_end), 3),
                "ac_runtime_seconds": round(self._ac_duration(events, max(start, day_start), day_end)[0], 3),
            })
            day_start += 86400

        efficient_seconds = sum(seconds for temperature, seconds in temperature_seconds.items() if float(temperature) >= 24)
        automatic_shutdowns = sum(
            1 for _, kind, data in in_period
            if kind == "ac" and data.get("power") is False and str(data.get("source", "")).startswith("AUTO_")
        )
        temperature_transitions = sum(
            1 for _, kind, data in in_period
            if kind == "ac" and data.get("power") is True and str(data.get("source", "")).startswith("AUTO_")
        )

        return {
            "period": {"start": start, "end": end},
            "sound": {
                "events": len(sounds),
                "average_level": round(sum(sounds) / len(sounds), 1) if sounds else None,
                "peak_level": max(sounds) if sounds else None,
                "measurement": "A0 peak-to-peak amplitude over 50 ms",
            },
            "motion": {"events": motion_events, "active_seconds": round(motion_seconds, 3)},
            "ac": {
                "runtime_seconds": round(ac_seconds, 3),
                "temperature_seconds": {str(k): round(v, 3) for k, v in sorted(temperature_seconds.items())},
                "efficient_setpoint_share_percent": round(efficient_seconds / ac_seconds * 100, 1) if ac_seconds else 0,
                "metric_note": "Runtime proxy only; not electrical energy (kWh) or CO2e.",
            },
            "automation": {
                "automatic_shutdowns": automatic_shutdowns,
                "temperature_transitions": temperature_transitions,
                "interventions": automatic_shutdowns + temperature_transitions,
            },
            "daily": daily,
        }

    @staticmethod
    def _binary_duration(events, kind, field, start, end):
        active = False
        cursor = start
        total = 0.0
        for ts, event_kind, data in events:
            if event_kind != kind or field not in data:
                continue
            if ts < start:
                active = bool(data[field])
                continue
            if ts >= end:
                break
            if active:
                total += ts - cursor
            active = bool(data[field])
            cursor = ts
        if active:
            total += end - cursor
        return max(0.0, total)

    @staticmethod
    def _ac_duration(events, start, end):
        on = False
        temperature = None
        cursor = start
        total = 0.0
        by_temperature = {}
        for ts, kind, data in events:
            if kind != "ac" or "power" not in data:
                continue
            if ts < start:
                on = bool(data["power"])
                if data.get("temperature") is not None:
                    temperature = data["temperature"]
                continue
            if ts >= end:
                break
            if on:
                duration = ts - cursor
                total += duration
                if temperature is not None:
                    by_temperature[temperature] = by_temperature.get(temperature, 0.0) + duration
            on = bool(data["power"])
            if data.get("temperature") is not None:
                temperature = data["temperature"]
            cursor = ts
        if on:
            duration = end - cursor
            total += duration
            if temperature is not None:
                by_temperature[temperature] = by_temperature.get(temperature, 0.0) + duration
        return max(0.0, total), by_temperature
