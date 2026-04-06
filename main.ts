import { App, staticFiles } from "fresh";

export const app = new App()
  .use(staticFiles())
  .fsRoutes();

if (import.meta.main) {
  // Only run data collection + server when executed directly (not imported by Vite)
  const { boot } = await import("./lib/boot.ts");
  const port = await boot();
  await app.listen({ port, hostname: "0.0.0.0" });
  console.log(`[wendy] dashboard: http://localhost:${port}`);
  console.log(`[wendy] glance:    http://localhost:${port}/glance`);
}
