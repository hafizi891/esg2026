import unittest
from pathlib import Path

ROOT = Path(__file__).parents[1] / "cloud" / "frontend" / "src"


class ESGExecutiveUITests(unittest.TestCase):
    def test_executive_overview_contains_reporting_and_proxy_disclosures(self):
        page = (ROOT / "pages" / "Analytics.jsx").read_text()
        for text in (
            "Executive overview",
            "Operational efficiency",
            "Automation interventions",
            "Download CSV",
            "not kWh or CO₂e",
        ):
            self.assertIn(text, page)

    def test_navigation_separates_esg_overview_from_live_monitoring(self):
        app = (ROOT / "App.jsx").read_text()
        self.assertIn("ESG Overview", app)
        self.assertIn("Live Monitoring", app)
        self.assertIn('path="/monitoring"', app)
        self.assertIn('<Route path="/" element={<Analytics />}', app)

    def test_offline_ac_is_never_presented_as_live_or_running(self):
        status = (ROOT / "lib" / "roomStatus.js").read_text()
        panel = (ROOT / "components" / "RoomStatusPanel.jsx").read_text()
        dashboard = (ROOT / "pages" / "Dashboard.jsx").read_text()
        self.assertIn("acStatus?.online && acStatus.power === '1'", status)
        self.assertIn("Last known", status)
        self.assertIn("Status unavailable", panel)
        self.assertIn("Last reported by the ESP8266", panel)
        self.assertIn("acStatus?.online && acStatus?.power === '1'", dashboard)


if __name__ == "__main__":
    unittest.main()
