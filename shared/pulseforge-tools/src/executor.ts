import type {
  JsonValue,
  PulseForgeToolDefinition,
  PulseForgeToolExecutionContext,
} from "./types.js";

export async function executePulseForgeTool(
  definition: PulseForgeToolDefinition,
  input: unknown,
  context: PulseForgeToolExecutionContext
): Promise<JsonValue> {
  const parsedInput = definition.inputSchema.parse(input);
  const provider = definition.credentialProvider;
  const runtimeProvider = context.providers[provider.key];
  if (!runtimeProvider) {
    throw new Error(`No runtime credential provider configured for ${provider.key}.`);
  }
  const oauthScopes = toOauthScopes(
    [...(context.getAuthorizationScopes?.(provider) ?? definition.requiredScopes)],
    runtimeProvider.resourceServerIdentifier
  );
  const invoke = runtimeProvider.credentialProvider.withAccessToken(
    {
      providerName: runtimeProvider.providerName,
      scopes: oauthScopes,
      authFlow: "USER_FEDERATION",
      callbackUrl: runtimeProvider.oauthCallbackUrl,
      onAuthUrl: async (authUrl) => {
        console.info("[tools] PulseForge tool authorization URL received", {
          tool: definition.name,
          agentRunId: context.agentRunId,
          providerName: runtimeProvider.providerName,
          providerKey: provider.key,
          scopes: oauthScopes,
          oauthCallbackUrlConfigured: Boolean(runtimeProvider.oauthCallbackUrl),
          authUrl: summarizeAuthorizationUrl(authUrl),
        });
        await context.onAuthorizationRequired?.({
          providerName: runtimeProvider.providerName,
          providerDisplayName: provider.displayName,
          authUrl,
          scopes: oauthScopes,
          agentRunId: context.agentRunId,
        });
      },
    },
    async (toolInput: typeof parsedInput, accessToken) => {
      const response = await callPulseForgeToolEndpoint(
        definition,
        toolInput,
        accessToken,
        context
      );
      return definition.outputSchema.parse(response) as JsonValue;
    }
  );

  try {
    return await invoke(parsedInput);
  } catch (error) {
    console.error("[tools] PulseForge tool execution threw", {
      tool: definition.name,
      agentRunId: context.agentRunId,
      providerName: runtimeProvider.providerName,
      providerKey: provider.key,
      scopes: oauthScopes,
      oauthCallbackUrlConfigured: Boolean(runtimeProvider.oauthCallbackUrl),
      error: serializeUnknownError(error),
    });

    throw error;
  }
}

function toOauthScopes(scopes: string[], resourceServerIdentifier?: string) {
  if (!resourceServerIdentifier) {
    return scopes;
  }

  return scopes.map((scope) => `${resourceServerIdentifier}/${scope}`);
}

function summarizeAuthorizationUrl(value: string): JsonValue {
  try {
    const url = new URL(value);
    const redirectUri = url.searchParams.get("redirect_uri");

    return {
      origin: url.origin,
      pathname: url.pathname,
      responseType: url.searchParams.get("response_type"),
      hasState: url.searchParams.has("state"),
      hasClientId: url.searchParams.has("client_id"),
      hasRedirectUri: Boolean(redirectUri),
      hasHash: url.hash.length > 0,
      hashLength: url.hash.length,
      hashHasState: url.hash.includes("state="),
      hashHasRedirectUri: url.hash.includes("redirect_uri="),
      hashHasClientId: url.hash.includes("client_id="),
      redirectUriOrigin: redirectUri ? new URL(redirectUri).origin : null,
      redirectUriPathname: redirectUri ? new URL(redirectUri).pathname : null,
    };
  } catch {
    return {
      parseError: true,
    };
  }
}

async function callPulseForgeToolEndpoint(
  definition: PulseForgeToolDefinition,
  input: unknown,
  accessToken: string,
  context: PulseForgeToolExecutionContext
): Promise<unknown> {
  const fetchImpl = context.fetch ?? fetch;
  const url = new URL(
    relativeToolPath(definition.http.path(input)),
    normalizedBaseUrl(context.backendUrl)
  );
  const body = definition.http.body?.(input);
  console.info("[tools] calling PulseForge tool endpoint", {
    tool: definition.name,
    method: definition.http.method,
    path: url.pathname,
    agentRunId: context.agentRunId,
  });

  const response = await fetchImpl(url, {
    method: definition.http.method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      "x-pulseforge-agent-run-id": context.agentRunId,
    },
    body: body === undefined ? undefined : JSON.stringify(stripUndefined(body)),
  });

  const payload = await response.json().catch(() => ({
    ok: false,
    errorCode: "invalid_tool_response",
    message: `Tool endpoint returned non-JSON response with HTTP ${response.status}.`,
  }));

  if (!response.ok) {
    console.warn("[tools] PulseForge tool endpoint failed", {
      tool: definition.name,
      status: response.status,
      agentRunId: context.agentRunId,
      errorCode: getErrorCode(payload),
      message: getErrorMessage(payload),
      payload,
    });

    return {
      ok: false,
      errorCode: getErrorCode(payload) ?? `http_${response.status}`,
      message: getErrorMessage(payload) ?? `Tool endpoint failed with HTTP ${response.status}.`,
    };
  }

  console.info("[tools] PulseForge tool endpoint succeeded", {
    tool: definition.name,
    status: response.status,
    agentRunId: context.agentRunId,
  });

  return payload;
}

function normalizedBaseUrl(value: string) {
  return value.endsWith("/") ? value : `${value}/`;
}

function relativeToolPath(value: string) {
  return value.replace(/^\/+/, "");
}

function stripUndefined(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(stripUndefined);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, stripUndefined(item as JsonValue)])
    );
  }

  return value;
}

function getErrorMessage(payload: unknown) {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "message" in payload &&
    typeof payload.message === "string"
  ) {
    return payload.message;
  }

  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "string"
  ) {
    return payload.error;
  }

  return null;
}

function getErrorCode(payload: unknown) {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "errorCode" in payload &&
    typeof payload.errorCode === "string"
  ) {
    return payload.errorCode;
  }

  return null;
}

function serializeUnknownError(error: unknown): JsonValue {
  if (error instanceof Error) {
    const serialized: Record<string, JsonValue> = {
      name: error.name,
      message: error.message,
    };

    if (error.stack) {
      serialized.stack = error.stack;
    }

    if (error.cause) {
      serialized.cause = serializeUnknownError(error.cause);
    }

    return {
      ...serialized,
      ...copyEnumerableErrorProperties(error),
    };
  }

  if (
    error === null ||
    typeof error === "string" ||
    typeof error === "number" ||
    typeof error === "boolean"
  ) {
    return error;
  }

  return toJsonValue(error);
}

function copyEnumerableErrorProperties(error: Error): Record<string, JsonValue> {
  return Object.fromEntries(
    Object.entries(error).map(([key, value]) => [key, toJsonValue(value)])
  );
}

function toJsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(toJsonValue);
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, toJsonValue(item)])
    );
  }

  return String(value);
}
