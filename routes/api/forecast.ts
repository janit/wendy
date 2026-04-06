import { getCachedForecast } from "../../lib/windy.ts";

const WINDOW_BEFORE_MS = 6 * 3_600_000;   // 6 hours ago
const WINDOW_AFTER_MS = 42 * 3_600_000;  // 42 hours ahead

export const handler = {
  GET() {
    const forecast = getCachedForecast();
    if (!forecast) {
      return new Response(JSON.stringify({ ok: false, error: "no forecast data yet" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }

    const now = Date.now();
    const from = now - WINDOW_BEFORE_MS;
    const to = now + WINDOW_AFTER_MS;
    const points = forecast.points.filter((p) => p.ts >= from && p.ts <= to);

    return new Response(JSON.stringify({
      fetchedAt: forecast.fetchedAt,
      model: forecast.model,
      now,
      points,
    }), {
      headers: { "Content-Type": "application/json" },
    });
  },
};
