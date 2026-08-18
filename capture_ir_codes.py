"""One-time interactive tool to capture real IR codes from your AC's remote,
so send_ac_command() in app.py can replay them locally instead of going
through Tuya's cloud AC-remote endpoint (which costs an API call every time).

Captures one code per exact (code, value) pair your automations actually
use — e.g. PowerOn, PowerOff, Temperature=16, Temperature=20 — since a raw
IR code replays an exact signal, not an abstract "set to any number."

Usage:
    python capture_ir_codes.py

Re-run any time you add a new temperature/mode/fan value to an automation
and want it to also work locally — already-captured settings are skipped
unless you choose to recapture them.
"""
import sys

import facility_store
import ir_codes


def _label(code, value):
    if code == "PowerOn":
        return "Power ON"
    if code == "PowerOff":
        return "Power OFF"
    if code == "T":
        return f"Temperature {value}°C"
    if code == "M":
        return f"Mode {value}"
    if code == "F":
        return f"Fan speed {value}"
    return f"{code}={value}"


def _needed_pairs():
    facility = facility_store.load()
    pairs = set()
    for automation in facility.get("automations", []):
        if automation.get("action_type") != "ac_command":
            continue
        for cmd in automation.get("action_ac_commands") or []:
            pairs.add((cmd.get("code"), cmd.get("value")))
    return sorted(pairs, key=lambda p: (str(p[0]), str(p[1])))


def main():
    pairs = _needed_pairs()
    if not pairs:
        print("No ac_command automations found in facility.json — nothing to capture.")
        return

    sensor = ir_codes.ir_blaster_sensor()  # raises with a clear message if not configured
    print(f"IR blaster: {sensor['name']} at {sensor['local_ip']}")
    already_count = sum(1 for code, value in pairs if ir_codes.has_code(code, value))
    print(f"{len(pairs)} setting(s) used by your automations — {already_count} already captured.")
    print()

    ir = ir_codes.connect()

    for code, value in pairs:
        label = _label(code, value)
        if ir_codes.has_code(code, value):
            answer = input(f"[{label}] already captured — recapture? (y/N): ").strip().lower()
            if answer != "y":
                continue
        input(f"Point your AC remote at the blaster, press [{label}], then press Enter here...")
        print("Listening for 15 seconds...")
        result = ir.receive_button(timeout=15)
        if not result:
            print(f"  No signal received for [{label}] — skipping. Re-run this script to try again.")
            print()
            continue
        ir_codes.save_code(code, value, result)
        print(f"  Captured [{label}].")
        print()

    print("Done — app.py will use these captured codes locally for any setting that has one,")
    print("falling back to Tuya's cloud endpoint for anything not yet captured.")


if __name__ == "__main__":
    try:
        main()
    except RuntimeError as e:
        print(f"Error: {e}")
        sys.exit(1)
