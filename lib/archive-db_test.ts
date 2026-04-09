import { assertEquals } from "jsr:@std/assert";
import {
  createArchiveDb,
  getArchivedDay,
  hasArchivedDay,
  insertArchivedDay,
  listArchivedDays,
  pruneArchive,
} from "./archive-db.ts";
import { encodeDay } from "./archive-codec.ts";
import type { Sample } from "./db.ts";

function testDb() {
  return createArchiveDb(":memory:");
}

Deno.test("archive-db - createArchiveDb creates archive_day table", () => {
  const db = testDb();
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  ).all<{ name: string }>();
  assertEquals(tables.map((t) => t.name).includes("archive_day"), true);
  db.close();
});

Deno.test("archive-db - insert and hasArchivedDay", () => {
  const db = testDb();
  assertEquals(hasArchivedDay(db, "2026-04-01"), false);
  insertArchivedDay(db, {
    date: "2026-04-01",
    row_count: 5,
    ts_start: 1743465600,
    ts_end: 1743552000,
    format: "gzip-cols-v1",
    blob: new Uint8Array([1, 2, 3]),
    created_at: 1743600000,
  });
  assertEquals(hasArchivedDay(db, "2026-04-01"), true);
  assertEquals(hasArchivedDay(db, "2026-04-02"), false);
  db.close();
});

Deno.test("archive-db - duplicate insert throws", () => {
  const db = testDb();
  const row = {
    date: "2026-04-01",
    row_count: 5,
    ts_start: 1743465600,
    ts_end: 1743552000,
    format: "gzip-cols-v1",
    blob: new Uint8Array([1, 2, 3]),
    created_at: 1743600000,
  };
  insertArchivedDay(db, row);
  let threw = false;
  try {
    insertArchivedDay(db, row);
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
  db.close();
});

Deno.test("archive-db - getArchivedDay round-trip", async () => {
  const db = testDb();
  const samples: Sample[] = [
    { ts: 1700000000, source: "tristar", power: 100, voltage: 48, current: 2, temp: 25, mode: "48v" },
    { ts: 1700000001, source: "victron", power: 200, voltage: 24, current: 8, temp: null, mode: "24v" },
  ];
  const blob = await encodeDay(samples);
  insertArchivedDay(db, {
    date: "2026-04-01",
    row_count: samples.length,
    ts_start: 1700000000,
    ts_end: 1700000002,
    format: "gzip-cols-v1",
    blob,
    created_at: 1700001000,
  });
  const decoded = await getArchivedDay(db, "2026-04-01");
  assertEquals(decoded?.length, 2);
  assertEquals(decoded?.[0], samples[0]);
  assertEquals(decoded?.[1], samples[1]);
  const missing = await getArchivedDay(db, "2026-04-02");
  assertEquals(missing, null);
  db.close();
});

Deno.test("archive-db - getArchivedDay rejects unknown format", async () => {
  const db = testDb();
  insertArchivedDay(db, {
    date: "2026-04-01",
    row_count: 0,
    ts_start: 0,
    ts_end: 0,
    format: "future-format-v9",
    blob: new Uint8Array([0]),
    created_at: 0,
  });
  let threw = false;
  try {
    await getArchivedDay(db, "2026-04-01");
  } catch (err) {
    threw = true;
    assertEquals((err as Error).message.includes("unknown format"), true);
  }
  assertEquals(threw, true);
  db.close();
});

Deno.test("archive-db - listArchivedDays returns range in order", () => {
  const db = testDb();
  for (const date of ["2026-04-03", "2026-04-01", "2026-04-05", "2026-04-02"]) {
    insertArchivedDay(db, {
      date,
      row_count: 1,
      ts_start: 0,
      ts_end: 0,
      format: "gzip-cols-v1",
      blob: new Uint8Array([0]),
      created_at: 0,
    });
  }
  const dates = listArchivedDays(db, "2026-04-02", "2026-04-04").map((r) => r.date);
  assertEquals(dates, ["2026-04-02", "2026-04-03"]);
  db.close();
});

Deno.test("archive-db - pruneArchive deletes strictly older", () => {
  const db = testDb();
  for (const date of ["2026-04-01", "2026-04-02", "2026-04-03", "2026-04-04"]) {
    insertArchivedDay(db, {
      date,
      row_count: 1,
      ts_start: 0,
      ts_end: 0,
      format: "gzip-cols-v1",
      blob: new Uint8Array([0]),
      created_at: 0,
    });
  }
  const removed = pruneArchive(db, "2026-04-03");
  assertEquals(removed, 2);
  assertEquals(hasArchivedDay(db, "2026-04-03"), true);
  assertEquals(hasArchivedDay(db, "2026-04-04"), true);
  assertEquals(hasArchivedDay(db, "2026-04-02"), false);
  db.close();
});
