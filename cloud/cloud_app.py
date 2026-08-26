"""Cloud-side companion to the Pi-hosted Smart Motion Sensor app.

Fully self-contained under cloud/ — no import of, or dependency on, anything
in the rest of the repo. It never talks to Tuya at all — no API calls, no
LAN dependency, deployable to any VM on its own. It only speaks to the same
MQTT broker the Pi-hosted app (unmodified) already publishes to:

  - Subscribes to "{prefix}/state/#" to mirror live sensor readings and
    automation firings (published by the Pi's notify_clients()).
  - Subscribes to "{prefix}/commands/#" to approximate current AC/switch
    status from the commands the Pi mirrors there whenever it actually
    sends one — the Pi has no dedicated "current AC/switch status" MQTT
    topic, so this is a best-effort reconstruction, not a live read.
  - Publishes to "{prefix}/remote/command" to send a command; the Pi's own
    mqtt_client.start_remote_listener() picks it up and does the actual
    device I/O against Tuya.

The Pi is the only thing that ever touches real hardware, Tuya, or
facility.json. This app is a mirror + a remote control, nothing more. Since
it has no access to facility.json, the floor/room/sensor layout it renders
comes from facility_layout.json (see that file) — a sanitized, manually
maintained snapshot committed alongside this file. Update it by hand
whenever floors/rooms/sensors/automations change on the Pi.

Gated by a single shared password (see /api/login) — this is the one app
in the repo meant to be reachable from the open internet.
"""
import hmac
import json
import os
import secrets
import threading
import time
from functools import wraps
from pathlib import Path

from dotenv import load_dotenv, set_key
from flask import Flask, jsonify, request, Response, send_from_directory, session
from flask_cors import CORS

ENV_PATH = Path(__file__).parent / ".env"
load_dotenv(ENV_PATH)

MQTT_BROKER_HOST = os.environ["MQTT_BROKER_HOST"]
MQTT_BROKER_PORT = int(os.environ.get("MQTT_BROKER_PORT", "1883"))
MQTT_USERNAME = os.environ["MQTT_USERNAME"]
MQTT_PASSWORD = os.environ["MQTT_PASSWORD"]
MQTT_TOPIC_PREFIX = os.environ.get("MQTT_TOPIC_PREFIX", "smart-motion-sensor")

# The one thing gating access to this dashboard — see require_auth() below.
CLOUD_DASHBOARD_PASSWORD = os.environ["CLOUD_DASHBOARD_PASSWORD"]

FACILITY_LAYOUT = json.loads((Path(__file__).parent / "facility_layout.json").read_text(encoding="utf-8"))

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})
# Signs the session cookie — falls back to a per-process random key (fine
# functionally, just means everyone's logged out on a restart) if unset.
# Set CLOUD_SESSION_SECRET to a fixed random string to survive restarts.
app.secret_key = os.environ.get("CLOUD_SESSION_SECRET") or secrets.token_hex(32)

# In-memory only, deliberately not persisted — a restart just means a brief
# gap until the Pi's next publish/command repopulates it. The Pi's own
# SQLite (analytics_store.py) remains the durable source of history; this
# is a live mirror, not a second database.
live_sensors = {}          # sensor_id -> last-known reading
automation_log = []        # most recent automation firings, oldest first
MAX_LOG = 500
# Seeded from the static snapshot so the page has something to show before
# the Pi's retained "state/automations" message arrives (published on every
# Pi startup and after every create/update/delete — see app.py's
# _publish_automations_state()); overwritten wholesale the moment it does.
automations = list(FACILITY_LAYOUT["automations"])
ac_status_cache = {}        # built up from mirrored "commands/ac" messages
switch_status_cache = None  # {"online": True, "value": bool} from "commands/switch"

sse_clients = []

# The Pi is the only thing that ever publishes on state/# or commands/#, so
# mqtt_status["last_message_at"] doubles as "last time we heard from the
# Pi" — reliably, now that app.py's send_heartbeat() publishes something
# every 20s even when nothing else changed. Comfortably above that interval
# to tolerate a missed beat or two plus network jitter.
PI_OFFLINE_TIMEOUT_SECONDS = 90

# The currently-connected subscriber client, if any — kept so a config save
# (see api_mqtt_update) can force a reconnect with the new settings without
# waiting for the broker connection to drop on its own.
_subscriber_client = None
mqtt_status = {"connected": False, "last_error": None, "connected_at": None, "last_message_at": None}


# ==========================================
# AUTH — a single shared password, session-cookie gated. Not a user system;
# there's no concept of individual accounts anywhere in this project.
# ==========================================


@app.route("/api/session")
def api_session():
    return jsonify({"authenticated": bool(session.get("authenticated"))})


@app.route("/api/login", methods=["POST"])
def api_login():
    password = (request.json or {}).get("password", "")
    # constant-time comparison — this endpoint is reachable from the open
    # internet, so a naive == would leak timing information about the
    # correct password one character at a time.
    if not hmac.compare_digest(password, CLOUD_DASHBOARD_PASSWORD):
        return jsonify({"error": "Incorrect password"}), 401
    session["authenticated"] = True
    session.permanent = True
    return jsonify({"success": True})


@app.route("/api/logout", methods=["POST"])
def api_logout():
    session.clear()
    return jsonify({"success": True})


def require_auth(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not session.get("authenticated"):
            return jsonify({"error": "unauthorized"}), 401
        return view(*args, **kwargs)

    return wrapped


# ==========================================
# MQTT MIRROR
# ==========================================


def notify_clients(event_type, data):
    """Same pattern as the Pi app's notify_clients() — a per-client message
    queue, drained by each browser's own SSE generator below."""
    msg = f"event: {event_type}\ndata: {json.dumps(data)}\n\n"
    for client in sse_clients:
        client.append(msg)


def _handle_state_message(event_type, payload):
    global automations, live_sensors, ac_status_cache
    if event_type == "heartbeat":
        pass  # nothing to do — just arriving at all is what keeps mqtt_status["last_message_at"] fresh
    elif event_type == "automations":
        automations = payload  # full replace — the Pi always publishes its complete current list, retained
        notify_clients("automations", payload)
    elif event_type == "sensor_update":
        live_sensors[payload.get("id")] = payload
        notify_clients("sensor_update", payload)
    elif event_type == "sensor_snapshot":
        # Retained, republished every ~20s by the Pi's heartbeat thread with
        # EVERY sensor's current reading — full replace. Without this, a
        # (re)connecting subscriber only ever learns a sensor's state from
        # sensor_update (on-change only), so anything that hasn't happened
        # to change since reconnecting would wrongly still show as
        # offline/unknown even though it's genuinely fine.
        live_sensors = payload
        notify_clients("sensor_snapshot", payload)
    elif event_type == "ac_status":
        # Retained, full replace — the Pi's own send_ac_command() mirrors
        # its complete known AC state here every time (not just the one
        # aspect that changed), so this alone is enough to reconstruct
        # ac_status_cache correctly on (re)connect. _handle_command_message
        # below still updates it incrementally too on every command for
        # lower latency; both converge to the same picture.
        ac_status_cache = payload
        notify_clients("device_status_update", {"device": "ac"})
    elif event_type == "automation_triggered":
        automation_log.append(
            {
                "automation_id": payload.get("id"),
                # The unmodified Pi doesn't publish event_type/timestamp on this
                # topic (only id/success/error) — these defaults keep the Logs
                # page from choking on missing fields; they upgrade for free if
                # the Pi's automation_engine.py is ever extended to include them.
                "event_type": payload.get("event_type", "action"),
                "success": payload.get("success"),
                "error": payload.get("error"),
                "timestamp": payload.get("timestamp", time.time()),
                "source": "automation",
                "device": None,
            }
        )
        del automation_log[:-MAX_LOG]  # keep only the most recent MAX_LOG entries
        notify_clients("automation_triggered", payload)
    elif event_type == "manual_command":
        # A dashboard click (from either app, not an automation) — mirrored
        # here so it shows up in this app's own Logs page too, in the exact
        # same shape the Pi's local Logs page renders (see
        # analytics_store.log_manual_command / app.py's log_manual_command).
        automation_log.append(
            {
                "automation_id": "manual",
                "event_type": payload.get("event_type", "action"),
                "success": payload.get("success"),
                "error": None,
                "timestamp": payload.get("timestamp", time.time()),
                "source": "manual",
                "device": payload.get("device"),
            }
        )
        del automation_log[:-MAX_LOG]
        notify_clients("manual_command", payload)


# Mirrors app.py's AC_CODE_MAP — commands/ac is published there with the
# ALREADY-mapped code ("power"/"temp"/"mode"/"wind"), so this just needs to
# normalize "power" to the "1"/"0" strings the real Tuya status endpoint
# uses (everything else the frontend reads via Number(), so int is fine).
def _handle_command_message(device, payload):
    global switch_status_cache
    if device == "ac":
        code, value = payload.get("code"), payload.get("value")
        if code == "power":
            ac_status_cache["power"] = "1" if value else "0"
        elif code in ("temp", "mode", "wind"):
            ac_status_cache[code] = value
    elif device == "switch":
        switch_status_cache = {"online": True, "value": bool(payload.get("value"))}
    else:
        return
    # Every AC/switch command is fire-and-forget over MQTT — the REST route
    # that sent it (api_send_ac_command/api_toggle_switch/...) returns as
    # soon as the publish succeeds, well before the Pi has actually
    # executed it and mirrored the result back here. Without this, a
    # dashboard's own "refresh device status right after my click" call
    # reads the stale pre-update cache every time, and the real state only
    # ever shows up after a full page reload made later, by chance, after
    # this message had time to arrive. Broadcasting here lets the frontend
    # refetch exactly when the mirrored state actually changes instead.
    notify_clients("device_status_update", {"device": device})


def start_mqtt_subscriber():
    """Runs forever (call in a background thread): subscribes to the Pi's
    published state/command topics and updates the in-memory mirrors above.
    Reads MQTT_BROKER_HOST etc. fresh on every (re)connect attempt — not just
    once — so a settings save (api_mqtt_update) takes effect on the very
    next iteration of this loop, without a process restart."""
    global _subscriber_client
    while True:
        try:
            import paho.mqtt.client as mqtt

            def on_message(client, userdata, msg):
                mqtt_status["last_message_at"] = time.time()
                parts = msg.topic.split("/")
                if len(parts) < 2:
                    return
                try:
                    payload = json.loads(msg.payload.decode("utf-8"))
                except (ValueError, UnicodeDecodeError):
                    return
                if parts[-2] == "state":
                    _handle_state_message(parts[-1], payload)
                elif parts[-2] == "commands":
                    _handle_command_message(parts[-1], payload)

            def on_disconnect(client, userdata, *args):
                mqtt_status["connected"] = False

            client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
            client.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD)
            client.on_message = on_message
            client.on_disconnect = on_disconnect
            client.connect(MQTT_BROKER_HOST, MQTT_BROKER_PORT, keepalive=30)
            _subscriber_client = client
            mqtt_status.update({"connected": True, "last_error": None, "connected_at": time.time()})
            client.subscribe([(f"{MQTT_TOPIC_PREFIX}/state/#", 0), (f"{MQTT_TOPIC_PREFIX}/commands/#", 0)])
            print(f"Cloud app: subscribed to {MQTT_TOPIC_PREFIX}/state/# and /commands/#")
            client.loop_forever()  # blocks; returns on a clean disconnect() or unrecoverable error
        except Exception as e:
            mqtt_status.update({"connected": False, "last_error": str(e)})
            print(f"Cloud app MQTT subscriber error: {e} — retrying in 10s")
            time.sleep(10)
        finally:
            _subscriber_client = None
            mqtt_status["connected"] = False


def publish_command(payload):
    """Publishes a command for the Pi's remote listener to execute against
    real hardware. Short-lived connection — commands are infrequent
    (user-triggered from this dashboard)."""
    import paho.mqtt.client as mqtt

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    client.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD)
    client.connect(MQTT_BROKER_HOST, MQTT_BROKER_PORT, keepalive=10)
    client.loop_start()
    client.publish(f"{MQTT_TOPIC_PREFIX}/remote/command", json.dumps(payload)).wait_for_publish(timeout=5)
    client.loop_stop()
    client.disconnect()


# ==========================================
# API ROUTES — shaped to match what cloud/frontend's copy of the dashboard
# actually calls (see frontend/src/api/client.js there).
# ==========================================


def _is_sensor_alert(sensor, value, online):
    """Mirrors facility_store._is_sensor_alert on the Pi — duplicated by
    hand since this app has no import path to it (deliberately; it never
    touches facility.json)."""
    if sensor["type"] == "temperature" and sensor.get("thresholds") and value is not None:
        return value < sensor["thresholds"]["min"] or value > sensor["thresholds"]["max"]
    if sensor["type"] == "pir" and not online:
        return True
    return False


@app.route("/api/floors")
@require_auth
def api_floors():
    return jsonify(sorted(FACILITY_LAYOUT["floors"], key=lambda f: f["order"]))


@app.route("/api/dashboard")
@require_auth
def api_dashboard():
    floor_id = request.args.get("floor_id")
    if not floor_id:
        return jsonify({"error": "floor_id is required"}), 400
    floor = next((f for f in FACILITY_LAYOUT["floors"] if f["id"] == floor_id), None)
    rooms_out = []
    for room in FACILITY_LAYOUT["rooms"]:
        if room["floor_id"] != floor_id:
            continue
        residents = [r for r in FACILITY_LAYOUT["residents"] if r["room_id"] == room["id"]]
        sensors_out = []
        for sensor in FACILITY_LAYOUT["sensors"]:
            if sensor["room_id"] != room["id"]:
                continue
            reading = live_sensors.get(sensor["id"], {"online": False, "value": None})
            value, online = reading.get("value"), reading.get("online", False)
            alert = _is_sensor_alert(sensor, value, online)
            sensors_out.append({**sensor, "value": value, "online": online, "alert": alert})
        room_has_alert = any(s["alert"] for s in sensors_out)
        residents_out = [{**r, "alert": room_has_alert} for r in residents]
        rooms_out.append({**room, "residents": residents_out, "sensors": sensors_out})
    return jsonify({"floor": floor, "rooms": rooms_out})


@app.route("/api/rooms")
@require_auth
def api_rooms():
    return jsonify(FACILITY_LAYOUT["rooms"])


@app.route("/api/sensors")
@require_auth
def api_sensors():
    return jsonify(FACILITY_LAYOUT["sensors"])


@app.route("/api/residents")
@require_auth
def api_residents():
    return jsonify(FACILITY_LAYOUT["residents"])


@app.route("/api/automations", methods=["GET", "POST"])
@require_auth
def api_automations():
    if request.method == "GET":
        return jsonify(automations)
    # POST: create. Fire-and-forget over MQTT — the Pi is the source of
    # truth and mirrors its resulting list back on "state/automations",
    # which is what actually updates `automations` above (see
    # _handle_state_message). Nothing is applied optimistically here.
    data = request.json or {}
    try:
        publish_command({"type": "create_automation", "data": data})
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/automations/<automation_id>", methods=["PUT", "DELETE"])
@require_auth
def api_automation_detail(automation_id):
    try:
        if request.method == "PUT":
            publish_command({"type": "update_automation", "id": automation_id, "data": request.json or {}})
        else:
            publish_command({"type": "delete_automation", "id": automation_id})
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/automation_events")
@require_auth
def api_automation_events():
    limit = request.args.get("limit", 200, type=int)
    since = request.args.get("since", type=float)
    rows = automation_log
    if since is not None:
        rows = [r for r in rows if r.get("timestamp", 0) >= since]
    return jsonify(list(reversed(rows[-limit:])))  # most recent first


@app.route("/api/send_ir", methods=["POST"])
@require_auth
def api_send_ir():
    code = (request.json or {}).get("code")
    if not code:
        return jsonify({"error": "No IR code provided"}), 400
    try:
        publish_command({"type": "send_ir", "code": code})
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/send_ac_command", methods=["POST"])
@require_auth
def api_send_ac_command():
    data = request.json or {}
    code, value = data.get("code"), data.get("value")
    if not code or value is None:
        return jsonify({"error": "code and value are required"}), 400
    try:
        publish_command({"type": "ac_command", "code": code, "value": value})
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/toggle_switch", methods=["POST"])
@require_auth
def api_toggle_switch():
    value = (request.json or {}).get("value")
    if value is None:
        return jsonify({"error": "value is required"}), 400
    try:
        publish_command({"type": "toggle_switch", "value": bool(value)})
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/resync_ac_state", methods=["POST"])
@require_auth
def api_resync_ac_state():
    # NOTE: the unmodified Pi's dispatch_remote_command() has no handler for
    # this command type yet — it'll log "unknown type" and no-op. Kept here
    # so the button doesn't error; wire it up on the Pi side to make it real.
    try:
        publish_command({"type": "resync_ac_state", "data": request.json or {}})
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/ac_status")
@require_auth
def api_ac_status():
    return jsonify(ac_status_cache or {"power": "0"})


@app.route("/api/switch_status")
@require_auth
def api_switch_status():
    return jsonify(switch_status_cache or {"online": False, "value": None})


@app.route("/api/mqtt")
@require_auth
def api_mqtt():
    return jsonify(
        {
            "broker_host": MQTT_BROKER_HOST,
            "broker_port": MQTT_BROKER_PORT,
            "username": MQTT_USERNAME,
            "topic_prefix": MQTT_TOPIC_PREFIX,
            "password_set": bool(MQTT_PASSWORD),  # never echo the actual password back
            "status": mqtt_status,
        }
    )


@app.route("/api/mqtt", methods=["PUT"])
@require_auth
def api_mqtt_update():
    """Persists new broker settings to .env (preserving every other line in
    it via dotenv's set_key) and forces the live subscriber to reconnect
    with them immediately — no process restart needed. An omitted/blank
    password leaves the stored one unchanged, since GET never returns it
    for the form to round-trip."""
    global MQTT_BROKER_HOST, MQTT_BROKER_PORT, MQTT_USERNAME, MQTT_PASSWORD, MQTT_TOPIC_PREFIX
    data = request.json or {}

    if data.get("broker_host"):
        MQTT_BROKER_HOST = data["broker_host"]
        set_key(ENV_PATH, "MQTT_BROKER_HOST", MQTT_BROKER_HOST)
    if data.get("broker_port"):
        try:
            MQTT_BROKER_PORT = int(data["broker_port"])
        except (TypeError, ValueError):
            return jsonify({"error": "broker_port must be a number"}), 400
        set_key(ENV_PATH, "MQTT_BROKER_PORT", str(MQTT_BROKER_PORT))
    if data.get("username"):
        MQTT_USERNAME = data["username"]
        set_key(ENV_PATH, "MQTT_USERNAME", MQTT_USERNAME)
    if data.get("password"):
        MQTT_PASSWORD = data["password"]
        set_key(ENV_PATH, "MQTT_PASSWORD", MQTT_PASSWORD)
    if data.get("topic_prefix"):
        MQTT_TOPIC_PREFIX = data["topic_prefix"]
        set_key(ENV_PATH, "MQTT_TOPIC_PREFIX", MQTT_TOPIC_PREFIX)

    if _subscriber_client is not None:
        try:
            _subscriber_client.disconnect()  # safe to call from another thread; forces a clean reconnect
        except Exception:
            pass

    return jsonify({"success": True})


@app.route("/api/pi_status")
@require_auth
def api_pi_status():
    last_seen_at = mqtt_status["last_message_at"]
    online = last_seen_at is not None and (time.time() - last_seen_at) < PI_OFFLINE_TIMEOUT_SECONDS
    return jsonify({"online": online, "last_seen_at": last_seen_at})


@app.route("/api/stream")
@require_auth
def stream():
    """Server-Sent Events endpoint — identical pattern to the Pi app's,
    including the idle heartbeat (see app.py's stream() for the full
    reasoning): this app is the one deliberately reachable from the open
    internet, almost certainly through a reverse proxy for the domain/HTTPS,
    which makes silent buffering/idle-timeout drops of a long-lived SSE
    connection even more likely than on the Pi's direct LAN connection."""
    HEARTBEAT_INTERVAL_SECONDS = 15

    def event_stream():
        messages = []
        sse_clients.append(messages)
        last_sent = time.time()
        try:
            while True:
                if messages:
                    yield messages.pop(0)
                    last_sent = time.time()
                elif time.time() - last_sent >= HEARTBEAT_INTERVAL_SECONDS:
                    yield ": heartbeat\n\n"
                    last_sent = time.time()
                time.sleep(0.1)
        except GeneratorExit:
            sse_clients.remove(messages)

    response = Response(event_stream(), mimetype="text/event-stream")
    response.headers["Cache-Control"] = "no-cache"
    # nginx's own opt-out for buffering a proxied response, read straight off
    # this header — works even without editing the reverse proxy's config.
    response.headers["X-Accel-Buffering"] = "no"
    return response


# ==========================================
# FRONTEND — its own copy of the React app under cloud/frontend/. Run
# `npm install && npm run build` there first; for development, run
# `npm run dev` there instead with VITE_API_PROXY_TARGET pointed at this
# process's port (5001). Never gated by require_auth — it's a static shell
# that itself calls /api/session on load and shows a login screen until
# authenticated, same as any SPA with a login page.
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
        "Frontend build not found — run `npm install && npm run build` in "
        "cloud/frontend/, or use `npm run dev` there for development.",
        404,
    )


if __name__ == "__main__":
    threading.Thread(target=start_mqtt_subscriber, daemon=True).start()
    app.run(host="0.0.0.0", port=5001, debug=False, threaded=True)
