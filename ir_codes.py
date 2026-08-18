"""Local IR code capture/replay for the AC — an alternative to Tuya's cloud
"IR Control Hub" AC endpoint. A code is captured once per exact setting
(power on/off, a specific temperature, ...) via capture_ir_codes.py, then
replayed locally through the IR blaster's own local protocol — no cloud
call, no API quota cost. send_ac_command() in app.py checks here first and
only falls back to the cloud endpoint for a (code, value) pair that hasn't
been captured yet, so partial capture doesn't break anything."""
import json
from pathlib import Path

from tinytuya.Contrib.IRRemoteControlDevice import IRRemoteControlDevice

import facility_store

IR_CODES_PATH = Path(__file__).parent / "ir_codes.json"


def _key(code, value):
    return f"{code}:{value}"


def load_codes():
    if not IR_CODES_PATH.exists():
        return {}
    with open(IR_CODES_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def save_code(code, value, base64_code):
    codes = load_codes()
    codes[_key(code, value)] = base64_code
    with open(IR_CODES_PATH, "w", encoding="utf-8") as f:
        json.dump(codes, f, indent=2)


def has_code(code, value):
    return _key(code, value) in load_codes()


def get_code(code, value):
    return load_codes().get(_key(code, value))


def ir_blaster_sensor():
    facility = facility_store.load()
    sensor = next((s for s in facility["sensors"] if s["type"] == "ir"), None)
    if sensor is None:
        raise RuntimeError("No IR blaster sensor configured in facility.json")
    if not sensor.get("local_ip") or not sensor.get("local_key"):
        raise RuntimeError("IR blaster has no local_ip/local_key configured — set it via Settings first")
    return sensor


def connect():
    sensor = ir_blaster_sensor()
    return IRRemoteControlDevice(
        sensor["tuya_device_id"], sensor["local_ip"], sensor["local_key"],
        version=sensor.get("local_version") or 3.3,
    )


def send_locally(base64_code):
    """Replays a previously-captured IR code over the local network — no
    cloud call. Raises if the blaster's local connection isn't reachable
    (same failure mode as any other local device in this app — e.g. its IP
    can drift the same way the PIR sensor's does)."""
    connect().send_button(base64_code)
