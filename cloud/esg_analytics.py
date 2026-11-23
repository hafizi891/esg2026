"""Persistent operational metrics derived from ESP8266 MQTT events.

These are ESG-relevant usage proxies, not utility-grade energy or carbon data.
"""

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

# shortcut: fixed UTC+8 (Malaysia, no DST) for report day boundaries; make it configurable if deployed elsewhere.
REPORT_TZ = timezone(timedelta(hours=8))
_TZ_OFFSET = 8 * 3600


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
            db.execute("CREATE INDEX IF NOT EXISTS idx_esg_events_kind_time ON esg_events(kind, timestamp)")

    @contextmanager
    def _connect(self):
        # sqlite3's own `with` only commits; it never closes, which leaked a handle per call.
        db = sqlite3.connect(self.path, timeout=10)
        try:
            db.execute("PRAGMA journal_mode=WAL")
            with db:
                yield db
        finally:
            db.close()

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
            # Durations only need the last motion/AC state before the period, not all history.
            rows = []
            for kind in ("motion", "ac"):
                rows += db.execute(
                    "SELECT timestamp, kind, data FROM esg_events WHERE kind = ? AND timestamp < ? "
                    "ORDER BY timestamp DESC, id DESC LIMIT 1",
                    (kind, start),
                ).fetchall()
            rows += db.execute(
                "SELECT timestamp, kind, data FROM esg_events WHERE timestamp >= ? AND timestamp < ? ORDER BY timestamp, id",
                (start, end),
            ).fetchall()

        events = [(ts, kind, json.loads(data)) for ts, kind, data in rows]
        state_events = [e for e in events if e[1] in ("motion", "ac")]
        in_period = [(ts, kind, data) for ts, kind, data in events if ts >= start]
        sounds = [data["level"] for _, kind, data in in_period if kind == "sound" and isinstance(data.get("level"), (int, float))]

        motion_seconds = self._binary_duration(state_events, "motion", "active", start, end)
        ac_seconds, temperature_seconds = self._ac_duration(state_events, start, end)
        motion_events = sum(1 for _, kind, data in in_period if kind == "motion" and data.get("active") is True)

        # Days run midnight-to-midnight in REPORT_TZ; bucket events in one pass.
        first_day = (start + _TZ_OFFSET) // 86400 * 86400 - _TZ_OFFSET
        buckets = {}
        for ts, kind, data in in_period:
            buckets.setdefault(first_day + (ts - first_day) // 86400 * 86400, []).append((kind, data))

        daily = []
        day_start = first_day
        while day_start < end:
            day_end = min(day_start + 86400, end)
            day_events = buckets.get(day_start, [])
            day_sounds = [data["level"] for kind, data in day_events if kind == "sound" and isinstance(data.get("level"), (int, float))]
            daily.append({
                "date": datetime.fromtimestamp(day_start, REPORT_TZ).date().isoformat(),
                "sound_events": len(day_sounds),
                "peak_sound_level": max(day_sounds) if day_sounds else None,
                "motion_events": sum(1 for kind, data in day_events if kind == "motion" and data.get("active") is True),
                "motion_active_seconds": round(self._binary_duration(state_events, "motion", "active", max(start, day_start), day_end), 3),
                "ac_runtime_seconds": round(self._ac_duration(state_events, max(start, day_start), day_end)[0], 3),
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


def record_esp_events(store, topic, events, now):
    """Store the analytics-relevant readings from one apply_esp_message() result."""
    readings = {payload.get("id"): payload for _, payload in events}
    leaf = topic.rsplit("/", 1)[-1]
    if leaf == "sound" and "sensor-mic" in readings:
        store.record("sound", now, level=readings["sensor-mic"]["value"])
    elif leaf == "motion" and "sensor-pir" in readings:
        store.record("motion", now, active=readings["sensor-pir"]["motion"])
    elif leaf == "status" and readings.get("sensor-device", {}).get("online") is False:
        # A dropped board never sends "motion: false" or "aircon_off"; close open intervals.
        # AC state is unknown while offline (power None), so it stops counting as runtime.
        store.record("motion", now, active=False)
        store.record("ac", now, power=None, source="DEVICE_OFFLINE")
    elif leaf == "ir" and "sensor-ac" in readings:
        reading = readings["sensor-ac"]
        store.record(
            "ac", now,
            power=reading.get("power") == "1",
            temperature=reading.get("temp"),
            fan=reading.get("fan"),
            source=reading.get("source"),
        )
