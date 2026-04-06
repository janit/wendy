import { getDb } from "../../lib/state.ts";
import { getHistory } from "../../lib/db.ts";

export const handler = {
  GET() {
    const db = getDb();
    const now = Math.floor(Date.now() / 1000);
    const from = now - 86400; // 24h ago
    const rows = getHistory(db, from, now);
    return new Response(JSON.stringify(rows), {
      headers: { "Content-Type": "application/json" },
    });
  },
};
