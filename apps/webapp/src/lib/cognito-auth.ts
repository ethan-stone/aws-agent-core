import {
  CognitoIdentityProviderClient,
  ConfirmSignUpCommand,
  InitiateAuthCommand,
  ResendConfirmationCodeCommand,
  SignUpCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import type { ApiAuthConfig } from "../../../../shared/pulseforge-domain/src/index.js";
import type { StoredAuthSession } from "./auth-storage.js";

function requireCognitoConfig(config: ApiAuthConfig) {
  if (
    !config.enabled ||
    config.provider !== "cognito" ||
    !config.region ||
    !config.userPoolClientId
  ) {
    throw new Error("Cognito auth is not configured");
  }
}

function createClient(config: ApiAuthConfig) {
  requireCognitoConfig(config);

  return new CognitoIdentityProviderClient({
    region: config.region,
  });
}

function decodeJwtPayload(token?: string) {
  if (!token) {
    return null;
  }

  const [, payload] = token.split(".");
  if (!payload) {
    return null;
  }

  try {
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as {
      exp?: number;
      email?: string;
    };
  } catch {
    return null;
  }
}

function toStoredSession(authenticationResult: {
  AccessToken?: string;
  IdToken?: string;
  RefreshToken?: string;
}): StoredAuthSession {
  if (!authenticationResult.AccessToken) {
    throw new Error("Cognito did not return an access token");
  }

  const payload = decodeJwtPayload(authenticationResult.IdToken);
  const accessPayload = decodeJwtPayload(authenticationResult.AccessToken);
  const expiresAt = new Date(
    ((payload?.exp ?? accessPayload?.exp ?? 0) * 1000) || Date.now()
  ).toISOString();

  return {
    accessToken: authenticationResult.AccessToken,
    idToken: authenticationResult.IdToken,
    refreshToken: authenticationResult.RefreshToken,
    expiresAt,
    email: payload?.email,
  };
}

export async function signUpWithCognito(
  config: ApiAuthConfig,
  email: string,
  password: string
) {
  const client = createClient(config);
  const command = new SignUpCommand({
    ClientId: config.userPoolClientId,
    Username: email,
    Password: password,
    UserAttributes: [{ Name: "email", Value: email }],
  });

  const response = await client.send(command);
  return {
    userConfirmed: response.UserConfirmed ?? false,
  };
}

export async function confirmSignUpWithCognito(
  config: ApiAuthConfig,
  email: string,
  code: string
) {
  const client = createClient(config);
  await client.send(
    new ConfirmSignUpCommand({
      ClientId: config.userPoolClientId,
      Username: email,
      ConfirmationCode: code,
    })
  );
}

export async function resendConfirmationCode(
  config: ApiAuthConfig,
  email: string
) {
  const client = createClient(config);
  await client.send(
    new ResendConfirmationCodeCommand({
      ClientId: config.userPoolClientId,
      Username: email,
    })
  );
}

export async function signInWithCognito(
  config: ApiAuthConfig,
  email: string,
  password: string
) {
  const client = createClient(config);
  const response = await client.send(
    new InitiateAuthCommand({
      ClientId: config.userPoolClientId,
      AuthFlow: "USER_PASSWORD_AUTH",
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password,
      },
    })
  );

  if (response.ChallengeName) {
    throw new Error(`Unsupported Cognito challenge: ${response.ChallengeName}`);
  }

  if (!response.AuthenticationResult) {
    throw new Error("Cognito did not return an authentication result");
  }

  return toStoredSession(response.AuthenticationResult);
}
