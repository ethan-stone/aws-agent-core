import { Hono, type MiddlewareHandler } from "hono";
import type {
  AgentKind,
  AuthenticatedAppUser,
  CreateConversationRequest,
  CreateConversationRunRequest,
} from "../../../shared/pulseforge-domain/src/index.js";
import {
  appPermissions,
  buildIncidentInvestigationContext,
  getAgentRun,
  getApiAuthConfig,
  getConversationDetail,
  getDashboard,
  getDevice,
  getDeviceTelemetry,
  getIncident,
  getSnapshot,
  getStorageMode,
  listDevices,
  listIncidents,
  seedDemoData,
  verifyAccessToken,
} from "../../../shared/pulseforge-backend/src/index.js";
import {
  ActiveRootRunError,
  completeAgentResourceTokenAuth,
  createConversationAndRun,
  createConversationAndRunStream,
  runConversation,
  runConversationStream,
} from "./services/agent-service.js";
import type { ApiAppEnv } from "./types.js";

const publicApiPaths = new Set(["/api/auth/config"]);
const isRequestLoggingEnabled =
  process.env.API_LOG_LEVEL === "debug" || process.env.API_LOG_LEVEL === "info";
const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "accept, content-type, authorization, x-pulseforge-agent-run-id",
  "access-control-allow-methods": "GET,POST,OPTIONS",
} as const;

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

function requireUserPermission(
  permission: AuthenticatedAppUser["permissions"][number]
): MiddlewareHandler<ApiAppEnv> {
  return async (c, next) => {
    if (!getApiAuthConfig().enabled) {
      return next();
    }

    const user = c.get("user");
    if (!user) {
      return c.json({ error: "Authentication required" }, 401);
    }

    if (!user.permissions.includes(permission)) {
      return c.json({ error: "Forbidden" }, 403);
    }

    return next();
  };
}

function isAgentKind(value: unknown): value is AgentKind {
  return (
    value === "ops-copilot" ||
    value === "anomaly-investigation" ||
    value === "remediation-planner" ||
    value === "autonomous-remediation"
  );
}

function asPrompt(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function wantsEventStream(acceptHeader?: string | null) {
  return acceptHeader?.includes("text/event-stream") ?? false;
}

function conversationDetailStream(
  details: AsyncGenerator<unknown>,
  status = 200
) {
  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream({
      async start(controller) {
        const writeEvent = (event: string, data: unknown) => {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        };

        try {
          for await (const detail of details) {
            writeEvent("conversation", detail);
          }
        } catch (error) {
          writeEvent("error", {
            error: error instanceof Error ? error.message : "Agent run failed.",
          });
        } finally {
          controller.close();
        }
      },
    }),
    {
      status,
      headers: {
        ...corsHeaders,
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      },
    }
  );
}

export const app = new Hono<ApiAppEnv>();

app.use("*", async (c, next) => {
  for (const [name, value] of Object.entries(corsHeaders)) {
    c.header(name, value);
  }

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

app.get(
  "/api/dashboard",
  requireUserPermission(appPermissions.readDashboard),
  async (c) => {
    return c.json(await getDashboard());
  }
);

app.get(
  "/api/devices",
  requireUserPermission(appPermissions.readDevices),
  async (c) => {
    return c.json({ items: await listDevices() });
  }
);

app.get(
  "/api/devices/:deviceId",
  requireUserPermission(appPermissions.readDevices),
  async (c) => {
    const device = await getDevice(c.req.param("deviceId"));
    if (!device) {
      return c.json({ error: "Device not found" }, 404);
    }

    return c.json(device);
  }
);

app.get(
  "/api/devices/:deviceId/telemetry",
  requireUserPermission(appPermissions.readTelemetry),
  async (c) => {
    const telemetry = await getDeviceTelemetry(c.req.param("deviceId"));
    if (!telemetry) {
      return c.json({ error: "Device telemetry not found" }, 404);
    }

    return c.json({ items: telemetry });
  }
);

app.get(
  "/api/incidents",
  requireUserPermission(appPermissions.readIncidents),
  async (c) => {
    return c.json({ items: await listIncidents() });
  }
);

app.get(
  "/api/incidents/:incidentId",
  requireUserPermission(appPermissions.readIncidents),
  async (c) => {
    const incident = await getIncident(c.req.param("incidentId"));
    if (!incident) {
      return c.json({ error: "Incident not found" }, 404);
    }

    return c.json(incident);
  }
);

app.get(
  "/api/snapshot",
  requireUserPermission(appPermissions.readDashboard),
  async (c) => {
    return c.json(await getSnapshot());
  }
);

app.post(
  "/api/admin/seed",
  requireUserPermission(appPermissions.writeAdmin),
  async (c) => {
    await seedDemoData();
    return c.json({ ok: true, storage: await getStorageMode() });
  }
);

app.post(
  "/api/oauth2/complete-resource-token-auth",
  requireUserPermission(appPermissions.writeAgentRuns),
  async (c) => {
    const body = (await c.req.json()) as { sessionUri?: string };
    const user = c.get("user");

    if (!body.sessionUri) {
      return c.json({ error: "sessionUri is required" }, 400);
    }

    if (!user) {
      return c.json({ error: "Authentication required" }, 401);
    }

    if (!getBearerToken(c.req.header("authorization"))) {
      return c.json({ error: "Authentication required" }, 401);
    }

    await completeAgentResourceTokenAuth(body.sessionUri, user);
    return c.json({ ok: true });
  }
);

app.post(
  "/api/conversations",
  requireUserPermission(appPermissions.writeAgentRuns),
  async (c) => {
    const body = (await c.req.json()) as Partial<CreateConversationRequest>;
    const prompt = asPrompt(body.prompt);
    const user = c.get("user");

    if (!isAgentKind(body.agentKind) || !prompt) {
      return c.json({ error: "agentKind and prompt are required" }, 400);
    }

    const incidentId = asOptionalString(body.incidentId);
    const investigationContext = incidentId
      ? await buildIncidentInvestigationContext(incidentId)
      : null;

    const request = {
      agentKind: body.agentKind,
      prompt,
      incidentId,
      deviceId: asOptionalString(body.deviceId),
    };

    if (wantsEventStream(c.req.header("accept"))) {
      return conversationDetailStream(
        await createConversationAndRunStream(
          request,
          user,
          investigationContext
        ),
        201
      );
    }

    const detail = await createConversationAndRun(
      request,
      user,
      investigationContext
    );

    const lastRun = detail.runs.at(-1);
    return c.json(detail, lastRun?.status === "failed" ? 502 : 201);
  }
);

app.post(
  "/api/conversations/:conversationId/runs",
  requireUserPermission(appPermissions.writeAgentRuns),
  async (c) => {
    const body = (await c.req.json()) as Partial<CreateConversationRunRequest>;
    const prompt = asPrompt(body.prompt);
    const user = c.get("user");

    if (!prompt) {
      return c.json({ error: "prompt is required" }, 400);
    }

    const incidentId = asOptionalString(body.incidentId);
    const investigationContext = incidentId
      ? await buildIncidentInvestigationContext(incidentId)
      : null;

    try {
      const request = {
        prompt,
        incidentId,
        deviceId: asOptionalString(body.deviceId),
      };
      const detail = wantsEventStream(c.req.header("accept"))
        ? await runConversationStream(
            c.req.param("conversationId"),
            request,
            user,
            investigationContext
          )
        : await runConversation(
            c.req.param("conversationId"),
            request,
            user,
            investigationContext
          );

      if (!detail) {
        return c.json({ error: "Conversation not found" }, 404);
      }

      if (Symbol.asyncIterator in detail) {
        return conversationDetailStream(detail);
      }

      const lastRun = detail.runs.at(-1);
      return c.json(detail, lastRun?.status === "failed" ? 502 : 200);
    } catch (error) {
      if (error instanceof ActiveRootRunError) {
        return c.json({ error: error.message }, 409);
      }

      throw error;
    }
  }
);

app.get(
  "/api/conversations/:conversationId",
  requireUserPermission(appPermissions.writeAgentRuns),
  async (c) => {
    const detail = await getConversationDetail(c.req.param("conversationId"));
    if (!detail) {
      return c.json({ error: "Conversation not found" }, 404);
    }

    return c.json(detail);
  }
);

app.get(
  "/api/agent-runs/:runId",
  requireUserPermission(appPermissions.writeAgentRuns),
  async (c) => {
    const run = await getAgentRun(c.req.param("runId"));
    if (!run) {
      return c.json({ error: "Agent run not found" }, 404);
    }

    return c.json(run);
  }
);

app.onError((error, c) => {
  console.error("[api] unhandled error", {
    method: c.req.method,
    path: c.req.path,
    error: error instanceof Error ? error.message : String(error),
  });

  return c.json({ error: "Internal server error" }, 500);
});
