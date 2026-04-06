import { getBus } from "../../lib/state.ts";

export const handler = {
  GET() {
    const history = getBus().recentHistory();
    return new Response(JSON.stringify(history), {
      headers: { "Content-Type": "application/json" },
    });
  },
};
