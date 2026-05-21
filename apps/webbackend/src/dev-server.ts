import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import dotenv from "dotenv";
import { app } from "./app.js";

dotenv.config({
  path: [
    fileURLToPath(new URL("../.env.local", import.meta.url)),
    fileURLToPath(new URL("../.env", import.meta.url)),
  ],
  quiet: true,
});

const port = Number(process.env.API_PORT ?? "3000");

const server = serve({
  fetch: app.fetch,
  port,
});

console.log(`PulseForge web backend listening on http://localhost:${port}`);

process.on("SIGINT", () => {
  server.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  server.close((err) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }

    process.exit(0);
  });
});
