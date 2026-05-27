import test from "node:test";
import assert from "node:assert/strict";
import type {
  CreateEventCommandInput,
  DeleteEventCommandInput,
  Event,
  ListEventsCommandOutput,
  PayloadType,
} from "@aws-sdk/client-bedrock-agentcore";
import type { Snapshot, SnapshotLocation } from "@strands-agents/sdk";
import {
  AgentCoreSnapshotStorage,
  InMemorySnapshotStorage,
} from "./agentcore-snapshot-storage.js";

const location = {
  sessionId: "session-123",
  scope: "agent",
  scopeId: "pulseforge-ops-copilot",
} satisfies SnapshotLocation;

test("AgentCoreSnapshotStorage saves and loads latest snapshots", async () => {
  const snapshot = createSnapshot("first");
  const client = new MockBedrockAgentCoreClient([
    { events: [], $metadata: {} },
    {
      events: [
        createSnapshotEvent({
          eventId: "latest-1",
          timestamp: new Date("2026-04-21T10:00:00.000Z"),
          location,
          snapshotId: "latest",
          isLatest: true,
          snapshot,
        }),
      ],
      $metadata: {},
    },
  ]);
  const storage = new AgentCoreSnapshotStorage({
    client: client.asClient() as never,
    memoryId: "memory-123",
    actorId: "user-123",
  });

  await storage.saveSnapshot({
    location,
    snapshotId: "latest",
    isLatest: true,
    snapshot,
  });
  const loaded = await storage.loadSnapshot({ location });

  assert.deepEqual(loaded, snapshot);
  assert.equal(client.createdEvents.length, 1);
  assert.equal(client.createdEvents[0]?.sessionId, "session-123");
  assert.deepEqual(client.createdEvents[0]?.payload?.[0], {
    blob: { snapshot },
  });
});

test("AgentCoreSnapshotStorage replaces stale latest snapshots", async () => {
  const stale = createSnapshot("stale");
  const fresh = createSnapshot("fresh");
  const client = new MockBedrockAgentCoreClient([
    {
      events: [
        createSnapshotEvent({
          eventId: "latest-stale",
          timestamp: new Date("2026-04-21T09:00:00.000Z"),
          location,
          snapshotId: "latest",
          isLatest: true,
          snapshot: stale,
        }),
      ],
      $metadata: {},
    },
  ]);
  const storage = new AgentCoreSnapshotStorage({
    client: client.asClient() as never,
    memoryId: "memory-123",
    actorId: "user-123",
  });

  await storage.saveSnapshot({
    location,
    snapshotId: "latest",
    isLatest: true,
    snapshot: fresh,
  });

  assert.equal(client.createdEvents.length, 1);
  assert.deepEqual(client.deletedEvents, ["latest-stale"]);
});

test("AgentCoreSnapshotStorage lists immutable snapshot ids", async () => {
  const response = {
    events: [
      createSnapshotEvent({
        eventId: "latest",
        timestamp: new Date("2026-04-21T09:00:00.000Z"),
        location,
        snapshotId: "latest",
        isLatest: true,
        snapshot: createSnapshot("latest"),
      }),
      createSnapshotEvent({
        eventId: "immutable-b",
        timestamp: new Date("2026-04-21T10:00:00.000Z"),
        location,
        snapshotId: "b",
        isLatest: false,
        snapshot: createSnapshot("b"),
      }),
      createSnapshotEvent({
        eventId: "immutable-a",
        timestamp: new Date("2026-04-21T10:00:00.000Z"),
        location,
        snapshotId: "a",
        isLatest: false,
        snapshot: createSnapshot("a"),
      }),
    ],
    $metadata: {},
  };
  const client = new MockBedrockAgentCoreClient([response, response]);
  const storage = new AgentCoreSnapshotStorage({
    client: client.asClient() as never,
    memoryId: "memory-123",
    actorId: "user-123",
  });

  assert.deepEqual(await storage.listSnapshotIds({ location }), ["a", "b"]);
  assert.deepEqual(await storage.listSnapshotIds({ location, startAfter: "a" }), [
    "b",
  ]);
});

test("InMemorySnapshotStorage round-trips latest snapshots", async () => {
  const storage = new InMemorySnapshotStorage();
  const snapshot = createSnapshot("local");

  await storage.saveSnapshot({
    location,
    snapshotId: "latest",
    isLatest: true,
    snapshot,
  });

  assert.deepEqual(await storage.loadSnapshot({ location }), snapshot);
});

class MockBedrockAgentCoreClient {
  readonly createdEvents: CreateEventCommandInput[] = [];
  readonly deletedEvents: string[] = [];
  private readonly listResponses: ListEventsCommandOutput[];

  constructor(listResponses: ListEventsCommandOutput[]) {
    this.listResponses = [...listResponses];
  }

  asClient() {
    return this as unknown as {
      send(command: unknown): Promise<unknown>;
    };
  }

  async send(command: unknown): Promise<unknown> {
    const commandName = (command as { constructor: { name: string } }).constructor
      .name;
    const input = (command as { input: Record<string, unknown> }).input;

    if (commandName === "ListEventsCommand") {
      return this.listResponses.shift() ?? { events: [] };
    }

    if (commandName === "CreateEventCommand") {
      this.createdEvents.push(input as unknown as CreateEventCommandInput);
      return {};
    }

    if (commandName === "DeleteEventCommand") {
      this.deletedEvents.push(
        (input as unknown as DeleteEventCommandInput).eventId ?? ""
      );
      return {};
    }

    throw new Error(`Unsupported command: ${commandName}`);
  }
}

function createSnapshot(label: string): Snapshot {
  return {
    scope: "agent",
    schemaVersion: "1.0",
    createdAt: "2026-04-21T10:00:00.000Z",
    data: {
      messages: [
        {
          role: "user",
          content: [{ text: label }],
        },
      ],
    },
    appData: {},
  };
}

function createSnapshotEvent(params: {
  eventId: string;
  timestamp: Date;
  location: SnapshotLocation;
  snapshotId: string;
  isLatest: boolean;
  snapshot: Snapshot;
}): Event {
  return {
    memoryId: "memory-123",
    actorId: "user-123",
    sessionId: params.location.sessionId,
    eventId: params.eventId,
    eventTimestamp: params.timestamp,
    payload: [
      {
        blob: {
          snapshot: params.snapshot as unknown as PayloadType.BlobMember["blob"],
        },
      },
    ],
    metadata: {
      "pulseforge:event-kind": {
        stringValue: "pulseforge-strands-session-snapshot",
      },
      "pulseforge:event-version": { stringValue: "1" },
      "pulseforge:snapshot-id": { stringValue: params.snapshotId },
      "pulseforge:snapshot-is-latest": {
        stringValue: params.isLatest ? "true" : "false",
      },
      "pulseforge:snapshot-scope": { stringValue: params.location.scope },
      "pulseforge:snapshot-scope-id": { stringValue: params.location.scopeId },
    },
  };
}
