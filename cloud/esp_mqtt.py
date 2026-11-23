"""Translate the ESP8266's MQTT topic contract into dashboard sensor state."""

import json
import re

ESP_SENSOR_IDS = ("sensor-device", "sensor-pir", "sensor-mic", "sensor-ir", "sensor-ac")


def _base(value):
    return value.rstrip("/")


def subscription_topic(topic_base):
    return f"{_base(topic_base)}/#"


def _update(state, sensor_id, now, **fields):
    # changed_at moves only on a real reading; status messages refresh timestamp but keep it.
    reading = {"id": sensor_id, "online": True, "timestamp": now, "changed_at": now, **fields}
    state[sensor_id] = reading
    return ("sensor_update", reading)


def apply_esp_message(state, topic, payload_bytes, now, topic_base="devices/esp-prototype-01"):
    """Apply one ESP message and return SSE events as ``(name, payload)`` tuples."""
    prefix = f"{_base(topic_base)}/"
    if not topic.startswith(prefix):
        return []
    leaf = topic[len(prefix):]
    if "/" in leaf or leaf not in {"status", "motion", "sound", "ir"}:
        return []

    try:
        raw = payload_bytes.decode("utf-8").strip()
    except UnicodeDecodeError:
        return []

    if leaf == "status":
        if raw not in {"online", "offline"}:
            return []
        online = raw == "online"
        event = _update(state, "sensor-device", now, online=online, value=raw)
        events = [event]
        for sensor_id in ESP_SENSOR_IDS[1:]:
            previous = state.get(sensor_id, {})
            reading = {**previous, "id": sensor_id, "online": online, "timestamp": now}
            state[sensor_id] = reading
            events.append(("sensor_update", reading))
        return events

    try:
        payload = json.loads(raw)
    except (TypeError, ValueError):
        return []
    if not isinstance(payload, dict):
        return []

    if leaf == "motion" and isinstance(payload.get("motion"), bool):
        value = "pir" if payload["motion"] else "none"
        return [_update(state, "sensor-pir", now, value=value, motion=payload["motion"])]
    if (
        leaf == "sound"
        and payload.get("sound") is True
        and isinstance(payload.get("level"), (int, float))
        and not isinstance(payload.get("level"), bool)
    ):
        # Firmware publishes only threshold-crossing events. ``level`` is the
        # A0 peak-to-peak amplitude measured over its 50 ms sample window; it
        # is not a continuous dB reading and no explicit quiet event follows.
        return [
            _update(
                state,
                "sensor-mic",
                now,
                value=payload["level"],
                active=True,
                event="sound_detected",
                measurement="peak_to_peak_50ms",
            )
        ]
    if leaf == "ir" and payload.get("command"):
        command = payload["command"]
        events = [_update(state, "sensor-ir", now, value=command, source=payload.get("source"))]
        # Firmware reports confirmed AC actions as:
        #   aircon_off
        #   aircon_<temperature>
        #   aircon_<temperature>_<fan-speed>
        # Parse the reported parameters instead of maintaining a fixed list of
        # temperatures, so the dashboard follows the device's MQTT contract.
        ac_match = re.fullmatch(r"aircon_(\d{1,2})(?:_([a-z0-9-]+))?", str(command))
        if command == "aircon_off" or ac_match:
            previous = state.get("sensor-ac", {})
            reading = {
                **previous,
                "id": "sensor-ac",
                "online": True,
                "timestamp": now,
                "changed_at": now,
                "power": "0" if command == "aircon_off" else "1",
                "temp": previous.get("temp") if command == "aircon_off" else int(ac_match.group(1)),
                "source": payload.get("source"),
                "last_command": command,
            }
            if ac_match and ac_match.group(2):
                reading["fan"] = ac_match.group(2)
            state["sensor-ac"] = reading
            events.append(("sensor_update", reading))
            events.append(("device_status_update", {"device": "ac", "status": reading}))
        return events
    return []
