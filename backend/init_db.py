import os
import sqlite3

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "..", "data", "processed")
os.makedirs(DATA_DIR, exist_ok=True)
DB_PATH = os.path.join(DATA_DIR, "alerts.db")

def init_database():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # 1. Registered Outposts (Fixed Location, No Live GPS)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS nodes (
            node_id INTEGER PRIMARY KEY,
            node_name TEXT NOT NULL,
            fixed_latitude REAL NOT NULL,
            fixed_longitude REAL NOT NULL,
            lga_name TEXT NOT NULL DEFAULT 'Biu',
            state TEXT NOT NULL DEFAULT 'Borno',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # 2. Live and Archived Alert Telemetry
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS live_alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            msg_id TEXT UNIQUE,
            node_id INTEGER NOT NULL,
            sequence_number INTEGER DEFAULT 0,
            alert_type TEXT NOT NULL,
            battery_level REAL DEFAULT 0.0,
            rssi REAL DEFAULT 0.0,
            snr REAL DEFAULT 0.0,
            latitude REAL,
            longitude REAL,
            lga_name TEXT DEFAULT 'Biu',
            state TEXT DEFAULT 'Borno',
            status TEXT DEFAULT 'ACTIVE',
            received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            acknowledged_at DATETIME,
            response_time_seconds INTEGER DEFAULT 0,
            disorder_type TEXT DEFAULT 'Political violence',
            event_type TEXT DEFAULT 'Battles',
            sub_event_type TEXT DEFAULT 'Armed clash',
            actor1 TEXT DEFAULT 'ISWAP: Islamic State West Africa Province',
            actor2 TEXT DEFAULT 'Security Outpost Sentinel',
            fatalities INTEGER DEFAULT 0,
            notes TEXT DEFAULT '',
            FOREIGN KEY (node_id) REFERENCES nodes (node_id)
        )
    """)

    # 3. Deterministic Historical ACLED Sector Risk Baseline
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS risk_scores (
            lga_name TEXT PRIMARY KEY,
            state TEXT NOT NULL,
            latitude REAL,
            longitude REAL,
            risk_score REAL DEFAULT 0.0,
            event_count INTEGER DEFAULT 0,
            total_fatalities INTEGER DEFAULT 0,
            primary_actor TEXT DEFAULT 'ISWAP: Islamic State West Africa Province',
            primary_event_type TEXT DEFAULT 'Battles - Armed clash',
            last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Populate baseline testing data if empty
    cursor.execute("SELECT COUNT(*) FROM nodes")
    if cursor.fetchone()[0] == 0:
        cursor.executemany("""
            INSERT INTO nodes (node_id, node_name, fixed_latitude, fixed_longitude, lga_name, state)
            VALUES (?, ?, ?, ?, ?, ?)
        """, [
            (101, "Biu Perimeter Sentinel 1", 10.6180, 12.1945, "Biu", "Borno"),
            (102, "Academic Area Outpost", 10.6135, 12.1890, "Biu", "Borno"),
            (103, "Southern Boundary Post", 10.6050, 12.1980, "Biu", "Borno")
        ])

    cursor.execute("SELECT COUNT(*) FROM risk_scores")
    if cursor.fetchone()[0] == 0:
        cursor.execute("""
            INSERT INTO risk_scores (lga_name, state, latitude, longitude, risk_score, event_count, total_fatalities, primary_actor, primary_event_type)
            VALUES ('Biu', 'Borno', 10.6117, 12.1919, 12.2, 163, 913, 'ISWAP: Islamic State West Africa Province', 'Battles - Armed clash')
        """)

    conn.commit()
    conn.close()
    print(f"[OK] Database initialized successfully at: {DB_PATH}")

if __name__ == "__main__":
    init_database()