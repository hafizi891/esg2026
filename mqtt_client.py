import json

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
