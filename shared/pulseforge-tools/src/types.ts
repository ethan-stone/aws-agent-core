import type { z } from "zod";

export type PulseForgeToolScope =
  | "read:devices"
  | "read:incidents"
  | "read:telemetry"
  | "write:incident_events"
  | "write:tickets"
  | "write:remediation_actions";

export type PulseForgeToolName =
  | "get_incident_context"
  | "get_device"
  | "get_device_telemetry"
  | "create_incident_event"
  | "create_ticket"
  | "propose_remediation_action";

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
    provider: PulseForgeCredentialProviderDescriptor
  ) => readonly PulseForgeToolScope[];
  onAuthorizationRequired?: (details: {
    providerName: string;
    providerDisplayName: string;
    authUrl: string;
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
