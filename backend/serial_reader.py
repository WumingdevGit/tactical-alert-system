import os
import json
import time
import sqlite3
from datetime import datetime
import serial
import serial.tools.list_ports

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "..", "data", "processed", "alerts.db")

# Approved project alert categories
VALID_ALERT_TYPES = {
    "1": "Armed Attack",
    "2": "Kidnapping/Ambush",
    "3": "Medical/Fire",
    "ARMED ATTACK": "Armed Attack",
    "KIDNAPPING/AMBUSH": "Kidnapping/Ambush",
    "MEDICAL/FIRE": "Medical/Fire"
}

# Cache for duplicate suppression: {(node_id, sequence_number): last_seen_timestamp}
packet_cache = {}
DEDUPLICATION_WINDOW_SECONDS = 30.0

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def auto_detect_gateway_port():
    """Detect Silicon Labs CP210x or CH340 USB-UART bridges commonly on TTGO boards."""
    ports = serial.tools.list_ports.comports()
    for p in ports:
        desc = (p.description or "").lower()
        hwid = (p.hwid or "").lower()
        if "cp210" in desc or "ch340" in desc or "uart" in desc or "usb" in desc:
            return p.device
    return None

def process_payload(payload):
    """
    Expected payload format (JSON string from Gateway via USB serial):
    {
        "origin_id": 101,
        "alert_type": "Armed Attack", # or code "1", "2", "3"
        "battery_percent": 88,
        "sequence_number": 42,
        "rssi": -85.5,
        "snr": 6.2
    }
    """
    global packet_cache
    now = time.time()

    node_id = int(payload.get("origin_id", 0))
    raw_type = str(payload.get("alert_type", "Armed Attack")).strip().upper()
    alert_type = VALID_ALERT_TYPES.get(raw_type, "Armed Attack")
    battery_level = float(payload.get("battery_percent", 100.0))
    seq_num = int(payload.get("sequence_number", 0))
    rssi = float(payload.get("rssi", -90.0))
    snr = float(payload.get("snr", 0.0))

    # 1. Duplicate Packet Suppression (origin_id + sequence_number)
    cache_key = (node_id, seq_num)
    if cache_key in packet_cache:
        if now - packet_cache[cache_key] < DEDUPLICATION_WINDOW_SECONDS:
            print(f"[SERIAL] Duplicate packet ignored: Node #{node_id}, Seq #{seq_num}")
            return
    packet_cache[cache_key] = now

    # Clean old cache entries
    packet_cache = {k: v for k, v in packet_cache.items() if now - v < DEDUPLICATION_WINDOW_SECONDS}

    # 2. Resolve fixed coordinates from registered database outpost
    conn = get_db()
    cursor = conn.cursor()
    node = cursor.execute("SELECT * FROM nodes WHERE node_id = ?", (node_id,)).fetchone()

    if node:
        lat = node["fixed_latitude"]
        lon = node["fixed_longitude"]
        lga = node["lga_name"]
        state = node["state"]
    else:
        # Unregistered node fallback
        lat = 10.6117
        lon = 12.1919
        lga = "Biu"
        state = "Borno"
        print(f"[WARN] Node #{node_id} not pre-registered. Using default sector coordinates.")

    msg_id = f"LORA-{node_id}-{seq_num}-{int(now)}"
    time_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")

    cursor.execute("""
        INSERT INTO live_alerts 
        (msg_id, node_id, sequence_number, alert_type, battery_level, rssi, snr, 
         latitude, longitude, lga_name, state, status, received_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)
    """, (msg_id, node_id, seq_num, alert_type, battery_level, rssi, snr, lat, lon, lga, state, time_str))

    conn.commit()
    conn.close()
    print(f"[INGEST] Incoming {alert_type} from Outpost #{node_id} (RSSI: {rssi} dBm, Batt: {battery_level}%) logged.")

def run_serial_listener(port=None, baudrate=115200):
    if not port:
        port = auto_detect_gateway_port()

    if not port:
        print("[ERROR] No USB Gateway hardware detected. Connect the Gateway TTGO board or specify port manually.")
        return

    print(f"[SERIAL] Connecting to Gateway on port {port} at {baudrate} baud...")
    try:
        ser = serial.Serial(port, baudrate, timeout=1.5)
        time.sleep(2) # Allow board reboot after DTR toggle
        print("[SERIAL] Gateway receiver online. Listening for point-to-point LoRa packets...")

        while True:
            line = ser.readline().decode('utf-8', errors='ignore').strip()
            if line:
                if line.startswith("{") and line.endswith("}"):
                    try:
                        data = json.loads(line)
                        process_payload(data)
                    except json.JSONDecodeError:
                        print(f"[WARN] Malformed serial JSON received: {line}")
                else:
                    # Log raw non-JSON debug strings from microcontroller if any
                    print(f"[GATEWAY DEBUG] {line}")
            time.sleep(0.01)

    except serial.SerialException as e:
        print(f"[SERIAL CRITICAL] Port error: {e}")
    except KeyboardInterrupt:
        print("\n[SERIAL] Listener halted by operator.")

if __name__ == "__main__":
    import sys
    custom_port = sys.argv[1] if len(sys.argv) > 1 else None
    run_serial_listener(port=custom_port)