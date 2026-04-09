import { getArchiveDb } from "../../../../lib/state.ts";
import { getArchivedDay } from "../../../../lib/archive-db.ts";

/**
 * GET /api/archive/day/:date[?source=tristar]
 *
 * Returns the decoded samples for a single archived UTC day.
 * Optional ?source= filter applied in-memory (e.g. ?source=tristar).
 *
 * Returns 404 if the day isn't in the archive.
 * Returns 503 if the archive DB is not initialised.
 * Returns 400 if the date is not in YYYY-MM-DD format.
 */
export const handler = {
  async GET(ctx: { req: Request; params: { date: string } }) {
    const db = getArchiveDb();
    if (!db) {
      return new Response(
        JSON.stringify({ error: "archive not enabled" }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      );
    }

    const date = ctx.params.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return new Response(
        JSON.stringify({ error: "date must be in YYYY-MM-DD format" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    let samples;
    try {
      samples = await getArchivedDay(db, date);
    } catch (err) {
      return new Response(
        JSON.stringify({ error: String(err) }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    if (samples === null) {
      return new Response(
        JSON.stringify({ error: "not archived" }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    const url = new URL(ctx.req.url);
    const source = url.searchParams.get("source");
    const filtered = source ? samples.filter((s) => s.source === source) : samples;

    return new Response(JSON.stringify(filtered), {
      headers: { "Content-Type": "application/json" },
    });
  },
};
