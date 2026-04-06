import { getDb } from "../../lib/state.ts";

export const handler = {
  GET() {
    const db = getDb();
    const rows = db.prepare(
      "SELECT date, total_kwh, peak_power, peak_voltage FROM daily_stats ORDER BY date DESC LIMIT 30"
    ).all<{ date: string; total_kwh: number; peak_power: number; peak_voltage: number }>();
    return new Response(JSON.stringify(rows), {
      headers: { "Content-Type": "application/json" },
    });
  },
};
