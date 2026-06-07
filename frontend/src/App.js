import { useState, useEffect, useCallback } from "react";
import "./App.css";

const BASE = "http://localhost:8000";

const api = {
  predict: () => fetch(`${BASE}/api/predict`).then(r => r.json()),
  history: () => fetch(`${BASE}/api/history`).then(r => r.json()),
  postData: (d) =>
    fetch(`${BASE}/api/data`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(d),
    }).then(r => r.json()),
};

// ── Icons ────────────────────────────────────────────────────────────────────
const Icon = ({ name }) => {
  const icons = {
    temp:      "🌡️",
    humidity:  "💧",
    pressure:  "🔵",
    wind:      "💨",
    forecast:  "🔮",
    refresh:   "↻",
    send:      "→",
    history:   "📈",
    status_ok: "●",
    status_err:"●",
  };
  return <span className="icon">{icons[name] || "•"}</span>;
};

// ── Sparkline ────────────────────────────────────────────────────────────────
function Sparkline({ data, color = "#00e5ff" }) {
  if (!data || data.length < 2) return null;
  const w = 200, h = 48, pad = 4;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="sparkline">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts.split(" ").pop().split(",")[0]} cy={pts.split(" ").pop().split(",")[1]} r="3" fill={color} />
    </svg>
  );
}

// ── StatCard ─────────────────────────────────────────────────────────────────
function StatCard({ icon, label, value, unit, history, color }) {
  return (
    <div className="stat-card">
      <div className="stat-header">
        <Icon name={icon} />
        <span className="stat-label">{label}</span>
      </div>
      <div className="stat-value">
        {value !== null && value !== undefined ? (
          <>{typeof value === "number" ? value.toFixed(1) : value}<span className="stat-unit">{unit}</span></>
        ) : <span className="stat-empty">—</span>}
      </div>
      {history && <Sparkline data={history} color={color} />}
    </div>
  );
}

// ── SendDataForm ──────────────────────────────────────────────────────────────
function SendDataForm({ onSent }) {
  const [form, setForm] = useState({ temp: "", humidity: "", pressure: "", wind_speed: "" });
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);

  const handle = e => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  const submit = async () => {
    const payload = {
      temp:       parseFloat(form.temp),
      humidity:   parseFloat(form.humidity),
      pressure:   parseFloat(form.pressure),
      wind_speed: parseFloat(form.wind_speed),
    };
    if (Object.values(payload).some(isNaN)) {
      setStatus({ ok: false, msg: "All fields are required." });
      return;
    }
    setLoading(true);
    try {
      const res = await api.postData(payload);
      setStatus({ ok: true, msg: res.message || "Data sent!" });
      setForm({ temp: "", humidity: "", pressure: "", wind_speed: "" });
      onSent();
    } catch {
      setStatus({ ok: false, msg: "Failed to send data." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="form-card">
      <h2 className="section-title"><Icon name="send" /> Inject Sensor Data</h2>
      <div className="form-grid">
        {[
          { name: "temp",       placeholder: "Temp (°C)",    min: -60, max: 60   },
          { name: "humidity",   placeholder: "Humidity (%)", min: 0,   max: 100  },
          { name: "pressure",   placeholder: "Pressure (hPa)", min: 870, max: 1084 },
          { name: "wind_speed", placeholder: "Wind (m/s)",   min: 0,   max: 120  },
        ].map(f => (
          <input
            key={f.name}
            name={f.name}
            type="number"
            placeholder={f.placeholder}
            value={form[f.name]}
            onChange={handle}
            className="form-input"
            min={f.min}
            max={f.max}
            step="0.1"
          />
        ))}
      </div>
      <button className="btn-primary" onClick={submit} disabled={loading}>
        {loading ? "Sending…" : "Send to Backend"}
      </button>
      {status && (
        <p className={`form-status ${status.ok ? "ok" : "err"}`}>{status.msg}</p>
      )}
    </div>
  );
}

// ── HistoryTable ──────────────────────────────────────────────────────────────
function HistoryTable({ rows }) {
  if (!rows.length) return <p className="empty-msg">No history yet.</p>;
  return (
    <div className="table-wrap">
      <table className="history-table">
        <thead>
          <tr>
            <th>#</th><th>Timestamp</th><th>Temp °C</th>
            <th>Humidity %</th><th>Pressure hPa</th><th>Wind m/s</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              <td>{r.id}</td>
              <td>{r.timestamp ? new Date(r.timestamp).toLocaleTimeString() : "—"}</td>
              <td>{r.temp?.toFixed(1)}</td>
              <td>{r.humidity?.toFixed(1)}</td>
              <td>{r.pressure?.toFixed(1)}</td>
              <td>{r.wind_speed?.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [prediction, setPrediction] = useState(null);
  const [history,    setHistory]    = useState([]);
  const [predError,  setPredError]  = useState(null);
  const [loading,    setLoading]    = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [pred, hist] = await Promise.all([api.predict(), api.history()]);
      if (pred.detail) setPredError(pred.detail);
      else { setPrediction(pred); setPredError(null); }
      setHistory(hist);
    } catch {
      setPredError("Cannot reach backend at localhost:8000");
    } finally {
      setLoading(false);
      setLastRefresh(new Date().toLocaleTimeString());
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const cc  = prediction?.current_conditions;
  const histTemp     = history.map(r => r.temp);
  const histHumidity = history.map(r => r.humidity);
  const histPressure = history.map(r => r.pressure);
  const histWind     = history.map(r => r.wind_speed);

  return (
    <div className="app">
      {/* ── Header ── */}
      <header className="header">
        <div className="header-left">
          <span className="logo-mark">NW</span>
          <div>
            <h1 className="app-title">NeuroWeather</h1>
            <p className="app-sub">AI-Powered Sensor Dashboard</p>
          </div>
        </div>
        <div className="header-right">
          <span className={`status-dot ${predError ? "err" : "ok"}`} />
          <span className="status-label">{predError ? "Offline" : "Live"}</span>
          <button className={`btn-icon ${loading ? "spinning" : ""}`} onClick={refresh} title="Refresh">
            <Icon name="refresh" />
          </button>
          {lastRefresh && <span className="last-refresh">Updated {lastRefresh}</span>}
        </div>
      </header>

      <main className="main">
        {/* ── Error Banner ── */}
        {predError && (
          <div className="error-banner">⚠ {predError}</div>
        )}

        {/* ── Forecast Hero ── */}
        <div className="forecast-hero">
          <div className="forecast-label"><Icon name="forecast" /> Next Hour Forecast</div>
          <div className="forecast-value">
            {prediction?.prediction_next_hour !== undefined
              ? <>{prediction.prediction_next_hour.toFixed(1)}<span className="forecast-unit">°C</span></>
              : <span className="stat-empty">—</span>}
          </div>
        </div>

        {/* ── Current Conditions ── */}
        <section className="section">
          <h2 className="section-title">Current Conditions</h2>
          <div className="cards-grid">
            <StatCard icon="temp"     label="Temperature" value={cc?.temp}       unit="°C"  history={histTemp}     color="#ff6b6b" />
            <StatCard icon="humidity" label="Humidity"    value={cc?.humidity}   unit="%"   history={histHumidity} color="#00e5ff" />
            <StatCard icon="pressure" label="Pressure"    value={cc?.pressure}   unit=" hPa" history={histPressure} color="#a78bfa" />
            <StatCard icon="wind"     label="Wind Speed"  value={cc?.wind_speed} unit=" m/s" history={histWind}    color="#34d399" />
          </div>
        </section>

        {/* ── Two-column: form + history ── */}
        <div className="split-row">
          <SendDataForm onSent={refresh} />

          <div className="history-card">
            <h2 className="section-title"><Icon name="history" /> Sensor History (last 24)</h2>
            <HistoryTable rows={history} />
          </div>
        </div>
      </main>
    </div>
  );
}