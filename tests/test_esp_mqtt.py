import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "cloud"))

from esp_mqtt import apply_esp_message, subscription_topic


class EspMqttTests(unittest.TestCase):
    def test_topics_use_esp_device_base(self):
        base = "devices/esp-prototype-01"
        self.assertEqual(subscription_topic(base), "devices/esp-prototype-01/#")

    def test_online_status_marks_device_online(self):
        state = {}
        events = apply_esp_message(state, "devices/esp-prototype-01/status", b"online", 100.0)
        expected = {"id": "sensor-device", "online": True, "value": "online", "timestamp": 100.0, "changed_at": 100.0}
        self.assertEqual(state["sensor-device"], expected)
        self.assertTrue(state["sensor-pir"]["online"])
        self.assertTrue(state["sensor-mic"]["online"])
        self.assertTrue(state["sensor-ir"]["online"])
        self.assertEqual(events[0], ("sensor_update", expected))

    def test_motion_payload_maps_to_pir_sensor(self):
        state = {}
        events = apply_esp_message(state, "devices/esp-prototype-01/motion", b'{"motion":true}', 101.0)
        self.assertEqual(state["sensor-pir"]["value"], "pir")
        self.assertTrue(state["sensor-pir"]["online"])
        self.assertEqual(events[0][0], "sensor_update")

    def test_status_message_keeps_last_real_change_time(self):
        state = {}
        apply_esp_message(state, "devices/esp-prototype-01/motion", b'{"motion":true}', 101.0)
        apply_esp_message(state, "devices/esp-prototype-01/status", b"online", 150.0)
        self.assertEqual(state["sensor-pir"]["timestamp"], 150.0)
        self.assertEqual(state["sensor-pir"]["changed_at"], 101.0)

    def test_sound_payload_maps_level_and_activity(self):
        state = {}
        apply_esp_message(state, "devices/esp-prototype-01/sound", b'{"sound":true,"level":24}', 102.0)
        self.assertEqual(state["sensor-mic"]["value"], 24)
        self.assertTrue(state["sensor-mic"]["active"])
        self.assertEqual(state["sensor-mic"]["measurement"], "peak_to_peak_50ms")
        self.assertEqual(state["sensor-mic"]["event"], "sound_detected")

    def test_sound_payload_requires_numeric_level(self):
        state = {}
        self.assertEqual(
            apply_esp_message(
                state,
                "devices/esp-prototype-01/sound",
                b'{"sound":true,"level":"loud"}',
                102.0,
            ),
            [],
        )
        self.assertEqual(state, {})

    def test_ir_payload_maps_last_ir_event(self):
        state = {}
        apply_esp_message(state, "devices/esp-prototype-01/ir", b'{"source":"MOTION","command":"switch_robot"}', 103.0)
        self.assertEqual(state["sensor-ir"]["value"], "switch_robot")
        self.assertEqual(state["sensor-ir"]["source"], "MOTION")

    def test_aircon_ir_events_update_aircon_state(self):
        state = {}
        events = apply_esp_message(
            state,
            "devices/esp-prototype-01/ir",
            b'{"source":"MQTT","command":"aircon_18"}',
            103.0,
        )
        self.assertEqual(state["sensor-ac"]["power"], "1")
        self.assertEqual(state["sensor-ac"]["temp"], 18)
        self.assertEqual(events[-1][0], "device_status_update")

        apply_esp_message(
            state,
            "devices/esp-prototype-01/ir",
            b'{"source":"AUTO_10_SEC","command":"aircon_27"}',
            104.0,
        )
        self.assertEqual(state["sensor-ac"]["temp"], 27)

        apply_esp_message(
            state,
            "devices/esp-prototype-01/ir",
            b'{"source":"AUTO_INACTIVITY","command":"aircon_off"}',
            105.0,
        )
        self.assertEqual(state["sensor-ac"]["power"], "0")

    def test_new_temperature_and_fan_ir_event_updates_aircon_state(self):
        state = {}
        events = apply_esp_message(
            state,
            "devices/esp-prototype-01/ir",
            b'{"source":"AUTO_10_SEC","command":"aircon_26_low"}',
            106.0,
        )
        self.assertEqual(state["sensor-ac"]["power"], "1")
        self.assertEqual(state["sensor-ac"]["temp"], 26)
        self.assertEqual(state["sensor-ac"]["fan"], "low")
        self.assertEqual(state["sensor-ac"]["last_command"], "aircon_26_low")
        self.assertTrue(any(name == "device_status_update" for name, _ in events))

    def test_unknown_or_malformed_topic_is_ignored(self):
        state = {}
        self.assertEqual(apply_esp_message(state, "devices/another-device/motion", b'{"motion":true}', 104.0), [])
        self.assertEqual(apply_esp_message(state, "devices/esp-prototype-01/motion", b'not-json', 104.0), [])
        self.assertEqual(state, {})

    def test_offline_status_marks_all_known_esp_sensors_offline(self):
        state = {
            "sensor-device": {"id": "sensor-device", "online": True, "value": "online"},
            "sensor-pir": {"id": "sensor-pir", "online": True, "value": "pir"},
            "sensor-mic": {"id": "sensor-mic", "online": True, "value": 24},
            "sensor-ir": {"id": "sensor-ir", "online": True, "value": "switch_robot"},
        }
        apply_esp_message(state, "devices/esp-prototype-01/status", b"offline", 105.0)
        self.assertTrue(all(item["online"] is False for item in state.values()))
        self.assertEqual(state["sensor-device"]["value"], "offline")

if __name__ == "__main__":
    unittest.main()
