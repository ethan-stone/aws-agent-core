import {
  CreateEventCommand,
  DeleteEventCommand,
  ListEventsCommand,
  type BedrockAgentCoreClient,
  type Event,
  type MetadataValue,
  type PayloadType,
} from "@aws-sdk/client-bedrock-agentcore";
import type {
  Scope,
  Snapshot,
  SnapshotManifest,
  SnapshotLocation,
  SnapshotStorage,
} from "@strands-agents/sdk";

const SNAPSHOT_EVENT_KIND = "pulseforge-strands-session-snapshot";
const SNAPSHOT_EVENT_VERSION = "1";
const EVENT_KIND_METADATA_KEY = "pulseforge:event-kind";
const EVENT_VERSION_METADATA_KEY = "pulseforge:event-version";
const SNAPSHOT_ID_METADATA_KEY = "pulseforge:snapshot-id";
const SNAPSHOT_IS_LATEST_METADATA_KEY = "pulseforge:snapshot-is-latest";
const SNAPSHOT_SCOPE_METADATA_KEY = "pulseforge:snapshot-scope";
const SNAPSHOT_SCOPE_ID_METADATA_KEY = "pulseforge:snapshot-scope-id";
const MANIFEST_SNAPSHOT_ID = "manifest";

export class AgentCoreSnapshotStorage implements SnapshotStorage {
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

  async saveSnapshot(params: {
    location: SnapshotLocation;
    snapshotId: string;
    isLatest: boolean;
    snapshot: Snapshot;
  }): Promise<void> {
    const existing = await this.listSnapshotEvents(params.location);
    const staleEventIds = existing
      .filter((event) =>
        params.isLatest
          ? event.metadata.isLatest
          : event.metadata.snapshotId === params.snapshotId
      )
      .map((event) => event.eventId);

    await this.client.send(
      new CreateEventCommand({
        memoryId: this.memoryId,
        actorId: this.actorId,
        sessionId: sessionIdForLocation(params.location),
        eventTimestamp: new Date(),
        payload: [
          {
            blob: {
              snapshot: toDocument(params.snapshot),
            },
          } satisfies PayloadType,
        ],
        metadata: buildSnapshotMetadata({
          location: params.location,
          snapshotId: params.snapshotId,
          isLatest: params.isLatest,
        }),
      })
    );

    await this.deleteEvents(params.location, staleEventIds);
  }

  async loadSnapshot(params: {
    location: SnapshotLocation;
    snapshotId?: string;
  }): Promise<Snapshot | null> {
    const events = await this.listSnapshotEvents(params.location);
    const event = latestSnapshotEvent(
      events.filter((item) =>
        params.snapshotId
          ? item.metadata.snapshotId === params.snapshotId
          : item.metadata.isLatest
      )
    );

    return event?.snapshot ?? null;
  }

  async listSnapshotIds(params: {
    location: SnapshotLocation;
    limit?: number;
    startAfter?: string;
  }): Promise<string[]> {
    const ids = [
      ...new Set(
        (await this.listSnapshotEvents(params.location))
          .map((event) => event.metadata.snapshotId)
          .filter(
            (snapshotId) =>
              snapshotId !== "latest" && snapshotId !== MANIFEST_SNAPSHOT_ID
          )
      ),
    ].sort();
    const startIndex = params.startAfter
      ? ids.findIndex((id) => id === params.startAfter) + 1
      : 0;
    const page = ids.slice(startIndex);
    return params.limit ? page.slice(0, params.limit) : page;
  }

  async deleteSession(params: { sessionId: string }): Promise<void> {
    const events = await this.listSessionEvents(params.sessionId);
    await this.deleteEventIds(
      params.sessionId,
      events
        .map((event) => event.eventId)
        .filter((eventId): eventId is string => Boolean(eventId))
    );
  }

  async loadManifest(params: {
    location: SnapshotLocation;
  }): Promise<SnapshotManifest> {
    const events = await this.listSnapshotEvents(params.location);
    const manifestEvent = latestSnapshotEvent(
      events.filter(
        (event) => event.metadata.snapshotId === MANIFEST_SNAPSHOT_ID
      )
    );
    if (manifestEvent?.manifest) {
      return manifestEvent.manifest;
    }

    return {
      schemaVersion: "1.0",
      updatedAt: new Date(0).toISOString(),
    };
  }

  async saveManifest(params: {
    location: SnapshotLocation;
    manifest: SnapshotManifest;
  }): Promise<void> {
    const existing = await this.listSnapshotEvents(params.location);
    const staleEventIds = existing
      .filter((event) => event.metadata.snapshotId === MANIFEST_SNAPSHOT_ID)
      .map((event) => event.eventId);

    await this.client.send(
      new CreateEventCommand({
        memoryId: this.memoryId,
        actorId: this.actorId,
        sessionId: sessionIdForLocation(params.location),
        eventTimestamp: new Date(),
        payload: [
          {
            blob: {
              manifest: toDocument(params.manifest),
            },
          } satisfies PayloadType,
        ],
        metadata: buildSnapshotMetadata({
          location: params.location,
          snapshotId: MANIFEST_SNAPSHOT_ID,
          isLatest: false,
        }),
      })
    );

    await this.deleteEvents(params.location, staleEventIds);
  }

  private async listSnapshotEvents(
    location: SnapshotLocation
  ): Promise<StoredSnapshotEvent[]> {
    const events = await this.listSessionEvents(sessionIdForLocation(location));
    return events
      .map((event) => parseSnapshotEvent(event, location))
      .filter((event): event is StoredSnapshotEvent => Boolean(event));
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

  private async deleteEvents(
    location: SnapshotLocation,
    eventIds: string[]
  ): Promise<void> {
    await this.deleteEventIds(sessionIdForLocation(location), eventIds);
  }

  private async deleteEventIds(
    sessionId: string,
    eventIds: string[]
  ): Promise<void> {
    for (const eventId of eventIds) {
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
}

export class InMemorySnapshotStorage implements SnapshotStorage {
  private readonly snapshots = new Map<string, Snapshot>();
  private readonly manifests = new Map<string, SnapshotManifest>();

  async saveSnapshot(params: {
    location: SnapshotLocation;
    snapshotId: string;
    isLatest: boolean;
    snapshot: Snapshot;
  }): Promise<void> {
    if (params.isLatest) {
      this.snapshots.set(storageKey(params.location, "latest"), params.snapshot);
    }
    this.snapshots.set(
      storageKey(params.location, params.snapshotId),
      params.snapshot
    );
  }

  async loadSnapshot(params: {
    location: SnapshotLocation;
    snapshotId?: string;
  }): Promise<Snapshot | null> {
    return (
      this.snapshots.get(
        storageKey(params.location, params.snapshotId ?? "latest")
      ) ?? null
    );
  }

  async listSnapshotIds(params: {
    location: SnapshotLocation;
    limit?: number;
    startAfter?: string;
  }): Promise<string[]> {
    const prefix = storageKeyPrefix(params.location);
    const ids = [...this.snapshots.keys()]
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length))
      .filter((id) => id !== "latest")
      .sort();
    const startIndex = params.startAfter
      ? ids.findIndex((id) => id === params.startAfter) + 1
      : 0;
    const page = ids.slice(startIndex);
    return params.limit ? page.slice(0, params.limit) : page;
  }

  async deleteSession(params: { sessionId: string }): Promise<void> {
    const prefix = `${params.sessionId}:`;
    for (const key of [...this.snapshots.keys()]) {
      if (key.startsWith(prefix)) {
        this.snapshots.delete(key);
      }
    }
    for (const key of [...this.manifests.keys()]) {
      if (key.startsWith(prefix)) {
        this.manifests.delete(key);
      }
    }
  }

  async loadManifest(params: {
    location: SnapshotLocation;
  }): Promise<SnapshotManifest> {
    return (
      this.manifests.get(locationKey(params.location)) ?? {
        schemaVersion: "1.0",
        updatedAt: new Date(0).toISOString(),
      }
    );
  }

  async saveManifest(params: {
    location: SnapshotLocation;
    manifest: SnapshotManifest;
  }): Promise<void> {
    this.manifests.set(locationKey(params.location), params.manifest);
  }
}

type SnapshotMetadata = {
  snapshotId: string;
  isLatest: boolean;
  scope: Scope;
  scopeId: string;
};

type StoredSnapshotEvent = {
  eventId: string;
  eventTimestamp: number;
  metadata: SnapshotMetadata;
  snapshot?: Snapshot;
  manifest?: SnapshotManifest;
};

function parseSnapshotEvent(
  event: Event,
  location: SnapshotLocation
): StoredSnapshotEvent | null {
  if (!event.eventId) {
    return null;
  }

  const metadata = parseSnapshotMetadata(event.metadata);
  if (
    !metadata ||
    metadata.scope !== location.scope ||
    metadata.scopeId !== location.scopeId
  ) {
    return null;
  }

  const [payload] = event.payload ?? [];
  const blob = getBlob(payload);
  const snapshot = isSnapshot(blob?.snapshot) ? blob.snapshot : undefined;
  const manifest = isSnapshotManifest(blob?.manifest)
    ? blob.manifest
    : undefined;
  if (!snapshot && !manifest) {
    return null;
  }

  return {
    eventId: event.eventId,
    eventTimestamp: event.eventTimestamp?.getTime() ?? 0,
    metadata,
    ...(snapshot ? { snapshot } : {}),
    ...(manifest ? { manifest } : {}),
  };
}

function parseSnapshotMetadata(
  metadata: Record<string, MetadataValue> | undefined
): SnapshotMetadata | null {
  if (
    getMetadataString(metadata, EVENT_KIND_METADATA_KEY) !==
      SNAPSHOT_EVENT_KIND ||
    getMetadataString(metadata, EVENT_VERSION_METADATA_KEY) !==
      SNAPSHOT_EVENT_VERSION
  ) {
    return null;
  }

  const snapshotId = getMetadataString(metadata, SNAPSHOT_ID_METADATA_KEY);
  const isLatest =
    getMetadataString(metadata, SNAPSHOT_IS_LATEST_METADATA_KEY) === "true";
  const scope = getMetadataString(metadata, SNAPSHOT_SCOPE_METADATA_KEY);
  const scopeId = getMetadataString(metadata, SNAPSHOT_SCOPE_ID_METADATA_KEY);
  if (
    !snapshotId ||
    (scope !== "agent" && scope !== "multiAgent") ||
    !scopeId
  ) {
    return null;
  }

  return {
    snapshotId,
    isLatest,
    scope,
    scopeId,
  };
}

function buildSnapshotMetadata(params: {
  location: SnapshotLocation;
  snapshotId: string;
  isLatest: boolean;
}): Record<string, MetadataValue> {
  return {
    [EVENT_KIND_METADATA_KEY]: { stringValue: SNAPSHOT_EVENT_KIND },
    [EVENT_VERSION_METADATA_KEY]: { stringValue: SNAPSHOT_EVENT_VERSION },
    [SNAPSHOT_ID_METADATA_KEY]: { stringValue: params.snapshotId },
    [SNAPSHOT_IS_LATEST_METADATA_KEY]: {
      stringValue: params.isLatest ? "true" : "false",
    },
    [SNAPSHOT_SCOPE_METADATA_KEY]: { stringValue: params.location.scope },
    [SNAPSHOT_SCOPE_ID_METADATA_KEY]: { stringValue: params.location.scopeId },
  };
}

function latestSnapshotEvent(
  events: StoredSnapshotEvent[]
): StoredSnapshotEvent | null {
  return (
    [...events].sort((left, right) => {
      if (left.eventTimestamp !== right.eventTimestamp) {
        return right.eventTimestamp - left.eventTimestamp;
      }

      return right.eventId.localeCompare(left.eventId);
    })[0] ?? null
  );
}

function sessionIdForLocation(location: SnapshotLocation): string {
  return location.sessionId;
}

function storageKey(location: SnapshotLocation, snapshotId: string): string {
  return `${storageKeyPrefix(location)}${snapshotId}`;
}

function storageKeyPrefix(location: SnapshotLocation): string {
  return `${locationKey(location)}:`;
}

function locationKey(location: SnapshotLocation): string {
  return `${location.sessionId}:${location.scope}:${location.scopeId}`;
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

function getBlob(payload: PayloadType | undefined): Record<string, unknown> | null {
  if (!payload || !("blob" in payload) || !payload.blob) {
    return null;
  }

  return typeof payload.blob === "object" && payload.blob !== null
    ? (payload.blob as Record<string, unknown>)
    : null;
}

function toDocument<T>(value: T): PayloadType.BlobMember["blob"] {
  return value as PayloadType.BlobMember["blob"];
}

function isSnapshot(value: unknown): value is Snapshot {
  return (
    typeof value === "object" &&
    value !== null &&
    "scope" in value &&
    (value.scope === "agent" || value.scope === "multiAgent") &&
    "schemaVersion" in value &&
    typeof value.schemaVersion === "string" &&
    "createdAt" in value &&
    typeof value.createdAt === "string" &&
    "data" in value &&
    typeof value.data === "object" &&
    value.data !== null &&
    "appData" in value &&
    typeof value.appData === "object" &&
    value.appData !== null
  );
}

function isSnapshotManifest(value: unknown): value is SnapshotManifest {
  return (
    typeof value === "object" &&
    value !== null &&
    "schemaVersion" in value &&
    typeof value.schemaVersion === "string" &&
    "updatedAt" in value &&
    typeof value.updatedAt === "string"
  );
}
