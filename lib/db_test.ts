import { assertEquals } from "jsr:@std/assert";
import { createDb, insertSamples, getHistory, updateDailyStats, getDailyStats, pruneOldSamples } from "./db.ts";
import type { Sample } from "./db.ts";

function testDb() {
  return createDb(":memory:");
}

Deno.test("createDb - tables exist", () => {
  const db = testDb();
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  ).all<{ name: string }>();
  const names = tables.map((t) => t.name);
  assertEquals(names.includes("samples"), true);
  assertEquals(names.includes("daily_stats"), true);
  db.close();
});

Deno.test("insertSamples - inserts and retrieves", () => {
  const db = testDb();
  const now = Math.floor(Date.now() / 1000);
  const samples: Sample[] = [
    { ts: now, source: "victron", power: 500, voltage: 26.1, current: 19.2, temp: null, mode: "24v" },
    { ts: now, source: "tristar", power: 847, voltage: 52.4, current: 16.2, temp: 34, mode: "48v" },
  ];
  insertSamples(db, samples);
  const rows = getHistory(db, now - 10, now + 10);
  assertEquals(rows.length, 2);
  db.close();
});

Deno.test("insertSamples - upsert on duplicate key", () => {
  const db = testDb();
  const now = Math.floor(Date.now() / 1000);
  insertSamples(db, [
    { ts: now, source: "victron", power: 500, voltage: 26, current: 19, temp: null, mode: "24v" },
  ]);
  insertSamples(db, [
    { ts: now, source: "victron", power: 600, voltage: 27, current: 22, temp: null, mode: "24v" },
  ]);
  const rows = getHistory(db, now - 10, now + 10);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].power, 600);
  db.close();
});

Deno.test("updateDailyStats - creates and updates", () => {
  const db = testDb();
  // First flush: 1.5 kWh running total from hardware counters
  updateDailyStats(db, "2026-03-27", 1.5, 847, 52.4);
  // Second flush: 1.8 kWh running total (replaces, not accumulates)
  updateDailyStats(db, "2026-03-27", 1.8, 1200, 48.0);
  const stats = getDailyStats(db, "2026-03-27");
  assertEquals(stats!.total_kwh, 1.8);
  // peak_power and peak_voltage use MAX, so highest values are kept
  assertEquals(stats!.peak_power, 1200);
  assertEquals(stats!.peak_voltage, 52.4);
  db.close();
});

Deno.test("pruneOldSamples - removes old data", () => {
  const db = testDb();
  const old = Math.floor(Date.now() / 1000) - 90000;
  const recent = Math.floor(Date.now() / 1000) - 100;
  insertSamples(db, [
    { ts: old, source: "victron", power: 100, voltage: 25, current: 4, temp: null, mode: "24v" },
    { ts: recent, source: "victron", power: 500, voltage: 26, current: 19, temp: null, mode: "24v" },
  ]);
  pruneOldSamples(db, 86400);
  const rows = getHistory(db, 0, Math.floor(Date.now() / 1000) + 10);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].power, 500);
  db.close();
});
