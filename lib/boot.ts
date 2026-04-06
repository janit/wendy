import { createDb, insertSamples, updateDailyStats, pruneOldSamples, getEnergySnapshot, setEnergySnapshot } from "./db.ts";
import { DataBus } from "./databus.ts";
import { startMqtt } from "./mqtt.ts";
import { startModbus } from "./modbus.ts";
import { startVictronModbus } from "./victron-modbus.ts";
import { startWsClient } from "./ws-client.ts";
import { initState } from "./state.ts";

const FLUSH_INTERVAL_MS = 5000;
const PRUNE_MAX_AGE_S = 86400; // 24h
const PRUNE_INTERVAL_MS = 600_000; // 10 minutes

export type Role = "source" | "display" | "standalone";

/**
 * Initialize services based on WENDY_ROLE and return config.
 */
export async function boot(): Promise<{ port: number; role: Role }> {
  const rawRole = Deno.env.get("WENDY_ROLE") ?? "standalone";
  if (!["source", "display", "standalone"].includes(rawRole)) {
    throw new Error(`Invalid WENDY_ROLE: "${rawRole}" (must be source, display, or standalone)`);
  }
  const role = rawRole as Role;
  const PORT = parseInt(Deno.env.get("WENDY_PORT") ?? "8086");

  console.log(`[boot] role=${role}`);

  const bus = new DataBus();

  // Display & standalone: init DB, share state with routes, start flush loop
  if (role !== "source") {
    const DB_PATH = Deno.env.get("WENDY_DB_PATH") ?? "./data/wendy.db";
    const db = createDb(DB_PATH);
    console.log(`[db] opened ${DB_PATH}`);

    initState(db, bus);

    // Restore energy snapshots from DB
    const today = new Date().toISOString().slice(0, 10);
    const snap24v = getEnergySnapshot(db, today, "charged24v");
    const snap48v = getEnergySnapshot(db, today, "charged48v");
    bus.restoreSnapshots(snap24v, snap48v);
    if (snap24v != null || snap48v != null) {
      console.log(`[boot] restored energy snapshots: 24v=${snap24v} 48v=${snap48v}`);
    }

    let lastPrune = 0;

    setInterval(() => {
      const samples = bus.drainBuffer();
      if (samples.length === 0) return;

      try {
        insertSamples(db, samples);

        const today = new Date().toISOString().slice(0, 10);
        const maxPower = Math.max(...samples.map((s) => s.power ?? 0));
        const maxVoltage = Math.max(...samples.map((s) => s.voltage ?? 0));

        // Use Victron hardware counters as source of truth for daily energy
        const todayTotal = bus.todayKwh24v + bus.todayKwh48v;
        updateDailyStats(db, today, todayTotal, maxPower, maxVoltage);

        const now = Date.now();
        if (now - lastPrune >= PRUNE_INTERVAL_MS) {
          pruneOldSamples(db, PRUNE_MAX_AGE_S);
          lastPrune = now;
        }

        // Persist energy snapshots so they survive restarts
        const snapDate = new Date().toISOString().slice(0, 10);
        const snaps = bus.getSnapshots();
        if (snaps.charged24v != null) setEnergySnapshot(db, snapDate, "charged24v", snaps.charged24v);
        if (snaps.charged48v != null) setEnergySnapshot(db, snapDate, "charged48v", snaps.charged48v);
      } catch (err) {
        console.error("[flush] error:", err);
      }
    }, FLUSH_INTERVAL_MS);
  }

  // Source & standalone: start hardware pollers
  if (role !== "display") {
    const MQTT_HOST = Deno.env.get("WENDY_MQTT_HOST") ?? "192.168.47.6";
    const MQTT_PORT = parseInt(Deno.env.get("WENDY_MQTT_PORT") ?? "1883");
    const MODBUS_HOST = Deno.env.get("WENDY_MODBUS_HOST") ?? "192.168.47.11";
    const MODBUS_PORT = parseInt(Deno.env.get("WENDY_MODBUS_PORT") ?? "502");
    const GX_HOST = Deno.env.get("WENDY_GX_HOST") ?? "192.168.47.6";
    const GX_MODBUS_PORT = parseInt(Deno.env.get("WENDY_GX_MODBUS_PORT") ?? "502");

    try {
      await startMqtt(bus, { host: MQTT_HOST, port: MQTT_PORT });
    } catch (err) {
      console.error("[main] MQTT failed to start:", err);
    }

    try {
      await startModbus(bus, {
        host: MODBUS_HOST,
        port: MODBUS_PORT,
        slaveId: 1,
        pollIntervalMs: 1000,
      });
    } catch (err) {
      console.error("[main] TriStar Modbus failed:", err);
    }

    try {
      startVictronModbus(bus, {
        host: GX_HOST,
        port: GX_MODBUS_PORT,
        pollIntervalMs: 1000,
      });
    } catch (err) {
      console.error("[main] Victron GX Modbus failed:", err);
    }
  }

  // Source mode: no DB, so disable sample buffering to prevent unbounded memory growth
  if (role === "source") {
    bus.disableBuffer();
  }

  // Source: start WebSocket client to upstream
  if (role === "source") {
    const upstream = Deno.env.get("WENDY_UPSTREAM");
    if (!upstream) {
      throw new Error("WENDY_UPSTREAM is required when WENDY_ROLE=source");
    }
    const secret = Deno.env.get("WENDY_SECRET");
    startWsClient(bus, upstream, secret);
  }

  return { port: PORT, role };
}
