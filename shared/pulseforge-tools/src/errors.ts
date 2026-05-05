import type { PulseForgeToolScope } from "./types.js";

export interface ToolAuthorizationRequiredDetails {
  providerName: string;
  authUrl: string;
  scopes: PulseForgeToolScope[];
  agentRunId: string;
}

export class ToolAuthorizationRequiredError extends Error {
  readonly providerName: string;
  readonly authUrl: string;
  readonly scopes: PulseForgeToolScope[];
  readonly agentRunId: string;

  constructor(details: ToolAuthorizationRequiredDetails) {
    super("Tool authorization is required before the agent can continue.");
    this.name = "ToolAuthorizationRequiredError";
    this.providerName = details.providerName;
    this.authUrl = details.authUrl;
    this.scopes = details.scopes;
    this.agentRunId = details.agentRunId;
  }
}
