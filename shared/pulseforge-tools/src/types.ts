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

export type PulseForgeAgentToolBundleName =
  | "ops-copilot"
  | "anomaly-investigation"
  | "remediation-planner"
  | "autonomous-remediation";

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
  requiredScopes: PulseForgeToolScope[];
  http: {
    method: HttpMethod;
    path: (input: z.infer<TInputSchema>) => string;
    body?: (input: z.infer<TInputSchema>) => JsonValue;
  };
}

export interface ToolAccessTokenConfig {
  providerName: string;
  scopes: PulseForgeToolScope[];
  authFlow: "USER_FEDERATION";
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
  providerName: string;
  credentialProvider: ToolCredentialProvider;
  fetch?: typeof fetch;
}
