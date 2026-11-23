import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).parents[1] / "cloud"))
_tmp = tempfile.mkdtemp()
os.environ.update(
    CLOUD_DASHBOARD_PASSWORD="pw",
    MQTT_BROKER_HOST="127.0.0.1",
    MQTT_BROKER_PORT="1",  # nothing listens; the background subscriber just retries
    MQTT_USERNAME="u",
    MQTT_PASSWORD="p",
    ESG_ANALYTICS_PATH=str(Path(_tmp) / "esg.db"),
)
import cloud_app  # noqa: E402


class HealthTests(unittest.TestCase):
    def setUp(self):
        self.client = cloud_app.app.test_client()

    def test_healthy_when_connected_and_recent(self):
        with mock.patch.dict(cloud_app.mqtt_status, connected=True, last_message_at=time.time() - 5):
            self.assertEqual(self.client.get("/api/health").status_code, 200)

    def test_unhealthy_when_board_silent(self):
        with mock.patch.dict(cloud_app.mqtt_status, connected=True, last_message_at=time.time() - 3_600):
            self.assertEqual(self.client.get("/api/health").status_code, 503)

    def test_settings_cannot_be_changed_from_the_browser(self):
        self.client.post("/api/login", json={"password": "pw"})
        self.assertEqual(self.client.put("/api/mqtt", json={"broker_host": "evil"}).status_code, 405)


class BoardAlertTests(unittest.TestCase):
    def test_alerts_only_on_real_change(self):
        with mock.patch.object(cloud_app, "send_telegram") as send:
            cloud_app.alert_on_board_status(None, {"online": False})  # first status after restart
            cloud_app.alert_on_board_status(True, {"online": True})  # no change
            send.assert_not_called()
            cloud_app.alert_on_board_status(True, {"online": False})
            send.assert_called_once_with("ESP board went OFFLINE")


if __name__ == "__main__":
    unittest.main()
