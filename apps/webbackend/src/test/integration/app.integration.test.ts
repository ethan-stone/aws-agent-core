import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { app } from "../../app.js";
import { seedDemoData } from "../../services/pulseforge-service.js";
import { canUseDocker } from "../helpers/docker.js";
import { startMongoTestProcess, type MongoTestProcess } from "../helpers/mongo.js";

const describeMongo = canUseDocker() ? describe : describe.skip;

describe("PulseForge web backend integration (memory)", () => {
  it("reports memory storage mode when MongoDB is not configured", async () => {
    delete process.env.MONGODB_URI;
    delete process.env.MONGODB_DB_NAME;
    delete process.env.COGNITO_TOOLS_CLIENT_ID;
    delete process.env.COGNITO_TOOLS_CLIENT_IDS;

    const response = await app.request("/api/ping");
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      storage: string;
    };
    expect(body.storage).toBe("memory");
  });

  it("requires an agent run header before tool authentication", async () => {
    const response = await app.request("/tools/devices/dev-freezer-014");
    expect(response.status).toBe(400);

    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("x-pulseforge-agent-run-id");
  });

  it("fails closed for tools when Cognito tool auth is not configured", async () => {
    const response = await app.request("/tools/devices/dev-freezer-014", {
      headers: {
        "x-pulseforge-agent-run-id": "run-1",
      },
    });
    expect(response.status).toBe(503);
  });
});

describeMongo("PulseForge web backend integration (mongodb)", () => {
  let mongo: MongoTestProcess;

  beforeAll(async () => {
    mongo = await startMongoTestProcess();
    process.env.MONGODB_URI = mongo.uri;
    process.env.MONGODB_DB_NAME = "pulseforge_vitest";
    await seedDemoData();
  });

  afterAll(async () => {
    await mongo?.stop();
  });

  it("reports mongodb storage mode", async () => {
    const response = await app.request("/api/ping");
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      storage: string;
    };
    expect(body.storage).toBe("mongodb");
  });

  it("serves the seeded dashboard summary", async () => {
    const response = await app.request("/api/dashboard");
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      totalSites: number;
      totalDevices: number;
      criticalIncidents: number;
    };
    expect(body.totalSites).toBe(2);
    expect(body.totalDevices).toBe(4);
    expect(body.criticalIncidents).toBe(1);
  });

  it("returns incident detail without leaking _id", async () => {
    const response = await app.request("/api/incidents/inc-1001");
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      incident: Record<string, unknown> & { id: string };
      events: Array<Record<string, unknown>>;
    };
    expect(body.incident.id).toBe("inc-1001");
    expect(body.incident._id).toBeUndefined();
    expect(body.events).toHaveLength(2);
    expect(body.events[0]._id).toBeUndefined();
  });

  it("returns 404 for unknown devices", async () => {
    const response = await app.request("/api/devices/does-not-exist");
    expect(response.status).toBe(404);

    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("Device not found");
  });
});
