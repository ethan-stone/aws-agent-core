import "./lib/load-env.js";
import { Hono } from "hono";
import type {
  AuthenticatedAppUser,
  CreateAgentRunRequest,
} from "../../../shared/pulseforge-domain/src/index.js";
import {
  getDashboard,
  getDevice,
  getDeviceTelemetry,
  getAgentRun,
  getIncident,
  getSnapshot,
  getStorageMode,
  listDevices,
  listIncidents,
  seedDemoData,
} from "./services/pulseforge-service.js";
import { runAgent } from "./services/agent-service.js";
import { getApiAuthConfig, verifyAccessToken } from "./lib/auth.js";

type ApiAppEnv = {
  Variables: {
    user: AuthenticatedAppUser | null;
  };
};

const publicApiPaths = new Set(["/api/ping", "/api/auth/config"]);
const isRequestLoggingEnabled =
  process.env.API_LOG_LEVEL === "debug" || process.env.API_LOG_LEVEL === "info";

function getBearerToken(headerValue?: string | null) {
  if (!headerValue) {
    return null;
  }

  const [scheme, token] = headerValue.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
}

export const app = new Hono<ApiAppEnv>();

app.use("*", async (c, next) => {
  c.header("access-control-allow-origin", "*");
  c.header("access-control-allow-headers", "content-type, authorization");
  c.header("access-control-allow-methods", "GET,POST,OPTIONS");

  if (c.req.method === "OPTIONS") {
    return c.body(null, 204);
  }

  return next();
});

app.use("/api/*", async (c, next) => {
  const startedAt = Date.now();
  await next();

  if (isRequestLoggingEnabled) {
    console.info("[api]", {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Date.now() - startedAt,
    });
  }
});

app.use("/api/*", async (c, next) => {
  c.set("user", null);

  if (publicApiPaths.has(c.req.path)) {
    return next();
  }

  const config = getApiAuthConfig();
  if (!config.enabled) {
    return next();
  }

  const token = getBearerToken(c.req.header("authorization"));
  if (!token) {
    return c.json({ error: "Authentication required" }, 401);
  }

  try {
    const user = await verifyAccessToken(token);
    c.set("user", user);
    return next();
  } catch {
    return c.json({ error: "Invalid access token" }, 401);
  }
});

app.get("/api/ping", async (c) => {
  return c.json({
    status: "ok",
    service: "pulseforge-api",
    storage: await getStorageMode(),
  });
});

app.get("/api/auth/config", async (c) => {
  return c.json(getApiAuthConfig());
});

app.get("/api/me", async (c) => {
  const auth = getApiAuthConfig();
  const user = c.get("user");

  return c.json({
    authenticated: Boolean(user),
    auth,
    user,
  });
});

app.get("/api/dashboard", async (c) => {
  return c.json(await getDashboard());
});

app.get("/api/devices", async (c) => {
  return c.json({ items: await listDevices() });
});

app.get("/api/devices/:deviceId", async (c) => {
  const device = await getDevice(c.req.param("deviceId"));
  if (!device) {
    return c.json({ error: "Device not found" }, 404);
  }

  return c.json(device);
});

app.get("/api/devices/:deviceId/telemetry", async (c) => {
  const telemetry = await getDeviceTelemetry(c.req.param("deviceId"));
  if (!telemetry) {
    return c.json({ error: "Device telemetry not found" }, 404);
  }

  return c.json({ items: telemetry });
});

app.get("/api/incidents", async (c) => {
  return c.json({ items: await listIncidents() });
});

app.get("/api/incidents/:incidentId", async (c) => {
  const incident = await getIncident(c.req.param("incidentId"));
  if (!incident) {
    return c.json({ error: "Incident not found" }, 404);
  }

  return c.json(incident);
});

app.get("/api/snapshot", async (c) => {
  return c.json(await getSnapshot());
});

app.post("/api/admin/seed", async (c) => {
  await seedDemoData();
  return c.json({ ok: true, storage: await getStorageMode() });
});

app.post("/api/agent-runs", async (c) => {
  const body = (await c.req.json()) as Partial<CreateAgentRunRequest>;

  if (!body.agentKind || !body.prompt) {
    return c.json({ error: "agentKind and prompt are required" }, 400);
  }

  const run = await runAgent({
    agentKind: body.agentKind,
    prompt: body.prompt,
    incidentId: body.incidentId,
    deviceId: body.deviceId,
    sessionId: body.sessionId,
  });

  return c.json(run, run.status === "failed" ? 502 : 200);
});

app.get("/api/agent-runs/:runId", async (c) => {
  const run = await getAgentRun(c.req.param("runId"));
  if (!run) {
    return c.json({ error: "Agent run not found" }, 404);
  }

  return c.json(run);
});

app.onError((error, c) => {
  console.error("[api] unhandled error", {
    method: c.req.method,
    path: c.req.path,
    error: error instanceof Error ? error.message : String(error),
  });

  return c.json({ error: "Internal server error" }, 500);
});
