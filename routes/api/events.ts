import { getBus } from "../../lib/state.ts";

export const handler = {
  GET(ctx: { req: Request }) {
    const bus = getBus();
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();

        // Send current state immediately
        const initial = bus.latest();
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(initial)}\n\n`));

        // Subscribe to updates
        const unsub = bus.subscribe((state) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(state)}\n\n`));
          } catch {
            unsub();
          }
        });

        // Clean up when client disconnects
        ctx.req.signal.addEventListener("abort", () => {
          unsub();
          try { controller.close(); } catch { /* already closed */ }
        });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  },
};
