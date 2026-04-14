import { serve } from "@hono/node-server";
import { app } from "./app.js";

const port = Number(process.env.API_PORT ?? "3000");

const server = serve({
  fetch: app.fetch,
  port,
});

console.log(`PulseForge API listening on http://localhost:${port}`);

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
