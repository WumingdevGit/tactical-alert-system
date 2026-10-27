import sqlite3
from datetime import datetime

print("[START] Generating simulated sub-GHz distress burst...")

# Connect to your active database
conn = sqlite3.connect('data/processed/alerts.db')
cursor = conn.cursor()

# Generate a mock message ID and current UTC time
now = datetime.utcnow()
time_str = now.strftime("%Y-%m-%d %H:%M:%S")
mock_msg_id = f"SIM-{int(now.timestamp())}"

# Inject a new ACTIVE alert for Node #102 (near NAUB campus coordinates)
cursor.execute('''
    INSERT INTO live_alerts 
    (msg_id, node_id, latitude, longitude, alert_type, battery_level, rssi, snr, status, received_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
''', (mock_msg_id, 102, 10.6130, 12.1940, "DISTRESS", 3.45, -88, 4.2, "ACTIVE", time_str))

conn.commit()
conn.close()

print(f" >>> [SUCCESS] Packet {mock_msg_id} injected into telemetry stream.")
print("[DONE] Check your dashboard!")