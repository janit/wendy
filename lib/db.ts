import { Database } from "@db/sqlite";

export interface Sample {
  ts: number;
  source: string;
  power: number | null;
  voltage: number | null;
  current: number | null;
  temp: number | null;
  mode: string | null;
}

export interface DailyStats {
  date: string;
  total_kwh: number;
  peak_power: number;
  peak_voltage: number;
}

export function createDb(path: string): Database {
  const db = new Database(path);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS samples (
      ts INTEGER NOT NULL,
      source TEXT NOT NULL,
      power REAL,
      voltage REAL,
      current REAL,
      temp REAL,
      mode TEXT,
      PRIMARY KEY (ts, source)
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_stats (
      date TEXT PRIMARY KEY,
      total_kwh REAL DEFAULT 0,
      peak_power REAL DEFAULT 0,
      peak_voltage REAL DEFAULT 0
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS energy_snapshots (
      date TEXT NOT NULL,
      key TEXT NOT NULL,
      value REAL NOT NULL,
      PRIMARY KEY (date, key)
    )
  `);
  return db;
}

// Sanitize NaN/Infinity to null for SQLite
function num(v: number | null): number | null {
  if (v == null || !isFinite(v)) return null;
  return v;
}

export function insertSamples(db: Database, samples: Sample[]): void {
  db.exec("BEGIN");
  try {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO samples (ts, source, power, voltage, current, temp, mode)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const s of samples) {
      stmt.run(s.ts, s.source, num(s.power), num(s.voltage), num(s.current), num(s.temp), s.mode);
    }
    stmt.finalize();
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function getHistory(db: Database, from: number, to: number): Sample[] {
  return db.prepare(
    "SELECT ts, source, power, voltage, current, temp, mode FROM samples WHERE ts >= ? AND ts <= ? ORDER BY ts"
  ).all<Sample>(from, to);
}

export function updateDailyStats(
  db: Database,
  date: string,
  addKwh: number,
  power: number,
  voltage: number,
): void {
  db.prepare(`
    INSERT INTO daily_stats (date, total_kwh, peak_power, peak_voltage)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      total_kwh = excluded.total_kwh,
      peak_power = MAX(peak_power, excluded.peak_power),
      peak_voltage = MAX(peak_voltage, excluded.peak_voltage)
  `).run(date, addKwh, power, voltage);
}

export function getDailyStats(db: Database, date: string): DailyStats | null {
  return db.prepare(
    "SELECT date, total_kwh, peak_power, peak_voltage FROM daily_stats WHERE date = ?"
  ).get<DailyStats>(date) ?? null;
}

export function getEnergySnapshot(db: Database, date: string, key: string): number | null {
  const row = db.prepare(
    "SELECT value FROM energy_snapshots WHERE date = ? AND key = ?"
  ).get<{ value: number }>(date, key);
  return row?.value ?? null;
}

export function setEnergySnapshot(db: Database, date: string, key: string, value: number): void {
  db.prepare(`
    INSERT INTO energy_snapshots (date, key, value)
    VALUES (?, ?, ?)
    ON CONFLICT(date, key) DO UPDATE SET value = excluded.value
  `).run(date, key, value);
}

export function pruneOldSamples(db: Database, maxAgeSeconds: number): void {
  const cutoff = Math.floor(Date.now() / 1000) - maxAgeSeconds;
  db.prepare("DELETE FROM samples WHERE ts < ?").run(cutoff);
}

function dayBounds(dateUtc: string): [number, number] {
  const year = parseInt(dateUtc.slice(0, 4));
  const month = parseInt(dateUtc.slice(5, 7)) - 1;
  const day = parseInt(dateUtc.slice(8, 10));
  const start = Math.floor(Date.UTC(year, month, day) / 1000);
  return [start, start + 86400];
}

export function getSamplesForDay(db: Database, dateUtc: string): Sample[] {
  const [start, end] = dayBounds(dateUtc);
  return db.prepare(
    "SELECT ts, source, power, voltage, current, temp, mode FROM samples WHERE ts >= ? AND ts < ? ORDER BY ts",
  ).all<Sample>(start, end);
}

export function getOldestSampleDate(db: Database): string | null {
  const row = db.prepare("SELECT MIN(ts) as minTs FROM samples").get<{ minTs: number | null }>();
  if (!row || row.minTs == null) return null;
  return new Date(row.minTs * 1000).toISOString().slice(0, 10);
}
