import { Database } from "@db/sqlite";
import type { Sample } from "./db.ts";
import { ARCHIVE_FORMAT, decodeDay } from "./archive-codec.ts";

export interface ArchivedDayRow {
  date: string;
  row_count: number;
  ts_start: number;
  ts_end: number;
  format: string;
  blob: Uint8Array;
  created_at: number;
}

export interface ArchivedDayMeta {
  date: string;
  row_count: number;
  ts_start: number;
  ts_end: number;
  format: string;
  created_at: number;
}

export function createArchiveDb(path: string): Database {
  const db = new Database(path);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS archive_day (
      date       TEXT PRIMARY KEY,
      row_count  INTEGER NOT NULL,
      ts_start   INTEGER NOT NULL,
      ts_end     INTEGER NOT NULL,
      format     TEXT NOT NULL,
      blob       BLOB NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
  return db;
}

export function hasArchivedDay(db: Database, date: string): boolean {
  const row = db.prepare("SELECT 1 FROM archive_day WHERE date = ?").get(date);
  return row !== undefined;
}

export function insertArchivedDay(db: Database, row: ArchivedDayRow): void {
  db.prepare(`
    INSERT INTO archive_day (date, row_count, ts_start, ts_end, format, blob, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(row.date, row.row_count, row.ts_start, row.ts_end, row.format, row.blob, row.created_at);
}

export async function getArchivedDay(db: Database, date: string): Promise<Sample[] | null> {
  const row = db.prepare(
    "SELECT format, blob FROM archive_day WHERE date = ?",
  ).get<{ format: string; blob: Uint8Array }>(date);
  if (!row) return null;
  if (row.format !== ARCHIVE_FORMAT) {
    throw new Error(`archive-db: unknown format "${row.format}" for date ${date}`);
  }
  return await decodeDay(row.blob);
}

export function listArchivedDays(db: Database, from: string, to: string): ArchivedDayMeta[] {
  return db.prepare(
    "SELECT date, row_count, ts_start, ts_end, format, created_at FROM archive_day WHERE date >= ? AND date <= ? ORDER BY date",
  ).all<ArchivedDayMeta>(from, to);
}

export function pruneArchive(db: Database, olderThanDate: string): number {
  return db.prepare("DELETE FROM archive_day WHERE date < ?").run(olderThanDate);
}
