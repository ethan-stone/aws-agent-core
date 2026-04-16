import { afterAll } from "vitest";
import { resetMongoClientForTests } from "../lib/mongodb.js";
import { resetRepositoryForTests } from "../services/pulseforge-service.js";

const originalMongoUri = process.env.MONGODB_URI;
const originalMongoDbName = process.env.MONGODB_DB_NAME;

afterAll(async () => {
  process.env.MONGODB_URI = originalMongoUri;
  process.env.MONGODB_DB_NAME = originalMongoDbName;
  await resetRepositoryForTests();
  await resetMongoClientForTests();
});
