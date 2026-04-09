import { getDb } from "../../lib/state.ts";
import { getHistory } from "../../lib/db.ts";

export const handler = {
  GET(ctx: { req: Request }) {
    const db = getDb();
    const url = new URL(ctx.req.url);
    const now = Math.floor(Date.now() / 1000);

    const fromParam = url.searchParams.get("from");
    const toParam = url.searchParams.get("to");
    const sourceParam = url.searchParams.get("source");

    const from = fromParam ? parseInt(fromParam, 10) : now - 86400;
    const to = toParam ? parseInt(toParam, 10) : now;

    if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) {
      return new Response(JSON.stringify({ error: "invalid from/to" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const rows = getHistory(db, from, to);
    const filtered = sourceParam ? rows.filter((r) => r.source === sourceParam) : rows;

    return new Response(JSON.stringify(filtered), {
      headers: { "Content-Type": "application/json" },
    });
  },
};
