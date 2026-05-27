import type { z } from "zod";

export type PulseForgeToolScope =
  | "read:devices"
  | "read:incidents"
  | "read:telemetry"
  | "write:incident_events"
  | "write:tickets"
  | "write:remediation_actions"
  | "write:device_commands";

export type PulseForgeToolName =
  | "get_incident_context"
  | "get_device"
  | "get_device_telemetry"
  | "create_incident_event"
  | "create_ticket"
  | "propose_remediation_action"
  | "reset_device";

export type PulseForgeCredentialProviderKey = "pulseforge-backend";

export interface PulseForgeCredentialProviderDescriptor<
  TScope extends string = PulseForgeToolScope,
> {
  key: PulseForgeCredentialProviderKey;
  displayName: string;
  supportedScopes: readonly TScope[];
}

export type HttpMethod = "GET" | "POST";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface PulseForgeToolDefinition<
  TInputSchema extends z.ZodType = z.ZodType,
  TOutputSchema extends z.ZodType = z.ZodType,
> {
  name: PulseForgeToolName;
  description: string;
  inputSchema: TInputSchema;
  outputSchema: TOutputSchema;
  credentialProvider: PulseForgeCredentialProviderDescriptor;
  requiredScopes: PulseForgeToolScope[];
  approval?: {
    required: true;
    actionType: "tool_approval";
    title: string;
    description: string;
    actionLabel: string;
    risk: "low" | "medium" | "high";
  };
  http: {
    method: HttpMethod;
    path: (input: z.infer<TInputSchema>) => string;
    body?: (input: z.infer<TInputSchema>) => JsonValue;
  };
}

export interface ToolAccessTokenConfig {
  providerName: string;
  scopes: string[];
  authFlow: "USER_FEDERATION";
  callbackUrl?: string;
  onAuthUrl?: (url: string) => void | Promise<void>;
}

export interface ToolCredentialProvider {
  withAccessToken<TInput, TResult>(
    config: ToolAccessTokenConfig,
    fn: (input: TInput, accessToken: string) => Promise<TResult>
  ): (input: TInput) => Promise<TResult>;
}

export interface PulseForgeToolExecutionContext {
  backendUrl: string;
  agentRunId: string;
  providers: Record<PulseForgeCredentialProviderKey, PulseForgeRuntimeCredentialProvider>;
  getAuthorizationScopes?: (
    provider: PulseForgeCredentialProviderDescriptor,
    definition: PulseForgeToolDefinition
  ) => readonly PulseForgeToolScope[];
  onToolCallStarted?: (details: {
    toolCallId: string;
    toolName: PulseForgeToolName;
    input: unknown;
  }) => void | Promise<void>;
  onToolCallCompleted?: (details: {
    toolCallId: string;
    toolName: PulseForgeToolName;
    output: JsonValue;
  }) => void | Promise<void>;
  onToolCallFailed?: (details: {
    toolCallId: string;
    toolName: PulseForgeToolName;
    error: JsonValue;
  }) => void | Promise<void>;
  onAuthorizationRequired?: (details: {
    requiredActionId: string;
    providerName: string;
    providerDisplayName: string;
    authUrl: string;
    scopes: string[];
    agentRunId: string;
  }) => void | Promise<void>;
  onAuthorizationResolved?: (details: {
    requiredActionId: string;
    providerName: string;
    scopes: string[];
    agentRunId: string;
  }) => void | Promise<void>;
  fetch?: typeof fetch;
}

export interface PulseForgeRuntimeCredentialProvider {
  providerName: string;
  resourceServerIdentifier?: string;
  oauthCallbackUrl?: string;
  credentialProvider: ToolCredentialProvider;
}
