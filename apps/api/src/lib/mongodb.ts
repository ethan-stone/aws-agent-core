import { MongoClient } from "mongodb";

const mongoUri = process.env.MONGODB_URI;
const mongoDbName = process.env.MONGODB_DB_NAME ?? "pulseforge";

let clientPromise: Promise<MongoClient> | null = null;

export function isMongoConfigured(): boolean {
  return Boolean(mongoUri);
}

export function getMongoDbName(): string {
  return mongoDbName;
}

export async function getMongoClient(): Promise<MongoClient> {
  if (!mongoUri) {
    throw new Error("MONGODB_URI is not configured");
  }

  if (!clientPromise) {
    const client = new MongoClient(mongoUri);
    clientPromise = client.connect();
  }

  return clientPromise;
}
