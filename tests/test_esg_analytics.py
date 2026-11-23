import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "cloud"))

from esg_analytics import AnalyticsStore, record_esp_events
from esp_mqtt import apply_esp_message


class ESGAnalyticsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = AnalyticsStore(Path(self.tmp.name) / "analytics.db")

    def tearDown(self):
        self.tmp.cleanup()

    def test_summary_reports_sound_motion_and_ac_operational_metrics(self):
        base = 1_700_000_000
        self.store.record("sound", base + 10, level=40)
        self.store.record("sound", base + 20, level=80)
        self.store.record("motion", base + 30, active=True)
        self.store.record("motion", base + 90, active=False)
        self.store.record("ac", base + 100, power=True, temperature=18, fan="turbo", source="MOTION")
        self.store.record("ac", base + 700, power=True, temperature=26, fan="low", source="AUTO_1_MIN")
        self.store.record("ac", base + 1_000, power=False, source="AUTO_INACTIVITY_40S")

        result = self.store.summary(base, base + 1_200)

        self.assertEqual(result["sound"]["events"], 2)
        self.assertEqual(result["sound"]["average_level"], 60)
        self.assertEqual(result["sound"]["peak_level"], 80)
        self.assertEqual(result["motion"]["events"], 1)
        self.assertEqual(result["motion"]["active_seconds"], 60)
        self.assertEqual(result["ac"]["runtime_seconds"], 900)
        self.assertEqual(result["ac"]["temperature_seconds"]["18"], 600)
        self.assertEqual(result["ac"]["temperature_seconds"]["26"], 300)
        self.assertEqual(result["ac"]["efficient_setpoint_share_percent"], 33.3)
        self.assertEqual(result["automation"]["automatic_shutdowns"], 1)
        self.assertEqual(result["automation"]["temperature_transitions"], 1)

    def test_connections_are_closed_after_use(self):
        with self.store._connect() as db:
            pass
        with self.assertRaises(sqlite3.ProgrammingError):
            db.execute("SELECT 1")

    def test_open_activity_intervals_are_capped_at_period_end(self):
        self.store.record("motion", 100, active=True)
        self.store.record("ac", 200, power=True, temperature=26, fan="low")
        result = self.store.summary(0, 500)
        self.assertEqual(result["motion"]["active_seconds"], 400)
        self.assertEqual(result["ac"]["runtime_seconds"], 300)

    def test_daily_trend_contains_zero_days_and_event_totals(self):
        day = 86_400
        midnight = -8 * 3600  # 1970-01-01 00:00 in UTC+8
        self.store.record("sound", midnight + day + 10, level=50)
        self.store.record("motion", midnight + day + 20, active=True)
        self.store.record("motion", midnight + day + 50, active=False)
        result = self.store.summary(midnight, midnight + day * 3)
        self.assertEqual(len(result["daily"]), 3)
        self.assertEqual(result["daily"][1]["sound_events"], 1)
        self.assertEqual(result["daily"][1]["motion_events"], 1)

    def test_days_follow_malaysia_midnight_not_utc(self):
        # 2026-11-23 23:30 UTC is 2026-11-24 07:30 in Malaysia.
        ts = 1_795_476_600
        self.store.record("sound", ts, level=10)
        result = self.store.summary(ts - 3_600, ts + 3_600)
        row = next(r for r in result["daily"] if r["sound_events"])
        self.assertEqual(row["date"], "2026-11-24")

    def test_history_before_period_only_sets_starting_state(self):
        self.store.record("sound", 50, level=99)
        self.store.record("motion", 60, active=True)
        result = self.store.summary(100, 200)
        self.assertEqual(result["sound"]["events"], 0)
        self.assertEqual(result["motion"]["active_seconds"], 100)


class RecordEspEventsTests(unittest.TestCase):
    PREFIX = "devices/esp-prototype-01"

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = AnalyticsStore(Path(self.tmp.name) / "analytics.db")
        self.state = {}

    def tearDown(self):
        self.tmp.cleanup()

    def feed(self, leaf, payload, now):
        topic = f"{self.PREFIX}/{leaf}"
        record_esp_events(self.store, topic, apply_esp_message(self.state, topic, payload, now, self.PREFIX), now)

    def test_esp_messages_become_analytics_rows(self):
        self.feed("sound", b'{"sound": true, "level": 42}', 10)
        self.feed("motion", b'{"motion": true}', 20)
        self.feed("ir", b'{"command": "aircon_26_low", "source": "MOTION"}', 30)
        result = self.store.summary(0, 100)
        self.assertEqual(result["sound"]["events"], 1)
        self.assertEqual(result["motion"]["events"], 1)
        self.assertEqual(result["ac"]["temperature_seconds"], {"26": 70})

    def test_board_going_offline_ends_motion(self):
        self.feed("motion", b'{"motion": true}', 10)
        self.feed("status", b"offline", 40)
        self.assertEqual(self.store.summary(0, 1_000)["motion"]["active_seconds"], 30)

    def test_board_going_offline_stops_ac_runtime(self):
        self.feed("ir", b'{"command": "aircon_25_low", "source": "MOTION"}', 10)
        self.feed("status", b"offline", 110)
        result = self.store.summary(0, 1_000)
        self.assertEqual(result["ac"]["runtime_seconds"], 100)
        self.assertEqual(result["automation"]["automatic_shutdowns"], 0)


if __name__ == "__main__":
    unittest.main()
