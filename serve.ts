/**
 * Production entry point: boots data collection, then serves the Fresh app.
 * In source mode, boots pollers + WebSocket client only (no web server).
 * Usage: deno run -A serve.ts
 */
import { boot } from "./lib/boot.ts";

const { port, role } = await boot();

if (role === "source") {
  console.log("[wendy] running as data source");
  // Keep process alive — pollers and ws-client run in the background
  await new Promise(() => {});
} else {
  // Dynamic import of the built Fresh server entry
  const mod = await import("./_fresh/server/server-entry.mjs");
  const handler = mod.default;

  const server = Deno.serve(
    {
      port,
      hostname: "0.0.0.0",
      onError(err) {
        console.error("[serve] request error:", err);
        return new Response("Internal Server Error", { status: 500 });
      },
    },
    (req: Request) => {
      try {
        return handler.fetch(req);
      } catch (err) {
        console.error("[serve] fetch error:", err);
        return new Response("Internal Server Error", { status: 500 });
      }
    },
  );

  console.log(`[wendy] dashboard: http://localhost:${port}`);
  console.log(`[wendy] overlay:   http://localhost:${port}/overlay`);

  await server.finished;
}
