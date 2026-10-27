import os
import sqlite3
import pandas as pd
import re

# Absolute paths guarantee defense-day stability
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CSV_PATH = os.path.join(BASE_DIR, "..", "data", "raw", "acled_nigeria.csv")
DB_PATH = os.path.join(BASE_DIR, "..", "data", "processed", "alerts.db")

def normalize_string(s):
    if pd.isna(s): 
        return "UNKNOWN"
    s = str(s).upper()
    s = s.replace(' LGA', '') # Remove LGA suffix if present
    s = re.sub(r'[^A-Z0-9]', '', s) # Strip all spaces, hyphens, and punctuation
    return s

def clean_and_ingest():
    if not os.path.exists(CSV_PATH):
        print(f"[ERROR] CSV not found at {CSV_PATH}")
        return

    print("[PROCESS] Loading ACLED historical data for ALL states...")
    df = pd.read_csv(CSV_PATH, low_memory=False)
    
    # Apply aggressive universal normalization to guarantee map matching
    df['admin1_clean'] = df['admin1'].apply(normalize_string)
    df['admin2_clean'] = df['admin2'].apply(normalize_string)
    df['fatalities'] = pd.to_numeric(df['fatalities'], errors='coerce').fillna(0)

    # Correct ACLED's known location misclassifications for your operational area
    biu_settlements = ['BIU', 'MIRINGA', 'BURATAI', 'GALDIMARE', 'KIMBA']
    df.loc[df['location'].astype(str).str.upper().isin(biu_settlements), 'admin2_clean'] = 'BIU'

    print("[PROCESS] Aggregating incidents by normalized LGA...")
    aggregated = df.groupby(['admin1_clean', 'admin2_clean']).agg(
        event_count=('admin2_clean', 'count'),
        total_fatalities=('fatalities', 'sum'),
        primary_event_type=('event_type', lambda x: x.mode()[0] if not x.mode().empty else 'Unknown'),
        primary_actor=('actor1', lambda x: x.mode()[0] if not x.mode().empty else 'Unknown'),
        display_name=('admin2', 'first'), # Keep original readable name for the UI
        display_state=('admin1', 'first')
    ).reset_index()

    max_events = aggregated['event_count'].max()
    max_fatalities = aggregated['total_fatalities'].max()
    
    aggregated['risk_score'] = (
        (aggregated['event_count'] / max_events * 60) + 
        (aggregated['total_fatalities'] / max_fatalities * 40)
    ).round(1)

    print(f"[PROCESS] Connecting to shared database at: {DB_PATH}")
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Drop the old table completely to force a schema update
    cursor.execute("DROP TABLE IF EXISTS risk_scores")

    cursor.execute("""
        CREATE TABLE risk_scores (
            lga_name TEXT,
            state TEXT NOT NULL,
            latitude REAL,
            longitude REAL,
            risk_score REAL DEFAULT 0.0,
            event_count INTEGER DEFAULT 0,
            total_fatalities INTEGER DEFAULT 0,
            primary_actor TEXT,
            primary_event_type TEXT,
            display_name TEXT,
            last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (lga_name, state)
        )
    """)

    # We removed DELETE FROM risk_scores since we just dropped and recreated it

    records = [
        (row['admin2_clean'], row['display_state'], 0.0, 0.0, row['risk_score'], 
         row['event_count'], row['total_fatalities'], row['primary_actor'], row['primary_event_type'], row['display_name'])
        for _, row in aggregated.iterrows()
    ]

    cursor.executemany("""
        INSERT INTO risk_scores 
        (lga_name, state, latitude, longitude, risk_score, event_count, total_fatalities, primary_actor, primary_event_type, display_name)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, records)

    conn.commit()
    conn.close()
    print("[SUCCESS] All Nigerian LGAs processed, normalized, and locked into the primary database.")

if __name__ == "__main__":
    clean_and_ingest()