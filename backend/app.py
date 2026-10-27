import os
import sqlite3
from flask import Flask, jsonify, request
from flask_cors import CORS
from datetime import datetime

# File Paths relative to this script
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "..", "data", "processed", "alerts.db")

app = Flask(__name__)
# Enable CORS so our React frontend on port 5173 can fetch data safely
CORS(app)

def get_db():
    """Helper to open an SQLite connection and return dict-like rows."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

@app.route("/api/health", methods=["GET"])
def health_check():
    return jsonify({"status": "ONLINE", "system": "TACTICAL_BASE_STATION"}), 200

@app.route("/api/risk-scores", methods=["GET"])
def get_risk_scores():
    try:
        conn = get_db()
        cursor = conn.cursor()
        # Fetch LGAs sorted by highest threat index first
        cursor.execute("""
            SELECT lga_name, state, latitude, longitude, risk_score, 
                   event_count, total_fatalities, last_updated 
            FROM risk_scores 
            ORDER BY risk_score DESC
        """)
        scores = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify(scores), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/alerts/live", methods=["GET"])
def get_live_alerts():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT a.id, a.msg_id, a.node_id, n.node_name, n.state, n.lga_name,
               a.latitude, a.longitude, a.alert_type, a.battery_level,
               a.rssi, a.snr, a.status, a.received_at, a.response_time_seconds
        FROM live_alerts a
        LEFT JOIN nodes n ON a.node_id = n.node_id
        WHERE a.status != 'RESOLVED'
        ORDER BY a.received_at DESC
        LIMIT 4
    """)
    alerts = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return jsonify(alerts), 200

@app.route("/api/nodes", methods=["GET"])
def get_nodes():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM nodes")
    nodes = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return jsonify(nodes), 200

@app.route("/api/nodes", methods=["POST"])
def register_node():
    data = request.json
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO nodes (node_id, node_name, fixed_latitude, fixed_longitude, lga_name, state)
            VALUES (?, ?, ?, ?, 'Biu', 'Borno')
        """, (data['node_id'], data['node_name'], data['latitude'], data['longitude']))
        conn.commit()
        conn.close()
        return jsonify({"status": "Node registered successfully"}), 201
    except Exception as e:
        return jsonify({"error": "Node ID already exists or invalid parameters."}), 400

@app.route('/api/alerts/<int:alert_id>/acknowledge', methods=['POST'])
def acknowledge_alert(alert_id):
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        # Check when the alert was originally received
        alert = cursor.execute('SELECT received_at FROM live_alerts WHERE id = ?', (alert_id,)).fetchone()
        
        if not alert:
            conn.close()
            return jsonify({"error": "Alert not found"}), 404
            
        received_at_str = alert['received_at']
        
        # Calculate the operator's response time in seconds
        try:
            received_time = datetime.strptime(received_at_str, "%Y-%m-%d %H:%M:%S")
            now = datetime.utcnow()
            response_delta = int((now - received_time).total_seconds())
        except Exception:
            response_delta = 0 # Fallback in case of time formatting issues

        # Update the database to reflect the acknowledged status
        cursor.execute('''
            UPDATE live_alerts 
            SET status = 'ACKNOWLEDGED', acknowledged_at = ?, response_time_seconds = ? 
            WHERE id = ?
        ''', (datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"), response_delta, alert_id))
        
        conn.commit()
        conn.close()
        
        return jsonify({"status": "success", "response_time_seconds": response_delta}), 200
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/alerts/<int:alert_id>/resolve', methods=['POST'])
def resolve_alert(alert_id):
    try:
        conn = get_db()
        cursor = conn.cursor()
        payload = request.get_json() or {}

        # 1. Fetch hardware alert telemetry
        alert = cursor.execute("""
            SELECT a.id, a.node_id, a.received_at, a.battery_level, a.rssi,
                   COALESCE(n.lga_name, 'Biu') AS lga_name,
                   COALESCE(n.state, 'Borno') AS state
            FROM live_alerts a
            LEFT JOIN nodes n ON a.node_id = n.node_id
            WHERE a.id = ?
        """, (alert_id,)).fetchone()

        if not alert:
            conn.close()
            return jsonify({"error": "Alert not found"}), 404

        lga = alert['lga_name']
        state = alert['state']

        # 2. Fetch baseline ACLED historical profile for this sector
        sector_profile = cursor.execute("""
            SELECT risk_score, primary_actor, primary_event_type, total_fatalities, event_count
            FROM risk_scores
            WHERE LOWER(TRIM(lga_name)) = LOWER(TRIM(?))
        """, (lga,)).fetchone()

        # 3. Blend Operator Input with ACLED defaults
        actor1 = payload.get('actor1') or (sector_profile['primary_actor'] if sector_profile else 'ISWAP: Islamic State West Africa Province')
        event_type = payload.get('event_type') or 'Battles'
        sub_event_type = payload.get('sub_event_type') or 'Armed clash'
        actor2 = payload.get('actor2') or 'Security Outpost Sentinel'
        disorder_type = payload.get('disorder_type') or 'Political violence'
        fatalities = int(payload.get('fatalities', 0))
        
        default_notes = (
            f"C2 Debrief: Outpost #{alert['node_id']} distress signal verified in {lga}, {state}. "
            f"Hardware metrics: RSSI {alert['rssi']} dBm, Batt {alert['battery_level']}V."
        )
        notes = payload.get('notes') or default_notes

        # 4. Commit hybrid intelligence record to SQLite
        cursor.execute("""
            UPDATE live_alerts 
            SET status = 'RESOLVED',
                disorder_type = ?,
                event_type = ?,
                sub_event_type = ?,
                actor1 = ?,
                actor2 = ?,
                fatalities = ?,
                notes = ?
            WHERE id = ?
        """, (disorder_type, event_type, sub_event_type, actor1, actor2, fatalities, notes, alert_id))

        conn.commit()
        conn.close()
        return jsonify({"status": "success", "message": f"Alert #{alert_id} archived with operator debrief."}), 200

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/reports/export', methods=['GET'])
def export_reports():
    try:
        conn = get_db()
        cursor = conn.cursor()

        # Safe query using COALESCE on all optional ACLED fields
        cursor.execute("""
            SELECT 
                a.id, a.msg_id, a.node_id, n.node_name,
                COALESCE(n.state, 'Borno') AS admin1,
                COALESCE(n.lga_name, 'Biu') AS admin2,
                a.latitude, a.longitude, a.battery_level, a.rssi, a.snr,
                a.status, a.received_at, a.acknowledged_at, a.response_time_seconds,
                COALESCE(a.disorder_type, 'Political violence') AS disorder_type,
                COALESCE(a.event_type, 'Battles') AS event_type,
                COALESCE(a.sub_event_type, 'Armed clash') AS sub_event_type,
                COALESCE(a.actor1, 'ISWAP: Islamic State West Africa Province') AS actor1,
                COALESCE(a.actor2, 'Security Outpost Sentinel') AS actor2,
                COALESCE(a.fatalities, 0) AS fatalities,
                COALESCE(a.notes, 'Sub-GHz distress burst resolved') AS notes,
                COALESCE(r.risk_score, 12.2) AS acled_risk_score,
                COALESCE(r.event_count, 163) AS acled_past_events,
                COALESCE(r.total_fatalities, 913) AS acled_total_fatalities
            FROM live_alerts a
            LEFT JOIN nodes n ON a.node_id = n.node_id
            LEFT JOIN risk_scores r ON LOWER(TRIM(COALESCE(n.lga_name, 'Biu'))) = LOWER(TRIM(r.lga_name))
            WHERE a.status = 'RESOLVED'
            ORDER BY a.received_at DESC
        """)
        rows = cursor.fetchall()
        conn.close()

        records = [dict(r) for r in rows]

        if not records:
            return jsonify({"status": "success", "records": [], "csv": ""}), 200

        csv_header = (
            "EVENT_ID_CNTY,EVENT_DATE,YEAR,DISORDER_TYPE,EVENT_TYPE,SUB_EVENT_TYPE,"
            "ACTOR1,ACTOR2,COUNTRY,ADMIN1,ADMIN2,LOCATION,LATITUDE,LONGITUDE,"
            "FATALITIES,RESPONSE_TIME_SEC,RSSI_DBM,BATTERY_V,SECTOR_THREAT_INDEX,NOTES\n"
        )
        csv_lines = [csv_header]

        for r in records:
            event_id = f"NGA-TAC-{r['id']:05d}"
            raw_date = r['received_at'] or "2026-09-11 00:00:00"
            event_date = raw_date[:10]
            year = event_date[:4]
            location = r['node_name'] or f"Outpost #{r['node_id']}"
            clean_notes = (r['notes'] or '').replace('"', '""')

            line = (
                f"{event_id},{event_date},{year},\"{r['disorder_type']}\",\"{r['event_type']}\","
                f"\"{r['sub_event_type']}\",\"{r['actor1']}\",\"{r['actor2']}\",Nigeria,"
                f"\"{r['admin1']}\",\"{r['admin2']}\",\"{location}\",{r['latitude']},{r['longitude']},"
                f"{r['fatalities']},{r['response_time_seconds'] or 0},{r['rssi']},{r['battery_level']},"
                f"{r['acled_risk_score']},\"{clean_notes}\"\n"
            )
            csv_lines.append(line)

        return jsonify({
            "status": "success",
            "csv": "".join(csv_lines),
            "records": records
        }), 200

    except Exception as e:
        print(f"[ERROR] Export query failed: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/nodes/<int:node_id>', methods=['DELETE'])
def delete_node(node_id):
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM nodes WHERE node_id = ?", (node_id,))
        conn.commit()
        conn.close()
        return jsonify({"status": "success", "message": f"Node #{node_id} decommissioned"}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/nodes/<int:node_id>/simulate-distress', methods=['POST'])
def trigger_node_drill(node_id):
    try:
        payload = request.get_json() or {}
        # Cycle through or accept specific approved category
        requested_type = payload.get("alert_type", "Armed Attack")
        valid_categories = ["Armed Attack", "Kidnapping/Ambush", "Medical/Fire"]
        alert_type = requested_type if requested_type in valid_categories else "Armed Attack"

        conn = get_db()
        cursor = conn.cursor()
        node = cursor.execute("SELECT * FROM nodes WHERE node_id = ?", (node_id,)).fetchone()
        if not node:
            conn.close()
            return jsonify({"error": "Node not found"}), 404

        now = datetime.utcnow()
        time_str = now.strftime("%Y-%m-%d %H:%M:%S")
        msg_id = f"DRILL-{node_id}-{int(now.timestamp())}"

        cursor.execute("""
            INSERT INTO live_alerts 
            (msg_id, node_id, sequence_number, latitude, longitude, alert_type, battery_level, rssi, snr, status, received_at)
            VALUES (?, ?, 1, ?, ?, ?, 92.0, -84.0, 5.8, 'ACTIVE', ?)
        """, (msg_id, node_id, node['fixed_latitude'], node['fixed_longitude'], alert_type, time_str))

        conn.commit()
        conn.close()
        return jsonify({"status": "success", "message": f"{alert_type} drill logged for Outpost #{node_id}"}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    # Runs the server locally on port 5000
    app.run(host="0.0.0.0", port=5000, debug=True)