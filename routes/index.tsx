import { page } from "fresh";
import { getBus } from "../lib/state.ts";
import ThemeToggle from "../islands/ThemeToggle.tsx";
import StreamingCharts from "../islands/StreamingCharts.tsx";
import ChiaStatus from "../islands/ChiaStatus.tsx";
import WindForecast from "../islands/WindForecast.tsx";

interface Data {
  power: number | null;
  voltage: number | null;
  mode: string;
  todayKwh: number;
  todayKwh24v: number;
  todayKwh48v: number;
  chargeState: string | null;
  temp: number | null;
}

export const handler = {
  GET() {
    const state = getBus().latest();
    return page({
      power: state.totalPower,
      voltage: state.arrayVoltage,
      mode: state.mode,
      todayKwh: state.todayKwh,
      todayKwh24v: state.todayKwh24v,
      todayKwh48v: state.todayKwh48v,
      chargeState: state.chargeState,
      temp: state.temp,
    } satisfies Data);
  },
};

export default function Glance(props: { data: Data }) {
  const d = props.data;

  return (
    <div class="glance-grid">
      {/* Top-left: hero numbers */}
      <div class="glance-hero">
        <div class="glance-mode">
          <span>WENDY</span>
          <span style="margin: 0 8px; color: var(--text-label);">&middot;</span>
          <span class="glance-mode-value" id="glance-mode">{d.mode.toUpperCase()}</span>
        </div>
        <div class="glance-power" id="glance-power">
          {d.power != null ? d.power.toFixed(1) : "\u2014"}
        </div>
        <div class="glance-power-unit">WATTS</div>
        <div class="glance-divider" />
        <div class="glance-secondary">
          <div>
            <div class="glance-stat-value" id="glance-kwh">{(d.todayKwh * 1000).toFixed(0)}</div>
            <div class="glance-stat-label">Wh TODAY</div>
          </div>
          <div>
            <div class="glance-stat-value" id="glance-kwh24">{(d.todayKwh24v * 1000).toFixed(0)}</div>
            <div class="glance-stat-label">24V Wh</div>
          </div>
          <div>
            <div class="glance-stat-value" id="glance-kwh48">{(d.todayKwh48v * 1000).toFixed(0)}</div>
            <div class="glance-stat-label">48V Wh</div>
          </div>
          <div>
            <div class="glance-stat-value" id="glance-voltage">
              {d.voltage != null ? d.voltage.toFixed(1) : "\u2014"}
            </div>
            <div class="glance-stat-label">VOLTS</div>
          </div>
          <div>
            <div class="glance-stat-value" id="glance-temp">
              {d.temp != null ? d.temp.toFixed(1) : "\u2014"}
            </div>
            <div class="glance-stat-label">&deg;C HEATSINK</div>
          </div>
        </div>
        <div class="glance-charge-state" id="glance-charge">
          {(d.chargeState ?? "\u2014").toUpperCase()}
        </div>
        <div class="glance-divider" />
        <ChiaStatus />
      </div>

      {/* Top-right + bottom: charts in 2x2 grid */}
      <StreamingCharts layout="grid" />

      {/* Wind forecast chart */}
      <WindForecast />

      {/* Theme toggle */}
      <div style="position: fixed; bottom: 12px; right: 12px; opacity: 0.3; z-index: 10;">
        <ThemeToggle />
      </div>

      {/* SSE updater for hero numbers */}
      <script dangerouslySetInnerHTML={{ __html: `
        const src = new EventSource("/api/events");
        src.onmessage = (e) => {
          const d = JSON.parse(e.data);
          const el = (id) => document.getElementById(id);
          const set = (id, v) => { const e = el(id); if (e) e.textContent = v; };
          set("glance-power", d.totalPower != null ? d.totalPower.toFixed(1) : "\u2014");
          set("glance-kwh", d.todayKwh != null ? (d.todayKwh * 1000).toFixed(0) : "\u2014");
          set("glance-kwh24", d.todayKwh24v != null ? (d.todayKwh24v * 1000).toFixed(0) : "\u2014");
          set("glance-kwh48", d.todayKwh48v != null ? (d.todayKwh48v * 1000).toFixed(0) : "\u2014");
          set("glance-voltage", d.arrayVoltage != null ? d.arrayVoltage.toFixed(1) : "\u2014");
          set("glance-temp", d.temp != null ? d.temp.toFixed(1) : "\u2014");
          set("glance-mode", d.mode ? d.mode.toUpperCase() : "\u2014");
          set("glance-charge", d.chargeState ? d.chargeState.toUpperCase() : "\u2014");
        };
      `}} />
    </div>
  );
}
