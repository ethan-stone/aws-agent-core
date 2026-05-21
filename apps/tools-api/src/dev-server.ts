import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import dotenv from "dotenv";
import { toolsApi } from "./app.js";

dotenv.config({
  path: [
    fileURLToPath(new URL("../.env.local", import.meta.url)),
    fileURLToPath(new URL("../.env", import.meta.url)),
  ],
  quiet: true,
});

const port = Number(process.env.TOOLS_API_PORT ?? "3001");

const server = serve({
  fetch: toolsApi.fetch,
  port,
});

console.log(`PulseForge tools API listening on http://localhost:${port}`);

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
