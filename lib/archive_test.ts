import { assertEquals } from "jsr:@std/assert";
import {
  clampDelay,
  computeNextRunAt,
  findFallingBehind,
  runArchivePass,
} from "./archive.ts";
import { createDb, insertSamples } from "./db.ts";
import {
  createArchiveDb,
  hasArchivedDay,
  insertArchivedDay,
  listArchivedDays,
} from "./archive-db.ts";

function todayUtcStart(): number {
  const t = new Date();
  return Math.floor(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()) / 1000);
}

function utcDateString(unixSec: number): string {
  return new Date(unixSec * 1000).toISOString().slice(0, 10);
}

Deno.test("computeNextRunAt - before 00:05 UTC returns same day 00:05", () => {
  const now = new Date(Date.UTC(2026, 3, 8, 0, 3, 0));
  const next = computeNextRunAt(now);
  assertEquals(next.toISOString(), "2026-04-08T00:05:00.000Z");
});

Deno.test("computeNextRunAt - exactly 00:05 UTC returns next day", () => {
  const now = new Date(Date.UTC(2026, 3, 8, 0, 5, 0));
  const next = computeNextRunAt(now);
  assertEquals(next.toISOString(), "2026-04-09T00:05:00.000Z");
});

Deno.test("computeNextRunAt - mid-day returns next day 00:05", () => {
  const now = new Date(Date.UTC(2026, 3, 8, 14, 30, 0));
  const next = computeNextRunAt(now);
  assertEquals(next.toISOString(), "2026-04-09T00:05:00.000Z");
});

Deno.test("computeNextRunAt - 23:59 UTC returns next day", () => {
  const now = new Date(Date.UTC(2026, 3, 8, 23, 59, 0));
  const next = computeNextRunAt(now);
  assertEquals(next.toISOString(), "2026-04-09T00:05:00.000Z");
});

Deno.test("clampDelay - clamps to 60s minimum", () => {
  assertEquals(clampDelay(0), 60_000);
  assertEquals(clampDelay(-5_000_000), 60_000);
  assertEquals(clampDelay(30_000), 60_000);
});

Deno.test("clampDelay - clamps to 26h maximum", () => {
  assertEquals(clampDelay(100 * 3600 * 1000), 26 * 3600 * 1000);
});

Deno.test("clampDelay - passes through normal values", () => {
  assertEquals(clampDelay(3600_000), 3600_000); // 1h
  assertEquals(clampDelay(20 * 3600_000), 20 * 3600_000); // 20h
});

Deno.test("runArchivePass - archives complete days, excludes today", async () => {
  const live = createDb(":memory:");
  const archive = createArchiveDb(":memory:");
  const todayStart = todayUtcStart();

  // Seed 10 days: 10 days ago through 1 day ago. Today is excluded.
  for (let d = 10; d >= 1; d--) {
    insertSamples(live, [
      { ts: todayStart - d * 86400 + 3600, source: "tristar", power: d, voltage: 48, current: 1, temp: 20, mode: "48v" },
      { ts: todayStart - d * 86400 + 7200, source: "victron", power: d * 2, voltage: 24, current: 1, temp: 21, mode: "24v" },
    ]);
  }
  // Add a sample for today — must NOT be archived
  insertSamples(live, [
    { ts: todayStart + 60, source: "tristar", power: 999, voltage: 48, current: 1, temp: 20, mode: "48v" },
  ]);

  await runArchivePass({ liveDb: live, archiveDb: archive, retentionDays: 365 });

  const archived = listArchivedDays(archive, "1970-01-01", "9999-12-31");
  assertEquals(archived.length, 10);
  assertEquals(hasArchivedDay(archive, utcDateString(todayStart)), false);
  for (const row of archived) {
    assertEquals(row.row_count, 2);
  }
  live.close();
  archive.close();
});

Deno.test("runArchivePass - idempotent on second run", async () => {
  const live = createDb(":memory:");
  const archive = createArchiveDb(":memory:");
  const todayStart = todayUtcStart();
  for (let d = 5; d >= 1; d--) {
    insertSamples(live, [
      { ts: todayStart - d * 86400 + 3600, source: "tristar", power: d, voltage: 48, current: 1, temp: 20, mode: "48v" },
    ]);
  }
  await runArchivePass({ liveDb: live, archiveDb: archive, retentionDays: 365 });
  await runArchivePass({ liveDb: live, archiveDb: archive, retentionDays: 365 });
  const archived = listArchivedDays(archive, "1970-01-01", "9999-12-31");
  assertEquals(archived.length, 5);
  live.close();
  archive.close();
});

Deno.test("runArchivePass - empty live DB is a no-op", async () => {
  const live = createDb(":memory:");
  const archive = createArchiveDb(":memory:");
  await runArchivePass({ liveDb: live, archiveDb: archive, retentionDays: 365 });
  assertEquals(listArchivedDays(archive, "1970-01-01", "9999-12-31").length, 0);
  live.close();
  archive.close();
});

Deno.test("runArchivePass - bad day does not block other days", async () => {
  const live = createDb(":memory:");
  const archive = createArchiveDb(":memory:");
  const todayStart = todayUtcStart();

  // Days 1..9 ago: valid samples. Day 5 ago: a sample with an unknown source
  // string that will make encodeDay throw.
  for (let d = 9; d >= 1; d--) {
    if (d === 5) {
      insertSamples(live, [
        { ts: todayStart - d * 86400 + 3600, source: "weirdo", power: 1, voltage: 1, current: 1, temp: 1, mode: "24v" },
      ]);
    } else {
      insertSamples(live, [
        { ts: todayStart - d * 86400 + 3600, source: "tristar", power: d, voltage: 48, current: 1, temp: 20, mode: "48v" },
      ]);
    }
  }

  await runArchivePass({ liveDb: live, archiveDb: archive, retentionDays: 365 });

  const archived = listArchivedDays(archive, "1970-01-01", "9999-12-31");
  // 9 days seeded, 1 fails to encode → 8 archived
  assertEquals(archived.length, 8);
  // The bad day (5 ago) is not in the archive
  const badDate = utcDateString(todayStart - 5 * 86400);
  assertEquals(hasArchivedDay(archive, badDate), false);
  live.close();
  archive.close();
});

Deno.test("findFallingBehind - empty live DB returns empty", () => {
  const live = createDb(":memory:");
  const archive = createArchiveDb(":memory:");
  assertEquals(findFallingBehind(live, archive, new Date()), []);
  live.close();
  archive.close();
});

Deno.test("findFallingBehind - all days within 2 days returns empty", () => {
  const live = createDb(":memory:");
  const archive = createArchiveDb(":memory:");
  const now = new Date(Date.UTC(2026, 3, 8, 12, 0, 0));
  const todayStart = Math.floor(Date.UTC(2026, 3, 8) / 1000);
  insertSamples(live, [
    { ts: todayStart - 86400, source: "tristar", power: 1, voltage: 1, current: 1, temp: 1, mode: "24v" },
  ]);
  assertEquals(findFallingBehind(live, archive, now), []);
  live.close();
  archive.close();
});

Deno.test("findFallingBehind - lists unarchived days older than 2 days", () => {
  const live = createDb(":memory:");
  const archive = createArchiveDb(":memory:");
  const now = new Date(Date.UTC(2026, 3, 8, 12, 0, 0));
  const todayStart = Math.floor(Date.UTC(2026, 3, 8) / 1000);
  // Seed days 5, 4, 3 ago — all should be flagged
  for (const d of [5, 4, 3]) {
    insertSamples(live, [
      { ts: todayStart - d * 86400 + 3600, source: "tristar", power: 1, voltage: 1, current: 1, temp: 1, mode: "24v" },
    ]);
  }
  // Day 4 ago is already archived → should be excluded
  insertArchivedDay(archive, {
    date: "2026-04-04",
    row_count: 1,
    ts_start: 0,
    ts_end: 0,
    format: "gzip-cols-v1",
    blob: new Uint8Array([0]),
    created_at: 0,
  });
  const missing = findFallingBehind(live, archive, now);
  assertEquals(missing, ["2026-04-03", "2026-04-05"]);
  live.close();
  archive.close();
});

Deno.test("runArchivePass - retention prunes old days", async () => {
  const live = createDb(":memory:");
  const archive = createArchiveDb(":memory:");

  // Seed the archive directly with 400 fake days
  const todayStart = todayUtcStart();
  for (let d = 1; d <= 400; d++) {
    const date = utcDateString(todayStart - d * 86400);
    insertArchivedDay(archive, {
      date,
      row_count: 1,
      ts_start: todayStart - d * 86400,
      ts_end: todayStart - (d - 1) * 86400,
      format: "gzip-cols-v1",
      blob: new Uint8Array([0]),
      created_at: 0,
    });
  }
  // Live DB is empty so the encoding loop is a no-op; only the prune step runs.
  await runArchivePass({ liveDb: live, archiveDb: archive, retentionDays: 365 });

  // Days strictly older than (today - 365) are removed.
  // Cutoff date = today - 365. Days 366..400 ago are deleted (35 days).
  const remaining = listArchivedDays(archive, "1970-01-01", "9999-12-31");
  assertEquals(remaining.length, 365);
  live.close();
  archive.close();
});
