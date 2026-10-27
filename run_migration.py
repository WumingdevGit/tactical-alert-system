import sqlite3
import os

db_path = os.path.join("data", "processed", "alerts.db")
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

# Required ACLED columns
columns_to_add = [
    ("disorder_type", "TEXT DEFAULT 'Political violence'"),
    ("event_type", "TEXT DEFAULT 'Battles'"),
    ("sub_event_type", "TEXT DEFAULT 'Armed clash'"),
    ("actor1", "TEXT DEFAULT 'ISWAP: Islamic State West Africa Province'"),
    ("actor2", "TEXT DEFAULT 'Security Outpost Sentinel'"),
    ("fatalities", "INTEGER DEFAULT 0"),
    ("notes", "TEXT DEFAULT 'Sub-GHz distress burst resolved by operator'")
]

for col_name, col_type in columns_to_add:
    try:
        cursor.execute(f"ALTER TABLE live_alerts ADD COLUMN {col_name} {col_type}")
        print(f"[OK] Added column: {col_name}")
    except sqlite3.OperationalError:
        print(f"[INFO] Column already present: {col_name}")

conn.commit()
conn.close()
print("[DONE] Migration complete.")