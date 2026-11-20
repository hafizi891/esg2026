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


if __name__ == "__main__":
    unittest.main()
