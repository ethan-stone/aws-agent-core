import type {
  AgentKind,
  AgentRunStatus,
} from "../../../../shared/pulseforge-domain/src/index.js";

export interface WebBackendDiagnosticContext {
  requestId?: string;
  method?: string;
  path?: string;
  userId?: string;
  conversationId?: string;
  runId?: string;
  agentKind?: AgentKind;
  runtimeSessionId?: string;
  providerSessionId?: string;
  incidentId?: string;
  deviceId?: string;
}

export interface WebBackendDiagnosticError {
  name?: string;
  message: string;
  stack?: string;
  metadata?: {
    httpStatusCode?: number;
    requestId?: string;
  };
}

type LogLevel = "debug" | "info" | "warn" | "error";

const logLevelOrder: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function configuredLogLevel(): LogLevel {
  const value = process.env.API_LOG_LEVEL;
  if (
    value === "debug" ||
    value === "info" ||
    value === "warn" ||
    value === "error"
  ) {
    return value;
  }

  return "info";
}

function shouldLog(level: LogLevel) {
  return logLevelOrder[level] >= logLevelOrder[configuredLogLevel()];
}

function writeDiagnostic(
  level: LogLevel,
  event: string,
  context: WebBackendDiagnosticContext | undefined,
  data: Record<string, unknown> = {}
) {
  if (!shouldLog(level)) {
    return;
  }

  const payload = {
    event,
    ...context,
    ...data,
  };

  if (level === "error") {
    console.error("[webbackend]", payload);
    return;
  }

  if (level === "warn") {
    console.warn("[webbackend]", payload);
    return;
  }

  if (level === "debug") {
    console.debug("[webbackend]", payload);
    return;
  }

  console.info("[webbackend]", payload);
}

export function extendDiagnostics(
  context: WebBackendDiagnosticContext | undefined,
  next: WebBackendDiagnosticContext
): WebBackendDiagnosticContext {
  return {
    ...(context ?? {}),
    ...next,
  };
}

export function formatDiagnosticError(error: unknown): WebBackendDiagnosticError {
  if (error instanceof Error) {
    const metadata = (
      error as Error & {
        $metadata?: { httpStatusCode?: number; requestId?: string };
      }
    ).$metadata;

    return {
      name: error.name === "Error" ? undefined : error.name,
      message: error.message,
      stack: error.stack,
      metadata,
    };
  }

  return {
    message: String(error),
  };
}

export const webBackendDiagnostics = {
  apiRequestCompleted(
    context: WebBackendDiagnosticContext,
    data: { status: number; durationMs: number }
  ) {
    writeDiagnostic("info", "api.request.completed", context, data);
  },

  apiAuthRejected(
    context: WebBackendDiagnosticContext,
    data: { reason: string }
  ) {
    writeDiagnostic("warn", "api.auth.rejected", context, data);
  },

  apiUnhandledError(context: WebBackendDiagnosticContext, error: unknown) {
    writeDiagnostic("error", "api.request.failed", context, {
      error: formatDiagnosticError(error),
    });
  },

  lambdaContextConfigured(
    context: WebBackendDiagnosticContext,
    data: { awsRequestId?: string; callbackWaitsForEmptyEventLoop: boolean }
  ) {
    writeDiagnostic("debug", "lambda.context.configured", context, data);
  },

  conversationStreamOpened(
    context: WebBackendDiagnosticContext | undefined,
    data: { status: number }
  ) {
    writeDiagnostic("info", "conversation.stream.opened", context, data);
  },

  conversationStreamSnapshot(
    context: WebBackendDiagnosticContext | undefined,
    data: {
      conversationId?: string;
      runId?: string;
      runStatus?: AgentRunStatus;
      runItems?: number;
    }
  ) {
    writeDiagnostic("debug", "conversation.stream.snapshot", context, data);
  },

  conversationStreamError(
    context: WebBackendDiagnosticContext | undefined,
    error: unknown
  ) {
    writeDiagnostic("error", "conversation.stream.failed", context, {
      error: formatDiagnosticError(error),
    });
  },

  conversationStreamClosed(
    context: WebBackendDiagnosticContext | undefined,
    data: { snapshots: number; durationMs: number }
  ) {
    writeDiagnostic("info", "conversation.stream.closed", context, data);
  },

  agentRunStarted(
    context: WebBackendDiagnosticContext,
    data: { requestedByUserId?: string }
  ) {
    writeDiagnostic("info", "agent_run.started", context, data);
  },

  agentRequiredActionObserved(
    context: WebBackendDiagnosticContext,
    data: { actionType: string; requiredActionId: string; status: string }
  ) {
    writeDiagnostic("info", "agent_run.required_action.observed", context, data);
  },

  agentRunCompleted(
    context: WebBackendDiagnosticContext,
    data: { status: AgentRunStatus; itemCount: number; summary?: string }
  ) {
    writeDiagnostic("info", "agent_run.completed", context, data);
  },

  agentRunFailed(context: WebBackendDiagnosticContext, error: unknown) {
    writeDiagnostic("error", "agent_run.failed", context, {
      error: formatDiagnosticError(error),
    });
  },

  runtimeSessionResolved(
    context: WebBackendDiagnosticContext,
    data: { created: boolean; runtimeIdentity: string }
  ) {
    writeDiagnostic("info", "runtime_session.resolved", context, data);
  },

  runtimeInvocationStarted(
    context: WebBackendDiagnosticContext,
    data: { runtimeArn: string; qualifier: string; runtimeUserId: string }
  ) {
    writeDiagnostic("info", "agent_runtime.invocation.started", context, data);
  },

  runtimeEventReceived(
    context: WebBackendDiagnosticContext,
    data: { event: string; index: number }
  ) {
    const level: LogLevel =
      data.event === "auth_required" || data.event === "required_action"
        ? "info"
        : "debug";
    writeDiagnostic(level, "agent_runtime.event.received", context, data);
  },

  resourceTokenAuthCompleted(
    context: WebBackendDiagnosticContext | undefined,
    data: { sessionUri: string; userId: string; clientId?: string }
  ) {
    writeDiagnostic("info", "resource_token_auth.completed", context, data);
  },
} as const;
