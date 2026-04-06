import type { Sample } from "./db.ts";
import type { BusFields } from "./types.ts";

export interface Reading {
  source: "victron" | "tristar";
  power: number | null;
  voltage: number | null;
  current: number | null;
  temp: number | null;
  chargeState: string | null;
  batteryVoltage: number | null;
}

export interface MergedState {
  // TriStar (48V side)
  power: number | null;
  arrayVoltage: number | null;
  current: number | null;
  batteryVoltage: number | null;
  temp: number | null;
  chargeState: string | null;
  // Victron shunts
  victronPower: number | null;     // 24V Wind Control
  victronVoltage: number | null;
  victronCurrent: number | null;
  victron48vPower: number | null;  // 48V Wind Turbine
  victron48vCurrent: number | null;
  // Combined
  totalPower: number | null;
  totalCurrent: number | null;
  // Derived
  mode: "24v" | "48v";
  todayKwh: number;
  todayKwh24v: number;
  todayKwh48v: number;
  peakPower: number;
  peakVoltage: number;
  lifetimeKwh: number;
}

const MODE_UP_THRESHOLD = 52;
const MODE_DOWN_THRESHOLD = 48;

type Listener = (state: MergedState) => void;

const HISTORY_SIZE = 600; // 10 minutes at 1s

export interface TimestampedState {
  ts: number;
  state: MergedState;
}

export class DataBus {
  private latestBySource: Record<string, Reading> = {};
  private mode: "24v" | "48v" = "24v";
  private listeners: Set<Listener> = new Set();
  private buffer: Sample[] = [];
  private bufferEnabled = true;
  private historyBuf: (TimestampedState | null)[] = new Array(HISTORY_SIZE).fill(null);
  private historyIdx = 0;
  private pushListeners: Set<(reading: Reading) => void> = new Set();
  private fieldListeners: Set<(fields: Partial<BusFields>) => void> = new Set();

  todayKwh = 0;
  peakPower = 0;
  peakVoltage = 0;
  lifetimeKwh = 0;
  victronChargedKwh = 0; // cumulative from 24V BMV (10 Wh resolution)
  victronDischargedKwh = 0;
  victron48vPower: number | null = null;
  victron48vCurrent: number | null = null;
  victron48vVoltage: number | null = null;
  victron48vChargedKwh = 0; // cumulative from 48V shunt
  private charged24vStart: number | null = null;
  private charged48vStart: number | null = null;
  private currentDay: string = new Date().toISOString().slice(0, 10);

  push(reading: Reading): void {
    for (const listener of this.pushListeners) {
      listener(reading);
    }
    this.latestBySource[reading.source] = reading;

    if (reading.source === "tristar" && reading.voltage != null) {
      if (reading.voltage >= MODE_UP_THRESHOLD && this.mode === "24v") {
        this.mode = "48v";
      } else if (reading.voltage < MODE_DOWN_THRESHOLD && this.mode === "48v") {
        this.mode = "24v";
      }
    }

    if (this.bufferEnabled) {
      this.buffer.push({
        ts: Math.floor(Date.now() / 1000),
        source: reading.source,
        power: reading.power,
        voltage: reading.voltage,
        current: reading.current,
        temp: reading.temp,
        mode: this.mode,
      });
    }

    const state = this.latest();

    // Keep circular buffer of recent states for chart preloading
    this.historyBuf[this.historyIdx % HISTORY_SIZE] = { ts: Math.floor(Date.now() / 1000), state };
    this.historyIdx++;

    for (const listener of this.listeners) {
      listener(state);
    }
  }

  /** Restore snapshots from DB on boot */
  restoreSnapshots(charged24v: number | null, charged48v: number | null): void {
    this.charged24vStart = charged24v;
    this.charged48vStart = charged48v;
  }

  /** Get current snapshots for persistence */
  getSnapshots(): { charged24v: number | null; charged48v: number | null } {
    return { charged24v: this.charged24vStart, charged48v: this.charged48vStart };
  }

  private checkDayRollover(): void {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.currentDay) {
      this.charged24vStart = null;
      this.charged48vStart = null;
      this.currentDay = today;
    }
  }

  /** Daily 24V kWh from BMV cumulative counter (10 Wh resolution) */
  get todayKwh24v(): number {
    this.checkDayRollover();
    if (this.charged24vStart === null && this.victronChargedKwh > 0) {
      this.charged24vStart = this.victronChargedKwh;
    }
    if (this.charged24vStart === null) return 0;
    return Math.max(0, this.victronChargedKwh - this.charged24vStart);
  }

  /** Daily 48V kWh from SmartShunt cumulative counter */
  get todayKwh48v(): number {
    this.checkDayRollover();
    if (this.charged48vStart === null && this.victron48vChargedKwh > 0) {
      this.charged48vStart = this.victron48vChargedKwh;
    }
    if (this.charged48vStart === null) return 0;
    return Math.max(0, this.victron48vChargedKwh - this.charged48vStart);
  }

  latest(): MergedState {
    const tristar = this.latestBySource["tristar"];
    const victron = this.latestBySource["victron"];

    // Use Victron shunt readings for power (more reliable than TriStar registers)
    const p24 = victron?.power ?? 0;
    const p48 = this.victron48vPower ?? 0;

    return {
      power: this.victron48vPower,
      arrayVoltage: tristar?.voltage ?? null,
      current: tristar?.current ?? null,
      batteryVoltage: tristar?.batteryVoltage ?? null,
      temp: tristar?.temp ?? null,
      chargeState: tristar?.chargeState ?? null,
      victronPower: victron?.power ?? null,
      victronVoltage: victron?.voltage ?? null,
      victronCurrent: victron?.current ?? null,
      victron48vPower: this.victron48vPower,
      victron48vCurrent: this.victron48vCurrent,
      totalPower: p24 + p48,
      totalCurrent: (victron?.current ?? 0) + (this.victron48vCurrent ?? 0),
      mode: this.mode,
      todayKwh: this.todayKwh24v + this.todayKwh48v,
      todayKwh24v: this.todayKwh24v,
      todayKwh48v: this.todayKwh48v,
      peakPower: this.peakPower,
      peakVoltage: this.peakVoltage,
      lifetimeKwh: this.lifetimeKwh,
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  recentHistory(): TimestampedState[] {
    const result: TimestampedState[] = [];
    const count = Math.min(this.historyIdx, HISTORY_SIZE);
    const start = this.historyIdx - count;
    for (let i = start; i < this.historyIdx; i++) {
      const entry = this.historyBuf[i % HISTORY_SIZE];
      if (entry) result.push(entry);
    }
    return result;
  }

  drainBuffer(): Sample[] {
    const items = this.buffer;
    this.buffer = [];
    return items;
  }

  disableBuffer(): void {
    this.bufferEnabled = false;
    this.buffer = [];
  }

  onPush(listener: (reading: Reading) => void): () => void {
    this.pushListeners.add(listener);
    return () => this.pushListeners.delete(listener);
  }

  private static readonly ALLOWED_FIELDS: Set<string> = new Set([
    "todayKwh", "peakPower", "peakVoltage", "lifetimeKwh",
    "victronChargedKwh", "victronDischargedKwh",
    "victron48vPower", "victron48vCurrent", "victron48vVoltage",
    "victron48vChargedKwh",
  ]);

  setFields(fields: Partial<BusFields>): void {
    const safe: Partial<BusFields> = {};
    for (const key of Object.keys(fields)) {
      if (DataBus.ALLOWED_FIELDS.has(key)) {
        (safe as Record<string, unknown>)[key] = (fields as Record<string, unknown>)[key];
      }
    }
    Object.assign(this, safe);
    for (const listener of this.fieldListeners) {
      listener(safe);
    }
  }

  onFields(listener: (fields: Partial<BusFields>) => void): () => void {
    this.fieldListeners.add(listener);
    return () => this.fieldListeners.delete(listener);
  }
}
