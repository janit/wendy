import { getArchiveDb } from "../../../lib/state.ts";
import { listArchivedDays } from "../../../lib/archive-db.ts";

/**
 * GET /api/archive/days?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Returns metadata for archived days in the range (inclusive on both ends).
 * Both from and to are required. Dates must be in YYYY-MM-DD format.
 * Returns an empty array if no days match.
 *
 * Returns 503 if the archive DB is not initialised.
 */
export const handler = {
  GET(ctx: { req: Request }) {
    const db = getArchiveDb();
    if (!db) {
      return new Response(
        JSON.stringify({ error: "archive not enabled" }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      );
    }

    const url = new URL(ctx.req.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");

    if (!from || !to || !isDate(from) || !isDate(to)) {
      return new Response(
        JSON.stringify({ error: "from and to query params required in YYYY-MM-DD format" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const days = listArchivedDays(db, from, to);
    return new Response(JSON.stringify(days), {
      headers: { "Content-Type": "application/json" },
    });
  },
};

function isDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}
