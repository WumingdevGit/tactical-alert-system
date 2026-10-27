import os
import sqlite3
import pandas as pd
import numpy as np

# File Paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CSV_PATH = os.path.join(BASE_DIR, "..", "data", "raw", "acled_nigeria.csv")
DB_PATH = os.path.join(BASE_DIR, "..", "data", "processed", "alerts.db")

# Half-life for temporal decay: 2 years (730 days)
HALF_LIFE_DAYS = 730.0
LAMBDA_DECAY = np.log(2) / HALF_LIFE_DAYS

def build_database():
    if not os.path.exists(CSV_PATH):
        print(f"[ERROR] Cannot find data at: {CSV_PATH}")
        return

    print("[PROCESSING] Loading ACLED dataset...")
    df = pd.read_csv(CSV_PATH, low_memory=False)

    # Standardize column names to lowercase
    df.columns = [col.strip().lower() for col in df.columns]

    # Map ACLED standard columns
    state_col = "admin1"
    lga_col = "admin2"
    date_col = "event_date"
    death_col = "fatalities"
    lat_col = "latitude"
    lon_col = "longitude"

    print("[PROCESSING] Cleaning records...")
    df = df.dropna(subset=[state_col, lga_col, date_col, lat_col, lon_col]).copy()
    df[date_col] = pd.to_datetime(df[date_col], format='mixed', errors="coerce")
    df[death_col] = pd.to_numeric(df[death_col], errors="coerce").fillna(0)
    df = df.dropna(subset=[date_col]).copy()

    # Calculate temporal decay relative to the newest event
    max_date = df[date_col].max()
    print(f"[PROCESSING] Reference date for recency decay: {max_date.date()}")
    
    delta_days = (max_date - df[date_col]).dt.total_seconds() / (24 * 3600)
    df["temporal_weight"] = np.exp(-LAMBDA_DECAY * delta_days)
    df["severity_weight"] = 1.0 + np.log1p(df[death_col])
    df["event_risk"] = df["severity_weight"] * df["temporal_weight"]

    print("[PROCESSING] Aggregating LGA risk indices...")
    lga_grouped = df.groupby([state_col, lga_col]).agg(
        raw_risk_score=("event_risk", "sum"),
        event_count=("event_risk", "count"),
        total_fatalities=(death_col, "sum"),
        latitude=(lat_col, "mean"),
        longitude=(lon_col, "mean")
    ).reset_index()

    # Normalize scores to 0-100
    min_r = lga_grouped["raw_risk_score"].min()
    max_r = lga_grouped["raw_risk_score"].max()
    if max_r > min_r:
        lga_grouped["risk_score"] = ((lga_grouped["raw_risk_score"] - min_r) / (max_r - min_r)) * 100.0
    else:
        lga_grouped["risk_score"] = 0.0

    lga_grouped["risk_score"] = lga_grouped["risk_score"].round(2)
    lga_grouped["latitude"] = lga_grouped["latitude"].round(6)
    lga_grouped["longitude"] = lga_grouped["longitude"].round(6)

    print("[DATABASE] Building SQLite schema...")
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    cursor.executescript("""
        CREATE TABLE IF NOT EXISTS risk_scores (
            lga_name TEXT NOT NULL,
            state TEXT NOT NULL,
            latitude REAL,
            longitude REAL,
            risk_score REAL NOT NULL,
            event_count INTEGER NOT NULL,
            total_fatalities INTEGER NOT NULL,
            last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (state, lga_name)
        );

        CREATE TABLE IF NOT EXISTS nodes (
            node_id INTEGER PRIMARY KEY,
            node_name TEXT NOT NULL,
            fixed_latitude REAL NOT NULL,
            fixed_longitude REAL NOT NULL,
            lga_name TEXT NOT NULL,
            state TEXT NOT NULL,
            last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS live_alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            msg_id INTEGER NOT NULL,
            node_id INTEGER NOT NULL,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            alert_type INTEGER NOT NULL,
            battery_level REAL NOT NULL,
            rssi INTEGER NOT NULL,
            snr REAL NOT NULL,
            status TEXT DEFAULT 'ACTIVE',
            received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (node_id) REFERENCES nodes (node_id)
        );
    """)

    # Populate Risk Scores
    lga_data = lga_grouped[[lga_col, state_col, "latitude", "longitude", "risk_score", "event_count", "total_fatalities"]].values.tolist()
    cursor.executemany("""
        INSERT OR REPLACE INTO risk_scores 
        (lga_name, state, latitude, longitude, risk_score, event_count, total_fatalities)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, lga_data)

    # Insert a tactical dummy node so we have something to trigger alerts with
    cursor.execute("""
        INSERT OR IGNORE INTO nodes (node_id, node_name, fixed_latitude, fixed_longitude, lga_name, state)
        VALUES (101, 'NAUB Hostel Outpost', 10.6117, 12.1919, 'Biu', 'Borno')
    """)

    conn.commit()
    conn.close()
    print(f"[SUCCESS] Processed {len(lga_grouped)} LGAs and built database at {DB_PATH}")

if __name__ == "__main__":
    build_database()