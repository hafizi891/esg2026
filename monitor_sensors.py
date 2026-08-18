import time
import json
import os
import base64

try:
    import tinytuya
except ImportError:
    print("tinytuya is not installed. Please install it using: pip install tinytuya")
    exit(1)

# ==========================================
# CONFIGURATION
# ==========================================
# Device IDs from your provided Tuya raw data
PIR_DEVICE_ID = "a3844ede25b981a2f9u2sq"
IR_BLASTER_ID = "a33de1f9d52a1c1fd5xv23"

# The base64 IR code you want to send (e.g., Turn on TV)
# You need to sniff or learn this code using the Tuya app or debug logs.
# E.g. "YOUR_BASE64_IR_CODE"
IR_CODE_BASE64 = "YOUR_BASE64_IR_CODE"
# ==========================================

def load_devices():
    if not os.path.exists('devices.json'):
        print("devices.json not found!")
        print("Please run 'python -m tinytuya wizard' to link your Tuya account and generate devices.json")
        return []
        
    with open('devices.json', 'r') as f:
        devices = json.load(f)
    return devices

def send_ir_command(ir_device, base64_code):
    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Sending IR command...")
    # IR blasters typically use DP 201 to send IR codes. 
    # Structure may vary slightly by manufacturer.
    command = {
        "control": "send_ir",
        "head": "",
        "key1": base64_code,
        "type": 0,
        "delay": 300
    }
    
    # Generate the payload for DP 201 and send it
    payload = ir_device.generate_payload(tinytuya.CONTROL, {"201": json.dumps(command)})
    ir_device.send(payload)
    print("IR command sent.")

def main():
    print("TinyTuya PIR to IR Automation")
    print("-" * 30)
    
    device_configs = load_devices()
    
    if not device_configs:
        return

    # Find the specific devices
    pir_config = next((d for d in device_configs if d['id'] == PIR_DEVICE_ID), None)
    ir_config = next((d for d in device_configs if d['id'] == IR_BLASTER_ID), None)

    pir_device = None
    ir_device = None

    if pir_config:
        try:
            pir_device = tinytuya.Device(pir_config['id'], pir_config['ip'], pir_config['local_key'])
            pir_device.set_version(3.3)
            pir_device.set_socketPersistent(True) # Keep open for listening
            print(f"PIR Sensor Initialized: {pir_config.get('name', 'Unknown')} ({pir_config['ip']})")
        except Exception as e:
            print(f"Error initializing PIR sensor: {e}")
            
    if ir_config:
        try:
            ir_device = tinytuya.Device(ir_config['id'], ir_config['ip'], ir_config['local_key'])
            ir_device.set_version(3.3)
            print(f"IR Blaster Initialized: {ir_config.get('name', 'Unknown')} ({ir_config['ip']})")
        except Exception as e:
            print(f"Error initializing IR blaster: {e}")

    if not pir_device:
        print("\nPIR Device not initialized. Please check your network connection.")
        return

    print("\nListening for motion events (Press Ctrl+C to stop)...")
    
    try:
        while True:
            # Receive data from the PIR sensor
            data = pir_device.receive()
            
            if data and 'dps' in data:
                dps = data['dps']
                
                # Check for motion. Based on your raw JSON mapping, 
                # DP '1' is the PIR state and returns "pir" or "none".
                if '1' in dps:
                    pir_state = dps['1']
                    
                    if pir_state == "pir":
                        print(f"\n[{time.strftime('%Y-%m-%d %H:%M:%S')}] MOTION DETECTED!")
                        
                        # Trigger the IR Blaster if configured
                        if ir_device and IR_CODE_BASE64 != "YOUR_BASE64_IR_CODE":
                            send_ir_command(ir_device, IR_CODE_BASE64)
                        else:
                            print("Skipping IR blast (IR code not configured in script yet).")
                    elif pir_state == "none":
                        print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Motion cleared.")
                        
            time.sleep(0.1)
            
    except KeyboardInterrupt:
        print("\nMonitoring stopped by user.")

if __name__ == "__main__":
    main()
