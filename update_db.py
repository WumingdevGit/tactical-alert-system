import sqlite3

# Connect to your active database
conn = sqlite3.connect('data/processed/alerts.db')
cursor = conn.cursor()

print("[START] Initializing schema update...")

# 1. Add status column
try:
    cursor.execute("ALTER TABLE alerts ADD COLUMN status TEXT DEFAULT 'ACTIVE'")
    print(" >>> [SUCCESS] Added 'status' column.")
except sqlite3.OperationalError:
    print(" >>> [SKIP] 'status' column already exists.")

# 2. Add acknowledged_at column
try:
    cursor.execute("ALTER TABLE alerts ADD COLUMN acknowledged_at TIMESTAMP")
    print(" >>> [SUCCESS] Added 'acknowledged_at' column.")
except sqlite3.OperationalError:
    print(" >>> [SKIP] 'acknowledged_at' column already exists.")

# 3. Add response_time_seconds column
try:
    cursor.execute("ALTER TABLE alerts ADD COLUMN response_time_seconds INTEGER")
    print(" >>> [SUCCESS] Added 'response_time_seconds' column.")
except sqlite3.OperationalError:
    print(" >>> [SKIP] 'response_time_seconds' column already exists.")

conn.commit()
conn.close()
print("[DONE] Database schema update complete.")