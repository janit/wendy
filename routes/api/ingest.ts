import { getBus } from "../../lib/state.ts";
import type { BusMessage } from "../../lib/types.ts";

export const handler = {
  GET(ctx: { req: Request }) {
    const secret = Deno.env.get("WENDY_SECRET");
    if (!secret) {
      return new Response("WENDY_SECRET not configured", { status: 503 });
    }
    const url = new URL(ctx.req.url);
    if (url.searchParams.get("token") !== secret) {
      return new Response("Unauthorized", { status: 401 });
    }

    const { response, socket } = Deno.upgradeWebSocket(ctx.req);
    const bus = getBus();

    console.log("[ingest] source connected");

    socket.onmessage = (event) => {
      try {
        const msg: BusMessage = JSON.parse(
          typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data),
        );
        if (msg.type === "reading") {
          bus.push(msg.reading);
        } else if (msg.type === "fields") {
          bus.setFields(msg.fields);
        }
      } catch (err) {
        console.error("[ingest] parse error:", err);
      }
    };

    socket.onclose = () => {
      console.log("[ingest] source disconnected");
    };

    return response;
  },
};
