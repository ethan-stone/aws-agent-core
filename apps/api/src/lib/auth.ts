import { CognitoJwtVerifier } from "aws-jwt-verify";
import type { JwtPayload } from "aws-jwt-verify/jwt-model";
import type {
  ApiAuthConfig,
  AuthenticatedAppUser,
} from "../../../../shared/pulseforge-domain/src/index.js";

function getConfiguredRegion() {
  return process.env.COGNITO_REGION ?? process.env.COGNITO_USER_POOL_ID?.split("_")[0];
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

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function toAuthenticatedUser(payload: JwtPayload): AuthenticatedAppUser {
  return {
    sub: asString(payload.sub) ?? "",
    username:
      asString(payload.username) ??
      asString(payload["cognito:username"]) ??
      asString(payload.client_id) ??
      "unknown",
    email: asString(payload.email),
    groups: asStringArray(payload["cognito:groups"]),
  };
}

export async function verifyAccessToken(token: string) {
  const payload = await getAccessTokenVerifier().verify(token);
  return toAuthenticatedUser(payload);
}

export function resetAuthVerifierForTests() {
  accessTokenVerifier = null;
}
