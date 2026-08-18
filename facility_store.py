import json
import threading
import uuid
from pathlib import Path

FACILITY_PATH = Path(__file__).parent / "facility.json"
_lock = threading.Lock()


def load():
    with _lock:
        with open(FACILITY_PATH, "r", encoding="utf-8") as f:
            return json.load(f)


def save(data):
    with _lock:
        with open(FACILITY_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)


def new_id(prefix):
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def _is_sensor_alert(sensor, value, online):
    if sensor["type"] == "temperature" and sensor.get("thresholds") and value is not None:
        return value < sensor["thresholds"]["min"] or value > sensor["thresholds"]["max"]
    # A PIR sensor going offline is a real, actionable problem (it happens
    # whenever it loses its local WiFi connection) — worth flagging on the
    # dashboard. IR blasters/ACs are write-only and never show as "online"
    # in the first place, so they'd falsely alert forever if included here.
    if sensor["type"] == "pir" and sensor.get("tuya_device_id") and not online:
        return True
    return False


def build_dashboard_for_floor(floor_id, live_readings):
    """Join floors/rooms/residents/sensors + live_readings into render-ready
    per-floor data. Mirrors frontend/src/lib/buildDashboard.js."""
    facility = load()
    floor = next((f for f in facility["floors"] if f["id"] == floor_id), None)
    rooms_out = []

    for room in facility["rooms"]:
        if room["floor_id"] != floor_id:
            continue

        residents = [r for r in facility["residents"] if r["room_id"] == room["id"]]

        sensors_out = []
        for sensor in facility["sensors"]:
            if sensor["room_id"] != room["id"]:
                continue
            reading = live_readings.get(sensor["id"], {"online": False, "value": None})
            value = reading.get("value")
            online = reading.get("online", False)
            alert = _is_sensor_alert(sensor, value, online)
            sensors_out.append({**sensor, "value": value, "online": online, "alert": alert})

        room_has_alert = any(s["alert"] for s in sensors_out)
        residents_out = [{**r, "alert": room_has_alert} for r in residents]

        rooms_out.append({**room, "residents": residents_out, "sensors": sensors_out})

    return {"floor": floor, "rooms": rooms_out}


def add_sensor(payload):
    facility = load()
    sensor = {
        "id": new_id("sensor"),
        "room_id": payload["room_id"],
        "type": payload["type"],
        "name": payload["name"],
        "tuya_device_id": payload.get("tuya_device_id") or None,
        "position": payload.get("position", "inside"),
        "thresholds": payload.get("thresholds"),
        "unit": payload.get("unit"),
        "local_ip": payload.get("local_ip") or None,
        "local_key": payload.get("local_key") or None,
        "local_version": payload.get("local_version"),
    }
    facility["sensors"].append(sensor)
    save(facility)
    return sensor


def update_sensor(sensor_id, payload):
    facility = load()
    for sensor in facility["sensors"]:
        if sensor["id"] == sensor_id:
            sensor.update({k: v for k, v in payload.items() if k != "id"})
            save(facility)
            return sensor
    return None


def delete_sensor(sensor_id):
    facility = load()
    before = len(facility["sensors"])
    facility["sensors"] = [s for s in facility["sensors"] if s["id"] != sensor_id]
    save(facility)
    return len(facility["sensors"]) < before


def add_resident(payload):
    facility = load()
    resident = {
        "id": new_id("res"),
        "room_id": payload["room_id"],
        "name": payload["name"],
        "avatar_initials": payload.get("avatar_initials") or payload["name"][:2].upper(),
        "avatar_color": payload.get("avatar_color", "#3b82f6"),
    }
    facility["residents"].append(resident)
    save(facility)
    return resident


def update_resident(resident_id, payload):
    facility = load()
    for resident in facility["residents"]:
        if resident["id"] == resident_id:
            resident.update({k: v for k, v in payload.items() if k != "id"})
            save(facility)
            return resident
    return None


def delete_resident(resident_id):
    facility = load()
    before = len(facility["residents"])
    facility["residents"] = [r for r in facility["residents"] if r["id"] != resident_id]
    save(facility)
    return len(facility["residents"]) < before


def add_automation(payload):
    facility = load()
    automation = {
        "id": new_id("auto"),
        "name": payload["name"],
        "enabled": payload.get("enabled", True),
        "trigger_sensor_id": payload["trigger_sensor_id"],
        "trigger_condition": payload.get("trigger_condition", "motion_detected"),
        "no_motion_minutes": payload.get("no_motion_minutes"),
        "action_type": payload.get("action_type", "send_ir"),
        "action_ir_code": payload.get("action_ir_code"),
        "action_switch_state": payload.get("action_switch_state"),
        # A list of {"code": ..., "value": ...} so one rule can bundle multiple
        # AC settings together (e.g. power on + set temperature to 24 in the
        # same fire), instead of needing a separate rule per setting.
        "action_ac_commands": payload.get("action_ac_commands") or [],
    }
    facility.setdefault("automations", []).append(automation)
    save(facility)
    return automation


def update_automation(automation_id, payload):
    facility = load()
    for automation in facility.get("automations", []):
        if automation["id"] == automation_id:
            automation.update({k: v for k, v in payload.items() if k != "id"})
            save(facility)
            return automation
    return None


def delete_automation(automation_id):
    facility = load()
    before = len(facility.get("automations", []))
    facility["automations"] = [a for a in facility.get("automations", []) if a["id"] != automation_id]
    save(facility)
    return len(facility["automations"]) < before


def get_mqtt_config():
    return load().get("mqtt", {})


def update_mqtt_config(payload):
    facility = load()
    facility["mqtt"] = {**facility.get("mqtt", {}), **payload}
    save(facility)
    return facility["mqtt"]
