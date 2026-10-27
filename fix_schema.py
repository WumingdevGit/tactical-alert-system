import sqlite3

conn = sqlite3.connect('data/processed/alerts.db')
cursor = conn.cursor()

print("[START] Updating live_alerts table...")

try:
    cursor.execute("ALTER TABLE live_alerts ADD COLUMN status TEXT DEFAULT 'ACTIVE'")
    print(" >>> [SUCCESS] Added 'status'")
except sqlite3.OperationalError:
    print(" >>> [SKIP] 'status' already exists")

try:
    cursor.execute("ALTER TABLE live_alerts ADD COLUMN acknowledged_at TIMESTAMP")
    print(" >>> [SUCCESS] Added 'acknowledged_at'")
except sqlite3.OperationalError:
    print(" >>> [SKIP] 'acknowledged_at' already exists")

try:
    cursor.execute("ALTER TABLE live_alerts ADD COLUMN response_time_seconds INTEGER")
    print(" >>> [SUCCESS] Added 'response_time_seconds'")
except sqlite3.OperationalError:
    print(" >>> [SKIP] 'response_time_seconds' already exists")

conn.commit()
conn.close()
print("[DONE] live_alerts is ready for tactical commands!")