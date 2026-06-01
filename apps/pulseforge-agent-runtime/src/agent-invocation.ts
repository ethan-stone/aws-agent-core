import {
  Agent,
  BedrockModel,
  BeforeToolCallEvent,
  InterruptResponseContent,
  SlidingWindowConversationManager,
  type AgentResult,
  type JSONValue,
  type Snapshot,
} from "@strands-agents/sdk";
import {
  BedrockAgentCoreClient,
  GetWorkloadAccessTokenForUserIdCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import { withAccessToken } from "bedrock-agentcore/identity";
import { z } from "zod";
import {
  getPulseForgeAgentConfig,
  getPulseForgeAgentToolAuthorizationGroups,
  getPulseForgeAgentToolDefinitions,
  isPulseForgeAgentTriggerAllowed,
  pulseForgeAgentKindSchema,
} from "../../../shared/pulseforge-agent/src/index.js";
import type {
  AgentKind,
  AgentRuntimeInvocationActor,
  AgentRuntimeInvocation,
  AgentRuntimeStreamEvent,
  AgentRuntimeInvocationTrigger,
  ResumeRequiredActionInvocation,
  StartAgentRunInvocation,
  RequiredActionRunItem,
  ToolApprovalDecision,
  ToolApprovalGrant,
  Conversation,
} from "../../../shared/pulseforge-domain/src/index.js";
import {
  getAgentRun,
  getConversation,
  listRuntimeSessions,
} from "../../../shared/pulseforge-backend/src/index.js";
import {
  createPulseForgeStrandsTools,
  type JsonValue,
  type ToolAccessTokenConfig,
  type ToolCredentialProvider,
  type PulseForgeToolDefinition,
} from "../../../shared/pulseforge-tools/src/index.js";
import {
  AgentRunLifecycle,
  stripThinkingBlocks,
  type AgentRunLifecycleContext,
} from "./agent-run-lifecycle.js";
import type { AgentMemoryProjection } from "./agent-memory-projection.js";
import type { RuntimeConfig } from "./runtime-config.js";

interface RuntimeSseChunk {
  event: string;
  data: unknown;
}

export const agentRuntimeRequestSchema = z.object({
  version: z.literal("2026-05-28"),
  conversationId: z.string(),
  agentRunId: z.string(),
  runtimeSessionId: z.string().optional(),
  providerSessionId: z.string().optional(),
  actor: z.discriminatedUnion("type", [
    z.object({ type: z.literal("user"), userId: z.string() }),
    z.object({ type: z.literal("system"), systemId: z.string() }),
  ]),
}).and(
  z.discriminatedUnion("operation", [
    z.object({
      operation: z.literal("start_agent_run"),
      agentKind: pulseForgeAgentKindSchema,
      trigger: z.discriminatedUnion("type", [
        z.object({
          type: z.literal("operator_prompt"),
          prompt: z.string(),
          incidentId: z.string().optional(),
          deviceId: z.string().optional(),
        }),
        z.object({
          type: z.literal("incident_created"),
          incidentId: z.string(),
        }),
        z.object({
          type: z.literal("incident_agent_mention"),
          incidentId: z.string(),
          incidentActivityId: z.string(),
          prompt: z.string(),
        }),
      ]),
    }),
    z.object({
      operation: z.literal("resume_required_action"),
      requiredActionId: z.string(),
      interruptId: z.string(),
      snapshot: z.unknown(),
      response: z.object({
        approved: z.boolean(),
        decision: z
          .enum(["allow_once", "allow_always", "decline"])
          .optional(),
        comment: z.string().optional(),
        resolvedByUserId: z.string().optional(),
      }),
    }),
  ])
);

interface ResolvedAgentInvocation {
  request: AgentRuntimeInvocation;
  agentKind: AgentKind;
  actorId?: string;
  conversation: Conversation;
  lifecycleContext: AgentRunLifecycleContext;
}

export interface AgentRuntimeContext {
  sessionId: string;
  headers: Record<string, string>;
  workloadAccessToken?: string;
  oauth2CallbackUrl?: string;
}

export interface PulseForgeAgentInvocationDependencies {
  model: BedrockModel;
  runtimeConfig: RuntimeConfig;
  memoryProjection: AgentMemoryProjection;
  workloadTokenClient: BedrockAgentCoreClient;
}

export async function* runPulseForgeAgentInvocation(
  request: AgentRuntimeInvocation,
  context: AgentRuntimeContext,
  dependencies: PulseForgeAgentInvocationDependencies
): AsyncGenerator<RuntimeSseChunk> {
  let lifecycle: AgentRunLifecycle | null = null;
  try {
    const resolved = await resolveAgentInvocation(request);
    const runLifecycle = new AgentRunLifecycle(resolved.lifecycleContext);
    lifecycle = runLifecycle;
    const actorId = resolved.actorId ?? context.sessionId;
    const memorySessionId = resolveAgentMemorySessionId(request, context);
    const memory = await dependencies.memoryProjection.prepare({
      actorId,
      sessionId: memorySessionId,
    });
    console.info("[agent] memory session prepared", {
      agentRunId: request.agentRunId,
      conversationId: request.conversationId,
      runtimeSessionId: request.runtimeSessionId,
      providerSessionId: request.providerSessionId,
      contextSessionId: context.sessionId,
      memorySessionId,
    });
    const agentConfig = getPulseForgeAgentConfig(resolved.agentKind);
    const runtimeEvents = new AsyncEventQueue<AgentRuntimeStreamEvent>();
    const tools = await createAgentTools(resolved, context, dependencies, {
      onAuthorizationRequired: async (details) => {
        await runLifecycle.recordAuthorizationRequired(details);
        runtimeEvents.push({ event: "auth_required", data: details });
      },
      onAuthorizationResolved: async (details) => {
        const event: AgentRuntimeStreamEvent = {
          event: "action_resolution",
          data: {
            requiredActionId: details.requiredActionId,
            outcome: "resolved",
            content: [
              {
                type: "text",
                text: `${details.providerName} authorization completed.`,
              },
            ],
            data: {
              providerName: details.providerName,
              scopes: details.scopes,
              agentRunId: details.agentRunId,
            },
          },
        };
        await runLifecycle.recordActionResolution(event.data);
        runtimeEvents.push(event);
      },
      onToolCallStarted: async (details) => {
        await runLifecycle.recordToolCallStarted(details);
        runtimeEvents.push({
          event: "tool_call",
          data: {
            toolCallId: details.toolCallId,
            toolName: details.toolName,
            arguments: details.input,
            status: "pending",
          },
        });
      },
      onToolCallCompleted: async (details) => {
        await runLifecycle.recordToolCallCompleted(details);
        runtimeEvents.push({
          event: "tool_result",
          data: {
            toolCallId: details.toolCallId,
            toolName: details.toolName,
            content: details.output,
          },
        });
      },
      onToolCallFailed: async (details) => {
        await runLifecycle.recordToolCallFailed(details);
        runtimeEvents.push({
          event: "tool_result",
          data: {
            toolCallId: details.toolCallId,
            toolName: details.toolName,
            content: details.error,
            isError: true,
          },
        });
      },
    });

    const toolDefinitions = getPulseForgeAgentToolDefinitions(
      resolved.agentKind
    );
    const agent = new Agent({
      model: dependencies.model,
      id: agentConfig.id,
      name: agentConfig.label,
      systemPrompt: agentConfig.systemPrompt,
      tools,
      // Approval interrupts are snapshot-resumed one at a time. Sequential tool
      // execution prevents multiple approval buttons from sharing one snapshot.
      toolExecutor: "sequential",
      conversationManager: new SlidingWindowConversationManager({
        windowSize: 40,
      }),
      plugins: memory.plugins,
    });
    installToolApprovalHook(
      agent,
      toolDefinitions,
      resolved,
      runtimeEvents,
      runLifecycle
    );

    const agentInvocation = (async (): Promise<AgentRuntimeStreamEvent[]> => {
      const result =
        resolved.request.operation === "resume_required_action"
          ? await resumeInterruptedAgent(agent, resolved.request)
          : await agent.invoke(buildAgentPrompt(resolved.request));

      console.info("[agent] invocation completed", {
        agentRunId: resolved.request.agentRunId,
        agentKind: resolved.agentKind,
        stopReason: result.stopReason,
      });

      if (result.stopReason === "interrupt" && result.interrupts?.length) {
        const snapshot = agent.takeSnapshot({
          preset: "session",
          appData: {
            agentRunId: resolved.request.agentRunId,
            agentKind: resolved.agentKind,
          },
        });
        return result.interrupts.map((interrupt) =>
          buildInterruptRequiredAction(resolved, interrupt, snapshot)
        );
      }

      const text = stripThinkingBlocks(String(result));

      return [
        { event: "message", data: { text } },
        {
          event: "summary",
          data: buildInvestigationSummary(agentConfig.label, text),
        },
      ];
    })();

    let finalEvents: AgentRuntimeStreamEvent[] | undefined;
    let invocationError: unknown;
    agentInvocation
      .then((events) => {
        finalEvents = events;
      })
      .catch((error) => {
        invocationError = error;
      })
      .finally(() => runtimeEvents.close());

    while (true) {
      const event = await runtimeEvents.next();
      if (!event) {
        break;
      }

      yield toRuntimeSseChunk(event);
    }

    if (invocationError) {
      throw invocationError;
    }

    for (const event of finalEvents ?? []) {
      await recordFinalRuntimeEvent(runLifecycle, event);
      yield toRuntimeSseChunk(event);
    }
  } catch (error) {
    lifecycle ??= await createFallbackLifecycle(request);
    await lifecycle?.failRun(error);
    throw error;
  }
}

async function createFallbackLifecycle(
  request: AgentRuntimeInvocation
): Promise<AgentRunLifecycle | null> {
  if (request.operation === "start_agent_run") {
    const incidentId = request.trigger.incidentId;
    return new AgentRunLifecycle({
      conversationId: request.conversationId,
      agentRunId: request.agentRunId,
      agentKind: request.agentKind,
      ...(incidentId ? { incidentId } : {}),
      actorId: actorIdFromInvocation(request.actor),
    });
  }

  const run = await getAgentRun(request.agentRunId);
  if (!run) {
    return null;
  }

  return new AgentRunLifecycle({
    conversationId: request.conversationId,
    agentRunId: request.agentRunId,
    agentKind: run.agentKind,
    ...(run.incidentId ? { incidentId: run.incidentId } : {}),
    actorId: actorIdFromInvocation(request.actor),
  });
}

async function resolveAgentInvocation(
  request: AgentRuntimeInvocation
): Promise<ResolvedAgentInvocation> {
  const [conversation, run] = await Promise.all([
    getConversation(request.conversationId),
    getAgentRun(request.agentRunId),
  ]);
  if (!conversation) {
    throw new Error(`Conversation ${request.conversationId} not found.`);
  }
  if (!run) {
    throw new Error(`AgentRun ${request.agentRunId} not found.`);
  }
  if (run.conversationId !== request.conversationId) {
    throw new Error(
      `AgentRun ${run.id} belongs to conversation ${run.conversationId}, not ${request.conversationId}.`
    );
  }
  if (run.relationship === "root" && conversation.rootAgentKind !== run.agentKind) {
    throw new Error(
      `Conversation ${conversation.id} root AgentKind ${conversation.rootAgentKind} does not match run AgentKind ${run.agentKind}.`
    );
  }

  if (request.runtimeSessionId || request.providerSessionId) {
    const runtimeSessions = await listRuntimeSessions(conversation.id);
    const session = request.runtimeSessionId
      ? runtimeSessions.find((item) => item.id === request.runtimeSessionId)
      : runtimeSessions.find(
        (item) => item.providerSessionId === request.providerSessionId
      );
    if (!session) {
      throw new Error("RuntimeSession does not belong to the conversation.");
    }
    if (
      request.providerSessionId &&
      session.providerSessionId !== request.providerSessionId
    ) {
      throw new Error(
        "RuntimeSession providerSessionId does not match the invocation."
      );
    }
  }

  const agentKind =
    request.operation === "start_agent_run" ? request.agentKind : run.agentKind;
  if (request.operation === "start_agent_run") {
    validateStartInvocation(request, run.agentKind);
  }

  const actorId = actorIdFromInvocation(request.actor);
  return {
    request,
    agentKind,
    actorId,
    conversation,
    lifecycleContext: {
      conversationId: request.conversationId,
      agentRunId: request.agentRunId,
      agentKind,
      ...(conversation.incidentId ? { incidentId: conversation.incidentId } : {}),
      ...(actorId ? { actorId } : {}),
    },
  };
}

function validateStartInvocation(
  request: StartAgentRunInvocation,
  persistedAgentKind: AgentKind
): void {
  if (request.agentKind !== persistedAgentKind) {
    throw new Error(
      `Invocation AgentKind ${request.agentKind} does not match run AgentKind ${persistedAgentKind}.`
    );
  }
  if (!isPulseForgeAgentTriggerAllowed(request.agentKind, request.trigger.type)) {
    throw new Error(
      `${request.agentKind} does not accept ${request.trigger.type} triggers.`
    );
  }
  if (
    (request.trigger.type === "operator_prompt" ||
      request.trigger.type === "incident_agent_mention") &&
    request.trigger.prompt.trim().length === 0
  ) {
    throw new Error(`${request.trigger.type} trigger requires a prompt.`);
  }
}

function actorIdFromInvocation(
  actor: AgentRuntimeInvocationActor
): string | undefined {
  return actor.type === "user" ? actor.userId : actor.systemId;
}

function toRuntimeSseChunk(event: AgentRuntimeStreamEvent): RuntimeSseChunk {
  return {
    event: event.event,
    data: event.data,
  };
}

function installToolApprovalHook(
  agent: Agent,
  toolDefinitions: readonly PulseForgeToolDefinition[],
  invocation: ResolvedAgentInvocation,
  runtimeEvents: AsyncEventQueue<AgentRuntimeStreamEvent>,
  lifecycle: AgentRunLifecycle
) {
  const approvalToolByName = new Map<string, PulseForgeToolDefinition>();
  for (const definition of toolDefinitions) {
    if (shouldRequireToolApproval(definition, invocation)) {
      approvalToolByName.set(definition.name, definition);
    }
  }

  if (approvalToolByName.size === 0) {
    return;
  }

  agent.addHook(BeforeToolCallEvent, async (event) => {
    const definition = approvalToolByName.get(event.toolUse.name);
    const approval = definition?.approval;
    if (!definition || !approval) {
      return;
    }

    const parsedInput = definition.inputSchema.parse(event.toolUse.input);
    const approvalDescriptor = approval.buildApproval(parsedInput);
    const observeOnlyIncidentLinked = isObserveOnlyIncidentLinked(invocation);
    const existingGrant = observeOnlyIncidentLinked
      ? null
      : await findMatchingToolApprovalGrant(
        lifecycle,
        invocation,
        event.toolUse.name,
        approvalDescriptor.approvalKey
      );
    if (existingGrant) {
      await lifecycle.recordToolApprovalGrantUsed(existingGrant);
      return;
    }

    const response = event.interrupt<{
      approved?: boolean;
      decision?: ToolApprovalDecision;
      comment?: string;
      resolvedByUserId?: string;
    }>({
      name: "pulseforge_tool_approval",
      reason: {
        actionType: approval.actionType,
        toolName: event.toolUse.name,
        toolUseId: event.toolUse.toolUseId,
        input: event.toolUse.input,
        title: approval.title,
        description: approval.description,
        actionLabel: approval.actionLabel,
        risk: approval.risk,
        approvalKey: approvalDescriptor.approvalKey,
        approvalLabel: approvalDescriptor.approvalLabel,
        ...(observeOnlyIncidentLinked
          ? {}
          : { allowAlwaysLabel: approvalDescriptor.allowAlwaysLabel }),
        agentRunId: invocation.request.agentRunId,
      },
    });

    const decision = resolveToolApprovalDecision(response);
    if (observeOnlyIncidentLinked && decision === "allow_always") {
      throw new Error(
        "allow_always is not supported for observe-only incident approvals."
      );
    }
    const approved = decision !== "decline";
    const grant =
      approved && decision === "allow_always"
        ? await createToolApprovalGrantFromRequiredAction(
          lifecycle,
          invocation,
          {
            toolName: event.toolUse.name,
            toolUseId: event.toolUse.toolUseId,
            approvalKey: approvalDescriptor.approvalKey,
            approvalLabel: approvalDescriptor.approvalLabel,
          },
          response
        )
        : null;
    const resolutionEvent: AgentRuntimeStreamEvent = {
      event: "action_resolution",
      data: {
        requiredActionId:
          invocation.request.operation === "resume_required_action"
            ? invocation.request.requiredActionId
            : `interrupt:${invocation.request.agentRunId}:${event.toolUse.toolUseId}`,
        outcome: approved ? "resolved" : "declined",
        content: [
          {
            type: "text",
            text: approved
              ? `${approval.title} approved by operator.`
              : `${approval.title} declined by operator.`,
          },
        ],
        data: {
          type: approval.actionType,
          toolName: event.toolUse.name,
          toolUseId: event.toolUse.toolUseId,
          approved,
          decision,
          approvalKey: approvalDescriptor.approvalKey,
          approvalLabel: approvalDescriptor.approvalLabel,
          ...(grant ? { toolApprovalGrantId: grant.id } : {}),
          comment: response?.comment,
          resolvedByUserId: response?.resolvedByUserId,
        },
      },
    };
    await lifecycle.recordActionResolution(resolutionEvent.data);
    runtimeEvents.push(resolutionEvent);

    if (!approved) {
      event.cancel = `Operator declined approval for ${event.toolUse.name}.`;
    }
  });
}

function shouldRequireToolApproval(
  definition: PulseForgeToolDefinition,
  invocation: ResolvedAgentInvocation
): boolean {
  const policy = definition.approval?.required;
  if (!policy) {
    return false;
  }
  return policy === true || isObserveOnlyIncidentLinked(invocation);
}

function isObserveOnlyIncidentLinked(
  invocation: ResolvedAgentInvocation
): boolean {
  return (
    invocation.conversation.interactionMode === "observe_only" &&
    typeof invocation.conversation.incidentId === "string"
  );
}

function resolveToolApprovalDecision(response?: {
  approved?: boolean;
  decision?: ToolApprovalDecision;
}): ToolApprovalDecision {
  if (response?.approved !== true) {
    return "decline";
  }
  if (
    response.decision === "allow_once" ||
    response.decision === "allow_always"
  ) {
    return response.decision;
  }
  return "allow_once";
}

async function findMatchingToolApprovalGrant(
  lifecycle: AgentRunLifecycle,
  invocation: ResolvedAgentInvocation,
  toolName: string,
  approvalKey: string
): Promise<ToolApprovalGrant | null> {
  const actorId = invocation.actorId;
  if (!actorId) {
    return null;
  }

  const conversation = await lifecycle.getConversation();
  if (!conversation || conversation.status !== "open") {
    return null;
  }

  return (
    conversation.toolApprovalGrants?.find(
      (grant) =>
        grant.grantedByUserId === actorId &&
        grant.toolName === toolName &&
        grant.approvalKey === approvalKey
    ) ?? null
  );
}

async function createToolApprovalGrantFromRequiredAction(
  lifecycle: AgentRunLifecycle,
  invocation: ResolvedAgentInvocation,
  current: {
    toolName: string;
    toolUseId?: string;
    approvalKey: string;
    approvalLabel: string;
  },
  response?: { resolvedByUserId?: string }
): Promise<ToolApprovalGrant> {
  const requiredActionId =
    invocation.request.operation === "resume_required_action"
      ? invocation.request.requiredActionId
      : undefined;
  if (!requiredActionId) {
    throw new Error("Cannot create tool approval grant without required action.");
  }

  const requiredAction = await lifecycle.getRequiredAction(requiredActionId);
  if (!requiredAction) {
    throw new Error("Cannot create tool approval grant without stored action.");
  }

  const displayed = getToolApprovalActionData(requiredAction);
  if (!displayed) {
    throw new Error("Stored required action is missing tool approval data.");
  }

  if (
    displayed.toolName !== current.toolName ||
    displayed.approvalKey !== current.approvalKey ||
    displayed.approvalLabel !== current.approvalLabel ||
    (displayed.toolUseId && displayed.toolUseId !== current.toolUseId)
  ) {
    throw new Error(
      "Stored approval does not match the resumed tool approval request."
    );
  }

  const grantedByUserId = response?.resolvedByUserId ?? invocation.actorId;
  if (!grantedByUserId) {
    throw new Error("Cannot create tool approval grant without operator user.");
  }

  const grant = await lifecycle.upsertToolApprovalGrant({
    toolName: displayed.toolName,
    approvalKey: displayed.approvalKey,
    approvalLabel: displayed.approvalLabel,
    grantedByUserId,
  });
  if (!grant) {
    throw new Error("Could not save tool approval grant.");
  }

  return grant;
}

function getToolApprovalActionData(
  item: RequiredActionRunItem
):
  | {
    toolName: string;
    toolUseId?: string;
    approvalKey: string;
    approvalLabel: string;
  }
  | null {
  const data = item.data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return null;
  }

  const record = data as Record<string, unknown>;
  if (
    record.type !== "tool_approval" ||
    typeof record.toolName !== "string" ||
    typeof record.approvalKey !== "string" ||
    typeof record.approvalLabel !== "string"
  ) {
    return null;
  }

  return {
    toolName: record.toolName,
    approvalKey: record.approvalKey,
    approvalLabel: record.approvalLabel,
    ...(typeof record.toolUseId === "string"
      ? { toolUseId: record.toolUseId }
      : {}),
  };
}

async function resumeInterruptedAgent(
  agent: Agent,
  request: ResumeRequiredActionInvocation
): Promise<AgentResult> {
  // SessionManager restores the rolling latest snapshot during initialization.
  // Initialize first so the durable interrupt-resume snapshot wins.
  await agent.initialize();
  agent.loadSnapshot(request.snapshot as Snapshot);

  return agent.invoke([
    new InterruptResponseContent({
      interruptId: request.interruptId,
      response: request.response as JSONValue,
    }),
  ]);
}

function buildInterruptRequiredAction(
  invocation: ResolvedAgentInvocation,
  interrupt: { id: string; name: string; reason?: JSONValue },
  snapshot: Snapshot
): AgentRuntimeStreamEvent {
  const reason = asRecord(interrupt.reason);
  const actionType = stringFromRecord(reason, "actionType") ?? interrupt.name;
  const title =
    stringFromRecord(reason, "title") ?? `Approve ${stringFromRecord(reason, "toolName") ?? "tool call"}`;
  const description =
    stringFromRecord(reason, "description") ??
    "The agent needs operator approval before continuing.";
  const actionLabel = stringFromRecord(reason, "actionLabel") ?? "Approve";
  const risk = stringFromRecord(reason, "risk");
  const toolName = stringFromRecord(reason, "toolName");
  const toolUseId = stringFromRecord(reason, "toolUseId");
  const approvalKey = stringFromRecord(reason, "approvalKey");
  const approvalLabel = stringFromRecord(reason, "approvalLabel");
  const allowAlwaysLabel = stringFromRecord(reason, "allowAlwaysLabel");
  const requiredActionId = `interrupt:${invocation.request.agentRunId}:${interrupt.id}`;

  return {
    event: "required_action",
    data: {
      requiredActionId,
      actionType,
      content: [
        {
          type: "text",
          text: `${title}: ${description}`,
        },
      ],
      data: {
        type: actionType,
        title,
        description,
        actionLabel,
        risk,
        toolName,
        toolUseId,
        input: reason?.input,
        approvalKey,
        approvalLabel,
        ...(allowAlwaysLabel ? { allowAlwaysLabel } : {}),
        agentRunId: invocation.request.agentRunId,
        resume: {
          interruptId: interrupt.id,
          snapshot: snapshot as unknown,
        },
      },
    },
  };
}

function asRecord(value: JSONValue | undefined): Record<string, JsonValue> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, JsonValue>;
}

function stringFromRecord(
  value: Record<string, JsonValue> | null,
  key: string
): string | undefined {
  const item = value?.[key];
  return typeof item === "string" ? item : undefined;
}

export function resolveAgentMemorySessionId(
  request: Pick<AgentRuntimeInvocation, "providerSessionId">,
  context: Pick<AgentRuntimeContext, "sessionId">
): string {
  return request.providerSessionId ?? context.sessionId;
}

function buildAgentPrompt(request: StartAgentRunInvocation): string {
  return promptFromTrigger(request.trigger);
}

function promptFromTrigger(trigger: AgentRuntimeInvocationTrigger): string {
  if (trigger.type === "operator_prompt" || trigger.type === "incident_agent_mention") {
    return trigger.prompt;
  }

  return `Incident ${trigger.incidentId} was created. Investigate the incident, summarize likely causes, and take safe remediation steps when appropriate.`;
}

function buildInvestigationSummary(agentLabel: string, result: string) {
  return {
    title: `${agentLabel} summary`,
    summary: truncate(result, 220),
    findings: [],
    recommendedActions: [],
  };
}

async function recordFinalRuntimeEvent(
  lifecycle: AgentRunLifecycle,
  event: AgentRuntimeStreamEvent
): Promise<void> {
  if (event.event === "message") {
    await lifecycle.recordAgentMessage(event.data.text);
    return;
  }

  if (event.event === "required_action") {
    await lifecycle.recordRequiredAction(event.data);
    return;
  }

  if (event.event === "summary") {
    const summary = stripThinkingBlocks(
      event.data.summary ?? "Agent run completed."
    );
    await lifecycle.completeRun(summary, {
      title: stripThinkingBlocks(event.data.title ?? "Investigation summary"),
      summary,
      findings: (event.data.findings ?? []).map(stripThinkingBlocks),
      recommendedActions: (event.data.recommendedActions ?? []).map(
        stripThinkingBlocks
      ),
    });
  }
}

async function createAgentTools(
  invocation: ResolvedAgentInvocation,
  context: AgentRuntimeContext,
  dependencies: PulseForgeAgentInvocationDependencies,
  options?: {
    onToolCallStarted?: (details: {
      toolCallId: string;
      toolName: string;
      input: unknown;
    }) => void | Promise<void>;
    onToolCallCompleted?: (details: {
      toolCallId: string;
      toolName: string;
      output: unknown;
    }) => void | Promise<void>;
    onToolCallFailed?: (details: {
      toolCallId: string;
      toolName: string;
      error: unknown;
    }) => void | Promise<void>;
    onAuthorizationRequired?: (details: {
      requiredActionId: string;
      providerName: string;
      providerDisplayName: string;
      authUrl: string;
      scopes: string[];
      agentRunId: string;
    }) => void | Promise<void>;
    onAuthorizationResolved?: (details: {
      requiredActionId: string;
      providerName: string;
      scopes: string[];
      agentRunId: string;
    }) => void | Promise<void>;
  }
) {
  if (!dependencies.runtimeConfig.tools.enabled) {
    return [];
  }

  const toolDefinitions = getPulseForgeAgentToolDefinitions(
    invocation.agentKind
  );
  if (toolDefinitions.length === 0) {
    return [];
  }

  const authorizationGroups = getPulseForgeAgentToolAuthorizationGroups(
    invocation.agentKind
  );
  const bundledAuthorizationScopeByProviderKey = new Map(
    authorizationGroups.map((group) => [group.provider.key, group.scopes])
  );
  console.info("[tools] wiring agent tools", {
    agentKind: invocation.agentKind,
    agentRunId: invocation.request.agentRunId,
    tools: toolDefinitions.map((definition) => definition.name),
    authorizationGroups: authorizationGroups.map((group) => ({
      providerKey: group.provider.key,
      providerDisplayName: group.provider.displayName,
      scopes: group.scopes,
      tools: group.tools,
    })),
    oauthCallbackUrlSource: context.oauth2CallbackUrl
      ? "runtime-context"
      : dependencies.runtimeConfig.tools.oauthCallbackUrl
        ? "env-fallback"
        : "missing",
  });

  const credentialProvider = await createToolCredentialProvider(
    invocation,
    context,
    dependencies
  );
  const authFlow =
    invocation.conversation.interactionMode === "observe_only"
      ? "M2M"
      : "USER_FEDERATION";
  const providerName =
    authFlow === "M2M"
      ? dependencies.runtimeConfig.tools.m2mProviderName ??
        dependencies.runtimeConfig.tools.providerName
      : dependencies.runtimeConfig.tools.providerName;
  return createPulseForgeStrandsTools(toolDefinitions, {
    backendUrl: dependencies.runtimeConfig.tools.backendUrl,
    agentRunId: invocation.request.agentRunId,
    providers: {
      "pulseforge-backend": {
        providerName,
        resourceServerIdentifier:
          dependencies.runtimeConfig.tools.resourceServerIdentifier,
        oauthCallbackUrl:
          context.oauth2CallbackUrl ??
          dependencies.runtimeConfig.tools.oauthCallbackUrl,
        authFlow,
        credentialProvider,
      },
    },
    getAuthorizationScopes: (provider, definition) =>
      bundledAuthorizationScopeByProviderKey.get(provider.key) ??
      definition.requiredScopes,
    onToolCallStarted: options?.onToolCallStarted,
    onToolCallCompleted: options?.onToolCallCompleted,
    onToolCallFailed: options?.onToolCallFailed,
    onAuthorizationRequired: options?.onAuthorizationRequired,
    onAuthorizationResolved: options?.onAuthorizationResolved,
  });
}

async function createToolCredentialProvider(
  invocation: ResolvedAgentInvocation,
  context: AgentRuntimeContext,
  dependencies: PulseForgeAgentInvocationDependencies
): Promise<ToolCredentialProvider> {
  if (!dependencies.runtimeConfig.tools.enabled) {
    throw new Error("PulseForge tools are not configured.");
  }

  if (dependencies.runtimeConfig.tools.authMode === "agentcore-runtime") {
    return new AgentCoreIdentityCredentialProvider(context.workloadAccessToken);
  }

  const userId =
    context.headers["x-amzn-bedrock-agentcore-runtime-custom-user-id"] ??
    dependencies.runtimeConfig.tools.localUserId ??
    invocation.actorId;

  if (!userId) {
    throw new Error(
      "PULSEFORGE_TOOL_AUTH_MODE=local-user-id requires x-amzn-bedrock-agentcore-runtime-custom-user-id, PULSEFORGE_LOCAL_USER_ID, or actorId."
    );
  }

  const response = await dependencies.workloadTokenClient.send(
    new GetWorkloadAccessTokenForUserIdCommand({
      workloadName: dependencies.runtimeConfig.tools.workloadName,
      userId,
    })
  );

  if (!response.workloadAccessToken) {
    throw new Error("AgentCore did not return a workload access token.");
  }

  return new AgentCoreIdentityCredentialProvider(response.workloadAccessToken);
}

class AgentCoreIdentityCredentialProvider implements ToolCredentialProvider {
  constructor(private readonly workloadIdentityToken?: string) { }

  withAccessToken<TInput, TResult>(
    config: ToolAccessTokenConfig,
    fn: (input: TInput, accessToken: string) => Promise<TResult>
  ): (input: TInput) => Promise<TResult> {
    return withAccessToken({
      ...config,
      scopes: [...config.scopes],
      workloadIdentityToken: this.workloadIdentityToken,
    })(async (input: TInput, accessToken: string) => fn(input, accessToken));
  }
}

class AsyncEventQueue<T> {
  private readonly items: T[] = [];
  private readonly waiters: Array<(item: T | null) => void> = [];
  private closed = false;

  push(item: T) {
    if (this.closed) {
      return;
    }

    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(item);
      return;
    }

    this.items.push(item);
  }

  next(): Promise<T | null> {
    const item = this.items.shift();
    if (item) {
      return Promise.resolve(item);
    }

    if (this.closed) {
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  close() {
    if (this.closed) {
      return;
    }

    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter(null);
    }
  }
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}
