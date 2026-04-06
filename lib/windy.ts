/**
 * Windy Point Forecast API poller.
 *
 * Fetches wind forecast once per hour and caches in memory.
 * Only runs server-side — the frontend never sees coordinates.
 */

const POLL_INTERVAL_MS = 3_600_000; // 1 hour
const API_URL = "https://api.windy.com/api/point-forecast/v2";

export interface WindForecastPoint {
  ts: number;        // Unix ms
  windSpeed: number; // m/s
  windGust: number;  // m/s
  windDir: number;   // degrees
}

export interface WindForecast {
  fetchedAt: number; // Unix ms
  model: string;
  points: WindForecastPoint[];
}

const g = globalThis as unknown as { __wendy_forecast?: WindForecast };

export function getCachedForecast(): WindForecast | null {
  return g.__wendy_forecast ?? null;
}

async function fetchForecast(apiKey: string, lat: number, lon: number): Promise<void> {
  try {
    const body = {
      lat,
      lon,
      model: "gfs",
      parameters: ["wind", "windGust"],
      levels: ["surface"],
      key: apiKey,
    };

    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      console.error(`[windy] API error: ${res.status} ${res.statusText}`);
      return;
    }

    const data = await res.json();

    // Windy returns timestamps in ts[] and values in wind_u-surface[], wind_v-surface[], gust-surface[]
    const timestamps: number[] = data["ts"] ?? [];
    const windU: number[] = data["wind_u-surface"] ?? [];
    const windV: number[] = data["wind_v-surface"] ?? [];
    const gusts: number[] = data["gust-surface"] ?? [];

    const points: WindForecastPoint[] = timestamps.map((ts, i) => {
      const u = windU[i] ?? 0;
      const v = windV[i] ?? 0;
      const speed = Math.sqrt(u * u + v * v);
      // Wind direction: meteorological convention (where wind comes FROM)
      const dir = (Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360;
      return {
        ts,
        windSpeed: Math.round(speed * 10) / 10,
        windGust: Math.round((gusts[i] ?? speed) * 10) / 10,
        windDir: Math.round(dir),
      };
    });

    g.__wendy_forecast = {
      fetchedAt: Date.now(),
      model: "gfs",
      points,
    };

    console.log(`[windy] fetched ${points.length} forecast points`);
  } catch (err) {
    console.error("[windy] fetch error:", err);
  }
}

export function startWindyPoller(opts: { apiKey: string; lat: number; lon: number }): void {
  const { apiKey, lat, lon } = opts;
  console.log(`[windy] starting poller (every ${POLL_INTERVAL_MS / 60_000} min)`);

  // Fetch immediately, then every hour
  fetchForecast(apiKey, lat, lon);
  setInterval(() => fetchForecast(apiKey, lat, lon), POLL_INTERVAL_MS);
}
