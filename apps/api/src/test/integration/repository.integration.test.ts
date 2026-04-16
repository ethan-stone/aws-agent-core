import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { getMongoClient, getMongoDbName } from "../../lib/mongodb.js";
import { MongoPulseForgeRepository } from "../../repositories/mongo-repository.js";
import { canUseDocker } from "../helpers/docker.js";
import { startMongoTestProcess, type MongoTestProcess } from "../helpers/mongo.js";

const describeMongo = canUseDocker() ? describe : describe.skip;

describeMongo("MongoPulseForgeRepository", () => {
  let mongo: MongoTestProcess;
  let repository: MongoPulseForgeRepository;

  beforeAll(async () => {
    mongo = await startMongoTestProcess();
    process.env.MONGODB_URI = mongo.uri;
    process.env.MONGODB_DB_NAME = "pulseforge_repository_vitest";

    const client = await getMongoClient();
    repository = new MongoPulseForgeRepository(client, getMongoDbName());
    await repository.seedDemoData();
  });

  afterAll(async () => {
    await mongo?.stop();
  });

  it("seeds and reads devices", async () => {
    const devices = await repository.listDevices();
    expect(devices).toHaveLength(4);
    expect(devices[0]).not.toHaveProperty("_id");
  });

  it("returns telemetry snapshots without Mongo internals", async () => {
    const telemetry = await repository.getDeviceTelemetry("dev-freezer-014");
    expect(telemetry).not.toBeNull();
    expect(telemetry).toHaveLength(3);
    expect(telemetry?.[0]).not.toHaveProperty("_id");
  });

  it("returns incident aggregates without Mongo internals", async () => {
    const incident = await repository.getIncident("inc-1001");
    expect(incident?.incident).not.toHaveProperty("_id");
    expect(incident?.events[0]).not.toHaveProperty("_id");
  });
});
