import json
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


def get_config():
    return {**DEFAULT_CONFIG, **facility_store.get_mqtt_config()}


def publish(topic_suffix, payload):
    """Publish a JSON payload to the MQTT broker. No-op when disabled, so
    this is safe to call unconditionally from any call site. Connects fresh
    per call — commands are infrequent (user/automation triggered, not a
    polling loop), so a short-lived connection is simpler than managing a
    persistent client's reconnect-on-config-change lifecycle."""
    config = get_config()
    if not config["enabled"]:
        return
    try:
        import paho.mqtt.client as mqtt

        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
        if config["username"]:
            client.username_pw_set(config["username"], config["password"])
        client.connect(config["broker_host"], config["broker_port"], keepalive=10)
        client.loop_start()
        topic = f"{config['topic_prefix']}/{topic_suffix}"
        client.publish(topic, json.dumps(payload)).wait_for_publish(timeout=5)
        client.loop_stop()
        client.disconnect()
    except Exception as e:
        print(f"MQTT publish error: {e}")


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
            time.sleep(10)
            continue
        if not config["username"]:
            print("MQTT remote listener: refusing to start without a broker username/password configured")
            time.sleep(30)
            continue
        try:
            import paho.mqtt.client as mqtt

            def on_message(client, userdata, msg):
                try:
                    payload = json.loads(msg.payload.decode("utf-8"))
                except (ValueError, UnicodeDecodeError) as e:
                    print(f"MQTT remote listener: bad payload on {msg.topic}: {e}")
                    return
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
            client.loop_forever()  # blocks; paho reconnects automatically on a dropped connection
        except Exception as e:
            print(f"MQTT remote listener error: {e} — retrying in 10s")
            time.sleep(10)
