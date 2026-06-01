import { randomUUID } from "node:crypto";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { streamSSE } from "hono/streaming";
import type {
  AgentKind,
  AuthenticatedAppUser,
  ConversationSummary,
  CreateConversationRequest,
  CreateConversationRunRequest,
  Device,
  RunItem,
} from "../../../shared/pulseforge-domain/src/index.js";
import {
  appPermissions,
  getAgentRun,
  getApiAuthConfig,
  getConversationDetail,
  getDashboard,
  getDevice,
  getDeviceTelemetry,
  getIncident,
  getSnapshot,
  getStorageMode,
  createDevice,
  listDevices,
  listIncidents,
  resolveIncident,
  seedDemoData,
  verifyAccessToken,
} from "../../../shared/pulseforge-backend/src/index.js";
import {
  ActiveRootRunError,
  ConversationInteractionError,
  RequiredActionResolutionError,
  UnsupportedAgentTriggerError,
  completeAgentResourceTokenAuth,
  createConversationAndRun,
  createConversationAndRunStream,
  resolveRunRequiredAction,
  runConversation,
  runConversationStream,
} from "./services/agent-service.js";
import {
  IncidentCommentError,
  type IncidentCommentProgress,
  postIncidentComment,
  postIncidentCommentStream,
  startIncidentCreatedAutomation,
} from "./services/incident-collaboration-service.js";
import {
  conversationDetailEventStream,
  conversationRunStatus,
  wantsConversationEventStream,
} from "./services/conversation-run-transport.js";
import { webBackendDiagnostics } from "./services/webbackend-diagnostics.js";
import type { ApiAppEnv } from "./types.js";

const publicApiPaths = new Set(["/api/auth/config"]);
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
      webBackendDiagnostics.apiAuthRejected(c.get("requestContext"), {
        reason: `missing_user_for_permission:${permission}`,
      });
      return c.json({ error: "Authentication required" }, 401);
    }

    if (!user.permissions.includes(permission)) {
      webBackendDiagnostics.apiAuthRejected(
        {
          ...c.get("requestContext"),
          userId: user.sub,
        },
        {
          reason: `missing_permission:${permission}`,
        }
      );
      return c.json({ error: "Forbidden" }, 403);
    }

    return next();
  };
}

function isAgentKind(value: unknown): value is AgentKind {
  return (
    value === "ops-copilot" ||
    value === "incident-responder"
  );
}

function isDeviceType(value: unknown): value is Device["type"] {
  return (
    value === "freezer-sensor" ||
    value === "vibration-monitor" ||
    value === "gateway" ||
    value === "power-meter"
  );
}

function asPrompt(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function firstTextBlock(item?: Extract<RunItem, { kind: "message" }>) {
  const block = item?.content.find((content) => content.type === "text");
  if (!block || block.type !== "text") {
    return undefined;
  }
  const text = block.text.trim();
  return text.length > 120 ? `${text.slice(0, 117).trimEnd()}...` : text;
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

app.use("*", async (c, next) => {
  const requestId = c.req.header("x-request-id") ?? randomUUID();
  const requestContext = {
    requestId,
    method: c.req.method,
    path: c.req.path,
  };
  c.set("requestContext", requestContext);
  c.header("x-request-id", requestId);

  const lambdaContext = c.env?.context;
  if (lambdaContext) {
    lambdaContext.callbackWaitsForEmptyEventLoop = false;
    webBackendDiagnostics.lambdaContextConfigured(requestContext, {
      awsRequestId: lambdaContext.awsRequestId,
      callbackWaitsForEmptyEventLoop:
        lambdaContext.callbackWaitsForEmptyEventLoop,
    });
  }

  return next();
});

app.use("/api/*", async (c, next) => {
  const startedAt = Date.now();
  await next();
  webBackendDiagnostics.apiRequestCompleted(
    {
      ...c.get("requestContext"),
      userId: c.get("user")?.sub,
    },
    {
      status: c.res.status,
      durationMs: Date.now() - startedAt,
    }
  );
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
    webBackendDiagnostics.apiAuthRejected(c.get("requestContext"), {
      reason: "missing_bearer_token",
    });
    return c.json({ error: "Authentication required" }, 401);
  }

  try {
    const user = await verifyAccessToken(token);
    c.set("user", user);
    return next();
  } catch {
    webBackendDiagnostics.apiAuthRejected(c.get("requestContext"), {
      reason: "invalid_access_token",
    });
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

app.post(
  "/api/devices",
  requireUserPermission(appPermissions.writeDevices),
  async (c) => {
    const body = (await c.req.json()) as {
      id?: unknown;
      siteId?: unknown;
      name?: unknown;
      type?: unknown;
      firmwareVersion?: unknown;
      tags?: unknown;
    };
    const siteId = asOptionalString(body.siteId);
    const name = asOptionalString(body.name);
    const type = asOptionalString(body.type);
    if (!siteId || !name || !isDeviceType(type)) {
      return c.json({ error: "siteId, name, and valid type are required" }, 400);
    }

    const device = await createDevice({
      id: asOptionalString(body.id) ?? `dev-${randomUUID().slice(0, 8)}`,
      siteId,
      name,
      type,
      firmwareVersion: asOptionalString(body.firmwareVersion) ?? "1.0.0",
      tags: Array.isArray(body.tags)
        ? body.tags.filter((tag): tag is string => typeof tag === "string")
        : ["simulated"],
    });
    return c.json(device, 201);
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

app.post(
  "/api/incidents/:incidentId/resolve",
  requireUserPermission(appPermissions.writeIncidents),
  async (c) => {
    const incident = await resolveIncident(c.req.param("incidentId"));
    if (!incident) {
      return c.json({ error: "Incident not found" }, 404);
    }

    return c.json(await getIncident(incident.id));
  }
);

app.post(
  "/api/incidents/:incidentId/comments",
  requireUserPermission(appPermissions.writeAgentRuns),
  async (c) => {
    const body = (await c.req.json()) as { body?: unknown };
    const commentBody = asPrompt(body.body);
    const user = c.get("user");

    if (!commentBody) {
      return c.json({ error: "body is required" }, 400);
    }

    try {
      if (wantsConversationEventStream(c.req.header("accept"))) {
        if (!(await getIncident(c.req.param("incidentId")))) {
          return c.json({ error: "Incident not found" }, 404);
        }
        return incidentCommentProgressEventStream(
          c,
          postIncidentCommentStream(
            c.req.param("incidentId"),
            commentBody,
            user,
            c.get("requestContext")
          )
        );
      }

      const incident = await postIncidentComment(
        c.req.param("incidentId"),
        commentBody,
        user,
        c.get("requestContext")
      );
      if (!incident) {
        return c.json({ error: "Incident not found" }, 404);
      }

      return c.json(incident, 201);
    } catch (error) {
      if (error instanceof IncidentCommentError) {
        return c.json({ error: error.message }, 400);
      }
      throw error;
    }
  }
);

function incidentCommentProgressEventStream(
  c: Context<ApiAppEnv>,
  progress: AsyncGenerator<IncidentCommentProgress>
) {
  c.status(201);
  c.header("cache-control", "no-cache, no-transform");
  c.header("connection", "keep-alive");

  return streamSSE(
    c,
    async (stream) => {
      for await (const update of progress) {
        await stream.writeSSE({
          event: "incident",
          data: JSON.stringify(update.incident),
        });
        if (update.conversation) {
          await stream.writeSSE({
            event: "conversation",
            data: JSON.stringify(update.conversation),
          });
        }
      }
      await stream.close();
    },
    async (error, stream) => {
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({
          error:
            error instanceof Error
              ? error.message
              : "Incident comment stream failed.",
        }),
      });
      await stream.close();
    }
  );
}

app.post(
  "/api/incidents/:incidentId/automation/incident-created",
  requireUserPermission(appPermissions.writeAgentRuns),
  async (c) => {
    const incident = await startIncidentCreatedAutomation(
      c.req.param("incidentId"),
      c.get("requestContext")
    );
    if (!incident) {
      return c.json({ error: "Incident not found" }, 404);
    }

    return c.json(incident, 201);
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

    await completeAgentResourceTokenAuth(
      body.sessionUri,
      user,
      c.get("requestContext")
    );
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
    const request = {
      agentKind: body.agentKind,
      prompt,
      incidentId: asOptionalString(body.incidentId),
      deviceId: asOptionalString(body.deviceId),
    };

    try {
      if (wantsConversationEventStream(c.req.header("accept"))) {
        return conversationDetailEventStream(
          c,
          await createConversationAndRunStream(
            request,
            user,
            c.get("requestContext")
          ),
          {
            status: 201,
            diagnostics: c.get("requestContext"),
          }
        );
      }

      const detail = await createConversationAndRun(
        request,
        user,
        c.get("requestContext")
      );

      return c.json(detail, conversationRunStatus(detail, 201));
    } catch (error) {
      if (error instanceof UnsupportedAgentTriggerError) {
        return c.json({ error: error.message }, 400);
      }

      throw error;
    }
  }
);

app.get(
  "/api/conversations",
  requireUserPermission(appPermissions.writeAgentRuns),
  async (c) => {
    const user = c.get("user");
    const snapshot = await getSnapshot();
    const visibleConversations = snapshot.conversations
      .filter((conversation) => conversation.rootAgentKind === "ops-copilot")
      .filter((conversation) => {
        if (!getApiAuthConfig().enabled || !user) {
          return conversation.interactionMode !== "observe_only";
        }
        return (
          conversation.interactionOwnerUserId === user.sub ||
          snapshot.agentRuns.some(
            (run) =>
              run.conversationId === conversation.id &&
              run.requestedByUserId === user.sub
          )
        );
      })
      .map((conversation): ConversationSummary => {
        const runs = snapshot.agentRuns
          .filter((run) => run.conversationId === conversation.id)
          .sort((left, right) =>
            (left.startedAt ?? "").localeCompare(right.startedAt ?? "")
          );
        const latestRun = runs.at(-1);
        const items = runs.flatMap(
          (run) => snapshot.runItems.filter((item) => item.runId === run.id)
        );
        const firstUserMessage = items.find(
          (item): item is Extract<RunItem, { kind: "message" }> =>
            item.kind === "message" && item.role === "user"
        );
        const latestAgentMessage = [...items]
          .reverse()
          .find(
            (item): item is Extract<RunItem, { kind: "message" }> =>
              item.kind === "message" && item.role === "agent"
          );

        return {
          conversation,
          latestRun,
          title:
            firstTextBlock(firstUserMessage) ??
            conversation.incidentId ??
            "Untitled conversation",
          preview: latestRun?.summary ?? firstTextBlock(latestAgentMessage),
          itemCount: items.length,
          updatedAt: latestRun?.completedAt ?? latestRun?.startedAt ?? conversation.updatedAt,
        };
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

    return c.json({ items: visibleConversations });
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

    try {
      const request = {
        prompt,
        incidentId: asOptionalString(body.incidentId),
        deviceId: asOptionalString(body.deviceId),
      };
      const detail = wantsConversationEventStream(c.req.header("accept"))
        ? await runConversationStream(
            c.req.param("conversationId"),
            request,
            user,
            c.get("requestContext")
          )
        : await runConversation(
            c.req.param("conversationId"),
            request,
            user,
            c.get("requestContext")
          );

      if (!detail) {
        return c.json({ error: "Conversation not found" }, 404);
      }

      if (Symbol.asyncIterator in detail) {
        return conversationDetailEventStream(c, detail, {
          diagnostics: c.get("requestContext"),
        });
      }

      return c.json(detail, conversationRunStatus(detail, 200));
    } catch (error) {
      if (error instanceof ActiveRootRunError) {
        return c.json({ error: error.message }, 409);
      }
      if (error instanceof ConversationInteractionError) {
        return c.json({ error: error.message }, 403);
      }
      if (error instanceof UnsupportedAgentTriggerError) {
        return c.json({ error: error.message }, 400);
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

app.post(
  "/api/agent-runs/:runId/required-actions/:requiredActionId/resolve",
  requireUserPermission(appPermissions.writeAgentRuns),
  async (c) => {
    const body = (await c.req.json()) as {
      outcome?: string;
      decision?: string;
      comment?: string;
    };
    const user = c.get("user");

    if (body.outcome !== "resolved" && body.outcome !== "declined") {
      return c.json({ error: "outcome must be resolved or declined" }, 400);
    }
    if (
      body.decision &&
      body.decision !== "allow_once" &&
      body.decision !== "allow_always" &&
      body.decision !== "decline"
    ) {
      return c.json(
        { error: "decision must be allow_once, allow_always, or decline" },
        400
      );
    }
    if (
      body.outcome === "declined" &&
      (body.decision === "allow_once" || body.decision === "allow_always")
    ) {
      return c.json(
        { error: "declined outcome cannot use allow decision" },
        400
      );
    }
    if (body.outcome === "resolved" && body.decision === "decline") {
      return c.json(
        { error: "resolved outcome cannot use decline decision" },
        400
      );
    }

    try {
      const detail = await resolveRunRequiredAction(
        c.req.param("runId"),
        c.req.param("requiredActionId"),
        {
          outcome: body.outcome,
          ...(body.decision
            ? {
                decision: body.decision as
                  | "allow_once"
                  | "allow_always"
                  | "decline",
              }
            : {}),
          ...(asOptionalString(body.comment)
            ? { comment: asOptionalString(body.comment) }
            : {}),
        },
        user,
        c.get("requestContext")
      );

      if (!detail) {
        return c.json({ error: "Agent run not found" }, 404);
      }

      return c.json(detail, conversationRunStatus(detail, 200));
    } catch (error) {
      if (error instanceof ActiveRootRunError) {
        return c.json({ error: error.message }, 409);
      }
      if (error instanceof RequiredActionResolutionError) {
        return c.json({ error: error.message }, 400);
      }

      throw error;
    }
  }
);

app.onError((error, c) => {
  webBackendDiagnostics.apiUnhandledError(c.get("requestContext"), error);

  return c.json({ error: "Internal server error" }, 500);
});
