# Smart Motion Sensor

A self-hosted dashboard for Tuya-based home automation: a PIR motion sensor drives
rule-based automations (turn on the AC, adjust its temperature in stages, toggle a
switch robot, send IR codes) with a live floor-plan dashboard, activity logs, and
usage analytics.

Backend is Flask + SQLite. Frontend is React (Vite + Tailwind). Devices are
controlled through the Tuya Cloud API, with a persistent local connection to the
PIR sensor for low-latency motion detection.

## Features

- **Floor plan dashboard** — rooms laid out visually, live sensor/device state, alerts for offline devices.
- **Automation engine** — motion-detected / no-motion-timeout triggers, bundled AC commands (power, temperature, mode, fan) with per-command delays and staged multi-value sequences (e.g. set 30°C now, 24°C two minutes later).
- **State-diff guard, not a cooldown** — actions only resend when the target state actually differs from what was last applied, so a rule can fire on every motion event without spamming the AC.
- **Logs & analytics** — every automation firing (success or failure), plus gap/flicker analysis to help tune sensible "no motion" thresholds.
- **Network scan & self-healing** — detects when a local device's IP has drifted (common after Wi-Fi reconnects) and offers a one-click fix; the PIR listener also recovers automatically from a wedged connection.
- **Optional MQTT mirror** — publish every command to a broker for other systems (Home Assistant, Node-RED, etc.) to observe.
- **Optional local IR replay** — capture the exact AC settings you use once (`capture_ir_codes.py`) and they're sent locally afterward, with zero Tuya cloud API calls; falls back to the cloud endpoint automatically for anything not yet captured.

## Setup

### Backend

```bash
pip install -r requirements.txt
cp .env.example .env        # fill in your Tuya Cloud API credentials and device IDs
cp facility.example.json facility.json   # your room layout + sensors; devices can also be added via Settings in the UI
python app.py
```

Required in `.env`:

| Variable | What it is |
|---|---|
| `TUYA_API_REGION` | Tuya Cloud data center region (e.g. `sg`, `us`, `eu`) |
| `TUYA_API_KEY` / `TUYA_API_SECRET` | Tuya Cloud project credentials |
| `TUYA_IR_BLASTER_ID` | Device ID of your IR blaster |
| `TUYA_AC_DEVICE_ID` | Device ID of the AC remote (sub-device behind the IR blaster) |
| `TUYA_SWITCH_ROBOT_ID` | Device ID of your switch/clicker robot |

A PIR sensor's `local_ip` / `local_key` / `local_version` are configured per-sensor
via the Settings page (or directly in `facility.json`), since local control needs
the device's LAN address in addition to its cloud device ID.

### Frontend

```bash
cd frontend
npm install
npm run build
```

Flask serves the built frontend from `frontend/dist` — rebuild after any frontend
change; the backend doesn't need a restart for frontend-only changes, but does for
any Python change.

Then open `http://localhost:5000`.

### Optional: local IR replay (skip Tuya's cloud AC endpoint)

Every AC command normally goes through Tuya's cloud "IR Control Hub" endpoint, which
counts against your API quota. To send commands locally instead:

```bash
python capture_ir_codes.py
```

This walks through every distinct AC setting your automations currently use (power
on/off, each temperature, etc.), asks you to point the *real* AC remote at the IR
blaster and press the matching button, and saves the captured signal to
`ir_codes.json` (gitignored — it's specific to your exact remote/model). Once a
setting is captured, `send_ac_command()` replays it locally for free; anything not
yet captured still falls back to the cloud endpoint automatically, so partial
capture never breaks anything. Re-run the script any time you add a new
temperature/mode/fan value to an automation.

## Project layout

- `app.py` — Flask routes, device polling loop, PIR listener thread, SSE stream.
- `automation_engine.py` — rule evaluation, action dispatch, anti-spam guards.
- `facility_store.py` — reads/writes `facility.json` (floors, rooms, sensors, automations).
- `analytics_store.py` — SQLite-backed readings/automation-event history.
- `mqtt_client.py` — optional MQTT mirroring of outgoing commands.
- `ir_codes.py` / `capture_ir_codes.py` — optional local IR capture/replay for the AC (see above).
- `frontend/` — React dashboard (Dashboard, Automations, Logs, Analytics, Settings pages).

## Notes

- `facility.json` and `devices.json`/`snapshot.json` (leftover tinytuya wizard output)
  are gitignored — they contain your real device IDs and local encryption keys.
- Tuya's IR-blaster-controlled AC needs its dedicated `/v2.0/infrareds/.../air-conditioners/.../command`
  endpoint — a generic device command never triggers real IR output for this category.
