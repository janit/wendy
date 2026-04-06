import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";

interface ForecastPoint {
  ts: number;
  windSpeed: number;
  windGust: number;
  windDir: number;
}

interface ForecastData {
  fetchedAt: number;
  model: string;
  now: number;
  points: ForecastPoint[];
}

const REFRESH_MS = 3_600_000;

function dirLabel(deg: number): string {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round(deg / 22.5) % 16];
}

function fmtHour(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", hour12: false });
}

function dayLabel(ts: number): string {
  return new Date(ts).toLocaleDateString([], { weekday: "short" });
}

/** Color-code wind speed: calm→green→yellow→orange→red */
function windColor(speed: number): string {
  if (speed < 2) return "#8bc34a";
  if (speed < 5) return "#4caf50";
  if (speed < 8) return "#ffc107";
  if (speed < 11) return "#ff9800";
  if (speed < 15) return "#f44336";
  return "#d32f2f";
}

/** Wind direction arrow as a rotated SVG */
function WindArrow({ deg, size = 12 }: { deg: number; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={`transform:rotate(${deg}deg);display:block;margin:0 auto;`}
    >
      <path d="M12 2 L8 14 L12 11 L16 14 Z" fill="currentColor" opacity="0.7" />
    </svg>
  );
}

/** Find the closest point index to a given timestamp */
function closestIdx(points: ForecastPoint[], ts: number): number {
  let best = 0;
  let bestDist = Math.abs(points[0].ts - ts);
  for (let i = 1; i < points.length; i++) {
    const dist = Math.abs(points[i].ts - ts);
    if (dist < bestDist) { best = i; bestDist = dist; }
  }
  return best;
}

export default function WindForecast() {
  const data = useSignal<ForecastData | null>(null);

  function fetchData() {
    fetch("/api/forecast")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d) data.value = d; })
      .catch(() => {});
  }

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  const fc = data.value;
  if (!fc || fc.points.length === 0) {
    return (
      <div class="chart-card chart-forecast">
        <div class="chart-title">Wind Forecast</div>
        <div style="padding:8px;color:var(--text-label);font-size:12px;">Waiting for data...</div>
      </div>
    );
  }

  const pts = fc.points;
  const nowIdx = closestIdx(pts, fc.now);
  const nowPt = pts[nowIdx];

  // Detect day boundaries for headers
  const dayBreaks: { idx: number; label: string }[] = [];
  let lastDay = "";
  for (let i = 0; i < pts.length; i++) {
    const d = dayLabel(pts[i].ts);
    if (d !== lastDay) {
      dayBreaks.push({ idx: i, label: d });
      lastDay = d;
    }
  }

  return (
    <div class="chart-card chart-forecast">
      <div class="forecast-header">
        <span class="chart-title">Wind Forecast (GFS)</span>
        <span class="forecast-now-summary">
          <strong style={`color:${windColor(nowPt.windSpeed)}`}>{nowPt.windSpeed.toFixed(1)}</strong>
          <span style="color:var(--text-label)"> m/s</span>
          <span style="margin:0 4px;color:var(--text-label)">gust</span>
          <strong style={`color:${windColor(nowPt.windGust)}`}>{nowPt.windGust.toFixed(1)}</strong>
          <span style="color:var(--text-label)"> m/s</span>
          <span style="margin:0 4px;color:var(--text-label)">{dirLabel(nowPt.windDir)}</span>
          <WindArrow deg={nowPt.windDir} size={14} />
        </span>
      </div>
      <div class="forecast-strip-wrap">
        <div class="forecast-strip">
          {/* Day header row */}
          <div class="forecast-row forecast-row-days">
            <div class="forecast-label" />
            {pts.map((p, i) => {
              const brk = dayBreaks.find((b) => b.idx === i);
              return (
                <div
                  key={`day-${i}`}
                  class={`forecast-cell${i === nowIdx ? " forecast-now" : ""}`}
                >
                  {brk ? <span class="forecast-day-label">{brk.label}</span> : null}
                </div>
              );
            })}
          </div>
          {/* Hour row */}
          <div class="forecast-row">
            <div class="forecast-label">Hour</div>
            {pts.map((p, i) => (
              <div
                key={`h-${i}`}
                class={`forecast-cell${i === nowIdx ? " forecast-now" : ""}`}
              >
                {fmtHour(p.ts)}
              </div>
            ))}
          </div>
          {/* Wind speed row */}
          <div class="forecast-row">
            <div class="forecast-label">Wind</div>
            {pts.map((p, i) => (
              <div
                key={`s-${i}`}
                class={`forecast-cell${i === nowIdx ? " forecast-now" : ""}`}
                style={`color:${windColor(p.windSpeed)};font-weight:600`}
              >
                {Math.round(p.windSpeed)}
              </div>
            ))}
          </div>
          {/* Wind gust row */}
          <div class="forecast-row">
            <div class="forecast-label">Gust</div>
            {pts.map((p, i) => (
              <div
                key={`g-${i}`}
                class={`forecast-cell${i === nowIdx ? " forecast-now" : ""}`}
                style={`color:${windColor(p.windGust)}`}
              >
                {Math.round(p.windGust)}
              </div>
            ))}
          </div>
          {/* Wind direction row */}
          <div class="forecast-row">
            <div class="forecast-label">Dir</div>
            {pts.map((p, i) => (
              <div
                key={`d-${i}`}
                class={`forecast-cell${i === nowIdx ? " forecast-now" : ""}`}
              >
                <WindArrow deg={p.windDir} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
