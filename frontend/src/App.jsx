import React, { useState, useEffect, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup, Circle, GeoJSON, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { ShieldAlert, Layers, RefreshCw, Radio, Cpu, Download, Archive, Volume2, VolumeX, Trash2, Zap, Copy, MapPin } from "lucide-react";

// Fix default leaflet marker icon resolution
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
});

// Tactical Beacon (Pulsing Red Distress Icon)
const distressIcon = L.divIcon({
  className: "tactical-distress-marker",
  html: `
    <div style="position: relative; width: 32px; height: 32px;">
      <div style="position: absolute; width: 32px; height: 32px; background: rgba(239, 68, 68, 0.45); border-radius: 50%; animation: tacPulse 1.2s infinite ease-out;"></div>
      <div style="position: absolute; top: 8px; left: 8px; width: 16px; height: 16px; background: #ef4444; border: 2px solid #ffffff; border-radius: 50%; box-shadow: 0 0 10px #ef4444;"></div>
    </div>
  `,
  iconSize: [32, 32],
  iconAnchor: [16, 16]
});

// Tactical Outpost Sentinel (Futuristic Radar-Scan Hexagonal Cyber-Beacon)
const sentinelIcon = L.divIcon({
  className: "tactical-sentinel-marker",
  html: `
    <div style="position: relative; width: 34px; height: 34px; display: flex; align-items: center; justify-content: center;">
      <div style="position: absolute; width: 32px; height: 32px; border: 1.5px dashed #10b981; border-radius: 50%; opacity: 0.8; animation: radarSweep 8s linear infinite;"></div>
      <div style="width: 14px; height: 14px; background: #064e3b; border: 2px solid #34d399; transform: rotate(45deg); box-shadow: 0 0 12px #10b981; display: flex; align-items: center; justify-content: center;">
        <div style="width: 4px; height: 4px; background: #a7f3d0; border-radius: 50%;"></div>
      </div>
      <div style="position: absolute; width: 10px; height: 10px; background: rgba(16, 185, 129, 0.4); border-radius: 50%; animation: tacPulse 2.5s infinite ease-out;"></div>
    </div>
  `,
  iconSize: [34, 34],
  iconAnchor: [17, 17],
  popupAnchor: [0, -18]
});

// Base Station Gateway Icon (Blue Crosshair Core)
const baseStationIcon = L.divIcon({
  className: "tactical-base-marker",
  html: `<div style="width: 20px; height: 20px; background: #38bdf8; border: 2px solid #0f172a; border-radius: 50%; box-shadow: 0 0 12px #38bdf8; display: flex; align-items: center; justify-content: center;"><div style="width: 6px; height: 6px; background: #000; border-radius: 50%;"></div></div>`,
  iconSize: [20, 20],
  iconAnchor: [10, 10]
});

function AutoRecenter({ coords }) {
  const map = useMap();
  useEffect(() => {
    if (coords) {
      map.flyTo(coords, map.getZoom() < 14 ? 16 : map.getZoom(), { duration: 1.2 });
    }
  }, [coords, map]);
  return null;
}

export default function App() {
  const alarmAudio = useRef(null);

  const [alerts, setAlerts] = useState([]);
  const [nodes, setNodes] = useState([]);
  const [riskScores, setRiskScores] = useState([]);
  const [archiveRecords, setArchiveRecords] = useState([]);
  const [geoJsonData, setGeoJsonData] = useState(null);
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [selectedLgaInfo, setSelectedLgaInfo] = useState(null);
  const [showChoropleth, setShowChoropleth] = useState(true);
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [activeCoords, setActiveCoords] = useState([10.6117, 12.1919]);
  const [utcClock, setUtcClock] = useState(new Date().toUTCString());

  const [activeTab, setActiveTab] = useState("stream");

  const [newNodeId, setNewNodeId] = useState("");
  const [newNodeName, setNewNodeName] = useState("");
  const [newLat, setNewLat] = useState("");
  const [newLon, setNewLon] = useState("");
  const [statusMsg, setStatusMsg] = useState({ text: "", type: "" });

  // Archives Search & Category Filter States
  const [archiveSearch, setArchiveSearch] = useState("");
  const [archiveCategory, setArchiveCategory] = useState("ALL");

  // Operator Tactical Debrief States
  const [resolvingAlert, setResolvingAlert] = useState(null);
  const [debriefForm, setDebriefForm] = useState({
    actor1: "ISWAP: Islamic State West Africa Province",
    actor2: "Security Outpost Sentinel",
    event_type: "Battles",
    sub_event_type: "Armed clash",
    fatalities: 0,
    notes: ""
  });

  const [contextMenu, setContextMenu] = useState(null);
  const lastAlertIdRef = useRef(null);

  useEffect(() => {
    alarmAudio.current = new Audio("/tactical-ping.mp3");
    alarmAudio.current.loop = true;
    alarmAudio.current.volume = 0.8;

    return () => {
      if (alarmAudio.current) {
        alarmAudio.current.pause();
        alarmAudio.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setUtcClock(new Date().toUTCString()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const closeMenu = () => setContextMenu(null);
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, []);

  useEffect(() => {
    fetch("/geo/nigeria-lga.geojson")
      .then((res) => {
        if (!res.ok) throw new Error("GeoJSON not found");
        return res.json();
      })
      .then((data) => setGeoJsonData(data))
      .catch((err) => console.warn("[GIS] Local boundary file unavailable:", err.message));
  }, []);

  const fetchTelemetry = async () => {
    try {
      const [alertsRes, nodesRes, riskRes] = await Promise.all([
        fetch("http://127.0.0.1:5000/api/alerts/live"),
        fetch("http://127.0.0.1:5000/api/nodes"),
        fetch("http://127.0.0.1:5000/api/risk-scores")
      ]);

      const alertsData = await alertsRes.json();
      const nodesData = await nodesRes.json();
      const riskData = await riskRes.json();

      setAlerts(alertsData);
      setNodes(nodesData);
      setRiskScores(riskData);

      const activeCall = alertsData.find((a) => a.status === "ACTIVE");
      if (activeCall && activeCall.id !== lastAlertIdRef.current) {
        lastAlertIdRef.current = activeCall.id;
        setActiveCoords([activeCall.latitude, activeCall.longitude]);
      }
    } catch (err) {
      console.error("[NET] Flask backend offline on port 5000.");
    }
  };

  const fetchArchives = async () => {
    try {
      const res = await fetch("http://127.0.0.1:5000/api/reports/export");
      const data = await res.json();
      if (data.status === "success") {
        setArchiveRecords(data.records || []);
      }
    } catch (err) {
      console.error("[ARCHIVE] Failed to fetch archives:", err);
    }
  };

  useEffect(() => {
    if (activeTab === "archive") {
      fetchArchives();
    }
  }, [activeTab]);

  useEffect(() => {
    if (!alarmAudio.current) return;

    const hasActiveThreat = alerts.some((a) => a.status === "ACTIVE");

    if (hasActiveThreat && !isAudioMuted) {
      alarmAudio.current.play().catch((e) => console.warn("[AUDIO] Play prevented:", e));
    } else {
      alarmAudio.current.pause();
      alarmAudio.current.currentTime = 0;
    }
  }, [alerts, isAudioMuted]);

  // Approved 5-second polling interval
  useEffect(() => {
    fetchTelemetry();
    const interval = setInterval(fetchTelemetry, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleRegisterNode = async () => {
    if (!newNodeId || !newNodeName || !newLat || !newLon) {
      setStatusMsg({ text: "All registration fields are required.", type: "error" });
      setTimeout(() => setStatusMsg({ text: "", type: "" }), 4000);
      return;
    }

    try {
      const response = await fetch("http://127.0.0.1:5000/api/nodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          node_id: parseInt(newNodeId),
          node_name: newNodeName,
          latitude: parseFloat(newLat),
          longitude: parseFloat(newLon)
        })
      });

      const result = await response.json();

      if (!response.ok) {
        setStatusMsg({ text: result.error || "Deployment failed. Node ID may already exist.", type: "error" });
      } else {
        setStatusMsg({ text: `Node #${newNodeId} deployed successfully!`, type: "success" });
        setNewNodeId("");
        setNewNodeName("");
        setNewLat("");
        setNewLon("");
        fetchTelemetry();
        setActiveCoords([parseFloat(newLat), parseFloat(newLon)]);
      }
    } catch (err) {
      setStatusMsg({ text: "Network error connecting to base station.", type: "error" });
    }

    setTimeout(() => setStatusMsg({ text: "", type: "" }), 4000);
  };

  const handleCommitDebrief = async () => {
    if (!resolvingAlert) return;
    try {
      const res = await fetch(`http://127.0.0.1:5000/api/alerts/${resolvingAlert.id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(debriefForm)
      });

      if (res.ok) {
        setAlerts((prev) => prev.filter((a) => a.id !== resolvingAlert.id));
        setResolvingAlert(null);
        fetchTelemetry();
        fetchArchives();
        setStatusMsg({ text: `Alert #${resolvingAlert.id} archived with debrief.`, type: "success" });
        setTimeout(() => setStatusMsg({ text: "", type: "" }), 3000);
      } else {
        setStatusMsg({ text: "Failed to resolve alert.", type: "error" });
        setTimeout(() => setStatusMsg({ text: "", type: "" }), 3000);
      }
    } catch (err) {
      console.error("[DEBRIEF] Commit failed:", err);
      setStatusMsg({ text: "Connection error archiving debrief.", type: "error" });
      setTimeout(() => setStatusMsg({ text: "", type: "" }), 3000);
    }
  };

  const handleDeleteNode = async (nodeId) => {
    if (!window.confirm(`Decommission Outpost #${nodeId} from grid?`)) return;
    try {
      const res = await fetch(`http://127.0.0.1:5000/api/nodes/${nodeId}`, { method: "DELETE" });
      if (res.ok) {
        fetchTelemetry();
        setStatusMsg({ text: `Node #${nodeId} decommissioned.`, type: "success" });
        setTimeout(() => setStatusMsg({ text: "", type: "" }), 3000);
      }
    } catch (err) {
      console.error("[NODE] Delete failed:", err);
    }
  };

  const handleSimulateDistress = async (nodeId) => {
    try {
      const res = await fetch(`http://127.0.0.1:5000/api/nodes/${nodeId}/simulate-distress`, { method: "POST" });
      if (res.ok) {
        fetchTelemetry();
      }
    } catch (err) {
      console.error("[DRILL] Trigger failed:", err);
    }
  };

  // Filtered Archive Records (Single, centralized declaration)
  const filteredArchiveRecords = archiveRecords.filter((item) => {
    const searchLower = archiveSearch.toLowerCase();
    const matchesSearch =
      !archiveSearch ||
      (item.node_name && item.node_name.toLowerCase().includes(searchLower)) ||
      (item.actor1 && item.actor1.toLowerCase().includes(searchLower)) ||
      (item.admin2 && item.admin2.toLowerCase().includes(searchLower)) ||
      (item.lga_name && item.lga_name.toLowerCase().includes(searchLower)) ||
      `nga-tac-${String(item.id).padStart(5, "0")}`.includes(searchLower);

    const itemCategory = item.alert_type || item.event_type || "";
    const matchesCategory =
      archiveCategory === "ALL" ||
      itemCategory.toLowerCase() === archiveCategory.toLowerCase();

    return matchesSearch && matchesCategory;
  });

  const handleExportCSV = () => {
    if (filteredArchiveRecords.length === 0) {
      setStatusMsg({ text: "No matching records to export.", type: "error" });
      setTimeout(() => setStatusMsg({ text: "", type: "" }), 3000);
      return;
    }

    const csvHeader =
      "EVENT_ID_CNTY,EVENT_DATE,YEAR,ALERT_CATEGORY,DISORDER_TYPE,EVENT_TYPE,SUB_EVENT_TYPE," +
      "ACTOR1,ACTOR2,COUNTRY,ADMIN1,ADMIN2,LOCATION,LATITUDE,LONGITUDE," +
      "FATALITIES,RESPONSE_TIME_SEC,RSSI_DBM,BATTERY_PCT,HISTORICAL_RISK_INDEX,NOTES\n";

    const csvLines = [csvHeader];

    for (const r of filteredArchiveRecords) {
      const eventId = `NGA-TAC-${String(r.id).padStart(5, "0")}`;
      const rawDate = r.received_at || "2026-09-14 00:00:00";
      const eventDate = rawDate.slice(0, 10);
      const year = eventDate.slice(0, 4);
      const location = r.node_name || `Outpost #${r.node_id}`;
      const cleanNotes = (r.notes || "").replace(/"/g, '""');

      const line =
        `${eventId},${eventDate},${year},"${r.alert_type || "Armed Attack"}","${r.disorder_type || "Political violence"}","${r.event_type || "Battles"}",` +
        `"${r.sub_event_type || "Armed clash"}","${r.actor1 || "ISWAP"}","${r.actor2 || "Security Outpost Sentinel"}",Nigeria,` +
        `"${r.admin1 || r.state || "Borno"}","${r.admin2 || r.lga_name || "Biu"}","${location}",${r.latitude},${r.longitude},` +
        `${r.fatalities || 0},${r.response_time_seconds || 0},${r.rssi},${r.battery_level},` +
        `${r.acled_risk_score || 12.2},"${cleanNotes}"\n`;

      csvLines.push(line);
    }

    const blob = new Blob([csvLines.join("")], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `tactical_acled_report_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);

    setStatusMsg({ text: `Exported ${filteredArchiveRecords.length} records.`, type: "success" });
    setTimeout(() => setStatusMsg({ text: "", type: "" }), 3000);
  };

  const normalizeString = (str) => {
    if (!str) return "";
    return str.toUpperCase().replace(/\sLGA/g, '').replace(/[^A-Z0-9]/g, '');
  };

  const getRiskColor = (score) => {
    if (score > 60) return "#ef4444";
    if (score > 40) return "#f97316";
    if (score > 25) return "#f59e0b";
    if (score > 10) return "#10b981";
    return "#3b82f6";
  };

  const styleFeature = (feature) => {
    const props = feature.properties || {};
    const rawLgaName = props.adm2_name || props.NAME_2 || props.admin2Name || "";
    const rawStateName = props.adm1_name || props.NAME_1 || "";
    
    const cleanGeoLga = normalizeString(rawLgaName);
    const cleanGeoState = normalizeString(rawStateName);

    const match = riskScores.find(
      (r) => r.lga_name && r.state && 
             normalizeString(r.lga_name) === cleanGeoLga &&
             normalizeString(r.state) === cleanGeoState
    );
    const score = match ? match.risk_score : 0;

    return {
      fillColor: getRiskColor(score),
      weight: 1,
      opacity: 0.6,
      color: "#334155",
      fillOpacity: showChoropleth ? 0.55 : 0.04
    };
  };

  const onEachFeature = (feature, layer) => {
    const props = feature.properties || {};
    const rawLgaName = props.adm2_name || props.NAME_2 || "Unknown LGA";
    const rawStateName = props.adm1_name || props.NAME_1 || "Unknown State";
    
    const cleanGeoLga = normalizeString(rawLgaName);
    const cleanGeoState = normalizeString(rawStateName);
    
    const match = riskScores.find(
      (r) => r.lga_name && r.state && 
             normalizeString(r.lga_name) === cleanGeoLga &&
             normalizeString(r.state) === cleanGeoState
    );

    layer.on({
      click: () => {
        setSelectedLgaInfo({
          lga: match ? match.display_name || rawLgaName : rawLgaName,
          state: rawStateName,
          score: match ? match.risk_score : 0,
          events: match ? match.event_count : 0,
          fatalities: match ? match.total_fatalities : 0
        });
      }
    });
  };

  return (
    <div style={{ display: "flex", height: "100vh", width: "100vw", background: "#0b0f17", color: "#e2e8f0", fontFamily: "monospace" }}>
      <style>{`
        @keyframes tacPulse {
          0% { transform: scale(0.9); opacity: 0.9; }
          100% { transform: scale(2.4); opacity: 0; }
        }

        @keyframes radarSweep {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        /* Tactical Dark Glass HUD Popup Styling */
        .leaflet-popup-content-wrapper {
          background: #090e17 !important;
          color: #e2e8f0 !important;
          border: 1px solid #0284c7 !important;
          box-shadow: 0 0 15px rgba(2, 132, 199, 0.35), inset 0 0 12px rgba(15, 23, 42, 0.8) !important;
          border-radius: 4px !important;
          padding: 2px !important;
        }

        .leaflet-popup-tip {
          background: #090e17 !important;
          border: 1px solid #0284c7 !important;
        }

        .leaflet-popup-close-button {
          color: #64748b !important;
          padding: 4px 6px !important;
        }

        .leaflet-popup-close-button:hover {
          color: #ef4444 !important;
        }
      `}</style>

      {/* LEFT TACTICAL CONTROL PANEL */}
      <div style={{ width: "410px", borderRight: "1px solid #1e293b", background: "#0f172a", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "14px", borderBottom: "1px solid #1e293b", background: "#080d1a" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <ShieldAlert color="#ef4444" size={24} />
              <div>
                <div style={{ fontSize: "13px", fontWeight: "bold", letterSpacing: "1.5px", color: "#f87171" }}>
                  TACTICAL BASE STATION
                </div>
                <div style={{ fontSize: "9px", color: "#64748b" }}>ACLED HISTORICAL INGESTION & LORA RX</div>
              </div>
            </div>
            <button
              onClick={() => {
                setIsAudioMuted(!isAudioMuted);
                if (alarmAudio.current) {
                  alarmAudio.current.pause();
                  alarmAudio.current.currentTime = 0;
                }
              }}
              title={isAudioMuted ? "Unmute Alarm" : "Mute Alarm"}
              style={{ background: "#1e293b", border: "1px solid #334155", color: isAudioMuted ? "#ef4444" : "#10b981", padding: "4px 8px", cursor: "pointer", borderRadius: "3px" }}
            >
              {isAudioMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </button>
          </div>
          <div style={{ marginTop: "8px", fontSize: "10px", color: "#38bdf8", display: "flex", justifyContent: "space-between" }}>
            <span>RF-BAND: 868.0 MHz (LoRa P2P)</span>
            <span>{utcClock.slice(17, 25)} UTC</span>
          </div>
        </div>

        <div style={{ padding: "10px 14px", background: "#0a1124", borderBottom: "1px solid #1e293b" }}>
          <div style={{ fontSize: "10px", color: "#38bdf8", marginBottom: "6px", fontWeight: "bold" }}>+ DEPLOY NEW HARDWARE OUTPOST</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
            <div style={{ display: "flex", gap: "5px" }}>
              <input placeholder="ID (e.g. 103)" value={newNodeId} onChange={(e) => setNewNodeId(e.target.value)} style={{ width: "30%", background: "#1e293b", border: "1px solid #334155", color: "#fff", padding: "4px", fontSize: "10px" }} />
              <input placeholder="Outpost Designation" value={newNodeName} onChange={(e) => setNewNodeName(e.target.value)} style={{ width: "70%", background: "#1e293b", border: "1px solid #334155", color: "#fff", padding: "4px", fontSize: "10px" }} />
            </div>
            <div style={{ display: "flex", gap: "5px" }}>
              <input placeholder="Latitude" value={newLat} onChange={(e) => setNewLat(e.target.value)} style={{ width: "50%", background: "#1e293b", border: "1px solid #334155", color: "#fff", padding: "4px", fontSize: "10px" }} />
              <input placeholder="Longitude" value={newLon} onChange={(e) => setNewLon(e.target.value)} style={{ width: "50%", background: "#1e293b", border: "1px solid #334155", color: "#fff", padding: "4px", fontSize: "10px" }} />
            </div>
            <button onClick={handleRegisterNode} style={{ background: "#10b981", color: "#000", border: "none", padding: "5px", fontSize: "10px", fontWeight: "bold", cursor: "pointer", marginTop: "2px" }}>COMMIT TO GRID</button>
          </div>

          {statusMsg.text && (
            <div style={{ marginTop: "6px", padding: "4px 8px", fontSize: "10px", background: statusMsg.type === "error" ? "#7f1d1d" : "#064e3b", color: statusMsg.type === "error" ? "#fca5a5" : "#6ee7b7", borderRadius: "3px" }}>
              {statusMsg.text}
            </div>
          )}
        </div>

        {/* 3 TACTICAL TABS */}
        <div style={{ display: "flex", background: "#080d1a", borderBottom: "1px solid #1e293b" }}>
          <button
            onClick={() => setActiveTab("stream")}
            style={{ flex: 1, padding: "8px", background: activeTab === "stream" ? "#1e293b" : "transparent", border: "none", color: activeTab === "stream" ? "#38bdf8" : "#64748b", fontSize: "10px", fontWeight: "bold", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "4px" }}
          >
            <Radio size={12} /> ALERTS ({alerts.filter((a) => a.status === "ACTIVE").length})
          </button>
          <button
            onClick={() => setActiveTab("fleet")}
            style={{ flex: 1, padding: "8px", background: activeTab === "fleet" ? "#1e293b" : "transparent", border: "none", color: activeTab === "fleet" ? "#38bdf8" : "#64748b", fontSize: "10px", fontWeight: "bold", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "4px" }}
          >
            <Cpu size={12} /> NODES ({nodes.length})
          </button>
          <button
            onClick={() => setActiveTab("archive")}
            style={{ flex: 1, padding: "8px", background: activeTab === "archive" ? "#1e293b" : "transparent", border: "none", color: activeTab === "archive" ? "#38bdf8" : "#64748b", fontSize: "10px", fontWeight: "bold", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "4px" }}
          >
            <Archive size={12} /> ARCHIVES
          </button>
        </div>

        {/* TAB 1: LIVE INCIDENTS STREAM (LATEST 4) */}
        {activeTab === "stream" && (
          <div style={{ flex: 1, overflowY: "auto", padding: "12px" }}>
            <div style={{ fontSize: "10px", fontWeight: "bold", color: "#94a3b8", marginBottom: "8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>ACTIVE TELEMETRY STREAM (LATEST 4)</span>
              <RefreshCw size={12} style={{ cursor: "pointer" }} onClick={fetchTelemetry} />
            </div>

            {alerts.length === 0 ? (
              <div style={{ padding: "20px", textAlign: "center", color: "#475569", fontSize: "10px", border: "1px dashed #1e293b" }}>
                ALL SECTORS QUIET - NO ACTIVE DISTRESS BURSTS
              </div>
            ) : (
              alerts.map((alert) => (
                <div
                  key={alert.id}
                  onClick={() => {
                    setSelectedAlert(alert);
                    setActiveCoords([alert.latitude, alert.longitude]);
                  }}
                  style={{
                    padding: "9px",
                    marginBottom: "7px",
                    background: alert.status === "ACTIVE" ? "#22162b" : "#131b2e",
                    borderLeft: `4px solid ${alert.status === "ACTIVE" ? "#ef4444" : "#10b981"}`,
                    cursor: "pointer"
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontWeight: "bold", fontSize: "11px", color: alert.status === "ACTIVE" ? "#fca5a5" : "#6ee7b7" }}>
                      {alert.node_name || `OUTPOST #${alert.node_id}`}
                    </span>
                    <span style={{ fontSize: "9px", padding: "2px 5px", borderRadius: "3px", background: alert.status === "ACTIVE" ? "#7f1d1d" : "#064e3b" }}>
                      {alert.status}
                    </span>
                  </div>
                  <div style={{ fontSize: "10px", color: "#cbd5e1", marginTop: "3px" }}>
                    SECTOR: {alert.lga_name || "Biu"} | {alert.state || "Borno"}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: "5px", fontSize: "9px", color: "#94a3b8" }}>
                    <span>RSSI: {alert.rssi} dBm</span>
                    <span>SNR: {alert.snr} dB</span>
                    <span>BAT: {alert.battery_level}V</span>
                  </div>

                  {/* Correlated Historical ACLED Baseline */}
                  <div style={{ marginTop: "6px", background: "#080d1a", padding: "5px 7px", borderRadius: "3px", fontSize: "9px", border: "1px solid #1e293b" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", color: "#94a3b8" }}>
                      <span>Past Incidents: <strong style={{ color: "#38bdf8" }}>{alert.acled_past_events || 163}</strong></span>
                      <span>Reported Fatalities (Est.): <strong style={{ color: "#f87171" }}>{alert.acled_total_fatalities || 913}</strong></span>
                    </div>
                  </div>

                  {/* STAGE 1: ACTIVE BUTTON */}
                  {alert.status === "ACTIVE" && (
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (alarmAudio.current) {
                          alarmAudio.current.pause();
                          alarmAudio.current.currentTime = 0;
                        }
                        try {
                          const res = await fetch(`http://127.0.0.1:5000/api/alerts/${alert.id}/acknowledge`, { method: "POST" });
                          if (res.ok) fetchTelemetry();
                        } catch (err) {
                          console.error("[NET] Failed to acknowledge threat:", err);
                        }
                      }}
                      style={{
                        width: "100%",
                        background: "#ef4444",
                        color: "#fff",
                        border: "none",
                        padding: "6px",
                        fontSize: "10px",
                        fontWeight: "bold",
                        cursor: "pointer",
                        marginTop: "10px",
                        borderRadius: "3px",
                        letterSpacing: "1px"
                      }}
                    >
                      ACKNOWLEDGE THREAT
                    </button>
                  )}

                  {/* STAGE 2: ACKNOWLEDGED BUTTON (OPENS DEBRIEF MODAL) */}
                  {alert.status === "ACKNOWLEDGED" && (
                    <div style={{ marginTop: "10px", borderTop: "1px dashed #1e293b", paddingTop: "8px" }}>
                      <div style={{ fontSize: "10px", color: "#10b981", marginBottom: "6px" }}>
                        ✓ THREAT ACKNOWLEDGED <br />
                        <span style={{ color: "#94a3b8", fontSize: "9px" }}>Response Time: {alert.response_time_seconds} seconds</span>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setResolvingAlert(alert);
                          setDebriefForm({
                            actor1: "ISWAP: Islamic State West Africa Province",
                            actor2: "Security Outpost Sentinel",
                            event_type: "Battles",
                            sub_event_type: "Armed clash",
                            fatalities: 0,
                            notes: `Field verification: Outpost #${alert.node_id} beacon logged in sector ${alert.lga_name || 'Biu'}.`
                          });
                        }}
                        style={{
                          width: "100%",
                          background: "#3b82f6",
                          color: "#fff",
                          border: "none",
                          padding: "6px",
                          fontSize: "10px",
                          fontWeight: "bold",
                          cursor: "pointer",
                          borderRadius: "3px",
                          letterSpacing: "1px"
                        }}
                      >
                        RESOLVE & ARCHIVE
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* TAB 2: REGISTERED FLEET NODES */}
        {activeTab === "fleet" && (
          <div style={{ flex: 1, overflowY: "auto", padding: "12px" }}>
            <div style={{ fontSize: "10px", fontWeight: "bold", color: "#94a3b8", marginBottom: "8px" }}>
              REGISTERED HARDWARE OUTPOSTS
            </div>
            {nodes.length === 0 ? (
              <div style={{ padding: "20px", textAlign: "center", color: "#475569", fontSize: "10px", border: "1px dashed #1e293b" }}>
                NO NODES REGISTERED IN GRID
              </div>
            ) : (
              nodes.map((n) => (
                <div
                  key={`fleet-${n.node_id}`}
                  onClick={() => setActiveCoords([n.fixed_latitude, n.fixed_longitude])}
                  style={{
                    padding: "9px",
                    marginBottom: "7px",
                    background: "#131b2e",
                    borderLeft: "4px solid #38bdf8",
                    cursor: "pointer"
                  }}
                >
                  <div style={{ fontWeight: "bold", fontSize: "11px", color: "#38bdf8" }}>
                    [{n.node_id}] {n.node_name}
                  </div>
                  <div style={{ fontSize: "9px", color: "#94a3b8", marginTop: "3px" }}>
                    LAT: {n.fixed_latitude} | LON: {n.fixed_longitude}
                  </div>
                  <div style={{ fontSize: "9px", color: "#64748b" }}>
                    ZONE: {n.lga_name}, {n.state}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* TAB 3: RESOLVED ARCHIVES & ACLED CORRELATION WITH FILTER BAR */}
        {activeTab === "archive" && (
          <div style={{ flex: 1, overflowY: "auto", padding: "12px", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <span style={{ fontSize: "10px", fontWeight: "bold", color: "#94a3b8" }}>
                AFTER-ACTION REPORTS ({filteredArchiveRecords.length})
              </span>
              <button
                onClick={handleExportCSV}
                style={{
                  background: "#0284c7",
                  color: "#fff",
                  border: "none",
                  padding: "4px 8px",
                  fontSize: "9px",
                  fontWeight: "bold",
                  cursor: "pointer",
                  borderRadius: "2px",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px"
                }}
              >
                <Download size={11} /> DOWNLOAD CSV
              </button>
            </div>

            {/* Tactical Search & Category Filter Controls */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "10px", background: "#060911", padding: "8px", borderRadius: "3px", border: "1px solid #1e293b" }}>
              <input
                type="text"
                placeholder="Search by outpost, actor, sector, or ID..."
                value={archiveSearch}
                onChange={(e) => setArchiveSearch(e.target.value)}
                style={{
                  width: "100%",
                  background: "#0f172a",
                  border: "1px solid #334155",
                  color: "#fff",
                  padding: "4px 6px",
                  fontSize: "9px",
                  borderRadius: "2px",
                  outline: "none"
                }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "9px", color: "#64748b" }}>CATEGORY:</span>
                <select
                  value={archiveCategory}
                  onChange={(e) => setArchiveCategory(e.target.value)}
                  style={{
                    background: "#0f172a",
                    border: "1px solid #334155",
                    color: "#38bdf8",
                    padding: "3px 6px",
                    fontSize: "9px",
                    borderRadius: "2px",
                    outline: "none",
                    cursor: "pointer"
                  }}
                >
                  <option value="ALL">ALL CATEGORIES</option>
                  <option value="Armed Attack">Armed Attack</option>
                  <option value="Kidnapping/Ambush">Kidnapping/Ambush</option>
                  <option value="Medical/Fire">Medical/Fire</option>
                </select>
              </div>
            </div>

            {/* Archive Incidents Feed */}
            {filteredArchiveRecords.length === 0 ? (
              <div style={{ padding: "20px", textAlign: "center", color: "#475569", fontSize: "10px", border: "1px dashed #1e293b" }}>
                {archiveRecords.length === 0 ? "NO ARCHIVED INCIDENTS FOUND" : "NO MATCHING RECORDS FOR FILTER"}
              </div>
            ) : (
              filteredArchiveRecords.map((item) => (
                <div
                  key={`arch-${item.id}`}
                  style={{
                    padding: "9px",
                    marginBottom: "8px",
                    background: "#0b1329",
                    borderLeft: "4px solid #38bdf8",
                    fontSize: "10px"
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", fontWeight: "bold" }}>
                    <span style={{ color: "#38bdf8" }}>{item.node_name || `OUTPOST #${item.node_id}`}</span>
                    <span style={{ color: "#10b981", fontSize: "9px" }}>[NGA-TAC-{String(item.id).padStart(5, '0')}]</span>
                  </div>

                  {/* Incident Category & ACLED Event Taxonomy */}
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: "3px" }}>
                    <span style={{ color: "#f87171", fontSize: "9px", fontWeight: "bold" }}>
                      {item.alert_type || "Armed Attack"}
                    </span>
                    <span style={{ color: "#94a3b8", fontSize: "8px" }}>
                      {item.event_type || "Battles"} ({item.sub_event_type || "Armed clash"})
                    </span>
                  </div>

                  <div style={{ color: "#cbd5e1", fontSize: "9px", marginTop: "2px" }}>
                    Perpetrator: <span style={{ color: "#e2e8f0", fontWeight: "bold" }}>{item.actor1 || "Unidentified Armed Group"}</span>
                  </div>
                  <div style={{ color: "#cbd5e1", fontSize: "9px" }}>
                    Target: <span style={{ color: "#e2e8f0" }}>{item.actor2 || "Security Outpost Sentinel"}</span>
                  </div>

                  <div style={{ color: "#94a3b8", fontSize: "9px", marginTop: "4px" }}>
                    Sector: {item.admin2 || item.lga_name || "Biu"}, {item.admin1 || item.state || "Borno"} | Response: {item.response_time_seconds || 0}s
                  </div>

                  <div style={{ marginTop: "6px", background: "#060911", padding: "5px 7px", borderRadius: "3px", fontSize: "9px", border: "1px solid #1e293b" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", color: "#cbd5e1" }}>
                      <span>Historical Risk Index: <strong style={{ color: getRiskColor(item.acled_risk_score) }}>{item.acled_risk_score}/100</strong></span>
                      <span>Reported Fatalities (Est.): {item.fatalities || 0}</span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {selectedLgaInfo && (
          <div style={{ padding: "10px 14px", borderTop: "1px solid #1e293b", background: "#0a1124", fontSize: "10px" }}>
            <div style={{ color: "#38bdf8", fontWeight: "bold", marginBottom: "3px" }}>
              [LGA HISTORICAL RISK PROFILE: {selectedLgaInfo.lga.toUpperCase()}]
            </div>
            <div>STATE: {selectedLgaInfo.state}</div>
            <div>HISTORICAL RISK INDEX: <strong style={{ color: getRiskColor(selectedLgaInfo.score) }}>{selectedLgaInfo.score} / 100</strong></div>
            <div>ACLED CONFLICT INCIDENTS: {selectedLgaInfo.events}</div>
            <div>REPORTED FATALITIES (EST.): {selectedLgaInfo.fatalities}</div>
          </div>
        )}
      </div>

      {/* CENTER WORKSPACE: MAP VIEW */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <div style={{ height: "42px", background: "#0f172a", borderBottom: "1px solid #1e293b", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px" }}>
          <div style={{ display: "flex", gap: "16px", fontSize: "11px" }}>
            <span style={{ color: "#10b981" }}>● GATEWAY LINK: P2P LORA LINK</span>
            <span style={{ color: "#94a3b8" }}>DATASET: ACLED HISTORICAL REPOSITORY</span>
          </div>

          <button
            onClick={() => setShowChoropleth(!showChoropleth)}
            style={{ background: "#1e293b", border: "1px solid #334155", color: "#cbd5e1", padding: "4px 10px", fontSize: "11px", cursor: "pointer", display: "flex", alignItems: "center", gap: "5px" }}
          >
            <Layers size={13} /> {showChoropleth ? "HIDE CHOROPLETH" : "SHOW CHOROPLETH"}
          </button>
        </div>

        <div style={{ flex: 1, position: "relative" }}>
          <MapContainer center={activeCoords} zoom={16} style={{ height: "100%", width: "100%", background: "#060911" }}>
            <AutoRecenter coords={activeCoords} />

            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            {geoJsonData && (
              <GeoJSON
                data={geoJsonData}
                style={styleFeature}
                onEachFeature={onEachFeature}
              />
            )}

            {/* Base Station Gateway Command Hub Marker */}
            <Marker position={[10.6117, 12.1919]} icon={baseStationIcon}>
              <Popup>
                <div style={{ fontFamily: "monospace", padding: "4px 6px", minWidth: "160px" }}>
                  <strong style={{ color: "#38bdf8", fontSize: "11px" }}>[TACTICAL BASE STATION]</strong><br />
                  <span style={{ color: "#cbd5e1", fontSize: "9px" }}>Gateway Receiver Active (868 MHz)</span>
                </div>
              </Popup>
            </Marker>

            {/* Outpost Node Markers: Upgraded Radar Beacon & Dark Glass HUD Case */}
            {nodes.map((n) => (
              <Marker
                key={`node-${n.node_id}`}
                position={[n.fixed_latitude, n.fixed_longitude]}
                icon={sentinelIcon}
                eventHandlers={{
                  contextmenu: (e) => {
                    e.originalEvent.preventDefault();
                    setContextMenu({
                      x: e.originalEvent.clientX,
                      y: e.originalEvent.clientY,
                      node: n
                    });
                  }
                }}
              >
                <Popup>
                  <div style={{ fontFamily: "monospace", padding: "4px 6px", minWidth: "170px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #1e293b", paddingBottom: "4px", marginBottom: "6px" }}>
                      <span style={{ color: "#34d399", fontWeight: "bold", fontSize: "11px", letterSpacing: "1px" }}>
                        OUTPOST #{n.node_id}
                      </span>
                      <span style={{ fontSize: "8px", background: "#064e3b", color: "#6ee7b7", padding: "1px 4px", borderRadius: "2px", border: "1px solid #059669" }}>
                        P2P SENTINEL
                      </span>
                    </div>

                    <div style={{ fontSize: "11px", fontWeight: "bold", color: "#f8fafc", marginBottom: "4px" }}>
                      {n.node_name}
                    </div>

                    <div style={{ fontSize: "9px", color: "#94a3b8", display: "flex", flexDirection: "column", gap: "2px" }}>
                      <div>SECTOR: <span style={{ color: "#38bdf8" }}>{n.lga_name}, {n.state}</span></div>
                      <div>GRID: <span style={{ color: "#cbd5e1" }}>{Number(n.fixed_latitude).toFixed(4)}°N, {Number(n.fixed_longitude).toFixed(4)}°E</span></div>
                      <div>LINK: <span style={{ color: "#10b981" }}>ONLINE (868 MHz LoRa)</span></div>
                    </div>

                    <div style={{ marginTop: "6px", paddingTop: "4px", borderTop: "1px dashed #1e293b", fontSize: "8px", color: "#64748b", textAlign: "center" }}>
                      RIGHT-CLICK FOR TACTICAL DRILLS
                    </div>
                  </div>
                </Popup>
              </Marker>
            ))}

            {/* Live Distress Beacons */}
            {alerts.map((alert) => (
              <React.Fragment key={`alert-${alert.id}`}>
                {(alert.status === "ACTIVE" || alert.status === "ACKNOWLEDGED") && (
                  <>
                    <Marker position={[alert.latitude, alert.longitude]} icon={distressIcon}>
                      <Popup>
                        <div style={{ fontFamily: "monospace", padding: "4px 6px", minWidth: "170px" }}>
                          <div style={{ borderBottom: "1px solid rgba(239, 68, 68, 0.4)", paddingBottom: "4px", marginBottom: "6px" }}>
                            <span style={{ color: "#ef4444", fontWeight: "bold", fontSize: "11px", letterSpacing: "1px" }}>
                              [DISTRESS CALL DETECTED]
                            </span>
                          </div>

                          <div style={{ fontSize: "11px", fontWeight: "bold", color: "#f8fafc", marginBottom: "4px" }}>
                            {alert.node_name || `OUTPOST #${alert.node_id}`}
                          </div>

                          <div style={{ fontSize: "9px", color: "#cbd5e1", display: "flex", flexDirection: "column", gap: "2px" }}>
                            <div>STATUS: <span style={{ color: alert.status === "ACTIVE" ? "#f87171" : "#f59e0b", fontWeight: "bold" }}>{alert.status}</span></div>
                            <div>SIGNAL: <span style={{ color: "#38bdf8" }}>{alert.rssi} dBm (SNR: {alert.snr} dB)</span></div>
                            <div>BATTERY: <span style={{ color: "#10b981" }}>{alert.battery_level}V</span></div>
                            <div>LOGGED: <span style={{ color: "#94a3b8" }}>{alert.received_at}</span></div>
                          </div>
                        </div>
                      </Popup>
                    </Marker>
                    <Circle
                      center={[alert.latitude, alert.longitude]}
                      radius={350}
                      pathOptions={{ color: "#ef4444", fillColor: "#ef4444", fillOpacity: 0.18 }}
                    />
                  </>
                )}
              </React.Fragment>
            ))}
          </MapContainer>

          {/* Context Menu Overlay */}
          {contextMenu && (
            <div
              style={{
                position: "fixed",
                top: contextMenu.y,
                left: contextMenu.x,
                zIndex: 9999,
                background: "#0a1124",
                border: "1px solid #1e293b",
                boxShadow: "0 6px 16px rgba(0,0,0,0.8)",
                borderRadius: "4px",
                minWidth: "180px",
                padding: "4px 0",
                fontSize: "10px",
                fontFamily: "monospace"
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ padding: "6px 10px", borderBottom: "1px solid #1e293b", color: "#38bdf8", fontWeight: "bold" }}>
                OUTPOST #{contextMenu.node.node_id}
              </div>

              <button
                onClick={() => {
                  handleSimulateDistress(contextMenu.node.node_id);
                  setContextMenu(null);
                }}
                style={{ width: "100%", textAlign: "left", padding: "7px 10px", background: "transparent", border: "none", color: "#fca5a5", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#1e293b")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <Zap size={12} color="#ef4444" /> Trigger Distress Drill
              </button>

              <button
                onClick={() => {
                  setActiveCoords([contextMenu.node.fixed_latitude, contextMenu.node.fixed_longitude]);
                  setContextMenu(null);
                }}
                style={{ width: "100%", textAlign: "left", padding: "7px 10px", background: "transparent", border: "none", color: "#38bdf8", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#1e293b")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <MapPin size={12} color="#38bdf8" /> Center Camera
              </button>

              <button
                onClick={() => {
                  navigator.clipboard.writeText(`${contextMenu.node.fixed_latitude}, ${contextMenu.node.fixed_longitude}`);
                  setStatusMsg({ text: "Coordinates copied to clipboard!", type: "success" });
                  setTimeout(() => setStatusMsg({ text: "", type: "" }), 3000);
                  setContextMenu(null);
                }}
                style={{ width: "100%", textAlign: "left", padding: "7px 10px", background: "transparent", border: "none", color: "#cbd5e1", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#1e293b")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <Copy size={12} color="#cbd5e1" /> Copy Coordinates
              </button>

              <button
                onClick={() => {
                  handleDeleteNode(contextMenu.node.node_id);
                  setContextMenu(null);
                }}
                style={{ width: "100%", textAlign: "left", padding: "7px 10px", background: "transparent", border: "none", color: "#ef4444", fontWeight: "bold", cursor: "pointer", borderTop: "1px solid #1e293b", display: "flex", alignItems: "center", gap: "6px" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#7f1d1d")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <Trash2 size={12} color="#ef4444" /> Decommission Node
              </button>
            </div>
          )}

          {/* TACTICAL AFTER-ACTION DEBRIEF MODAL */}
          {resolvingAlert && (
            <div style={{
              position: "fixed",
              top: 0,
              left: 0,
              width: "100vw",
              height: "100vh",
              background: "rgba(3, 7, 18, 0.75)",
              backdropFilter: "blur(3px)",
              zIndex: 10000,
              display: "flex",
              alignItems: "center",
              justifyContent: "center"
            }}>
              <div style={{
                background: "#0f172a",
                border: "1px solid #334155",
                borderRadius: "6px",
                width: "420px",
                padding: "16px",
                boxShadow: "0 10px 25px rgba(0,0,0,0.8)",
                fontFamily: "monospace"
              }}>
                <div style={{ fontSize: "12px", fontWeight: "bold", color: "#38bdf8", borderBottom: "1px solid #1e293b", paddingBottom: "8px", marginBottom: "12px" }}>
                  OPERATOR AFTER-ACTION DEBRIEF: OUTPOST #{resolvingAlert.node_id}
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "10px" }}>
                  <div>
                    <label style={{ color: "#94a3b8", display: "block", marginBottom: "2px" }}>Perpetrator / Actor 1:</label>
                    <input
                      value={debriefForm.actor1}
                      onChange={(e) => setDebriefForm({ ...debriefForm, actor1: e.target.value })}
                      style={{ width: "100%", background: "#1e293b", border: "1px solid #334155", color: "#fff", padding: "5px", fontSize: "10px", borderRadius: "3px" }}
                    />
                  </div>

                  <div style={{ display: "flex", gap: "8px" }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ color: "#94a3b8", display: "block", marginBottom: "2px" }}>Event Type:</label>
                      <input
                        value={debriefForm.event_type}
                        onChange={(e) => setDebriefForm({ ...debriefForm, event_type: e.target.value })}
                        style={{ width: "100%", background: "#1e293b", border: "1px solid #334155", color: "#fff", padding: "5px", fontSize: "10px", borderRadius: "3px" }}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ color: "#94a3b8", display: "block", marginBottom: "2px" }}>Confirmed Fatalities:</label>
                      <input
                        type="number"
                        min="0"
                        value={debriefForm.fatalities}
                        onChange={(e) => setDebriefForm({ ...debriefForm, fatalities: e.target.value })}
                        style={{ width: "100%", background: "#1e293b", border: "1px solid #334155", color: "#fff", padding: "5px", fontSize: "10px", borderRadius: "3px" }}
                      />
                    </div>
                  </div>

                  <div>
                    <label style={{ color: "#94a3b8", display: "block", marginBottom: "2px" }}>Target / Actor 2:</label>
                    <input
                      value={debriefForm.actor2}
                      onChange={(e) => setDebriefForm({ ...debriefForm, actor2: e.target.value })}
                      style={{ width: "100%", background: "#1e293b", border: "1px solid #334155", color: "#fff", padding: "5px", fontSize: "10px", borderRadius: "3px" }}
                    />
                  </div>

                  <div>
                    <label style={{ color: "#94a3b8", display: "block", marginBottom: "2px" }}>Field Observations & Notes:</label>
                    <textarea
                      rows="3"
                      value={debriefForm.notes}
                      onChange={(e) => setDebriefForm({ ...debriefForm, notes: e.target.value })}
                      style={{ width: "100%", background: "#1e293b", border: "1px solid #334155", color: "#fff", padding: "5px", fontSize: "10px", borderRadius: "3px", resize: "none" }}
                    />
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "14px" }}>
                  <button
                    onClick={() => setResolvingAlert(null)}
                    style={{ background: "#334155", border: "none", color: "#cbd5e1", padding: "6px 12px", fontSize: "10px", cursor: "pointer", borderRadius: "3px" }}
                  >
                    CANCEL
                  </button>
                  <button
                    onClick={handleCommitDebrief}
                    style={{ background: "#0284c7", border: "none", color: "#fff", padding: "6px 12px", fontSize: "10px", fontWeight: "bold", cursor: "pointer", borderRadius: "3px" }}
                  >
                    COMMIT & ARCHIVE
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}