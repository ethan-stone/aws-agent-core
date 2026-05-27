import test from "node:test";
import assert from "node:assert/strict";
import {
  AgentMemoryProjection,
  getLongTermRetrievalConfig,
} from "./agent-memory-projection.js";
import { InMemorySnapshotStorage } from "./agentcore-snapshot-storage.js";
import type { RuntimeConfig } from "./runtime-config.js";

test("AgentMemoryProjection creates a session manager plugin for short-term memory", async () => {
  const projection = new AgentMemoryProjection({
    runtimeConfig: createRuntimeConfig({ memoryId: undefined }),
    localSnapshotStorage: new InMemorySnapshotStorage(),
  });

  const prepared = await projection.prepare({
    actorId: "user-123",
    sessionId: "session-123",
  });

  assert.equal(prepared.plugins.length, 1);
  assert.equal(prepared.plugins[0]?.name, "strands:session-manager");
});

test("AgentMemoryProjection adds long-term memory plugin when AgentCore memory is configured", async () => {
  const projection = new AgentMemoryProjection({
    runtimeConfig: createRuntimeConfig({ memoryId: "memory-123" }),
    memoryClient: { send: async () => ({}) } as never,
    localSnapshotStorage: new InMemorySnapshotStorage(),
  });

  const prepared = await projection.prepare({
    actorId: "user-123",
    sessionId: "session-123",
  });

  assert.deepEqual(
    prepared.plugins.map((plugin) => plugin.name),
    ["strands:session-manager", "pulseforge:agentcore-long-term-memory"]
  );
});

test("AgentMemoryProjection skips long-term memory plugin when disabled", async () => {
  const projection = new AgentMemoryProjection({
    runtimeConfig: createRuntimeConfig({
      memoryId: "memory-123",
      longTermMemoryEnabled: false,
    }),
    memoryClient: { send: async () => ({}) } as never,
    localSnapshotStorage: new InMemorySnapshotStorage(),
  });

  const prepared = await projection.prepare({
    actorId: "user-123",
    sessionId: "session-123",
  });

  assert.deepEqual(
    prepared.plugins.map((plugin) => plugin.name),
    ["strands:session-manager"]
  );
});

test("getLongTermRetrievalConfig follows runtime config", () => {
  assert.deepEqual(
    getLongTermRetrievalConfig({ longTermMemoryEnabled: false }),
    {}
  );
  assert.deepEqual(
    Object.keys(getLongTermRetrievalConfig({ longTermMemoryEnabled: true })),
    [
      "/preferences/{actorId}/",
      "/facts/{actorId}/",
      "/summaries/{actorId}/{sessionId}/",
    ]
  );
});

function createRuntimeConfig(options: {
  memoryId?: string;
  longTermMemoryEnabled?: boolean;
}): RuntimeConfig {
  return {
    runtimeEnv: "local",
    memoryId: options.memoryId,
    awsRegion: "us-east-1",
    longTermMemoryEnabled: options.longTermMemoryEnabled ?? true,
    longTermMemoryContextTag: "agentcore-memory-context",
    tools: {
      enabled: false,
      reason: "not needed in tests",
    },
  };
}
