# ESG Intelligence (NodeMCU prototype)

A NodeMCU (ESP8266) reports motion, sound and AC actions over MQTT. The cloud
dashboard in `cloud/` mirrors them live, stores them in SQLite, and turns them into an
ESG operational report (AC runtime, efficient-setpoint share, occupancy, sound
activity) with CSV export. It is read-only: it never sends commands to the board.

```
NodeMCU  --publish-->  MQTT broker  <--subscribe--  cloud/cloud_app.py  -->  browser
```

## MQTT topics

All under `MQTT_TOPIC_PREFIX` (default `devices/esp-prototype-01`):

| Topic | Payload | Meaning |
|---|---|---|
| `status` | `online` / `offline` | Board connection (use as the MQTT last will) |
| `motion` | `{"motion": true}` | PIR state change |
| `sound` | `{"sound": true, "level": 512}` | Sound over threshold; `level` is A0 peak-to-peak over 50 ms, not dB |
| `ir` | `{"command": "aircon_24_low", "source": "MOTION"}` | Confirmed AC action: `aircon_off`, `aircon_<temp>`, `aircon_<temp>_<fan>` |

Parsing lives in `cloud/esp_mqtt.py`; analytics in `cloud/esg_analytics.py`.

## Run

```bash
cd cloud
pip install -r requirements.txt
cp .env.example .env          # broker details + dashboard password
cd frontend && npm install && npm run build && cd ..
python cloud_app.py           # serves on port 5001
```

The dashboard is meant for the open internet, so put it behind HTTPS. The session
cookie is HTTPS-only (plain `http://localhost` still works for local testing). Prod
uses nginx: see [deploy/nginx-esg-dashboard.conf](deploy/nginx-esg-dashboard.conf)
(HTTP→HTTPS redirect, HSTS, gzip, asset caching, SSE).

Run a single process: each process starts its own MQTT subscriber and would store
every event once per process.

Report days run midnight to midnight in Malaysia time (UTC+8, `REPORT_TZ` in
`esg_analytics.py`).

MQTT broker settings are read-only in the dashboard; change them in `cloud/.env` and
restart.

## Operations

**Backup.** All report history is in one file, `cloud/esg_analytics.db`. Back it up
daily with cron (`crontab -e`), keeping 30 days:

```
0 3 * * * sqlite3 /path/to/cloud/esg_analytics.db ".backup /path/to/backups/esg-$(date +\%F).db" && find /path/to/backups -name 'esg-*.db' -mtime +30 -delete
```

Copy the backups off the VM too.

**Health check.** `GET /api/health` (no login) returns 200 while MQTT is connected and a
message arrived in the last 10 minutes, otherwise 503. Point an uptime monitor (e.g.
UptimeRobot) at `https://<your-domain>/api/health`.

**Offline alerts.** Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in `cloud/.env` to get
a Telegram message when the board goes offline or comes back (create a bot with
@BotFather). Unset = no alerts. The board must publish `offline` on `status` as its
MQTT last will for this to fire on a power or Wi-Fi loss.

While the board is offline, AC runtime is not counted (its state is unknown) and any
open motion interval is closed.

## Tests

```bash
python -m unittest discover -s tests -p "test_*.py"
```

They also run on every push via GitHub Actions (`.github/workflows/tests.yml`).
