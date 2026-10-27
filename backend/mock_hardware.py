import os
import random
import sqlite3
import sys
from datetime import datetime, timezone

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "..", "data", "processed", "alerts.db")

ALERT_TYPES = ["Armed Attack", "Kidnapping/Ambush", "Medical/Fire"]

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def trigger_virtual_lora_burst(node_id=None, custom_type=None):
    conn = get_db()
    cursor = conn.cursor()

    # Query requested outpost or pick the first available registered node
    node = None
    if node_id is not None:
        node = cursor.execute("SELECT * FROM nodes WHERE node_id = ?", (node_id,)).fetchone()

    if not node:
        node = cursor.execute("SELECT * FROM nodes ORDER BY node_id ASC LIMIT 1").fetchone()

    if not node:
        print("[SIMULATOR] Error: No nodes found in database. Deploy an outpost via the dashboard first.")
        conn.close()
        return

    target_id = node['node_id']

    # Realistic 868 MHz Point-to-Point signal telemetry
    rssi = round(random.uniform(-115.0, -78.0), 1)
    snr = round(random.uniform(-2.5, 9.5), 1)
    battery = round(random.uniform(72.0, 98.0), 1)
    seq_num = random.randint(100, 999)
    alert_type = custom_type or random.choice(ALERT_TYPES)

    now = datetime.now(timezone.utc)
    time_str = now.strftime("%Y-%m-%d %H:%M:%S")
    msg_id = f"SIM-P2P-{target_id}-{seq_num}-{int(now.timestamp())}"

    # Extract node coordinates
    lat = node['fixed_latitude'] if 'fixed_latitude' in node.keys() else 10.6180
    lon = node['fixed_longitude'] if 'fixed_longitude' in node.keys() else 12.1945
    lga = node['lga_name'] if 'lga_name' in node.keys() else "Biu"
    state = node['state'] if 'state' in node.keys() else "Borno"

    # Check available columns dynamically to avoid query crashes
    existing_cols = [c[1] for c in cursor.execute("PRAGMA table_info(live_alerts)").fetchall()]

    col_data = {
        "msg_id": msg_id,
        "node_id": target_id,
        "alert_type": alert_type,
        "battery_level": battery,
        "rssi": rssi,
        "snr": snr,
        "latitude": lat,
        "longitude": lon,
        "lga_name": lga,
        "state": state,
        "status": "ACTIVE",
        "received_at": time_str
    }

    if "sequence_number" in existing_cols:
        col_data["sequence_number"] = seq_num

    # Filter out columns that don't exist yet in the table
    valid_cols = [k for k in col_data.keys() if k in existing_cols]
    placeholders = ", ".join(["?"] * len(valid_cols))
    col_names = ", ".join(valid_cols)
    values = [col_data[c] for c in valid_cols]

    cursor.execute(f"INSERT INTO live_alerts ({col_names}) VALUES ({placeholders})", values)

    conn.commit()
    conn.close()

    print("\n[VIRTUAL LORA BURST TRANSMITTED]")
    print(f"  Outpost: #{target_id} ({node['node_name']})")
    print(f"  Category: {alert_type}")
    print(f"  RF Metrics: RSSI = {rssi} dBm, SNR = {snr} dB")
    print(f"  Battery: {battery}% | Seq: #{seq_num}")

if __name__ == "__main__":
    target = int(sys.argv[1]) if len(sys.argv) > 1 else None
    trigger_virtual_lora_burst(node_id=target)