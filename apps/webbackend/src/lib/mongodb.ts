import { MongoClient } from "mongodb";

let clientPromise: Promise<MongoClient> | null = null;

export function isMongoConfigured(): boolean {
  return Boolean(process.env.MONGODB_URI);
}

export function getMongoDbName(): string {
  return process.env.MONGODB_DB_NAME ?? "pulseforge";
}

export async function getMongoClient(): Promise<MongoClient> {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error("MONGODB_URI is not configured");
  }

  if (!clientPromise) {
    const client = new MongoClient(mongoUri);
    clientPromise = client.connect();
  }

  return clientPromise;
}

export async function resetMongoClientForTests(): Promise<void> {
  if (!clientPromise) {
    return;
  }

  const client = await clientPromise;
  await client.close();
  clientPromise = null;
}
