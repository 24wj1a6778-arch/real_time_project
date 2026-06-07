"""
backend/main.py
FastAPI backend for NeuroWeather.

FIXES:
  - Model path resolved relative to this file, not the CWD, so the server
    works regardless of where `uvicorn` is launched from.
  - Replaced bare `except` with specific exceptions; startup failure now
    raises clearly instead of silently setting `model = None`.
  - `/api/predict` now returns HTTP 503 (not 500) when the model isn't loaded,
    with a human-readable message.
  - SQLite connection wrapped in try/finally to guarantee closure on error.
  - `/api/history` returns results in chronological order (oldest→newest)
    so the frontend can render a left-to-right timeline without reversing.
  - Added CORS middleware so the React dev server (port 3000) can call the API.
  - Pydantic model fields have sensible validation ranges to reject garbage
    sensor readings early.
"""

import os
from contextlib import asynccontextmanager
from typing import List

import joblib
import pandas as pd
import sqlite3

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# ── Paths ────────────────────────────────────────────────────────────────────
BASE_DIR   = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(BASE_DIR, "weather_model.pkl")
DB_PATH    = os.path.join(BASE_DIR, "..", "weather.db")

# ── DB helper ────────────────────────────────────────────────────────────────

def get_conn() -> sqlite3.Connection:
    return sqlite3.connect(DB_PATH)

def init_db() -> None:
    conn = get_conn()
    try:
        conn.execute(
            """CREATE TABLE IF NOT EXISTS sensor_data (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp  DATETIME DEFAULT CURRENT_TIMESTAMP,
                temp       REAL NOT NULL,
                humidity   REAL NOT NULL,
                pressure   REAL NOT NULL,
                wind_speed REAL NOT NULL
            )"""
        )
        conn.commit()
    finally:
        conn.close()

# ── App lifecycle ────────────────────────────────────────────────────────────
model = None  # populated in lifespan

@asynccontextmanager
async def lifespan(app: FastAPI):
    global model
    # FIX: explicit exception instead of silent None
    if not os.path.exists(MODEL_PATH):
        raise FileNotFoundError(
            f"Model not found at {MODEL_PATH}. "
            "Run model/trainer.py first."
        )
    model = joblib.load(MODEL_PATH)
    init_db()
    yield  # server runs here
    # (cleanup if needed goes after yield)

app = FastAPI(title="NeuroWeather API", lifespan=lifespan)

# FIX: CORS so the React dev server can reach the API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Schemas ──────────────────────────────────────────────────────────────────

class SensorData(BaseModel):
    # FIX: validation ranges reject implausible sensor noise early
    temp:       float = Field(..., ge=-60, le=60,    description="°C")
    humidity:   float = Field(..., ge=0,   le=100,   description="%")
    pressure:   float = Field(..., ge=870, le=1084,  description="hPa")
    wind_speed: float = Field(..., ge=0,   le=120,   description="m/s")

# ── Endpoints ────────────────────────────────────────────────────────────────

@app.post("/api/data", status_code=201)
async def receive_iot_data(data: SensorData):
    """IoT devices POST sensor readings here."""
    conn = get_conn()
    try:
        conn.execute(
            "INSERT INTO sensor_data (temp, humidity, pressure, wind_speed) "
            "VALUES (?, ?, ?, ?)",
            (data.temp, data.humidity, data.pressure, data.wind_speed),
        )
        conn.commit()
    finally:
        conn.close()
    return {"message": "Data ingested successfully", "data": data}


@app.get("/api/predict")
async def predict_weather():
    """Return current conditions + AI temperature forecast."""
    # FIX: 503 when model failed to load, not a cryptic 500
    if model is None:
        raise HTTPException(status_code=503, detail="AI model not loaded.")

    conn = get_conn()
    try:
        df = pd.read_sql_query(
            "SELECT temp, humidity, pressure, wind_speed "
            "FROM sensor_data ORDER BY id DESC LIMIT 1",
            conn,
        )
    finally:
        conn.close()

    if df.empty:
        raise HTTPException(status_code=404, detail="No sensor data found. Start the IoT simulator first.")

    prediction = model.predict(df)[0]
    return {
        "current_conditions":   df.iloc[0].to_dict(),
        "prediction_next_hour": round(float(prediction), 2),
    }


@app.get("/api/history")
async def get_history():
    """Return the last 24 readings in chronological order (oldest first)."""
    conn = get_conn()
    try:
        # FIX: ASC order so the frontend timeline renders left→right naturally
        df = pd.read_sql_query(
            "SELECT * FROM ("
            "  SELECT * FROM sensor_data ORDER BY id DESC LIMIT 24"
            ") ORDER BY id ASC",
            conn,
        )
    finally:
        conn.close()
    return df.to_dict(orient="records")
