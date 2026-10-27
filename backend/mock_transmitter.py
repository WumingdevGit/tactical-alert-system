import sqlite3
import time
import random
import os

# Locate the database
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "..", "data", "processed", "alerts.db")

def send_distress_signal(node_id, lat, lon, alert_type=1):
    """Simulates an incoming LoRa packet being written to the database."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Simulate RF telemetry and battery decay
    msg_id = random.randint(10000, 99999)
    rssi = random.randint(-115, -60)        # LoRa Signal Strength
    snr = round(random.uniform(-7.5, 9.0), 1) # Signal-to-Noise Ratio
    battery = round(random.uniform(3.4, 4.1), 2) # Lithium-ion voltage
    
    try:
        cursor.execute("""
            INSERT INTO live_alerts 
            (msg_id, node_id, latitude, longitude, alert_type, battery_level, rssi, snr, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
        """, (msg_id, node_id, lat, lon, alert_type, battery, rssi, snr))
        
        conn.commit()
        print(f"[LORA RX] Packet received! Node {node_id} | RSSI: {rssi}dBm | SNR: {snr}dB")
    except Exception as e:
        print(f"[ERROR] Database write failed: {e}")
    finally:
        conn.close()

if __name__ == "__main__":
    print("=== TACTICAL LORA SIMULATOR ===")
    print("Simulating distress burst from Node 102 (NAUB Hostel)...")
    
    # Send 3 rapid bursts to simulate a frantic button press
    for i in range(3):
        send_distress_signal(node_id=102, lat=10.6117, lon=12.1919, alert_type=1)
        time.sleep(1.5) # Wait 1.5 seconds between bursts
        
    print("Transmission complete. Check your React dashboard!")