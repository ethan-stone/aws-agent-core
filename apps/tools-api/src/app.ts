import { OpenAPIHono } from "@hono/zod-openapi";
import { toolsApp } from "./routes.js";
import type { ToolsApiEnv } from "./types.js";

const isRequestLoggingEnabled =
  process.env.API_LOG_LEVEL === "debug" || process.env.API_LOG_LEVEL === "info";

export const toolsApi = new OpenAPIHono<ToolsApiEnv>();

toolsApi.use("*", async (c, next) => {
  c.header("access-control-allow-origin", "*");
  c.header(
    "access-control-allow-headers",
    "content-type, authorization, x-pulseforge-agent-run-id"
  );
  c.header("access-control-allow-methods", "GET,POST,OPTIONS");

  if (c.req.method === "OPTIONS") {
    return c.body(null, 204);
  }

  return next();
});

toolsApi.use("*", async (c, next) => {
  const startedAt = Date.now();
  await next();

  if (isRequestLoggingEnabled) {
    console.info("[tools-api]", {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Date.now() - startedAt,
    });
  }
});

toolsApi.doc("/openapi.json", {
  openapi: "3.0.0",
  info: {
    title: "PulseForge Agent Tools API",
    version: "0.1.0",
  },
});

toolsApi.route("/", toolsApp);

toolsApi.onError((error, c) => {
  console.error("[tools-api] unhandled error", {
    method: c.req.method,
    path: c.req.path,
    error: error instanceof Error ? error.message : String(error),
  });

  return c.json(
    {
      ok: false,
      errorCode: "internal_error",
      message: "Internal server error",
    },
    500
  );
});
