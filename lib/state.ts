import type { Database } from "@db/sqlite";
import type { DataBus } from "./databus.ts";

// Use globalThis so state is shared between source modules and bundled routes
const g = globalThis as unknown as {
  __wendy_db?: Database;
  __wendy_bus?: DataBus;
  __wendy_archive_db?: Database;
};

export function initState(db: Database, bus: DataBus) {
  g.__wendy_db = db;
  g.__wendy_bus = bus;
}

export function setArchiveDb(archiveDb: Database) {
  g.__wendy_archive_db = archiveDb;
}

export function getDb(): Database {
  return g.__wendy_db!;
}

export function getBus(): DataBus {
  return g.__wendy_bus!;
}

export function getArchiveDb(): Database | null {
  return g.__wendy_archive_db ?? null;
}
