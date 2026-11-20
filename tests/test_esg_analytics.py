import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "cloud"))

from esg_analytics import AnalyticsStore


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

    def test_open_activity_intervals_are_capped_at_period_end(self):
        self.store.record("motion", 100, active=True)
        self.store.record("ac", 200, power=True, temperature=26, fan="low")
        result = self.store.summary(0, 500)
        self.assertEqual(result["motion"]["active_seconds"], 400)
        self.assertEqual(result["ac"]["runtime_seconds"], 300)

    def test_daily_trend_contains_zero_days_and_event_totals(self):
        day = 86_400
        self.store.record("sound", day + 10, level=50)
        self.store.record("motion", day + 20, active=True)
        self.store.record("motion", day + 50, active=False)
        result = self.store.summary(0, day * 3)
        self.assertEqual(len(result["daily"]), 3)
        self.assertEqual(result["daily"][1]["sound_events"], 1)
        self.assertEqual(result["daily"][1]["motion_events"], 1)


if __name__ == "__main__":
    unittest.main()
