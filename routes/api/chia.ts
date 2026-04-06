import { getChiaStatus, type ChiaStatus } from "../../lib/chia-rpc.ts";

const POLL_INTERVAL_MS = 5_000;
const CHIA_ENABLED = !!Deno.env.get("CHIA_RPC_HOST");

let cached: ChiaStatus | null = null;
let lastError: string | null = null;

async function poll() {
  try {
    cached = await getChiaStatus();
    lastError = null;
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
  }
}

if (CHIA_ENABLED) {
  poll();
  setInterval(poll, POLL_INTERVAL_MS);
}

export const handler = {
  GET() {
    if (!CHIA_ENABLED) {
      return new Response(JSON.stringify({ enabled: false }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (cached) {
      return new Response(JSON.stringify(cached), {
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(
      JSON.stringify({ error: lastError ?? "Not yet polled" }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  },
};
