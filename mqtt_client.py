import collections
import json
import threading
import time

import facility_store

# Mirrors every device command this app sends (IR codes, switch toggles —
# whether triggered manually from the dashboard or by an automation) to an
# MQTT broker, so other systems (Node-RED, Home Assistant, etc.) can observe
# them. Configured and toggled on/off from the Settings page — disabled by
# default until a broker is configured there.
DEFAULT_CONFIG = {
    "enabled": False,
    "broker_host": "localhost",
    "broker_port": 1883,
    "username": None,
    "password": None,
    "topic_prefix": "smart-motion-sensor",
}

# Recent publish/receive activity, oldest first — powers the local "MQTT"
# tab so there's something concrete to look at besides "is it enabled".
# Bounded so a long-running process doesn't grow this without limit.
_activity_log = collections.deque(maxlen=200)

# Connection status of the persistent remote-command listener specifically —
# publish() is a short-lived connect-per-call and has no ongoing connection
# to report on, but the listener does, and "is it actually connected right
# now" is exactly what you'd want to know from a status tab.
listener_status = {"connected": False, "last_error": None, "connected_at": None, "last_message_at": None}


def _log_activity(direction, topic, payload, error=None):
    _activity_log.append({"ts": time.time(), "direction": direction, "topic": topic, "payload": payload, "error": error})


def get_activity_log():
    return list(_activity_log)


def get_listener_status():
    return dict(listener_status)


def get_config():
    return {**DEFAULT_CONFIG, **facility_store.get_mqtt_config()}


def publish(topic_suffix, payload, retain=False):
    """Publish a JSON payload to the MQTT broker. No-op when disabled, so
    this is safe to call unconditionally from any call site.

    Fire-and-forget on its own background thread — this is called
    synchronously from the PIR listener's own thread (via notify_clients())
    for every single motion pulse, and from send_ac_command()/
    set_switch_state() for every device command. Measured directly: when the
    broker is unreachable (WiFi/server down), the connect attempt below takes
    ~5s to time out — if that ran inline, it would stall live motion
    detection and command handling by ~5s on every single event. Running it
    on a thread means a broker outage can drop MQTT messages, but can never
    slow down anything else in the app."""
    if not get_config()["enabled"]:
        return
    threading.Thread(target=_publish_blocking, args=(topic_suffix, payload, retain), daemon=True).start()


def _publish_blocking(topic_suffix, payload, retain=False):
    """The actual connect-publish-disconnect cycle — see publish() above for
    why this runs on its own thread rather than the caller's. Connects fresh
    per call — commands are infrequent (user/automation triggered, not a
    polling loop), so a short-lived connection is simpler than managing a
    persistent client's reconnect-on-config-change lifecycle.

    retain=True asks the broker to hold onto the last message on this topic
    and hand it to any client that subscribes later — used for "current
    state" snapshots (e.g. the heartbeat) so a cloud companion that
    (re)connects still sees the latest one immediately, instead of waiting
    up to a full heartbeat interval for the next."""
    config = get_config()
    if not config["enabled"]:
        return
    topic = f"{config['topic_prefix']}/{topic_suffix}"
    try:
        import paho.mqtt.client as mqtt

        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
        if config["username"]:
            client.username_pw_set(config["username"], config["password"])
        client.connect(config["broker_host"], config["broker_port"], keepalive=10)
        client.loop_start()
        client.publish(topic, json.dumps(payload), retain=retain).wait_for_publish(timeout=5)
        client.loop_stop()
        client.disconnect()
        _log_activity("out", topic, payload)
    except Exception as e:
        print(f"MQTT publish error: {e}")
        _log_activity("out", topic, payload, error=str(e))


def start_remote_listener(dispatch):
    """Runs forever (call in a background thread): subscribes to this app's
    "remote/command" topic and calls dispatch(payload) for each message
    received. This is what lets a separate cloud-hosted dashboard — one that
    never talks to Tuya directly, just publishes to this same broker —
    control real devices: the Pi does the actual device I/O, the cloud side
    only ever publishes a command.

    SECURITY: dispatch() runs whatever arrives on this topic against real
    hardware, with no authentication layer beyond the broker's own. This
    refuses to start unless a broker username/password is configured —
    never point this at a broker reachable from the open internet without
    credentials on it.

    Reloads config on every (re)connect attempt, same reasoning as
    listen_pir()'s facility.json reload — so enabling/disabling MQTT or
    changing broker details from Settings takes effect without an app
    restart."""
    while True:
        config = get_config()
        if not config["enabled"]:
            listener_status.update(connected=False, last_error=None)
            time.sleep(10)
            continue
        if not config["username"]:
            print("MQTT remote listener: refusing to start without a broker username/password configured")
            listener_status.update(connected=False, last_error="No broker username/password configured")
            time.sleep(30)
            continue
        try:
            import paho.mqtt.client as mqtt

            def on_message(client, userdata, msg):
                listener_status["last_message_at"] = time.time()
                try:
                    payload = json.loads(msg.payload.decode("utf-8"))
                except (ValueError, UnicodeDecodeError) as e:
                    print(f"MQTT remote listener: bad payload on {msg.topic}: {e}")
                    _log_activity("in", msg.topic, None, error=f"bad payload: {e}")
                    return
                _log_activity("in", msg.topic, payload)
                try:
                    dispatch(payload)
                except Exception as e:
                    print(f"MQTT remote listener: dispatch error: {e}")

            client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
            client.username_pw_set(config["username"], config["password"])
            client.on_message = on_message
            client.connect(config["broker_host"], config["broker_port"], keepalive=30)
            topic = f"{config['topic_prefix']}/remote/command"
            client.subscribe(topic)
            print(f"MQTT remote listener: subscribed to {topic}")
            listener_status.update(connected=True, connected_at=time.time(), last_error=None)
            client.loop_forever()  # blocks; paho reconnects automatically on a dropped connection
        except Exception as e:
            print(f"MQTT remote listener error: {e} — retrying in 10s")
            listener_status.update(connected=False, last_error=str(e))
            time.sleep(10)
