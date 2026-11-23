"""Cloud dashboard for the NodeMCU (ESP8266) prototype.

Speaks only MQTT to the broker the NodeMCU publishes to (topic contract in
esp_mqtt.py):

  - Subscribes to "{prefix}/#" (status, motion, sound, ir) to mirror live
    sensor state and record ESG analytics events (esg_analytics.py).
  - Publishes plain-text commands to "{prefix}/command".

The floor/room/sensor layout comes from facility_layout.json, a manually
maintained file committed alongside this one.

Gated by a single shared password (see /api/login) — meant to be reachable
from the open internet, behind an HTTPS reverse proxy.
"""
import hmac
import json
import os
import secrets
import threading
import time
import urllib.parse
import urllib.request
from functools import wraps
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, request, Response, send_from_directory, session
from esp_mqtt import apply_esp_message, subscription_topic
from esg_analytics import AnalyticsStore, record_esp_events

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
# Optional Telegram alert when the board goes offline / comes back. Unset = no alerts.
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID")
# /api/health reports unhealthy after this long with no MQTT message.
HEALTH_MAX_SILENCE_SECONDS = 600

ESG_ANALYTICS_PATH = Path(os.environ.get("ESG_ANALYTICS_PATH", Path(__file__).parent / "esg_analytics.db"))
esg_analytics = AnalyticsStore(ESG_ANALYTICS_PATH)

app = Flask(__name__)
# Signs the session cookie — falls back to a per-process random key (fine
# functionally, just means everyone's logged out on a restart) if unset.
# Set CLOUD_SESSION_SECRET to a fixed random string to survive restarts.
app.secret_key = os.environ.get("CLOUD_SESSION_SECRET") or secrets.token_hex(32)
# Cookie only ever sent over HTTPS (browsers still allow it on http://localhost).
app.config["SESSION_COOKIE_SECURE"] = True

# In-memory live mirror; durable history lives in esg_analytics.
live_sensors = {}          # sensor_id -> last-known reading

sse_clients = []

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


def send_telegram(text):
    """Fire-and-forget alert; never blocks or breaks the MQTT loop."""
    if not (TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID):
        return

    def send():
        try:
            data = urllib.parse.urlencode({"chat_id": TELEGRAM_CHAT_ID, "text": text}).encode()
            urllib.request.urlopen(f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage", data, timeout=10)
        except Exception as e:
            print(f"Telegram alert failed: {e}")

    threading.Thread(target=send, daemon=True).start()


def alert_on_board_status(was_online, reading):
    """Alert only on a real change; the first status after an app restart (was_online None) is silent."""
    if reading is None or was_online is None or reading["online"] == was_online:
        return
    send_telegram("ESP board is back online" if reading["online"] else "ESP board went OFFLINE")


def start_mqtt_subscriber():
    """Runs forever (call in a background thread): subscribes to the board's
    topics and updates the live mirror and analytics."""
    while True:
        try:
            import paho.mqtt.client as mqtt

            def on_message(client, userdata, msg):
                now = time.time()
                mqtt_status["last_message_at"] = now
                was_online = live_sensors.get("sensor-device", {}).get("online")
                events = apply_esp_message(live_sensors, msg.topic, msg.payload, now, MQTT_TOPIC_PREFIX)
                for event_type, payload in events:
                    notify_clients(event_type, payload)
                record_esp_events(esg_analytics, msg.topic, events, now)
                if msg.topic.endswith("/status"):
                    alert_on_board_status(was_online, live_sensors.get("sensor-device"))

            def on_disconnect(client, userdata, *args):
                mqtt_status["connected"] = False

            client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
            client.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD)
            client.on_message = on_message
            client.on_disconnect = on_disconnect
            client.connect(MQTT_BROKER_HOST, MQTT_BROKER_PORT, keepalive=30)
            mqtt_status.update({"connected": True, "last_error": None, "connected_at": time.time()})
            topic = subscription_topic(MQTT_TOPIC_PREFIX)
            client.subscribe(topic, qos=1)
            print(f"Cloud app: subscribed to {topic}")
            client.loop_forever()  # blocks; returns on a clean disconnect() or unrecoverable error
        except Exception as e:
            mqtt_status.update({"connected": False, "last_error": str(e)})
            print(f"Cloud app MQTT subscriber error: {e} — retrying in 10s")
            time.sleep(10)
        finally:
            mqtt_status["connected"] = False


# ==========================================
# API ROUTES — shaped to match what cloud/frontend's copy of the dashboard
# actually calls (see frontend/src/api/client.js there).
# ==========================================


def _is_sensor_alert(sensor, value, online):
    """True when a sensor needs attention on the dashboard."""
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
            sensors_out.append({**sensor, "value": value, "online": online, "alert": alert, "changed_at": reading.get("changed_at")})
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


@app.route("/api/esg_analytics")
@require_auth
def api_esg_analytics():
    days = request.args.get("days", 7, type=int)
    if days < 1 or days > 90:
        return jsonify({"error": "days must be between 1 and 90"}), 400
    end = time.time()
    return jsonify(esg_analytics.summary(end - days * 86400, end))


@app.route("/api/ac_status")
@require_auth
def api_ac_status():
    return jsonify(live_sensors.get("sensor-ac") or {"online": False, "power": "0", "temp": None})


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


@app.route("/api/health")
def api_health():
    """Public, for an uptime monitor: 503 when MQTT is down or the board has gone silent."""
    last = mqtt_status["last_message_at"]
    age = None if last is None else round(time.time() - last)
    ok = mqtt_status["connected"] and age is not None and age < HEALTH_MAX_SILENCE_SECONDS
    return jsonify({"ok": ok, "last_message_age_seconds": age}), 200 if ok else 503


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


# Gunicorn imports this module and never executes __main__, so the MQTT
# subscriber must be started at import time for production.
_mqtt_subscriber_started = False


def _ensure_mqtt_subscriber():
    global _mqtt_subscriber_started
    if not _mqtt_subscriber_started:
        _mqtt_subscriber_started = True
        threading.Thread(target=start_mqtt_subscriber, daemon=True).start()


_ensure_mqtt_subscriber()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=False, threaded=True)
