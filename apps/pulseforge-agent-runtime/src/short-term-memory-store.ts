import { createHash } from "node:crypto";
import {
  CreateEventCommand,
  DeleteEventCommand,
  ListEventsCommand,
  type BedrockAgentCoreClient,
  type Event,
  type MetadataValue,
  type PayloadType,
} from "@aws-sdk/client-bedrock-agentcore";
import { Message } from "@strands-agents/sdk";

const MANAGED_EVENT_KIND = "pulseforge-short-term-message";
const MANAGED_EVENT_VERSION = "1";
const EVENT_KIND_METADATA_KEY = "pulseforge:event-kind";
const EVENT_VERSION_METADATA_KEY = "pulseforge:event-version";
const MESSAGE_KEY_METADATA_KEY = "pulseforge:message-key";
const MESSAGE_ORDER_METADATA_KEY = "pulseforge:message-order";

export interface ShortTermMemoryStore {
  loadMessages(sessionId: string): Promise<Message[]>;
  saveMessages(sessionId: string, messages: Message[]): Promise<void>;
}

export type StoredConversationMessage = {
  key: string;
  order: number;
  role: "user" | "assistant";
  text: string;
};

type ExistingManagedMessage = StoredConversationMessage & {
  eventId: string;
};

type ExistingEventClassification = {
  loadableMessages: StoredConversationMessage[];
  managedMessages: ExistingManagedMessage[];
  deleteEventIds: string[];
};

type ParsedEventMetadata = {
  kind?: string;
  version?: string;
  key?: string;
  order?: number;
};

type DedupedManagedMessages = {
  messages: ExistingManagedMessage[];
  duplicateEventIds: string[];
};

export class AgentCoreEventSessionStore implements ShortTermMemoryStore {
  private readonly client: BedrockAgentCoreClient;
  private readonly memoryId: string;
  private readonly actorId: string;

  constructor(config: {
    client: BedrockAgentCoreClient;
    memoryId: string;
    actorId: string;
  }) {
    this.client = config.client;
    this.memoryId = config.memoryId;
    this.actorId = config.actorId;
  }

  async loadMessages(sessionId: string): Promise<Message[]> {
    const events = await this.listSessionEvents(sessionId);
    const classifications = events.map((event) => classifyEvent(event));

    const managedMessages = classifications.flatMap(
      (classification) => classification.managedMessages
    );
    const loadableMessages =
      managedMessages.length > 0
        ? managedMessages
        : classifications.flatMap((classification) => classification.loadableMessages);

    return loadableMessages
      .sort(compareStoredMessages)
      .map((message) => storedConversationMessageToMessage(message));
  }

  async saveMessages(sessionId: string, messages: Message[]): Promise<void> {
    const existingEvents = await this.listSessionEvents(sessionId);
    const desiredMessages = serializeMessages(messages);
    const classifications = existingEvents.map((event) => classifyEvent(event));

    const dedupedManaged = dedupeManagedMessages(
      classifications.flatMap((classification) => classification.managedMessages)
    );
    const existingManaged = dedupedManaged.messages;
    const desiredKeys = new Set(desiredMessages.map((message) => message.key));
    const existingKeys = new Set(existingManaged.map((message) => message.key));

    const deleteEventIds = new Set(
      classifications.flatMap((classification) => classification.deleteEventIds)
    );
    for (const eventId of dedupedManaged.duplicateEventIds) {
      deleteEventIds.add(eventId);
    }

    for (const managedMessage of existingManaged) {
      if (!desiredKeys.has(managedMessage.key)) {
        deleteEventIds.add(managedMessage.eventId);
      }
    }

    const createMessages = desiredMessages.filter(
      (message) => !existingKeys.has(message.key)
    );

    for (const message of createMessages) {
      await this.client.send(
        new CreateEventCommand({
          memoryId: this.memoryId,
          actorId: this.actorId,
          sessionId,
          eventTimestamp: new Date(),
          payload: [
            {
              conversational: {
                role: message.role === "user" ? "USER" : "ASSISTANT",
                content: { text: message.text },
              },
            } satisfies PayloadType,
          ],
          metadata: buildManagedMetadata(message),
        })
      );
    }

    for (const eventId of deleteEventIds) {
      await this.client.send(
        new DeleteEventCommand({
          memoryId: this.memoryId,
          actorId: this.actorId,
          sessionId,
          eventId,
        })
      );
    }
  }

  private async listSessionEvents(sessionId: string): Promise<Event[]> {
    const events: Event[] = [];
    let nextToken: string | undefined;

    do {
      const response = await this.client.send(
        new ListEventsCommand({
          memoryId: this.memoryId,
          actorId: this.actorId,
          sessionId,
          includePayloads: true,
          nextToken,
        })
      );

      events.push(...(response.events ?? []));
      nextToken = response.nextToken;
    } while (nextToken);

    return events;
  }
}

export class InMemoryShortTermMemoryStore implements ShortTermMemoryStore {
  private readonly conversations = new Map<string, StoredConversationMessage[]>();

  async loadMessages(sessionId: string): Promise<Message[]> {
    return (this.conversations.get(sessionId) ?? []).map((message) =>
      storedConversationMessageToMessage(message)
    );
  }

  async saveMessages(sessionId: string, messages: Message[]): Promise<void> {
    this.conversations.set(sessionId, serializeMessages(messages));
  }
}

export function serializeMessages(messages: Message[]): StoredConversationMessage[] {
  const duplicateCounter = new Map<string, number>();

  return messages
    .map((message) => {
      const text = extractTextContent(message);
      if (!text) {
        return null;
      }

      const signature = createHash("sha256")
        .update(JSON.stringify({ role: message.role, text }))
        .digest("hex");
      const occurrence = duplicateCounter.get(signature) ?? 0;
      duplicateCounter.set(signature, occurrence + 1);

      return {
        key: `${signature}:${occurrence}`,
        order: 0,
        role: message.role,
        text,
      } satisfies StoredConversationMessage;
    })
    .filter((message): message is StoredConversationMessage => message !== null)
    .map((message, index) => ({
      ...message,
      order: index,
    }));
}

export function storedConversationMessageToMessage(
  message: Pick<StoredConversationMessage, "role" | "text">
): Message {
  return Message.fromMessageData({
    role: message.role,
    content: [{ text: message.text }],
  });
}

export function classifyEvent(event: Event): ExistingEventClassification {
  const eventId = event.eventId;
  if (!eventId) {
    return {
      loadableMessages: [],
      managedMessages: [],
      deleteEventIds: [],
    };
  }

  const metadata = parseEventMetadata(event.metadata);
  const managedClassification = classifyManagedEvent(event, eventId, metadata);
  if (managedClassification) {
    return managedClassification;
  }

  const legacyMessages = extractLegacyMessages(event);
  return {
    loadableMessages: legacyMessages,
    managedMessages: [],
    deleteEventIds: legacyMessages.length > 0 ? [eventId] : [],
  };
}

function classifyManagedEvent(
  event: Event,
  eventId: string,
  metadata: ParsedEventMetadata
): ExistingEventClassification | null {
  if (metadata.kind !== MANAGED_EVENT_KIND) {
    return null;
  }

  if (
    metadata.version !== MANAGED_EVENT_VERSION ||
    typeof metadata.key !== "string" ||
    typeof metadata.order !== "number"
  ) {
    console.warn("[memory] ignoring malformed managed event metadata", {
      eventId,
      metadata,
    });
    return {
      loadableMessages: [],
      managedMessages: [],
      deleteEventIds: [eventId],
    };
  }

  const [payload] = event.payload ?? [];
  const text = getConversationalText(payload);
  const role = getConversationalRole(payload);
  if (!text || !role) {
    console.warn("[memory] ignoring malformed managed event payload", {
      eventId,
      payloadCount: event.payload?.length ?? 0,
    });
    return {
      loadableMessages: [],
      managedMessages: [],
      deleteEventIds: [eventId],
    };
  }

  const managedMessage: ExistingManagedMessage = {
    eventId,
    key: metadata.key,
    order: metadata.order,
    role,
    text,
  };

  return {
    loadableMessages: [managedMessage],
    managedMessages: [managedMessage],
    deleteEventIds: [],
  };
}

function extractLegacyMessages(event: Event): StoredConversationMessage[] {
  const eventTimestamp = event.eventTimestamp?.getTime() ?? 0;

  return (event.payload ?? [])
    .map((payload, payloadIndex) => {
      const text = getConversationalText(payload);
      const role = getConversationalRole(payload);
      if (!text || !role) {
        return null;
      }

      return {
        key: `legacy:${event.eventId ?? "unknown"}:${payloadIndex}`,
        order: eventTimestamp * 1_000 + payloadIndex,
        role,
        text,
      } satisfies StoredConversationMessage;
    })
    .filter((message): message is StoredConversationMessage => message !== null);
}

function buildManagedMetadata(
  message: StoredConversationMessage
): Record<string, MetadataValue> {
  return {
    [EVENT_KIND_METADATA_KEY]: { stringValue: MANAGED_EVENT_KIND },
    [EVENT_VERSION_METADATA_KEY]: { stringValue: MANAGED_EVENT_VERSION },
    [MESSAGE_KEY_METADATA_KEY]: { stringValue: message.key },
    [MESSAGE_ORDER_METADATA_KEY]: { stringValue: String(message.order) },
  };
}

function parseEventMetadata(
  metadata: Record<string, MetadataValue> | undefined
): ParsedEventMetadata {
  const kind = getMetadataString(metadata, EVENT_KIND_METADATA_KEY);
  const version = getMetadataString(metadata, EVENT_VERSION_METADATA_KEY);
  const key = getMetadataString(metadata, MESSAGE_KEY_METADATA_KEY);
  const orderRaw = getMetadataString(metadata, MESSAGE_ORDER_METADATA_KEY);
  const order =
    typeof orderRaw === "string" && Number.isInteger(Number(orderRaw))
      ? Number(orderRaw)
      : undefined;

  return { kind, version, key, order };
}

function getMetadataString(
  metadata: Record<string, MetadataValue> | undefined,
  key: string
): string | undefined {
  const value = metadata?.[key];
  if (!value || !("stringValue" in value)) {
    return undefined;
  }

  return value.stringValue;
}

function getConversationalText(payload: PayloadType | undefined): string | null {
  if (!payload || !("conversational" in payload) || !payload.conversational) {
    return null;
  }

  const content = payload.conversational.content;
  if (!content || !("text" in content) || typeof content.text !== "string") {
    return null;
  }

  const text = content.text.trim();
  return text.length > 0 ? text : null;
}

function getConversationalRole(
  payload: PayloadType | undefined
): "user" | "assistant" | null {
  if (!payload || !("conversational" in payload) || !payload.conversational) {
    return null;
  }

  const role = payload.conversational.role;
  if (role === "USER") {
    return "user";
  }

  if (role === "ASSISTANT") {
    return "assistant";
  }

  return null;
}

function extractTextContent(message: Message): string | null {
  const textParts: string[] = [];

  for (const block of message.content) {
    if (block.type === "textBlock") {
      const text = block.text.trim();
      if (text) {
        textParts.push(text);
      }
    }
  }

  const text = textParts.join("\n");

  return text.length > 0 ? text : null;
}

function dedupeManagedMessages(
  messages: ExistingManagedMessage[]
): DedupedManagedMessages {
  const seenKeys = new Set<string>();
  const duplicateEventIds: string[] = [];
  const deduped: ExistingManagedMessage[] = [];

  for (const message of messages.sort(compareStoredMessages)) {
    if (seenKeys.has(message.key)) {
      duplicateEventIds.push(message.eventId);
      continue;
    }

    seenKeys.add(message.key);
    deduped.push(message);
  }

  return {
    messages: deduped,
    duplicateEventIds,
  };
}

function compareStoredMessages(
  left: Pick<StoredConversationMessage, "order" | "key">,
  right: Pick<StoredConversationMessage, "order" | "key">
): number {
  if (left.order !== right.order) {
    return left.order - right.order;
  }

  return left.key.localeCompare(right.key);
}
