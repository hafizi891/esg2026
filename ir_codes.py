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


def needed_pairs():
    """Every distinct (code, value) an ac_command automation actually sends —
    the full set capture_ir_codes.py needs to walk through, and what a
    "N of M captured" status readout is measured against."""
    facility = facility_store.load()
    pairs = set()
    for automation in facility.get("automations", []):
        if automation.get("action_type") != "ac_command":
            continue
        for cmd in automation.get("action_ac_commands") or []:
            pairs.add((cmd.get("code"), cmd.get("value")))
    return sorted(pairs, key=lambda p: (str(p[0]), str(p[1])))


def capture_status():
    pairs = needed_pairs()
    captured = sum(1 for code, value in pairs if has_code(code, value))
    return {"captured": captured, "needed": len(pairs)}


# The full set of buttons the dashboard's manual AC remote (AcRemoteModal.jsx)
# can send — same MODES/FAN_SPEEDS/temperature range as that component, kept
# in sync by hand since one's Python and the other's JS. This is deliberately
# broader than needed_pairs(): capturing this whole set means manual control
# from the dashboard goes local too, not just whatever your automations
# happen to reference.
FULL_MODES = [0, 1, 2, 3, 4]  # Cool, Heat, Auto, Fan, Dry
FULL_FAN_SPEEDS = [0, 1, 2, 3]  # Auto, Low, Medium, High
FULL_TEMP_RANGE = range(16, 31)  # 16-30°C inclusive


def full_remote_pairs():
    """Every button on the real remote worth capturing: both power states,
    every mode, every fan speed, and the entire temperature range — not just
    whatever a handful of automations happen to use."""
    pairs = [("PowerOn", "PowerOn"), ("PowerOff", "PowerOff")]
    pairs += [("M", m) for m in FULL_MODES]
    pairs += [("F", f) for f in FULL_FAN_SPEEDS]
    pairs += [("T", t) for t in FULL_TEMP_RANGE]
    return pairs


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
