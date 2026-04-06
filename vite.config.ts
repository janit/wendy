import { defineConfig } from "vite";
import { fresh } from "@fresh/plugin-vite";

export default defineConfig({
  plugins: [fresh()],
  ssr: {
    // Keep native/CJS packages out of the SSR bundle
    external: ["modbus-serial", "@ymjacky/mqtt5", "@db/sqlite"],
  },
});
