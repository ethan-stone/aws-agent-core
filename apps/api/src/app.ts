import { Hono } from "hono";
import {
  getDashboard,
  getDevice,
  getDeviceTelemetry,
  getIncident,
  getSnapshot,
  getStorageMode,
  listDevices,
  listIncidents,
  seedDemoData,
} from "./services/pulseforge-service.js";

export const app = new Hono();

app.use("*", async (c, next) => {
  c.header("access-control-allow-origin", "*");
  c.header("access-control-allow-headers", "content-type, authorization");
  c.header("access-control-allow-methods", "GET,POST,OPTIONS");

  if (c.req.method === "OPTIONS") {
    return c.body(null, 204);
  }

  await next();
});

app.get("/api/ping", async (c) => {
  return c.json({
    status: "ok",
    service: "pulseforge-api",
    storage: await getStorageMode(),
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
