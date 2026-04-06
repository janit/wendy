import { page } from "fresh";
import { getBus } from "../lib/state.ts";
import OverlayCharts from "../islands/OverlayCharts.tsx";

interface Data {
  power: number | null;
  arrayVoltage: number | null;
  batteryVoltage: number | null;
  victronVoltage: number | null;
  mode: string;
  todayKwh: number;
  todayKwh24v: number;
  todayKwh48v: number;
  temp: number | null;
}

export const handler = {
  GET() {
    const state = getBus().latest();
    return page({
      power: state.totalPower,
      arrayVoltage: state.arrayVoltage,
      batteryVoltage: state.batteryVoltage,
      victronVoltage: state.victronVoltage,
      mode: state.mode,
      todayKwh: state.todayKwh,
      todayKwh24v: state.todayKwh24v,
      todayKwh48v: state.todayKwh48v,
      temp: state.temp,
    } satisfies Data);
  },
};

export default function Overlay(props: { data: Data }) {
  const d = props.data;

  return (
    <div class="overlay-root">
      <style dangerouslySetInnerHTML={{ __html: `
        html, body { background: transparent !important; }
      `}} />
      <div class="overlay-grid">
        {/* Top-left: transparent — video shows through */}
        <div class="overlay-empty" />

        {/* Top-right: real-time stats */}
        <div class="overlay-panel overlay-stats">
          <div class="overlay-header">
            <span>WENDY</span>
            <span class="overlay-dot">&middot;</span>
            <span class="overlay-mode" id="ov-mode">{d.mode.toUpperCase()}</span>
          </div>
          <div class="overlay-watts" id="ov-watts">
            {d.power != null ? d.power.toFixed(0) : "\u2014"}
          </div>
          <div class="overlay-watts-unit">WATTS</div>
          <div class="overlay-info-row">
            <div>
              <div class="overlay-info-val" id="ov-bat24-v">
                {d.victronVoltage != null ? d.victronVoltage.toFixed(1) : "\u2014"}
              </div>
              <div class="overlay-info-label">V BAT 24</div>
            </div>
            <div>
              <div class="overlay-info-val" id="ov-bat48-v">
                {d.batteryVoltage != null ? d.batteryVoltage.toFixed(1) : "\u2014"}
              </div>
              <div class="overlay-info-label">V BAT 48</div>
            </div>
            <div>
              <div class="overlay-info-val" id="ov-array-v">
                {d.arrayVoltage != null ? d.arrayVoltage.toFixed(1) : "\u2014"}
              </div>
              <div class="overlay-info-label">V ARRAY</div>
            </div>
            <div>
              <div class="overlay-info-val" id="ov-temp">
                {d.temp != null ? d.temp.toFixed(0) : "\u2014"}&deg;C
              </div>
              <div class="overlay-info-label">HEATSINK</div>
            </div>
          </div>
          <div class="overlay-info-row" id="ov-chia-row" style="display:none">
            <div>
              <div class="overlay-info-val" id="ov-chia-status">...</div>
              <div class="overlay-info-label">CHIA FULL NODE</div>
            </div>
            <div>
              <div class="overlay-info-val" id="ov-chia-height">—</div>
              <div class="overlay-info-label">HEIGHT</div>
            </div>
            <div>
              <div class="overlay-info-val" id="ov-chia-peers">—</div>
              <div class="overlay-info-label">PEERS</div>
            </div>
          </div>
        </div>

        {/* Bottom row: charts */}
        <OverlayCharts />

      </div>

      {/* SSE updater for data panel + Chia poller */}
      <script dangerouslySetInnerHTML={{ __html: `
        const src = new EventSource("/api/events");
        src.onmessage = (e) => {
          const d = JSON.parse(e.data);
          const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
          set("ov-watts", d.totalPower != null ? d.totalPower.toFixed(0) : "\u2014");
          set("ov-array-v", d.arrayVoltage != null ? d.arrayVoltage.toFixed(1) : "\u2014");
          set("ov-bat48-v", d.batteryVoltage != null ? d.batteryVoltage.toFixed(1) : "\u2014");
          set("ov-bat24-v", d.victronVoltage != null ? d.victronVoltage.toFixed(1) : "\u2014");
          set("ov-temp", d.temp != null ? d.temp.toFixed(0) + "\u00b0C" : "\u2014");
          set("ov-mode", d.mode ? d.mode.toUpperCase() : "\u2014");
        };
        async function pollChia() {
          const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
          try {
            const r = await fetch("/api/chia");
            if (r.status === 404) return false;
            const row = document.getElementById("ov-chia-row");
            if (row) row.style.display = "";
            if (r.ok) {
              const c = await r.json();
              set("ov-chia-status", c.synced ? "SYNCED" : c.syncMode ? "SYNCING" : "OFFLINE");
              set("ov-chia-height", c.height != null ? c.height.toLocaleString() : "\u2014");
              set("ov-chia-peers", String(c.peers));
            } else {
              set("ov-chia-status", "OFFLINE");
            }
          } catch { set("ov-chia-status", "OFFLINE"); }
          return true;
        }
        pollChia().then(enabled => { if (enabled) setInterval(pollChia, 5000); });
      `}} />
    </div>
  );
}
