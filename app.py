import os
import time
import json
import socket
import threading
from pathlib import Path
from dotenv import load_dotenv
from flask import Flask, jsonify, request, Response, send_from_directory
from flask_cors import CORS

load_dotenv()

try:
    import tinytuya
except ImportError:
    print("tinytuya not installed. Run: pip install tinytuya")
    exit(1)

# tinytuya's cloud API calls (requests.get/requests.request in its
# _tuyaplatform()) don't pass their own timeout — with no default, a hung
# request to Tuya's servers (network partition, server-side stall, etc.)
# would block forever. Every cloud command (send_ac_command,
# set_switch_state, send_ir_command, get_ac_status, ...) runs synchronously
# inside either the PIR listener thread or the poll_devices() loop, so a
# single stuck call would freeze motion detection / polling entirely until
# the process was restarted. This bounds every socket that doesn't set its
# own explicit timeout (local tinytuya.Device calls already do, via
# set_socketTimeout(), and are unaffected) to a firm upper limit instead.
socket.setdefaulttimeout(20)

import facility_store
import analytics_store
import automation_engine
import mqtt_client
import ir_codes

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})

# ==========================================
# TUYA CLOUD CREDENTIALS — loaded from .env (see .env.example), never hardcoded
# ==========================================
API_REGION = os.environ["TUYA_API_REGION"]
API_KEY = os.environ["TUYA_API_KEY"]
API_SECRET = os.environ["TUYA_API_SECRET"]
# ==========================================

# Devices controlled directly (not just read) by the dashboard
IR_BLASTER_ID = os.environ["TUYA_IR_BLASTER_ID"]
AC_DEVICE_ID = os.environ["TUYA_AC_DEVICE_ID"]  # "Air" — structured infrared_ac sub-device behind the IR blaster
SWITCH_ROBOT_ID = os.environ["TUYA_SWITCH_ROBOT_ID"]  # bridged via a Bluetooth gateway — confirmed online in cloud.getdevices()

# sensor_id -> {"online": bool, "value": ...}, populated by poll_devices()/listen_pir()
live_readings = {}

# sensor IDs handled by a dedicated listen_pir() thread instead of poll_devices()
pir_listener_sensor_ids = set()

# SSE clients
sse_clients = []


def get_cloud():
    """Create and return a fresh Cloud connection."""
    return tinytuya.Cloud(
        apiRegion=API_REGION,
        apiKey=API_KEY,
        apiSecret=API_SECRET,
    )


def send_ir_command(base64_code):
    """Send a Base64 IR code to the IR blaster via cloud. Shared by the manual
    endpoint and the automation engine — this is the single choke point for
    every IR command regardless of who triggered it, so it's also where the
    (currently disabled) MQTT mirror hooks in."""
    cloud = get_cloud()
    result = cloud.sendcommand(IR_BLASTER_ID, {
        'commands': [{'code': 'send_ir', 'value': base64_code}]
    })
    mqtt_client.publish("commands/send_ir", {"code": base64_code})
    return result


# Maps our UI's button codes to the real IR Control Hub AC command codes.
# IMPORTANT: the generic cloud.sendcommand(AC_DEVICE_ID, ...) DP-write path
# (used here originally) always returns success without ever actually
# triggering IR transmission — confirmed by testing against real hardware.
# The dedicated /air-conditioners/.../command endpoint below is the one that
# actually works; it requires the "IR Control Hub Open Service" to be
# subscribed on the Tuya project (a separate subscription from IoT Core).
AC_CODE_MAP = {
    "PowerOn": ("power", 1),
    "PowerOff": ("power", 0),
    "T": ("temp", None),
    "M": ("mode", None),
    "F": ("wind", None),
}


def send_ac_command(code, value):
    """Send a real air-conditioner command — locally, for free, if this exact
    (code, value) has been captured via capture_ir_codes.py; otherwise via
    Tuya's dedicated IR Control Hub AC endpoint (costs a cloud API call).
    IR_BLASTER_ID doubles as the 'infrared_id' (the gateway) and AC_DEVICE_ID
    as the 'remote_id' — confirmed to be the same value for this setup by
    querying GET /v2.0/infrareds/{id}/remotes."""
    real_code, mapped_value = AC_CODE_MAP.get(code, (code, None))
    real_value = mapped_value if mapped_value is not None else value

    captured = ir_codes.get_code(code, value)
    if captured:
        ir_codes.send_locally(captured)
        result = {"local": True}
    else:
        cloud = get_cloud()
        result = cloud.cloudrequest(
            f"/v2.0/infrareds/{IR_BLASTER_ID}/air-conditioners/{AC_DEVICE_ID}/command",
            post={"code": real_code, "value": real_value},
        )
    mqtt_client.publish("commands/ac", {"code": real_code, "value": real_value})

    # Keep the automation engine's assumed AC state in sync regardless of who
    # sent this command — a manual click in the dashboard's AC remote counts
    # just as much as an automation firing. Without this, a manual override
    # would leave the engine believing the AC is still in its old state, and
    # it would wrongly skip re-sending a setting on the next automation fire
    # because it thinks nothing changed.
    automation_engine.set_known_ac_state(code, value)

    return result


def get_ac_status():
    """Read the AC's real current state (power/mode/temp/wind) — unlike the
    generic device status (always empty for this category), this dedicated
    endpoint reflects the actual last-applied state.

    The raw Tuya response wraps the actual fields inside a "result" object
    (e.g. {"result": {"power": "1", "temp": "26", ...}, "success": true,
    ...}) — every frontend consumer (the AC remote, the Logs status panel)
    reads power/temp/mode/wind directly on the returned object, so unwrap it
    here rather than in every caller."""
    cloud = get_cloud()
    response = cloud.cloudrequest(f"/v2.0/infrareds/{IR_BLASTER_ID}/remotes/{AC_DEVICE_ID}/ac/status")
    return response.get("result", response)


def set_switch_state(value):
    """Toggle the Switch Robot (bridged via BLE gateway) via cloud DP write."""
    cloud = get_cloud()
    result = cloud.sendcommand(SWITCH_ROBOT_ID, {
        'commands': [{'code': 'switch_1', 'value': bool(value)}]
    })
    mqtt_client.publish("commands/switch", {"value": bool(value)})
    return result


def dispatch_remote_command(payload):
    """Executes a command received from a remote (e.g. cloud-hosted)
    dashboard over MQTT — see mqtt_client.start_remote_listener(). The
    remote side never talks to Tuya directly; it publishes a command here
    and this app does the actual device I/O, exactly as if it came from this
    app's own dashboard or an automation."""
    cmd_type = payload.get("type")
    if cmd_type == "ac_command":
        send_ac_command(payload.get("code"), payload.get("value"))
    elif cmd_type == "toggle_switch":
        set_switch_state(bool(payload.get("value")))
    elif cmd_type == "send_ir":
        send_ir_command(payload.get("code"))
    else:
        print(f"Remote command: unknown type {cmd_type!r}")


def get_switch_status():
    """On-demand read of the Switch Robot's real on/off state — deliberately
    NOT part of the continuous poll_devices() loop. This exact device was the
    single largest source of cloud API calls last time (polled every 3s), so
    it's treated like the AC: checked only when someone actually looks at it,
    not continuously."""
    cloud = get_cloud()
    result = cloud.getstatus(SWITCH_ROBOT_ID)
    if not result or "result" not in result:
        return {"online": False, "value": None}
    value = None
    for dp in result["result"]:
        if dp.get("code") == "switch_1":
            value = bool(dp.get("value"))
    return {"online": True, "value": value}


def notify_clients(event_type, data):
    msg = f"event: {event_type}\ndata: {json.dumps(data)}\n\n"
    for client in sse_clients:
        client.append(msg)
    # Mirrors real-time state to MQTT too — this is the single choke point
    # for every sensor reading and automation firing regardless of source,
    # which is what lets a separate cloud-hosted dashboard (subscribed to
    # this same broker) show live state without ever calling Tuya directly.
    # "scan_progress" is excluded — that's purely local Wi-Fi-scan UI
    # feedback, meaningless off this network.
    if event_type in ("sensor_update", "automation_triggered"):
        mqtt_client.publish(f"state/{event_type}", data)


def handle_reading(sensor, reading, automations):
    """Common bookkeeping whenever a fresh reading arrives for a sensor —
    used by both the interval-poll loop (cloud/local status queries) and the
    passive PIR listener (pushed updates). Updates live state, logs to
    analytics on change, notifies SSE clients, and runs the automation engine."""
    prev = live_readings.get(sensor["id"])
    live_readings[sensor["id"]] = reading

    changed = (
        prev is None
        or prev.get("value") != reading.get("value")
        or prev.get("online") != reading.get("online")
    )

    if changed:
        analytics_store.log_reading(sensor["id"], reading.get("value"), reading.get("online"))
        notify_clients("sensor_update", {"id": sensor["id"], **reading})
        automation_engine.on_sensor_reading(
            sensor, reading, automations, send_ir_command, set_switch_state, send_ac_command, notify_clients,
        )


# Types intentionally excluded from the continuous 3s poll loop below:
# "ir"/"aircon" are write-only — Tuya reports no real status for them at all.
# "switch" DOES have a real status (see get_switch_status()), but the one
# real switch device we have was the single largest source of cloud API
# calls last time (polled every 3s) — it's checked on-demand only instead.
SKIP_CONTINUOUS_POLL_TYPES = {"ir", "aircon", "switch"}


def read_sensor(sensor):
    """Poll a single sensor's live Tuya status (local LAN if configured, else
    cloud). Returns None for sensors with no linked device or that are
    intentionally excluded from continuous polling (see
    SKIP_CONTINUOUS_POLL_TYPES)."""
    device_id = sensor.get("tuya_device_id")
    if not device_id or sensor["type"] in SKIP_CONTINUOUS_POLL_TYPES:
        return None

    if sensor.get("local_ip") and sensor.get("local_key"):
        d = tinytuya.Device(device_id, sensor["local_ip"], sensor["local_key"],
                             version=sensor.get("local_version", 3.3))
        d.set_socketTimeout(5)
        result = d.status()
        dps = result.get("dps") if result else None
        if not dps:
            return {"online": False, "value": None}
        if sensor["type"] == "pir":
            return {"online": True, "value": str(dps.get("1", "none")).lower()}
        return {"online": True, "value": dps}

    cloud = get_cloud()
    result = cloud.getstatus(device_id)
    if not result or "result" not in result:
        return {"online": False, "value": None}
    value = None
    for dp in result["result"]:
        if sensor["type"] == "switch" and dp.get("code") == "switch_1":
            value = bool(dp.get("value"))
    return {"online": True, "value": value}


def poll_devices():
    """Background thread: poll every sensor with a linked Tuya device every 3
    seconds — except sensors handled by a dedicated passive listener (see
    listen_pir), which react to pushed updates instead of being actively
    queried."""
    print("Polling thread started...")
    while True:
        facility = facility_store.load()
        automations = facility.get("automations", [])

        for sensor in facility["sensors"]:
            if not sensor.get("tuya_device_id") or sensor["type"] in SKIP_CONTINUOUS_POLL_TYPES:
                continue
            if sensor["id"] in pir_listener_sensor_ids:
                continue

            try:
                reading = read_sensor(sensor)
            except Exception as e:
                reading = {"online": False, "value": None}
                print(f"Poll error for sensor {sensor['id']} ({sensor['name']}): {e}")

            if reading is None:
                continue

            handle_reading(sensor, reading, automations)

        automation_engine.check_timeouts(
            automations, send_ir_command, set_switch_state, send_ac_command, notify_clients
        )

        time.sleep(3)


# sensor_id -> timestamp of the last sign of life from its PIR worker thread
# (see listen_pir/_pir_listen_once below). Belt-and-suspenders against a
# connection that hangs somewhere tinytuya's own set_socketTimeout() doesn't
# actually cover — confirmed to happen for real (twice: an ~19-hour and a
# 13+ minute silent stall, in both cases zero readings AND zero "offline"
# logs, meaning the thread never even reached its own except block).
_pir_heartbeats = {}


def _pir_listen_once(sensor, stop_flag):
    """One connection attempt + listen cycle, run on its own worker thread so
    the supervisor below (listen_pir) can detect and abandon it if it ever
    wedges completely, instead of waiting on it forever. Identical logic to
    the previous single-threaded version otherwise."""
    MAX_CONSECUTIVE_TIMEOUTS = 4  # ~4 * 30s = 2 minutes of silence before assuming it's actually gone
    sensor_id = sensor["id"]
    d = None
    try:
        d = tinytuya.Device(sensor["tuya_device_id"], sensor["local_ip"], sensor["local_key"],
                             version=sensor.get("local_version", 3.3))
        d.set_socketPersistent(True)
        d.set_socketTimeout(30)
        print(f"PIR listener connected for {sensor['name']} ({sensor_id}) at {sensor['local_ip']}")
        _pir_heartbeats[sensor_id] = time.time()

        consecutive_timeouts = 0
        while not stop_flag.is_set():
            data = d.receive()
            _pir_heartbeats[sensor_id] = time.time()
            if not data:
                consecutive_timeouts += 1
                if consecutive_timeouts >= MAX_CONSECUTIVE_TIMEOUTS:
                    raise ConnectionError(
                        f"no data for {MAX_CONSECUTIVE_TIMEOUTS * 30}s — not connected to WiFi anymore"
                    )
                continue  # timeout with nothing new — keep listening
            consecutive_timeouts = 0
            dps = data.get("dps")
            if dps and "1" in dps:
                reading = {"online": True, "value": str(dps["1"]).lower()}
                facility = facility_store.load()
                handle_reading(sensor, reading, facility.get("automations", []))
    except Exception as e:
        print(f"PIR worker error for {sensor_id}: {e}")
    finally:
        if d is not None:
            try:
                d.close()
            except Exception:
                pass


def listen_pir(sensor_id):
    """Background thread: supervises a persistent local connection to a PIR
    sensor, reacting to pushed updates immediately instead of actively
    polling every few seconds — lower latency, and only wakes the (usually
    battery-powered) device when it has something to report.

    Reloads the sensor's config (IP/key/version) from facility.json before
    every connection attempt — not just once at thread start — so a Settings
    edit (e.g. after the device's IP or local_key changes, which happens when
    it's re-paired onto a different WiFi network) takes effect the next time
    the connection drops and retries, without needing an app restart.

    Each attempt runs in its own worker thread (_pir_listen_once), watched
    via a heartbeat timestamp the worker updates on every receive() call.
    This is NOT the same thing as the worker's own internal timeout logic —
    that only helps if a hung call eventually returns/raises on its own,
    which real incidents have shown isn't guaranteed (a connection can wedge
    completely, with the worker never reaching its own except block, for
    hours). Python can't forcibly kill a stuck thread, so a wedged worker is
    simply abandoned (leaked, harmless since it's a daemon thread) rather
    than relied upon to ever recover — the supervisor starts a fresh worker
    against freshly-reloaded config the moment the heartbeat goes stale,
    exactly as if the connection had cleanly failed."""
    HEARTBEAT_STALE_AFTER = 45  # comfortably above the worker's own 30s receive() timeout

    while True:
        facility = facility_store.load()
        sensor = next((s for s in facility["sensors"] if s["id"] == sensor_id), None)
        if sensor is None:
            print(f"PIR listener: sensor {sensor_id} no longer exists, stopping")
            return

        stop_flag = threading.Event()
        _pir_heartbeats[sensor_id] = time.time()  # optimistic start — gives the worker time to connect
        worker = threading.Thread(target=_pir_listen_once, args=(sensor, stop_flag), daemon=True)
        worker.start()

        while worker.is_alive():
            worker.join(timeout=5)
            if worker.is_alive() and time.time() - _pir_heartbeats.get(sensor_id, 0) > HEARTBEAT_STALE_AFTER:
                print(f"PIR listener: worker for {sensor_id} stopped responding — abandoning it, reconnecting fresh")
                stop_flag.set()  # best-effort — won't interrupt a call that's already hung, but costs nothing to set
                break

        handle_reading(sensor, {"online": False, "value": None}, facility_store.load().get("automations", []))
        time.sleep(5)


def start_pir_listeners():
    """Spawn a dedicated listener thread for each PIR sensor configured with
    local LAN credentials. Returns the set of sensor IDs now handled this way,
    so poll_devices() skips them. (New sensors added later via Settings still
    need an app restart to get their own listener thread — but existing
    listeners now self-heal on IP/key changes without one — see listen_pir.)"""
    sensor_ids = set()
    for sensor in facility_store.load()["sensors"]:
        if sensor["type"] == "pir" and sensor.get("local_ip") and sensor.get("local_key"):
            threading.Thread(target=listen_pir, args=(sensor["id"],), daemon=True).start()
            sensor_ids.add(sensor["id"])
    return sensor_ids


# ==========================================
# API ROUTES
# ==========================================

@app.route("/api/floors")
def api_floors():
    facility = facility_store.load()
    return jsonify(sorted(facility["floors"], key=lambda f: f["order"]))


@app.route("/api/dashboard")
def api_dashboard():
    floor_id = request.args.get("floor_id")
    if not floor_id:
        return jsonify({"error": "floor_id is required"}), 400
    return jsonify(facility_store.build_dashboard_for_floor(floor_id, live_readings))


@app.route("/api/analytics")
def api_analytics():
    sensor_id = request.args.get("sensor_id")
    if not sensor_id:
        return jsonify({"error": "sensor_id is required"}), 400
    since = request.args.get("since")
    return jsonify(analytics_store.get_readings(sensor_id, since=float(since) if since else None))


@app.route("/api/automation_events")
def api_automation_events():
    since = request.args.get("since")
    limit = request.args.get("limit")
    return jsonify(
        analytics_store.get_all_automation_events(
            since=float(since) if since else None,
            limit=int(limit) if limit else 200,
        )
    )


scan_state = {"running": False}
SCAN_ROUNDS = 4
SCAN_ROUND_SECONDS = 5


def _scan_round_results(found, cloud_keys, sensors_by_device_id):
    """Turn one round's raw tinytuya results into (device dict, log line) pairs."""
    out = []
    for ip, info in found.items():
        device_id = info.get("gwId") or info.get("id")
        name = info.get("name") or device_id
        sensor = sensors_by_device_id.get(device_id)

        if not sensor:
            line = f"'{name}' at {ip} — not configured as a sensor in this app, skipping."
        elif sensor.get("local_ip") == ip:
            line = f"'{name}' at {ip} — matches sensor '{sensor['name']}', already up to date."
        else:
            line = (
                f"'{name}' — matches sensor '{sensor['name']}', but IP changed: "
                f"{sensor.get('local_ip') or 'none saved'} → {ip}."
            )
            if device_id in cloud_keys:
                line += f" Cloud confirms current key — ready to apply."
            else:
                line += " Could not confirm key from cloud — apply unavailable."

        device = {
            "ip": ip,
            "tuya_device_id": device_id,
            "version": info.get("version"),
            "name": info.get("name"),
            "matched_sensor_id": sensor["id"] if sensor else None,
            "matched_sensor_name": sensor["name"] if sensor else None,
            "ip_changed": bool(sensor and sensor.get("local_ip") != ip),
            "cloud_key": cloud_keys.get(device_id),
        }
        out.append((device, line))
    return out


def run_wifi_scan():
    """Runs in a background thread. tinytuya has no incremental/callback scan
    API — it's one blocking call that returns everything at the end — so
    genuine real-time discovery is approximated by running several short
    rounds back-to-back and pushing newly-seen devices over SSE as each round
    finishes, instead of one ~18s wait with a single reveal at the end."""
    scan_state["running"] = True
    seen_ips = set()
    try:
        notify_clients("scan_progress", {"status": "started"})
        notify_clients("scan_progress", {"status": "log", "line": "Fetching current keys from Tuya Cloud..."})
        try:
            cloud_keys = {d["id"]: d.get("key") for d in get_cloud().getdevices()}
            notify_clients(
                "scan_progress",
                {"status": "log", "line": f"Cloud reachable — got keys for {len(cloud_keys)} device(s)."},
            )
        except Exception as e:
            cloud_keys = {}
            notify_clients("scan_progress", {"status": "log", "line": f"Cloud unreachable ({e}) — no key lookup."})

        facility = facility_store.load()
        sensors_by_device_id = {s["tuya_device_id"]: s for s in facility["sensors"] if s.get("tuya_device_id")}

        for round_num in range(1, SCAN_ROUNDS + 1):
            notify_clients(
                "scan_progress",
                {"status": "log", "line": f"Listening for broadcasts — round {round_num}/{SCAN_ROUNDS}..."},
            )
            try:
                found = tinytuya.deviceScan(verbose=False, poll=False, maxretry=SCAN_ROUND_SECONDS)
            except Exception as e:
                notify_clients("scan_progress", {"status": "log", "line": f"Round {round_num} failed: {e}"})
                continue

            new_ips = [ip for ip in found if ip not in seen_ips]
            seen_ips.update(new_ips)
            for device, line in _scan_round_results({ip: found[ip] for ip in new_ips}, cloud_keys, sensors_by_device_id):
                notify_clients("scan_progress", {"status": "device_found", "device": device, "line": line})

        notify_clients(
            "scan_progress",
            {"status": "complete", "line": f"Scan complete — {len(seen_ips)} device(s) found."},
        )
    finally:
        scan_state["running"] = False


@app.route("/api/scan_devices", methods=["POST"])
def api_scan_devices():
    if scan_state.get("running"):
        return jsonify({"error": "A scan is already running"}), 409
    threading.Thread(target=run_wifi_scan, daemon=True).start()
    return jsonify({"started": True})


@app.route("/api/rooms")
def api_rooms():
    return jsonify(facility_store.load()["rooms"])


@app.route("/api/sensors", methods=["GET", "POST"])
def api_sensors():
    if request.method == "POST":
        return jsonify(facility_store.add_sensor(request.json)), 201
    return jsonify(facility_store.load()["sensors"])


@app.route("/api/sensors/<sensor_id>", methods=["PUT", "DELETE"])
def api_sensor_detail(sensor_id):
    if request.method == "DELETE":
        ok = facility_store.delete_sensor(sensor_id)
        return ("", 204) if ok else (jsonify({"error": "not found"}), 404)
    sensor = facility_store.update_sensor(sensor_id, request.json)
    return jsonify(sensor) if sensor else (jsonify({"error": "not found"}), 404)


@app.route("/api/residents", methods=["GET", "POST"])
def api_residents():
    if request.method == "POST":
        return jsonify(facility_store.add_resident(request.json)), 201
    return jsonify(facility_store.load()["residents"])


@app.route("/api/residents/<resident_id>", methods=["PUT", "DELETE"])
def api_resident_detail(resident_id):
    if request.method == "DELETE":
        ok = facility_store.delete_resident(resident_id)
        return ("", 204) if ok else (jsonify({"error": "not found"}), 404)
    resident = facility_store.update_resident(resident_id, request.json)
    return jsonify(resident) if resident else (jsonify({"error": "not found"}), 404)


@app.route("/api/automations", methods=["GET", "POST"])
def api_automations():
    if request.method == "POST":
        return jsonify(facility_store.add_automation(request.json)), 201
    return jsonify(facility_store.load().get("automations", []))


@app.route("/api/automations/<automation_id>", methods=["PUT", "DELETE"])
def api_automation_detail(automation_id):
    if request.method == "DELETE":
        ok = facility_store.delete_automation(automation_id)
        return ("", 204) if ok else (jsonify({"error": "not found"}), 404)
    automation = facility_store.update_automation(automation_id, request.json)
    return jsonify(automation) if automation else (jsonify({"error": "not found"}), 404)


@app.route("/api/mqtt", methods=["GET", "PUT"])
def api_mqtt():
    if request.method == "PUT":
        return jsonify(facility_store.update_mqtt_config(request.json))
    return jsonify(mqtt_client.get_config())


@app.route("/api/send_ir", methods=["POST"])
def send_ir():
    base64_code = request.json.get("code")
    if not base64_code:
        return jsonify({"error": "No IR code provided"}), 400

    try:
        result = send_ir_command(base64_code)
        print(f"IR command result: {result}")
        return jsonify({"success": True, "result": result})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/send_ac_command", methods=["POST"])
def send_ac_command_route():
    code = request.json.get("code")
    value = request.json.get("value")
    if not code or value is None:
        return jsonify({"error": "code and value are required"}), 400

    try:
        result = send_ac_command(code, value)
        print(f"AC command result: {result}")
        return jsonify({"success": True, "result": result})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/ac_status")
def api_ac_status():
    try:
        return jsonify(get_ac_status())
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/resync_ac_state", methods=["POST"])
def api_resync_ac_state():
    """Manually correct the automation engine's assumed AC state to match
    what someone actually sees on the physical unit — e.g. after the AC's
    own remote was used directly, which neither this app nor even Tuya's
    cloud can ever detect (the IR blaster only transmits, it has no feedback
    path from the AC). This ONLY updates our internal bookkeeping — no real
    command is sent, since the physical device is already in this state."""
    data = request.json or {}
    if data.get("power") is not None:
        automation_engine.set_known_ac_state("PowerOn" if data["power"] else "PowerOff", None)
    if data.get("temp") is not None:
        automation_engine.set_known_ac_state("T", data["temp"])
    if data.get("mode") is not None:
        automation_engine.set_known_ac_state("M", data["mode"])
    if data.get("fan") is not None:
        automation_engine.set_known_ac_state("F", data["fan"])
    return jsonify({"success": True})


@app.route("/api/toggle_switch", methods=["POST"])
def api_toggle_switch():
    value = request.json.get("value")
    if value is None:
        return jsonify({"error": "value is required"}), 400

    try:
        result = set_switch_state(bool(value))
        return jsonify({"success": True, "result": result})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/switch_status")
def api_switch_status():
    try:
        return jsonify(get_switch_status())
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/stream")
def stream():
    """Server-Sent Events endpoint for real-time updates."""
    def event_stream():
        messages = []
        sse_clients.append(messages)
        try:
            while True:
                if messages:
                    yield messages.pop(0)
                time.sleep(0.1)
        except GeneratorExit:
            sse_clients.remove(messages)

    return Response(event_stream(), mimetype="text/event-stream")


# ==========================================
# FRONTEND (serves the React production build — run `npm run build` in
# frontend/ first; for development, run `npm run dev` there instead and use
# the Vite dev server, which proxies /api to this Flask process)
# ==========================================

FRONTEND_DIST = Path(__file__).parent / "frontend" / "dist"


@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_frontend(path):
    if path and (FRONTEND_DIST / path).is_file():
        return send_from_directory(FRONTEND_DIST, path)
    if (FRONTEND_DIST / "index.html").exists():
        return send_from_directory(FRONTEND_DIST, "index.html")
    return (
        "Frontend build not found — run `npm run build` in frontend/, "
        "or use `npm run dev` there for development.",
        404,
    )


# ==========================================
# MAIN
# ==========================================

if __name__ == "__main__":
    print("Connecting to Tuya Cloud...")
    print(f"  Region : {API_REGION}")
    print(f"  API Key: {API_KEY}")

    try:
        cloud = get_cloud()
        devices = cloud.getdevices()
        if devices:
            print(f"Cloud connected! Found {len(devices)} device(s).")
        else:
            print("Cloud connected but no devices returned. Check your API credentials.")
    except Exception as e:
        print(f"Cloud connection error: {e}")

    pir_listener_sensor_ids = start_pir_listeners()

    t = threading.Thread(target=poll_devices, daemon=True)
    t.start()

    threading.Thread(target=mqtt_client.start_remote_listener, args=(dispatch_remote_command,), daemon=True).start()

    app.run(host="0.0.0.0", port=5000, debug=False, threaded=True)
