import { CognitoJwtVerifier } from "aws-jwt-verify";
import type { JwtPayload } from "aws-jwt-verify/jwt-model";
import type {
  ApiAuthConfig,
  AppPermission,
  AuditActor,
  AuthenticatedAppUser,
} from "@agent-core/pulseforge-domain";

export const PULSEFORGE_BACKEND_RESOURCE_SERVER =
  process.env.COGNITO_RESOURCE_SERVER_IDENTIFIER ?? "pulseforge-backend";

export const toolScopes = {
  readDevices: "read:devices",
  readIncidents: "read:incidents",
  readTelemetry: "read:telemetry",
  writeIncidentActivities: "write:incident_events",
  writeTickets: "write:tickets",
  writeRemediationActions: "write:remediation_actions",
  writeDeviceCommands: "write:device_commands",
} as const;

export type ToolScope = (typeof toolScopes)[keyof typeof toolScopes];

export const appPermissions = {
  readDashboard: "read:dashboard",
  readDevices: "read:devices",
  readIncidents: "read:incidents",
  readTelemetry: "read:telemetry",
  writeAgentRuns: "write:agent_runs",
  writeAdmin: "write:admin",
} as const satisfies Record<string, AppPermission>;

const defaultUserPermissions: AppPermission[] = [
  appPermissions.readDashboard,
  appPermissions.readDevices,
  appPermissions.readIncidents,
  appPermissions.readTelemetry,
  appPermissions.writeAgentRuns,
];

const adminPermissions: AppPermission[] = [
  ...defaultUserPermissions,
  appPermissions.writeAdmin,
];

export interface ToolAuthContext {
  actor: AuditActor & {
    actorType: "agent";
    onBehalfOfUserId: string;
    agentRunId: string;
  };
  user: AuthenticatedAppUser;
  scopes: string[];
}

function getConfiguredRegion() {
  return process.env.COGNITO_REGION ?? process.env.COGNITO_USER_POOL_ID?.split("_")[0];
}

function parseCsv(value?: string): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseTokenScopes(value?: string): string[] {
  return (value ?? "")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getApiAuthConfig(): ApiAuthConfig {
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  const userPoolClientId = process.env.COGNITO_USER_POOL_CLIENT_ID;
  const region = getConfiguredRegion();

  if (!userPoolId || !userPoolClientId || !region) {
    return {
      enabled: false,
      provider: "none",
    };
  }

  return {
    enabled: true,
    provider: "cognito",
    region,
    userPoolId,
    userPoolClientId,
  };
}

let accessTokenVerifier:
  | ReturnType<typeof CognitoJwtVerifier.create>
  | null = null;
let toolAccessTokenVerifier:
  | ReturnType<typeof CognitoJwtVerifier.create>
  | null = null;

function getAccessTokenVerifier() {
  const config = getApiAuthConfig();

  if (!config.enabled || !config.userPoolId || !config.userPoolClientId) {
    throw new Error("Cognito auth is not configured");
  }

  if (!accessTokenVerifier) {
    accessTokenVerifier = CognitoJwtVerifier.create({
      userPoolId: config.userPoolId,
      clientId: config.userPoolClientId,
      tokenUse: "access",
    });
  }

  return accessTokenVerifier;
}

function getToolClientIds(): string[] {
  return parseCsv(process.env.COGNITO_AGENT_IDENTITY_CLIENT_IDS);
}

export function isToolAuthConfigured(): boolean {
  return Boolean(
    process.env.COGNITO_USER_POOL_ID &&
      getConfiguredRegion() &&
      getToolClientIds().length > 0
  );
}

function getToolAccessTokenVerifier() {
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  const clientIds = getToolClientIds();

  if (!userPoolId || clientIds.length === 0) {
    throw new Error("Cognito tool auth is not configured");
  }

  if (!toolAccessTokenVerifier) {
    toolAccessTokenVerifier = CognitoJwtVerifier.create({
      userPoolId,
      clientId: clientIds,
      tokenUse: "access",
    });
  }

  return toolAccessTokenVerifier;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function getTokenScopes(payload: JwtPayload): string[] {
  return parseTokenScopes(asString(payload.scope));
}

function normalizeScope(scope: string): string {
  const prefix = `${PULSEFORGE_BACKEND_RESOURCE_SERVER}/`;
  return scope.startsWith(prefix) ? scope.slice(prefix.length) : scope;
}

function getAppPermissions(groups: string[]): AppPermission[] {
  return groups.includes("admin") ? adminPermissions : defaultUserPermissions;
}

function toAuthenticatedUser(payload: JwtPayload): AuthenticatedAppUser {
  const scopes = getTokenScopes(payload);
  const groups = asStringArray(payload["cognito:groups"]);

  return {
    sub: asString(payload.sub) ?? "",
    username:
      asString(payload.username) ??
      asString(payload["cognito:username"]) ??
      asString(payload.client_id) ??
      "unknown",
    email: asString(payload.email),
    groups,
    clientId: asString(payload.client_id),
    scopes: scopes.map(normalizeScope),
    permissions: getAppPermissions(groups),
  };
}

export async function verifyAccessToken(token: string) {
  const payload = await getAccessTokenVerifier().verify(token);
  return toAuthenticatedUser(payload);
}

export async function verifyToolAccessToken(
  token: string,
  agentRunId: string,
  requiredScopes: ToolScope[]
): Promise<ToolAuthContext> {
  const payload = await getToolAccessTokenVerifier().verify(token);
  const user = toAuthenticatedUser(payload);
  const clientId = user.clientId;

  if (!clientId) {
    throw new Error("Tool token is missing client_id");
  }

  if (!user.sub) {
    throw new Error("Tool token is missing user subject");
  }

  const scopeSet = new Set(user.scopes);
  const missingScopes = requiredScopes.filter((scope) => !scopeSet.has(scope));
  if (missingScopes.length > 0) {
    throw new Error(`Missing required scopes: ${missingScopes.join(", ")}`);
  }

  return {
    actor: {
      actorType: "agent",
      actorId: clientId,
      onBehalfOfUserId: user.sub,
      agentRunId,
    },
    user,
    scopes: user.scopes,
  };
}

export function resetAuthVerifierForTests() {
  accessTokenVerifier = null;
  toolAccessTokenVerifier = null;
}
