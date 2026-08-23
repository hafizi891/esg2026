"""Cloud-side companion to the Pi-hosted Smart Motion Sensor app.

This app never talks to Tuya at all — no API calls, no LAN dependency, fully
deployable to any cloud VM. It only speaks to the same MQTT broker the
Pi-hosted app publishes to:

  - Subscribes to "{prefix}/state/#" to mirror live sensor readings and
    automation firings (published by the Pi's notify_clients()).
  - Publishes to "{prefix}/remote/command" to send a command; the Pi's own
    mqtt_client.start_remote_listener() picks it up and does the actual
    device I/O against Tuya.

The Pi is the only thing that ever touches real hardware or Tuya's API.
This app is a mirror + a remote control, nothing more.
"""
import json
import os
import threading
import time

from dotenv import load_dotenv
from flask import Flask, jsonify, request, Response
from flask_cors import CORS

load_dotenv()

MQTT_BROKER_HOST = os.environ["MQTT_BROKER_HOST"]
MQTT_BROKER_PORT = int(os.environ.get("MQTT_BROKER_PORT", "1883"))
MQTT_USERNAME = os.environ["MQTT_USERNAME"]
MQTT_PASSWORD = os.environ["MQTT_PASSWORD"]
MQTT_TOPIC_PREFIX = os.environ.get("MQTT_TOPIC_PREFIX", "smart-motion-sensor")

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})

# In-memory only, deliberately not persisted — a restart just means a brief
# gap until the Pi's next publish repopulates it. The Pi's own SQLite
# (analytics_store.py) remains the durable source of history; this is a
# live mirror, not a second database.
live_sensors = {}          # sensor_id -> last-known reading
automation_log = []        # most recent automation firings, newest last
MAX_LOG = 500

sse_clients = []


def notify_clients(event_type, data):
    """Same pattern as the Pi app's notify_clients() — a per-client message
    queue, drained by each browser's own SSE generator below."""
    msg = f"event: {event_type}\ndata: {json.dumps(data)}\n\n"
    for client in sse_clients:
        client.append(msg)


def _handle_state_message(event_type, payload):
    if event_type == "sensor_update":
        live_sensors[payload.get("id")] = payload
        notify_clients("sensor_update", payload)
    elif event_type == "automation_triggered":
        automation_log.append({**payload, "received_at": time.time()})
        del automation_log[:-MAX_LOG]  # keep only the most recent MAX_LOG entries
        notify_clients("automation_triggered", payload)


def start_mqtt_subscriber():
    """Runs forever (call in a background thread): subscribes to the Pi's
    published state topics and updates the in-memory mirror above."""
    while True:
        try:
            import paho.mqtt.client as mqtt

            def on_message(client, userdata, msg):
                # topic shape published by the Pi: "{prefix}/state/{event_type}"
                parts = msg.topic.split("/")
                if len(parts) < 2 or parts[-2] != "state":
                    return
                event_type = parts[-1]
                try:
                    payload = json.loads(msg.payload.decode("utf-8"))
                except (ValueError, UnicodeDecodeError):
                    return
                _handle_state_message(event_type, payload)

            client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
            client.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD)
            client.on_message = on_message
            client.connect(MQTT_BROKER_HOST, MQTT_BROKER_PORT, keepalive=30)
            topic = f"{MQTT_TOPIC_PREFIX}/state/#"
            client.subscribe(topic)
            print(f"Cloud app: subscribed to {topic}")
            client.loop_forever()  # blocks; paho reconnects automatically on a dropped connection
        except Exception as e:
            print(f"Cloud app MQTT subscriber error: {e} — retrying in 10s")
            time.sleep(10)


def publish_command(payload):
    """Publishes a command for the Pi's remote listener to execute against
    real hardware. Short-lived connection — commands are infrequent
    (user-triggered from this dashboard), same reasoning as the Pi's own
    mqtt_client.publish()."""
    import paho.mqtt.client as mqtt

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    client.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD)
    client.connect(MQTT_BROKER_HOST, MQTT_BROKER_PORT, keepalive=10)
    client.loop_start()
    client.publish(f"{MQTT_TOPIC_PREFIX}/remote/command", json.dumps(payload)).wait_for_publish(timeout=5)
    client.loop_stop()
    client.disconnect()


@app.route("/api/live_state")
def api_live_state():
    return jsonify(list(live_sensors.values()))


@app.route("/api/automation_events")
def api_automation_events():
    limit = request.args.get("limit", 200, type=int)
    return jsonify(automation_log[-limit:])


@app.route("/api/command", methods=["POST"])
def api_command():
    payload = request.json or {}
    if "type" not in payload:
        return jsonify({"error": "'type' is required (ac_command / toggle_switch / send_ir)"}), 400
    try:
        publish_command(payload)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/stream")
def stream():
    """Server-Sent Events endpoint — identical pattern to the Pi app's."""
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


DASHBOARD_HTML = """<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Smart Motion Sensor — Cloud</title>
<style>
  body { font-family: -apple-system, "Segoe UI", sans-serif; max-width: 720px; margin: 40px auto; padding: 0 16px; color: #1b1f27; }
  h1 { font-size: 22px; }
  h2 { font-size: 15px; color: #5b5648; margin-top: 32px; }
  .card { border: 1px solid #ddd; border-radius: 8px; padding: 12px 16px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; }
  .muted { color: #888; font-size: 13px; }
  button { padding: 8px 14px; border-radius: 6px; border: 1px solid #ccc; background: #f4f4f4; cursor: pointer; margin-right: 8px; }
  button:hover { background: #e8e8e8; }
  input[type=number] { width: 70px; padding: 6px; border-radius: 6px; border: 1px solid #ccc; }
  #log { max-height: 240px; overflow-y: auto; border: 1px solid #ddd; border-radius: 8px; padding: 8px 12px; font-family: monospace; font-size: 12px; }
  #log div { padding: 3px 0; border-bottom: 1px solid #eee; }
</style>
</head>
<body>
<h1>Smart Motion Sensor — Cloud</h1>
<p class="muted">Mirrors the Pi over MQTT. This page never talks to Tuya directly.</p>

<h2>Live sensors</h2>
<div id="sensors"></div>

<h2>Controls</h2>
<div class="card">
  <span>AC Power</span>
  <span><button onclick="sendCommand({type:'ac_command', code:'PowerOn', value:'PowerOn'})">On</button>
  <button onclick="sendCommand({type:'ac_command', code:'PowerOff', value:'PowerOff'})">Off</button></span>
</div>
<div class="card">
  <span>AC Temperature</span>
  <span><input type="number" id="temp" value="24"> <button onclick="sendCommand({type:'ac_command', code:'T', value: Number(document.getElementById('temp').value)})">Set</button></span>
</div>
<div class="card">
  <span>Switch Robot</span>
  <span><button onclick="sendCommand({type:'toggle_switch', value: true})">On</button>
  <button onclick="sendCommand({type:'toggle_switch', value: false})">Off</button></span>
</div>

<h2>Recent automation activity</h2>
<div id="log"></div>

<script>
function sendCommand(payload) {
  fetch('/api/command', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload) })
    .then(r => r.json()).then(r => { if (r.error) alert(r.error); });
}

const sensors = {};
function renderSensors() {
  const el = document.getElementById('sensors');
  el.innerHTML = Object.values(sensors).map(s =>
    `<div class="card"><span>${s.id}</span><span>${s.value ?? '—'} ${s.online === false ? '(offline)' : ''}</span></div>`
  ).join('') || '<p class="muted">No sensor data received yet.</p>';
}

function prependLog(text) {
  const el = document.getElementById('log');
  const row = document.createElement('div');
  row.textContent = text;
  el.prepend(row);
}

fetch('/api/live_state').then(r => r.json()).then(rows => {
  rows.forEach(s => sensors[s.id] = s);
  renderSensors();
});
fetch('/api/automation_events').then(r => r.json()).then(rows => {
  rows.slice().reverse().forEach(e => prependLog(`${e.id} — ${e.success ? 'success' : 'FAILED'}`));
});

const source = new EventSource('/api/stream');
source.addEventListener('sensor_update', (e) => {
  const data = JSON.parse(e.data);
  sensors[data.id] = data;
  renderSensors();
});
source.addEventListener('automation_triggered', (e) => {
  const data = JSON.parse(e.data);
  prependLog(`${data.id} — ${data.success ? 'success' : 'FAILED'}`);
});
</script>
</body>
</html>
"""


@app.route("/")
def index():
    return Response(DASHBOARD_HTML, mimetype="text/html")


if __name__ == "__main__":
    threading.Thread(target=start_mqtt_subscriber, daemon=True).start()
    app.run(host="0.0.0.0", port=5001, debug=False, threaded=True)
