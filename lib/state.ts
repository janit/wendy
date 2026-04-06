import type { Database } from "@db/sqlite";
import type { DataBus } from "./databus.ts";

// Use globalThis so state is shared between source modules and bundled routes
const g = globalThis as unknown as {
  __wendy_db?: Database;
  __wendy_bus?: DataBus;
};

export function initState(db: Database, bus: DataBus) {
  g.__wendy_db = db;
  g.__wendy_bus = bus;
}

export function getDb(): Database {
  return g.__wendy_db!;
}

export function getBus(): DataBus {
  return g.__wendy_bus!;
}
