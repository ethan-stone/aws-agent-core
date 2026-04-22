import test from "node:test";
import assert from "node:assert/strict";
import type {
  CreateEventCommandInput,
  DeleteEventCommandInput,
  Event,
  ListEventsCommandOutput,
  MetadataValue,
} from "@aws-sdk/client-bedrock-agentcore";
import { Message } from "@strands-agents/sdk";
import {
  AgentCoreEventSessionStore,
  classifyEvent,
  serializeMessages,
  storedConversationMessageToMessage,
} from "./short-term-memory-store.js";

test("serializeMessages round-trips text messages in order", () => {
  const messages = [
    Message.fromMessageData({ role: "user", content: [{ text: "hello" }] }),
    Message.fromMessageData({
      role: "assistant",
      content: [{ text: "status nominal" }],
    }),
  ];

  const stored = serializeMessages(messages);

  assert.equal(stored.length, 2);
  assert.deepEqual(stored.map((message) => message.order), [0, 1]);
  assert.deepEqual(
    stored.map((message) => storedConversationMessageToMessage(message).toJSON()),
    messages.map((message) => message.toJSON())
  );
});

test("classifyEvent migrates legacy conversational events", () => {
  const event = createLegacyEvent({
    eventId: "event-legacy",
    timestamp: new Date("2026-04-21T10:00:00.000Z"),
    payloads: [
      { role: "USER", text: "hello" },
      { role: "ASSISTANT", text: "hi there" },
    ],
  });

  const classification = classifyEvent(event);

  assert.equal(classification.managedMessages.length, 0);
  assert.equal(classification.loadableMessages.length, 2);
  assert.deepEqual(classification.deleteEventIds, ["event-legacy"]);
});

test("loadMessages prefers managed canonical events over legacy events", async () => {
  const client = new MockBedrockAgentCoreClient([
    {
      events: [
        createLegacyEvent({
          eventId: "legacy-1",
          timestamp: new Date("2026-04-21T09:00:00.000Z"),
          payloads: [{ role: "USER", text: "legacy question" }],
        }),
        createManagedEvent({
          eventId: "managed-2",
          timestamp: new Date("2026-04-21T10:00:00.000Z"),
          role: "ASSISTANT",
          text: "second",
          key: "key-2",
          order: 1,
        }),
        createManagedEvent({
          eventId: "managed-1",
          timestamp: new Date("2026-04-21T10:00:00.000Z"),
          role: "USER",
          text: "first",
          key: "key-1",
          order: 0,
        }),
      ],
      $metadata: {},
    },
  ]);

  const store = new AgentCoreEventSessionStore({
    client: client.asClient() as never,
    memoryId: "memory-123",
    actorId: "user-123",
  });

  const messages = await store.loadMessages("session-123");

  assert.deepEqual(
    messages.map((message) => message.toJSON()),
    [
      { role: "user", content: [{ text: "first" }] },
      { role: "assistant", content: [{ text: "second" }] },
    ]
  );
});

test("saveMessages does not create duplicates when canonical state is unchanged", async () => {
  const existingMessages = [
    Message.fromMessageData({ role: "user", content: [{ text: "first" }] }),
    Message.fromMessageData({
      role: "assistant",
      content: [{ text: "second" }],
    }),
  ];
  const stored = serializeMessages(existingMessages);

  const client = new MockBedrockAgentCoreClient([
    {
      events: stored.map((message) =>
        createManagedEvent({
          eventId: `event-${message.order}`,
          timestamp: new Date("2026-04-21T10:00:00.000Z"),
          role: message.role === "user" ? "USER" : "ASSISTANT",
          text: message.text,
          key: message.key,
          order: message.order,
        })
      ),
      $metadata: {},
    },
  ]);

  const store = new AgentCoreEventSessionStore({
    client: client.asClient() as never,
    memoryId: "memory-123",
    actorId: "user-123",
  });

  await store.saveMessages("session-123", existingMessages);

  assert.equal(client.createdEvents.length, 0);
  assert.equal(client.deletedEvents.length, 0);
});

test("saveMessages replaces legacy or stale events with canonical managed events", async () => {
  const client = new MockBedrockAgentCoreClient([
    {
      events: [
        createLegacyEvent({
          eventId: "legacy-1",
          timestamp: new Date("2026-04-21T09:00:00.000Z"),
          payloads: [
            { role: "USER", text: "old question" },
            { role: "ASSISTANT", text: "old answer" },
          ],
        }),
        createManagedEvent({
          eventId: "managed-stale",
          timestamp: new Date("2026-04-21T10:00:00.000Z"),
          role: "ASSISTANT",
          text: "stale",
          key: "stale-key",
          order: 0,
        }),
      ],
      $metadata: {},
    },
  ]);

  const store = new AgentCoreEventSessionStore({
    client: client.asClient() as never,
    memoryId: "memory-123",
    actorId: "user-123",
  });

  await store.saveMessages("session-123", [
    Message.fromMessageData({
      role: "assistant",
      content: [{ text: "fresh canonical answer" }],
    }),
  ]);

  assert.equal(client.createdEvents.length, 1);
  assert.equal(client.createdEvents[0]?.actorId, "user-123");
  assert.equal(client.createdEvents[0]?.sessionId, "session-123");
  assert.equal(client.createdEvents[0]?.payload?.length, 1);
  assert.deepEqual(
    [...client.deletedEvents].sort(),
    ["legacy-1", "managed-stale"]
  );
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

function createManagedEvent(params: {
  eventId: string;
  timestamp: Date;
  role: "USER" | "ASSISTANT";
  text: string;
  key: string;
  order: number;
}): Event {
  return {
    memoryId: "memory-123",
    actorId: "user-123",
    sessionId: "session-123",
    eventId: params.eventId,
    eventTimestamp: params.timestamp,
    payload: [
      {
        conversational: {
          role: params.role,
          content: { text: params.text },
        },
      },
    ],
    metadata: managedMetadata(params.key, params.order),
  };
}

function createLegacyEvent(params: {
  eventId: string;
  timestamp: Date;
  payloads: Array<{ role: "USER" | "ASSISTANT"; text: string }>;
}): Event {
  return {
    memoryId: "memory-123",
    actorId: "user-123",
    sessionId: "session-123",
    eventId: params.eventId,
    eventTimestamp: params.timestamp,
    payload: params.payloads.map((payload) => ({
      conversational: {
        role: payload.role,
        content: { text: payload.text },
      },
    })),
  };
}

function managedMetadata(
  key: string,
  order: number
): Record<string, MetadataValue> {
  return {
    "pulseforge:event-kind": { stringValue: "pulseforge-short-term-message" },
    "pulseforge:event-version": { stringValue: "1" },
    "pulseforge:message-key": { stringValue: key },
    "pulseforge:message-order": { stringValue: String(order) },
  };
}
