import "./lib/load-env.js";
import { Hono, type MiddlewareHandler } from "hono";
import type {
  AuthenticatedAppUser,
  CreateAgentRunRequest,
  IncidentEvent,
  RemediationAction,
  Ticket,
} from "../../../shared/pulseforge-domain/src/index.js";
import {
  buildIncidentInvestigationContext,
  createAuditLog,
  createIncidentEvent,
  createRemediationAction,
  createTicket,
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
import {
  appPermissions,
  getApiAuthConfig,
  isToolAuthConfigured,
  toolScopes,
  type ToolAuthContext,
  type ToolScope,
  verifyAccessToken,
  verifyToolAccessToken,
} from "./lib/auth.js";

type ApiAppEnv = {
  Variables: {
    user: AuthenticatedAppUser | null;
    toolAuth: ToolAuthContext | null;
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

app.use("/tools/*", async (c, next) => {
  const startedAt = Date.now();
  await next();

  if (isRequestLoggingEnabled) {
    console.info("[tools]", {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Date.now() - startedAt,
    });
  }
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

function requireToolAccess(config: {
  operation: string;
  scopes: ToolScope[];
  resourceType?: string;
  getResourceId?: (c: Parameters<MiddlewareHandler<ApiAppEnv>>[0]) => string;
}): MiddlewareHandler<ApiAppEnv> {
  return async (c, next) => {
    c.set("toolAuth", null);

    const agentRunId = c.req.header("x-pulseforge-agent-run-id")?.trim();
    if (!agentRunId) {
      return c.json({ error: "x-pulseforge-agent-run-id is required" }, 400);
    }

    if (!isToolAuthConfigured()) {
      return c.json({ error: "Tool authentication is not configured" }, 503);
    }

    const token = getBearerToken(c.req.header("authorization"));
    if (!token) {
      return c.json({ error: "Authentication required" }, 401);
    }

    let toolAuth: ToolAuthContext;
    try {
      toolAuth = await verifyToolAccessToken(token, agentRunId, config.scopes);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid access token";
      return c.json(
        { error: message.startsWith("Missing required scopes") ? message : "Invalid access token" },
        message.startsWith("Missing required scopes") ? 403 : 401
      );
    }

    c.set("toolAuth", toolAuth);

    const run = await getAgentRun(agentRunId);
    if (!run) {
      await writeToolAudit(c, toolAuth, config, 404, "failed", "Agent run not found");
      return c.json({ error: "Agent run not found" }, 404);
    }

    if (
      run.requestedByUserId &&
      run.requestedByUserId !== toolAuth.actor.onBehalfOfUserId
    ) {
      await writeToolAudit(
        c,
        toolAuth,
        config,
        403,
        "failed",
        "Agent run does not belong to delegated user"
      );
      return c.json({ error: "Agent run does not belong to delegated user" }, 403);
    }

    await next();

    await writeToolAudit(
      c,
      toolAuth,
      config,
      c.res.status,
      c.res.status >= 400 ? "failed" : "succeeded"
    );
    return undefined;
  };
}

async function writeToolAudit(
  c: Parameters<MiddlewareHandler<ApiAppEnv>>[0],
  toolAuth: ToolAuthContext,
  config: {
    operation: string;
    scopes: ToolScope[];
    resourceType?: string;
    getResourceId?: (c: Parameters<MiddlewareHandler<ApiAppEnv>>[0]) => string;
  },
  statusCode: number,
  outcome: "succeeded" | "failed",
  message?: string
) {
  try {
    await createAuditLog({
      actor: toolAuth.actor,
      operation: config.operation,
      method: c.req.method,
      path: c.req.path,
      scopes: config.scopes,
      resourceType: config.resourceType,
      resourceId: config.getResourceId?.(c),
      outcome,
      statusCode,
      message,
    });
  } catch (error) {
    console.error("[tools] failed to write audit log", {
      operation: config.operation,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function getToolAuth(c: Parameters<MiddlewareHandler<ApiAppEnv>>[0]) {
  const toolAuth = c.get("toolAuth");
  if (!toolAuth) {
    throw new Error("Tool auth context was not initialized");
  }

  return toolAuth;
}

async function readJsonObject(c: Parameters<MiddlewareHandler<ApiAppEnv>>[0]) {
  const body = await c.req.json().catch(() => null);
  return typeof body === "object" && body !== null
    ? (body as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isIncidentEventKind(value: unknown): value is IncidentEvent["kind"] {
  return (
    value === "agent_summary" ||
    value === "action_attempted" ||
    value === "action_result" ||
    value === "ticket_created"
  );
}

function isTicketStatus(value: unknown): value is Ticket["status"] {
  return (
    value === "open" ||
    value === "in_progress" ||
    value === "waiting" ||
    value === "closed"
  );
}

function isRemediationActionType(
  value: unknown
): value is RemediationAction["type"] {
  return (
    value === "reboot-device" ||
    value === "rollback-firmware" ||
    value === "increase-sampling" ||
    value === "dispatch-technician"
  );
}

function isRemediationRisk(value: unknown): value is RemediationAction["risk"] {
  return value === "low" || value === "medium" || value === "high";
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

app.get("/api/ping", async (c) => {
  return c.json({
    status: "ok",
    service: "pulseforge-webbackend",
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

app.get("/api/dashboard", requireUserPermission(appPermissions.readDashboard), async (c) => {
  return c.json(await getDashboard());
});

app.get("/api/devices", requireUserPermission(appPermissions.readDevices), async (c) => {
  return c.json({ items: await listDevices() });
});

app.get("/api/devices/:deviceId", requireUserPermission(appPermissions.readDevices), async (c) => {
  const device = await getDevice(c.req.param("deviceId"));
  if (!device) {
    return c.json({ error: "Device not found" }, 404);
  }

  return c.json(device);
});

app.get("/api/devices/:deviceId/telemetry", requireUserPermission(appPermissions.readTelemetry), async (c) => {
  const telemetry = await getDeviceTelemetry(c.req.param("deviceId"));
  if (!telemetry) {
    return c.json({ error: "Device telemetry not found" }, 404);
  }

  return c.json({ items: telemetry });
});

app.get("/api/incidents", requireUserPermission(appPermissions.readIncidents), async (c) => {
  return c.json({ items: await listIncidents() });
});

app.get("/api/incidents/:incidentId", requireUserPermission(appPermissions.readIncidents), async (c) => {
  const incident = await getIncident(c.req.param("incidentId"));
  if (!incident) {
    return c.json({ error: "Incident not found" }, 404);
  }

  return c.json(incident);
});

app.get("/api/snapshot", requireUserPermission(appPermissions.readDashboard), async (c) => {
  return c.json(await getSnapshot());
});

app.post("/api/admin/seed", requireUserPermission(appPermissions.writeAdmin), async (c) => {
  await seedDemoData();
  return c.json({ ok: true, storage: await getStorageMode() });
});

app.post("/api/agent-runs", requireUserPermission(appPermissions.writeAgentRuns), async (c) => {
  const body = (await c.req.json()) as Partial<CreateAgentRunRequest>;
  const user = c.get("user");

  if (!body.agentKind || !body.prompt) {
    return c.json({ error: "agentKind and prompt are required" }, 400);
  }

  const investigationContext = body.incidentId
    ? await buildIncidentInvestigationContext(body.incidentId)
    : null;

  const run = await runAgent(
    {
      agentKind: body.agentKind,
      prompt: body.prompt,
      incidentId: body.incidentId,
      deviceId: body.deviceId,
      sessionId: body.sessionId,
    },
    user,
    investigationContext
  );

  return c.json(run, run.status === "failed" ? 502 : 200);
});

app.get("/api/agent-runs/:runId", requireUserPermission(appPermissions.writeAgentRuns), async (c) => {
  const run = await getAgentRun(c.req.param("runId"));
  if (!run) {
    return c.json({ error: "Agent run not found" }, 404);
  }

  return c.json(run);
});

app.get(
  "/tools/devices/:deviceId",
  requireToolAccess({
    operation: "devices.read",
    scopes: [toolScopes.readDevices],
    resourceType: "device",
    getResourceId: (c) => c.req.param("deviceId") ?? "",
  }),
  async (c) => {
    const device = await getDevice(c.req.param("deviceId"));
    if (!device) {
      return c.json({ error: "Device not found" }, 404);
    }

    return c.json(device);
  }
);

app.get(
  "/tools/devices/:deviceId/telemetry",
  requireToolAccess({
    operation: "device_telemetry.read",
    scopes: [toolScopes.readTelemetry],
    resourceType: "device",
    getResourceId: (c) => c.req.param("deviceId") ?? "",
  }),
  async (c) => {
    const telemetry = await getDeviceTelemetry(c.req.param("deviceId"));
    if (!telemetry) {
      return c.json({ error: "Device telemetry not found" }, 404);
    }

    return c.json({ items: telemetry });
  }
);

app.get(
  "/tools/incidents/:incidentId/context",
  requireToolAccess({
    operation: "incident_context.read",
    scopes: [
      toolScopes.readIncidents,
      toolScopes.readDevices,
      toolScopes.readTelemetry,
    ],
    resourceType: "incident",
    getResourceId: (c) => c.req.param("incidentId") ?? "",
  }),
  async (c) => {
    const context = await buildIncidentInvestigationContext(
      c.req.param("incidentId")
    );
    if (!context) {
      return c.json({ error: "Incident not found" }, 404);
    }

    return c.json(context);
  }
);

app.post(
  "/tools/incidents/:incidentId/events",
  requireToolAccess({
    operation: "incident_events.create",
    scopes: [toolScopes.writeIncidentEvents],
    resourceType: "incident",
    getResourceId: (c) => c.req.param("incidentId") ?? "",
  }),
  async (c) => {
    const incidentId = c.req.param("incidentId");
    const incident = await getIncident(incidentId);
    if (!incident) {
      return c.json({ error: "Incident not found" }, 404);
    }

    const body = await readJsonObject(c);
    const message = asString(body?.message);
    const kind = body?.kind;
    if (!message || !isIncidentEventKind(kind)) {
      return c.json(
        { error: "kind and message are required for incident events" },
        400
      );
    }

    const event = await createIncidentEvent({
      incidentId,
      kind,
      message,
      createdBy: getToolAuth(c).actor,
    });

    return c.json(event, 201);
  }
);

app.post(
  "/tools/incidents/:incidentId/tickets",
  requireToolAccess({
    operation: "tickets.create",
    scopes: [toolScopes.writeTickets],
    resourceType: "incident",
    getResourceId: (c) => c.req.param("incidentId") ?? "",
  }),
  async (c) => {
    const incidentId = c.req.param("incidentId");
    const incident = await getIncident(incidentId);
    if (!incident) {
      return c.json({ error: "Incident not found" }, 404);
    }

    const body = await readJsonObject(c);
    const assigneeTeam = asString(body?.assigneeTeam);
    const externalRef = asString(body?.externalRef);
    const status = body?.status;
    if (!assigneeTeam || (status !== undefined && !isTicketStatus(status))) {
      return c.json(
        { error: "assigneeTeam is required and status must be valid if provided" },
        400
      );
    }

    const ticket = await createTicket({
      incidentId,
      assigneeTeam,
      externalRef,
      status: isTicketStatus(status) ? status : undefined,
      createdBy: getToolAuth(c).actor,
    });

    return c.json(ticket, 201);
  }
);

app.post(
  "/tools/incidents/:incidentId/remediation-actions",
  requireToolAccess({
    operation: "remediation_actions.create",
    scopes: [toolScopes.writeRemediationActions],
    resourceType: "incident",
    getResourceId: (c) => c.req.param("incidentId") ?? "",
  }),
  async (c) => {
    const incidentId = c.req.param("incidentId");
    const incident = await getIncident(incidentId);
    if (!incident) {
      return c.json({ error: "Incident not found" }, 404);
    }

    const body = await readJsonObject(c);
    const type = body?.type;
    const risk = body?.risk;
    const summary = asString(body?.summary);
    if (!isRemediationActionType(type) || !isRemediationRisk(risk) || !summary) {
      return c.json(
        { error: "type, risk, and summary are required for remediation actions" },
        400
      );
    }

    const action = await createRemediationAction({
      incidentId,
      type,
      risk,
      summary,
      createdBy: getToolAuth(c).actor,
    });

    return c.json(action, 201);
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
