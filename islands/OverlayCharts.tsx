import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";

const MAX_POINTS = 600; // 10 minutes at 1s resolution

const LINE_WIDTH = 3;
const FONT_AXIS = "14px system-ui, sans-serif";
const FONT_LEGEND = "bold 15px system-ui, sans-serif";
const LABEL_COLOR = "rgba(255,255,255,0.5)";
const GRID_COLOR = "rgba(255,255,255,0.08)";

interface Point {
  ts: number;
  arrayVoltage: number | null;
  batteryVoltage: number | null;
  victronPower: number | null;
  victronVoltage: number | null;
  victron48vPower: number | null;
  totalPower: number | null;
  mode: string;
}

interface Series {
  key: keyof Point;
  color: string;
  label: string;
}

interface ChartConfig {
  title: string;
  unit: string;
  minRange: number;
  series: Series[];
}

const VOLTAGE_CHART: ChartConfig = {
  title: "Voltage",
  unit: "V",
  minRange: 10,
  series: [
    { key: "arrayVoltage", color: "#fbbf24", label: "Array" },
    { key: "batteryVoltage", color: "#22d3ee", label: "Bat 48V" },
    { key: "victronVoltage", color: "#4ade80", label: "Bat 24V" },
  ],
};

const VOLTAGE_24H: ChartConfig = {
  title: "Voltage — 24h",
  unit: "V",
  minRange: 10,
  series: [
    { key: "arrayVoltage", color: "#fbbf24", label: "Array" },
    { key: "batteryVoltage", color: "#22d3ee", label: "Bat 48V" },
    { key: "victronVoltage", color: "#4ade80", label: "Bat 24V" },
  ],
};

const POWER_CHART: ChartConfig = {
  title: "Power",
  unit: "W",
  minRange: 10,
  series: [
    { key: "totalPower", color: "#ffffff", label: "Total" },
    { key: "victronPower", color: "#4ade80", label: "24V" },
    { key: "victron48vPower", color: "#22d3ee", label: "48V" },
  ],
};

function fmtVal(v: number | null): string {
  if (v == null) return "\u2014";
  if (Math.abs(v) < 0.01) return "0";
  return v.toFixed(1);
}

function fmtTime(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtTimeShort(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function OverlayCharts() {
  const voltageRef = useRef<HTMLCanvasElement>(null);
  const powerRef = useRef<HTMLCanvasElement>(null);
  const voltage24hRef = useRef<HTMLCanvasElement>(null);
  const points = useSignal<Point[]>([]);
  const history24h = useSignal<Point[]>([]);
  const latest = useSignal<Point | null>(null);

  function stateToPoint(d: Record<string, unknown>, ts: number): Point {
    return {
      ts,
      arrayVoltage: d.arrayVoltage as number | null,
      batteryVoltage: d.batteryVoltage as number | null,
      victronPower: d.victronPower as number | null,
      victronVoltage: d.victronVoltage as number | null,
      victron48vPower: d.victron48vPower as number | null,
      totalPower: d.totalPower as number | null,
      mode: (d.mode as string) ?? "24v",
    };
  }

  function sampleToPoint(s: Record<string, unknown>): Point {
    return {
      ts: s.ts as number,
      arrayVoltage: s.source === "tristar" ? (s.voltage as number | null) : null,
      batteryVoltage: null,
      victronPower: s.source === "victron" ? (s.power as number | null) : null,
      victronVoltage: s.source === "victron" ? (s.voltage as number | null) : null,
      victron48vPower: null,
      totalPower: s.power as number | null,
      mode: (s.mode as string) ?? "24v",
    };
  }

  useEffect(() => {
    fetch("/api/recent")
      .then((r) => r.json())
      .then((hist: { ts: number; state: Record<string, unknown> }[]) => {
        const pts = hist.map((h) => stateToPoint(h.state, h.ts));
        if (pts.length > 0) {
          points.value = pts;
          latest.value = pts[pts.length - 1];
          drawAll();
        }
      })
      .catch(() => {});

    fetch("/api/history")
      .then((r) => r.json())
      .then((rows: Record<string, unknown>[]) => {
        const byTs = new Map<number, Point>();
        for (const row of rows) {
          const ts = row.ts as number;
          const existing = byTs.get(ts) || sampleToPoint(row);
          if (row.source === "tristar") {
            existing.arrayVoltage = row.voltage as number | null;
          } else if (row.source === "victron") {
            existing.victronVoltage = row.voltage as number | null;
          }
          byTs.set(ts, existing);
        }
        history24h.value = [...byTs.values()].sort((a, b) => a.ts - b.ts);
        draw24h();
      })
      .catch(() => {});

    const source = new EventSource("/api/events");
    source.onmessage = (e) => {
      const d = JSON.parse(e.data);
      const now = Date.now() / 1000;
      const pt = stateToPoint(d, now);
      latest.value = pt;
      const cutoff = now - MAX_POINTS;
      points.value = [...points.value.filter((p) => p.ts >= cutoff), pt];

      const cutoff24h = now - 86400;
      history24h.value = [...history24h.value.filter((p) => p.ts >= cutoff24h), pt];

      drawAll();
      draw24h();
    };

    const obs = new ResizeObserver(() => { drawAll(); draw24h(); });
    if (voltageRef.current) obs.observe(voltageRef.current);
    if (powerRef.current) obs.observe(powerRef.current);
    if (voltage24hRef.current) obs.observe(voltage24hRef.current);

    return () => { source.close(); obs.disconnect(); };
  }, []);

  function drawAll() {
    drawChart(voltageRef.current, VOLTAGE_CHART, points.value, fmtTime);
    drawChart(powerRef.current, POWER_CHART, points.value, fmtTime);
  }

  function draw24h() {
    drawChart(voltage24hRef.current, VOLTAGE_24H, history24h.value, fmtTimeShort);
  }

  function drawChart(canvas: HTMLCanvasElement | null, cfg: ChartConfig, data: Point[], timeFmt: (ts: number) => string) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    if (w === 0 || h === 0) return;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    ctx.font = FONT_AXIS;

    // Layout
    const yAxisW = 48;
    const xAxisH = 22;
    const legendH = 28;
    const pad = { top: legendH + 4, right: 10 };
    const plotX = yAxisW;
    const plotY = pad.top;
    const plotW = w - yAxisW - pad.right;
    const plotH = h - pad.top - xAxisH;

    // Y range
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const s of cfg.series) {
      for (const pt of data) {
        const v = pt[s.key] as number | null;
        if (v != null) {
          if (v < yMin) yMin = v;
          if (v > yMax) yMax = v;
        }
      }
    }
    if (!isFinite(yMin)) { yMin = 0; yMax = cfg.minRange; }
    const mid = (yMin + yMax) / 2;
    if (yMax - yMin < cfg.minRange) {
      yMin = mid - cfg.minRange / 2;
      yMax = mid + cfg.minRange / 2;
    }
    const pad2 = (yMax - yMin) * 0.1;
    yMin -= pad2;
    yMax += pad2;
    const yRange = yMax - yMin || 1;

    let minTs: number, maxTs: number, tsRange: number;
    if (data.length >= 2) {
      minTs = data[0].ts;
      maxTs = data[data.length - 1].ts;
      tsRange = maxTs - minTs || 1;
    } else {
      const now = Date.now() / 1000;
      minTs = now - MAX_POINTS;
      maxTs = now;
      tsRange = MAX_POINTS;
    }

    const toX = (ts: number) => plotX + ((ts - minTs) / tsRange) * plotW;
    const toY = (v: number) => plotY + (1 - (v - yMin) / yRange) * plotH;

    // Grid + Y labels
    const gridStep = niceStep(yRange, 4);
    const gridStart = Math.ceil(yMin / gridStep) * gridStep;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.font = FONT_AXIS;
    for (let v = gridStart; v <= yMax + 0.001; v += gridStep) {
      const y = toY(v);
      ctx.strokeStyle = GRID_COLOR;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(plotX, y);
      ctx.lineTo(plotX + plotW, y);
      ctx.stroke();
      ctx.fillStyle = LABEL_COLOR;
      ctx.fillText(
        Math.abs(v) < 0.001 ? "0" : v < 10 && v > -10 ? v.toFixed(1) : Math.round(v).toString(),
        yAxisW - 6, y,
      );
    }

    // X labels
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = LABEL_COLOR;
    const xLabelCount = Math.min(4, Math.floor(plotW / 90));
    for (let i = 0; i <= xLabelCount; i++) {
      const frac = i / xLabelCount;
      const ts = minTs + frac * tsRange;
      ctx.fillText(timeFmt(ts), plotX + frac * plotW, plotY + plotH + 4);
    }

    // Legend (top-left, inside chart)
    ctx.font = FONT_LEGEND;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    let legendX = plotX + 8;
    const cur = latest.value;
    for (const s of cfg.series) {
      const val = cur ? (cur[s.key] as number | null) : null;
      const text = `${s.label} ${fmtVal(val)}${cfg.unit}`;

      // Dot
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(legendX + 5, 12, 5, 0, Math.PI * 2);
      ctx.fill();
      legendX += 16;

      // Text with shadow for readability
      ctx.fillStyle = s.color;
      ctx.shadowColor = "rgba(0,0,0,0.8)";
      ctx.shadowBlur = 4;
      ctx.fillText(text, legendX, 4);
      ctx.shadowBlur = 0;
      const textW = ctx.measureText(text).width;
      legendX += textW + 20;
    }

    // Clip to plot area
    ctx.save();
    ctx.beginPath();
    ctx.rect(plotX, plotY, plotW, plotH);
    ctx.clip();

    if (data.length < 2) {
      ctx.font = FONT_AXIS;
      ctx.fillStyle = LABEL_COLOR;
      ctx.textAlign = "center";
      ctx.fillText("Waiting for data\u2026", plotX + plotW / 2, plotY + plotH / 2);
      ctx.restore();
      return;
    }

    // Mode transitions
    for (let i = 1; i < data.length; i++) {
      if (data[i].mode !== data[i - 1].mode) {
        const x = toX(data[i].ts);
        ctx.strokeStyle = "rgba(255,255,255,0.15)";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(x, plotY);
        ctx.lineTo(x, plotY + plotH);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Series lines
    for (const s of cfg.series) {
      ctx.beginPath();
      ctx.strokeStyle = s.color;
      ctx.lineWidth = LINE_WIDTH;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      let moved = false;
      for (let i = 0; i < data.length; i++) {
        const v = data[i][s.key] as number | null;
        if (v == null) continue;
        const x = toX(data[i].ts);
        const y = toY(v);
        if (!moved) { ctx.moveTo(x, y); moved = true; }
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    ctx.restore();
  }

  function niceStep(range: number, targetLines: number): number {
    const rough = range / targetLines;
    const mag = Math.pow(10, Math.floor(Math.log10(rough)));
    const norm = rough / mag;
    if (norm <= 1) return mag;
    if (norm <= 2) return 2 * mag;
    if (norm <= 5) return 5 * mag;
    return 10 * mag;
  }

  return (
    <>
      <div class="overlay-panel overlay-chart">
        <canvas
          ref={voltageRef}
          style="width:100%;height:100%;display:block;"
        />
      </div>
      <div class="overlay-panel overlay-chart">
        <canvas
          ref={powerRef}
          style="width:100%;height:100%;display:block;"
        />
      </div>
      <div class="overlay-panel overlay-chart overlay-chart-24h">
        <canvas
          ref={voltage24hRef}
          style="width:100%;height:100%;display:block;"
        />
      </div>
    </>
  );
}
