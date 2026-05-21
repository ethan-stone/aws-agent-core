import type { MiddlewareHandler } from "hono";
import {
  createAuditLog,
  getAgentRun,
  isToolAuthConfigured,
  toolScopes,
  type ToolAuthContext,
  type ToolScope,
  verifyToolAccessToken,
} from "../../../shared/pulseforge-backend/src/index.js";
import {
  type ToolsApiEnv,
} from "./types.js";

export { toolScopes };

const isToolDebugLoggingEnabled =
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

export function requireToolAccess(config: {
  operation: string;
  scopes: ToolScope[];
  resourceType?: string;
  getResourceId?: (c: Parameters<MiddlewareHandler<ToolsApiEnv>>[0]) => string;
}): MiddlewareHandler<ToolsApiEnv> {
  return async (c, next) => {
    c.set("toolAuth", null);

    const agentRunId = c.req.header("x-pulseforge-agent-run-id")?.trim();
    if (!agentRunId) {
      return c.json(
        {
          ok: false,
          errorCode: "missing_agent_run_id",
          message: "x-pulseforge-agent-run-id is required",
        },
        400
      );
    }

    if (!isToolAuthConfigured()) {
      return c.json(
        {
          ok: false,
          errorCode: "tool_auth_not_configured",
          message: "Tool authentication is not configured",
        },
        503
      );
    }

    const token = getBearerToken(c.req.header("authorization"));
    if (!token) {
      return c.json(
        {
          ok: false,
          errorCode: "authentication_required",
          message: "Authentication required",
        },
        401
      );
    }

    let toolAuth: ToolAuthContext;
    try {
      toolAuth = await verifyToolAccessToken(token, agentRunId, config.scopes);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Invalid access token";
      const missingScopes = message.startsWith("Missing required scopes");
      console.warn("[tools-auth] rejected tool token", {
        operation: config.operation,
        agentRunId,
        requiredScopes: config.scopes,
        errorCode: missingScopes ? "missing_required_scopes" : "invalid_token",
        verifierMessage: message,
        tokenClaims: summarizeJwtPayload(token),
      });
      return c.json(
        {
          ok: false,
          errorCode: missingScopes ? "missing_required_scopes" : "invalid_token",
          message: missingScopes ? message : "Invalid access token",
        },
        missingScopes ? 403 : 401
      );
    }

    c.set("toolAuth", toolAuth);
    if (isToolDebugLoggingEnabled) {
      console.info("[tools-auth] accepted tool token", {
        operation: config.operation,
        agentRunId,
        requiredScopes: config.scopes,
        actorId: toolAuth.actor.actorId,
        onBehalfOfUserId: toolAuth.actor.onBehalfOfUserId,
        scopes: toolAuth.scopes,
      });
    }

    const run = await getAgentRun(agentRunId);
    if (!run) {
      await writeToolAudit(c, toolAuth, config, 404, "failed", "Agent run not found");
      return c.json(
        {
          ok: false,
          errorCode: "agent_run_not_found",
          message: "Agent run not found",
        },
        404
      );
    }

    if (
      run.requestedByUserId &&
      run.requestedByUserId !== toolAuth.actor.onBehalfOfUserId
    ) {
      console.warn("[tools-auth] delegated user mismatch", {
        operation: config.operation,
        agentRunId,
        requestedByUserId: run.requestedByUserId,
        onBehalfOfUserId: toolAuth.actor.onBehalfOfUserId,
      });
      await writeToolAudit(
        c,
        toolAuth,
        config,
        403,
        "failed",
        "Agent run does not belong to delegated user"
      );
      return c.json(
        {
          ok: false,
          errorCode: "delegated_user_mismatch",
          message: "Agent run does not belong to delegated user",
        },
        403
      );
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

function summarizeJwtPayload(token: string) {
  try {
    const [, payload] = token.split(".");
    if (!payload) {
      return null;
    }

    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    ) as Record<string, unknown>;

    return {
      iss: asString(parsed.iss),
      tokenUse: asString(parsed.token_use),
      clientId: asString(parsed.client_id),
      aud: asString(parsed.aud),
      sub: asString(parsed.sub),
      username: asString(parsed.username) ?? asString(parsed["cognito:username"]),
      scope: asString(parsed.scope),
      exp: typeof parsed.exp === "number" ? parsed.exp : undefined,
    };
  } catch {
    return null;
  }
}

function asString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

export function getToolAuth(c: Parameters<MiddlewareHandler<ToolsApiEnv>>[0]) {
  const toolAuth = c.get("toolAuth");
  if (!toolAuth) {
    throw new Error("Tool auth context was not initialized");
  }

  return toolAuth;
}

async function writeToolAudit(
  c: Parameters<MiddlewareHandler<ToolsApiEnv>>[0],
  toolAuth: ToolAuthContext,
  config: {
    operation: string;
    scopes: ToolScope[];
    resourceType?: string;
    getResourceId?: (c: Parameters<MiddlewareHandler<ToolsApiEnv>>[0]) => string;
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
