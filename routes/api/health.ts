import { getBus } from "../../lib/state.ts";

const VERSION = Deno.env.get("WENDY_VERSION") ?? "dev";

export const handler = {
  GET() {
    const state = getBus().latest();
    return new Response(JSON.stringify({
      ok: true,
      version: VERSION,
      mode: state.mode,
      hasData: state.power != null,
    }), {
      headers: { "Content-Type": "application/json" },
    });
  },
};
