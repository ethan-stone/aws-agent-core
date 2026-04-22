import { BedrockAgentCoreApp } from "bedrock-agentcore/runtime";
import {
  Agent,
  BedrockModel,
  SlidingWindowConversationManager,
} from "@strands-agents/sdk";
import { fromIni } from "@aws-sdk/credential-providers";
import { BedrockAgentCoreClient } from "@aws-sdk/client-bedrock-agentcore";
import {
  AgentCoreLongTermMemoryPlugin,
  type RetrievalConfigMap,
} from "./agentcore-long-term-memory-plugin.js";
import {
  AgentCoreEventSessionStore,
  InMemoryShortTermMemoryStore,
  type ShortTermMemoryStore,
} from "./short-term-memory-store.js";
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({
  quiet: true,
});

const memoryId = process.env.MEMORY_ID;
const sharedAwsConfig = process.env.AWS_PROFILE
  ? {
      credentials: fromIni({
        profile: process.env.AWS_PROFILE,
      }),
    }
  : undefined;

const bedrockAgentCoreClient = memoryId
  ? new BedrockAgentCoreClient({
      region: process.env.AWS_REGION,
      ...sharedAwsConfig,
    })
  : undefined;

const localShortTermMemoryStore = new InMemoryShortTermMemoryStore();
const longTermRetrievalConfig = getLongTermRetrievalConfig();

if (!memoryId) {
  console.warn(
    "MEMORY_ID is not set. Using in-process memory for local development."
  );
}

const bedrockModel = new BedrockModel({
  modelId: "amazon.nova-pro-v1:0",
  clientConfig: sharedAwsConfig,
});
const agentKindSchema = z.enum([
  "ops-copilot",
  "anomaly-investigation",
  "remediation-planner",
  "autonomous-remediation",
]);

const agentRequestSchema = z.object({
  prompt: z.string(),
  agentKind: agentKindSchema.default("ops-copilot"),
  incidentId: z.string().optional(),
  deviceId: z.string().optional(),
  actorId: z.string().optional(),
  investigationContext: z
    .object({
      incident: z.object({
        id: z.string(),
        siteId: z.string(),
        title: z.string(),
        summary: z.string(),
        severity: z.string(),
        status: z.string(),
        deviceIds: z.array(z.string()),
        createdAt: z.string(),
        updatedAt: z.string(),
        category: z.string(),
      }),
      events: z.array(
        z.object({
          id: z.string(),
          incidentId: z.string(),
          timestamp: z.string(),
          kind: z.string(),
          message: z.string(),
        })
      ),
      devices: z.array(
        z.object({
          device: z.object({
            id: z.string(),
            siteId: z.string(),
            name: z.string(),
            type: z.string(),
            firmwareVersion: z.string(),
            batteryPercent: z.number(),
            connectivityPercent: z.number(),
            status: z.string(),
            tags: z.array(z.string()),
            lastSeenAt: z.string(),
          }),
          telemetry: z.array(
            z.object({
              timestamp: z.string(),
              temperatureC: z.number().optional(),
              vibrationMmS: z.number().optional(),
              batteryPercent: z.number(),
              signalStrength: z.number(),
              packetLossPercent: z.number(),
            })
          ),
        })
      ),
      relatedIncidents: z.array(
        z.object({
          id: z.string(),
          siteId: z.string(),
          title: z.string(),
          summary: z.string(),
          severity: z.string(),
          status: z.string(),
          deviceIds: z.array(z.string()),
          createdAt: z.string(),
          updatedAt: z.string(),
          category: z.string(),
        })
      ),
      runbook: z
        .object({
          id: z.string(),
          title: z.string(),
          category: z.string(),
          summary: z.string(),
          steps: z.array(z.string()),
        })
        .optional(),
    })
    .optional(),
});

const app = new BedrockAgentCoreApp({
  invocationHandler: {
    requestSchema: agentRequestSchema,
    process: async function* (request, context) {
      const prompt = request.prompt;
      console.log(`Session ${context.sessionId} - Received prompt:`, prompt);

      const actorId = request.actorId ?? context.sessionId;
      const shortTermMemoryStore = createShortTermMemoryStore(actorId);
      const initialMessages = await loadSessionMessages(
        shortTermMemoryStore,
        context.sessionId,
        actorId
      );

      const plugins =
        memoryId && bedrockAgentCoreClient
          ? [
              new AgentCoreLongTermMemoryPlugin({
                client: bedrockAgentCoreClient,
                memoryId,
                actorId,
                sessionId: context.sessionId,
                retrievalConfig: longTermRetrievalConfig,
                contextTag:
                  process.env.AGENTCORE_MEMORY_CONTEXT_TAG ??
                  "agentcore-memory-context",
              }),
            ]
          : [];

      const agent = new Agent({
        model: bedrockModel,
        id: agentIdForKind(request.agentKind),
        name: labelForAgentKind(request.agentKind),
        messages: initialMessages,
        conversationManager: new SlidingWindowConversationManager({
          windowSize: 40,
        }),
        plugins,
      });

      try {
        const enrichedPrompt = buildAgentPrompt(request);
        const result = await agent.invoke(enrichedPrompt);
        yield { event: "message", data: { text: result } };
        yield {
          event: "summary",
          data: buildInvestigationSummary(request, String(result)),
        };
      } catch (error) {
        console.log(error);
      } finally {
        await persistSessionMessages(
          shortTermMemoryStore,
          context.sessionId,
          actorId,
          agent.messages
        );
      }
    },
  },
});

app.run();

function getLongTermRetrievalConfig(): RetrievalConfigMap {
  if (process.env.ENABLE_AGENTCORE_LONG_TERM_MEMORY !== "true") {
    return {};
  }

  return {
    "/preferences/{actorId}/": {
      topK: 5,
      relevanceScore: 0.7,
    },
    "/facts/{actorId}/": {
      topK: 10,
      relevanceScore: 0.3,
    },
    "/summaries/{actorId}/{sessionId}/": {
      topK: 5,
      relevanceScore: 0.5,
    },
  };
}

function createShortTermMemoryStore(actorId: string): ShortTermMemoryStore {
  if (memoryId && bedrockAgentCoreClient) {
    return new AgentCoreEventSessionStore({
      client: bedrockAgentCoreClient,
      memoryId,
      actorId,
    });
  }

  return localShortTermMemoryStore;
}

async function loadSessionMessages(
  store: ShortTermMemoryStore,
  sessionId: string,
  actorId: string
) {
  try {
    return await store.loadMessages(sessionId);
  } catch (error) {
    console.error("[memory] failed to load session messages", {
      sessionId,
      actorId,
      error,
    });
    return [];
  }
}

async function persistSessionMessages(
  store: ShortTermMemoryStore,
  sessionId: string,
  actorId: string,
  messages: Agent["messages"]
) {
  try {
    await store.saveMessages(sessionId, messages);
  } catch (error) {
    console.error("[memory] failed to persist session messages", {
      sessionId,
      actorId,
      error,
    });
  }
}

function agentIdForKind(kind: z.infer<typeof agentKindSchema>) {
  return `pulseforge-${kind}`;
}

function buildAgentPrompt(request: z.infer<typeof agentRequestSchema>): string {
  const context = request.investigationContext;
  const contextLines = [
    `Agent kind: ${request.agentKind}`,
    request.incidentId ? `Incident ID: ${request.incidentId}` : null,
    request.deviceId ? `Device ID: ${request.deviceId}` : null,
    context
      ? [
          `Incident title: ${context.incident.title}`,
          `Incident severity: ${context.incident.severity}`,
          `Incident category: ${context.incident.category}`,
          `Incident summary: ${context.incident.summary}`,
          `Devices in scope: ${context.devices
            .map(
              ({ device }) =>
                `${device.name} (${device.id}, fw ${device.firmwareVersion}, status ${device.status})`
            )
            .join("; ")}`,
          `Recent telemetry: ${context.devices
            .map(({ device, telemetry }) => {
              const latest = telemetry.at(-1);
              if (!latest) {
                return `${device.id}: no telemetry`;
              }

              const metrics = [
                typeof latest.temperatureC === "number"
                  ? `temp ${latest.temperatureC}C`
                  : null,
                typeof latest.vibrationMmS === "number"
                  ? `vibration ${latest.vibrationMmS} mm/s`
                  : null,
                `battery ${latest.batteryPercent}%`,
                `signal ${latest.signalStrength}`,
                `packet loss ${latest.packetLossPercent}%`,
              ].filter(Boolean);

              return `${device.id}: ${metrics.join(", ")}`;
            })
            .join("; ")}`,
          context.relatedIncidents.length > 0
            ? `Related incidents: ${context.relatedIncidents
                .map((item) => `${item.id} (${item.category}, ${item.status})`)
                .join("; ")}`
            : "Related incidents: none",
          context.runbook
            ? `Runbook: ${context.runbook.title}. Steps: ${context.runbook.steps.join(
                " | "
              )}`
            : "Runbook: none",
        ].join("\n")
      : null,
    "",
    request.prompt,
    "",
    "Return a concise operator-ready investigation. Prefer evidence grounded in the provided context.",
  ].filter(Boolean);

  return contextLines.join("\n");
}

function buildInvestigationSummary(
  request: z.infer<typeof agentRequestSchema>,
  result: string
) {
  const context = request.investigationContext;
  const findings = context ? buildContextFindings(context) : [];
  const recommendedActions = context
    ? buildContextActions(context)
    : request.agentKind === "autonomous-remediation"
      ? [
          "Verify whether the proposed remediation is allowlisted before execution.",
          "Create or update an incident ticket if the issue remains unresolved.",
        ]
      : [
          "Review the investigation summary in the API response.",
          "Escalate to the remediation planner if an operational change is required.",
        ];

  return {
    title: `${labelForAgentKind(request.agentKind)} summary`,
    summary: truncate(result, 220),
    findings:
      findings.length > 0
        ? findings
        : [
            request.incidentId
              ? `Incident ${request.incidentId} was included in the analysis context.`
              : "No incident id was provided in the request.",
            request.deviceId
              ? `Device ${request.deviceId} was included in the analysis context.`
              : "No device id was provided in the request.",
          ],
    recommendedActions,
  };
}

function buildContextFindings(
  context: NonNullable<z.infer<typeof agentRequestSchema>["investigationContext"]>
) {
  const findings: string[] = [];

  const firmwareCohorts = new Set(
    context.devices.map(({ device }) => device.firmwareVersion)
  );
  if (firmwareCohorts.size === 1) {
    findings.push(
      `All affected devices share firmware cohort ${context.devices[0]?.device.firmwareVersion}.`
    );
  }

  const warmingDevices = context.devices
    .map(({ device, telemetry }) => ({
      device,
      latest: telemetry.at(-1),
    }))
    .filter(
      (item): item is typeof item & { latest: NonNullable<typeof item.latest> } =>
        Boolean(item.latest)
    )
    .filter((item) => typeof item.latest.temperatureC === "number" && item.latest.temperatureC > -15);

  if (warmingDevices.length > 0) {
    findings.push(
      `Temperature drift is visible on ${warmingDevices
        .map((item) => `${item.device.id} (${item.latest.temperatureC}C)`)
        .join(", ")}.`
    );
  }

  const highPacketLoss = context.devices
    .map(({ device, telemetry }) => ({
      device,
      latest: telemetry.at(-1),
    }))
    .filter(
      (item): item is typeof item & { latest: NonNullable<typeof item.latest> } =>
        Boolean(item.latest)
    )
    .filter((item) => item.latest.packetLossPercent >= 3);

  if (highPacketLoss.length > 0) {
    findings.push(
      `Elevated packet loss is present on ${highPacketLoss
        .map((item) => `${item.device.id} (${item.latest.packetLossPercent}%)`)
        .join(", ")}.`
    );
  }

  if (context.relatedIncidents.length > 0) {
    findings.push(
      `There are ${context.relatedIncidents.length} related incidents that may indicate a broader cohort or site pattern.`
    );
  }

  return findings;
}

function buildContextActions(
  context: NonNullable<z.infer<typeof agentRequestSchema>["investigationContext"]>
) {
  const actions: string[] = [];

  if (context.runbook) {
    actions.push(...context.runbook.steps.slice(0, 2));
  }

  if (context.incident.category === "temperature-drift") {
    actions.push("Compare affected freezer sensors against unaffected same-site devices before rollback.");
  }

  if (context.incident.category === "connectivity-loss") {
    actions.push("Confirm whether downstream devices are stale before scheduling a gateway reboot.");
  }

  return Array.from(new Set(actions)).slice(0, 4);
}

function labelForAgentKind(kind: z.infer<typeof agentKindSchema>): string {
  switch (kind) {
    case "ops-copilot":
      return "Ops Copilot";
    case "anomaly-investigation":
      return "Anomaly Investigation";
    case "remediation-planner":
      return "Remediation Planner";
    case "autonomous-remediation":
      return "Autonomous Remediation";
  }
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}
