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

  it("persists agent-created incident records and audit logs", async () => {
    const actor = {
      actorType: "agent" as const,
      actorId: "tools-client-123",
      onBehalfOfUserId: "user-123",
      agentRunId: "run-1",
    };

    const event = await repository.createIncidentEvent({
      incidentId: "inc-1001",
      kind: "agent_summary",
      message: "Agent reviewed the temperature drift incident.",
      createdBy: actor,
    });
    const ticket = await repository.createTicket({
      incidentId: "inc-1001",
      assigneeTeam: "Field Reliability",
      createdBy: actor,
    });
    const action = await repository.createRemediationAction({
      incidentId: "inc-1001",
      type: "rollback-firmware",
      risk: "medium",
      summary: "Rollback affected devices to the previous firmware.",
      createdBy: actor,
    });
    const auditLog = await repository.createAuditLog({
      actor,
      operation: "incident_context.read",
      method: "GET",
      path: "/tools/incidents/inc-1001/context",
      scopes: ["read:incidents", "read:devices", "read:telemetry"],
      resourceType: "incident",
      resourceId: "inc-1001",
      outcome: "succeeded",
      statusCode: 200,
    });

    expect(event.createdBy).toEqual(actor);
    expect(ticket.createdBy).toEqual(actor);
    expect(action.createdBy).toEqual(actor);
    expect(auditLog.actor).toEqual(actor);

    const snapshot = await repository.getSnapshot();
    expect(snapshot.incidentEvents.find((item) => item.id === event.id)).toBeTruthy();
    expect(snapshot.tickets.find((item) => item.id === ticket.id)).toBeTruthy();
    expect(
      snapshot.remediationActions.find((item) => item.id === action.id)
    ).toBeTruthy();
    expect(snapshot.auditLogs.find((item) => item.id === auditLog.id)).toBeTruthy();
  });
});
