"""
iot_simulator/device.py
Simulates an ESP32/Raspberry Pi pushing sensor data to the NeuroWeather API.
"""

import random
import time
import requests

API_URL          = "http://localhost:8000/api/data"
INTERVAL_SECONDS = 5


def simulate_sensor_reading():
    return {
        "temp":       round(random.uniform(15.0, 40.0), 2),
        "humidity":   round(random.uniform(30.0, 95.0), 2),
        "pressure":   round(random.uniform(990.0, 1030.0), 2),
        "wind_speed": round(random.uniform(0.0, 25.0), 2),
    }


def main():
    print("Starting IoT Device Simulation... (Ctrl-C to stop)")
    while True:
        payload = simulate_sensor_reading()
        try:
            response = requests.post(API_URL, json=payload, timeout=5)
            response.raise_for_status()
            print(f"[OK  {response.status_code}] Sent: {payload}")
        except requests.exceptions.HTTPError as exc:
            print(f"[ERR] Server rejected payload: {exc}")
        except requests.exceptions.ConnectionError:
            print(f"[ERR] Cannot reach {API_URL} - is the backend running?")
        except requests.exceptions.Timeout:
            print("[ERR] Request timed out.")

        time.sleep(INTERVAL_SECONDS)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nSimulation stopped.")