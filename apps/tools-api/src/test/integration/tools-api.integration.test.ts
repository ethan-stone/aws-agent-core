import { describe, expect, it } from "vitest";
import { toolsApi } from "../../app.js";

describe("PulseForge tools API", () => {
  it("publishes an OpenAPI document", async () => {
    const response = await toolsApi.request("/openapi.json");

    expect(response.status).toBe(200);
    const body = (await response.json()) as { openapi: string };
    expect(body.openapi).toBe("3.0.0");
  });

  it("does not expose stale compatibility or ping routes", async () => {
    expect((await toolsApi.request("/ping")).status).toBe(404);
    expect((await toolsApi.request("/tools/devices/dev-freezer-014")).status).toBe(404);
  });

  it("requires an agent run header before tool authentication", async () => {
    const response = await toolsApi.request("/devices/dev-freezer-014");

    expect(response.status).toBe(400);
    const body = (await response.json()) as { message: string };
    expect(body.message).toContain("x-pulseforge-agent-run-id");
  });

  it("fails closed when Cognito tool auth is not configured", async () => {
    delete process.env.COGNITO_AGENT_IDENTITY_CLIENT_IDS;

    const response = await toolsApi.request("/devices/dev-freezer-014", {
      headers: {
        "x-pulseforge-agent-run-id": "run-1",
      },
    });

    expect(response.status).toBe(503);
  });
});
