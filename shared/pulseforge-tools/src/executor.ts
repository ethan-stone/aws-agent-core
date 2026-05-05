import { ToolAuthorizationRequiredError } from "./errors.js";
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
  const invoke = context.credentialProvider.withAccessToken(
    {
      providerName: context.providerName,
      scopes: definition.requiredScopes,
      authFlow: "USER_FEDERATION",
      onAuthUrl: (authUrl) => {
        throw new ToolAuthorizationRequiredError({
          providerName: context.providerName,
          authUrl,
          scopes: definition.requiredScopes,
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

  return invoke(parsedInput);
}

async function callPulseForgeToolEndpoint(
  definition: PulseForgeToolDefinition,
  input: unknown,
  accessToken: string,
  context: PulseForgeToolExecutionContext
): Promise<unknown> {
  const fetchImpl = context.fetch ?? fetch;
  const url = new URL(definition.http.path(input), normalizedBaseUrl(context.backendUrl));
  const body = definition.http.body?.(input);
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
    return {
      ok: false,
      errorCode: `http_${response.status}`,
      message: getErrorMessage(payload) ?? `Tool endpoint failed with HTTP ${response.status}.`,
    };
  }

  return payload;
}

function normalizedBaseUrl(value: string) {
  return value.endsWith("/") ? value : `${value}/`;
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
