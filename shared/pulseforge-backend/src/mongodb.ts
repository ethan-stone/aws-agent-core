import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { MongoClient } from "mongodb";

let clientPromise: Promise<MongoClient> | null = null;
let mongoUriPromise: Promise<string> | null = null;
let secretsManagerClient: SecretsManagerClient | null = null;

export function isMongoConfigured(): boolean {
  return Boolean(process.env.MONGODB_URI || process.env.PULSEFORGE_SECRETS_ARN);
}

export function getMongoDbName(): string {
  return process.env.MONGODB_DB_NAME ?? "pulseforge";
}

export async function getMongoClient(): Promise<MongoClient> {
  const mongoUri = await getMongoUri();

  if (!clientPromise) {
    const client = new MongoClient(mongoUri);
    clientPromise = client.connect();
  }

  return clientPromise;
}

async function getMongoUri(): Promise<string> {
  if (process.env.MONGODB_URI) {
    return process.env.MONGODB_URI;
  }

  const secretArn = process.env.PULSEFORGE_SECRETS_ARN;
  if (!secretArn) {
    throw new Error("MONGODB_URI or PULSEFORGE_SECRETS_ARN is not configured");
  }

  if (!mongoUriPromise) {
    mongoUriPromise = fetchMongoUriFromPulseForgeSecrets(secretArn);
  }

  return mongoUriPromise;
}

async function fetchMongoUriFromPulseForgeSecrets(
  secretArn: string
): Promise<string> {
  const response = await getSecretsManagerClient().send(
    new GetSecretValueCommand({ SecretId: secretArn })
  );

  const secretString = response.SecretString;
  if (!secretString) {
    throw new Error("PulseForge secrets must contain a SecretString value");
  }

  const parsedUri = parseMongoUriFromPulseForgeSecrets(secretString);
  if (!parsedUri) {
    throw new Error(
      "PulseForge secrets must be JSON with a mongodbUri field"
    );
  }

  return parsedUri;
}

function parseMongoUriFromPulseForgeSecrets(secretString: string): string | null {
  const trimmed = secretString.trim();
  try {
    const value = JSON.parse(trimmed) as unknown;
    if (!value || typeof value !== "object") {
      return null;
    }

    const fields = value as Record<string, unknown>;
    const uri = fields.mongodbUri;
    return typeof uri === "string" && uri.trim() ? uri.trim() : null;
  } catch {
    return null;
  }
}

function getSecretsManagerClient(): SecretsManagerClient {
  if (!secretsManagerClient) {
    secretsManagerClient = new SecretsManagerClient({
      region: process.env.AWS_REGION ?? process.env.COGNITO_REGION ?? "us-east-1",
    });
  }

  return secretsManagerClient;
}

export async function resetMongoClientForTests(): Promise<void> {
  if (!clientPromise) {
    return;
  }

  const client = await clientPromise;
  await client.close();
  clientPromise = null;
  mongoUriPromise = null;
  secretsManagerClient = null;
}
