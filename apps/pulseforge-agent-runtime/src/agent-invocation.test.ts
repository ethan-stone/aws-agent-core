import test from "node:test";
import assert from "node:assert/strict";
import {
  Agent,
  BeforeToolCallEvent,
  FunctionTool,
  InterruptResponseContent,
  Model,
  type BaseModelConfig,
  type Message,
  type ModelStreamEvent,
  type Snapshot,
  type StreamOptions,
} from "@strands-agents/sdk";
import { z } from "zod";
import { runInvalidAgentInvocation } from "./invalid-agent-invocation.js";

type PlainContentBlock =
  | { type: "textBlock"; text: string }
  | { type: "toolUseBlock"; name: string; toolUseId: string; input: unknown };

class QueuedMessageModel extends Model<BaseModelConfig> {
  private readonly turns: PlainContentBlock[][];
  private turnIndex = 0;
  private config: BaseModelConfig = { modelId: "test-model" };

  constructor(turns: PlainContentBlock[][]) {
    super();
    this.turns = turns;
  }

  updateConfig(modelConfig: BaseModelConfig): void {
    this.config = { ...this.config, ...modelConfig };
  }

  getConfig(): BaseModelConfig {
    return this.config;
  }

  async *stream(
    _messages: Message[],
    _options?: StreamOptions
  ): AsyncGenerator<ModelStreamEvent> {
    const turn = this.turns[this.turnIndex];
    this.turnIndex += 1;
    if (!turn) {
      throw new Error("All model turns have been consumed.");
    }

    yield { type: "modelMessageStartEvent", role: "assistant" };
    for (const block of turn) {
      if (block.type === "textBlock") {
        yield { type: "modelContentBlockStartEvent" };
        yield {
          type: "modelContentBlockDeltaEvent",
          delta: { type: "textDelta", text: block.text },
        };
        yield { type: "modelContentBlockStopEvent" };
      } else {
        yield {
          type: "modelContentBlockStartEvent",
          start: {
            type: "toolUseStart",
            name: block.name,
            toolUseId: block.toolUseId,
          },
        };
        yield {
          type: "modelContentBlockDeltaEvent",
          delta: {
            type: "toolUseInputDelta",
            input: JSON.stringify(block.input),
          },
        };
        yield { type: "modelContentBlockStopEvent" };
      }
    }
    yield {
      type: "modelMessageStopEvent",
      stopReason: turn.some((block) => block.type === "toolUseBlock")
        ? "toolUse"
        : "endTurn",
    };
  }
}

function createApprovalTestAgent(params: {
  model: Model;
  executedDevices: string[];
}) {
  const agent = new Agent({
    model: params.model,
    tools: [
      new FunctionTool({
        name: "reset_device",
        description: "Reset a device",
        inputSchema: {
          type: "object",
          properties: { deviceId: { type: "string" } },
          required: ["deviceId"],
        },
        callback: (input) => {
          const deviceId = (input as { deviceId: string }).deviceId;
          params.executedDevices.push(deviceId);
          return { ok: true, deviceId };
        },
      }),
    ],
    printer: false,
    toolExecutor: "sequential",
  });

  agent.addHook(BeforeToolCallEvent, (event) => {
    if (event.toolUse.name !== "reset_device") {
      return;
    }
    const response = event.interrupt<{ approved?: boolean }>({
      name: "pulseforge_tool_approval",
      reason: {
        actionType: "tool_approval",
        toolName: event.toolUse.name,
        toolUseId: event.toolUse.toolUseId,
        input: event.toolUse.input,
      },
    });
    if (response?.approved !== true) {
      event.cancel = "Operator declined approval.";
    }
  });

  return agent;
}

function pendingCompletedToolResults(snapshot: Snapshot) {
  return (
    snapshot.data.interrupts as
      | {
          pendingToolExecution?: {
            completedToolResults?: Record<string, unknown>;
          };
        }
      | null
      | undefined
  )?.pendingToolExecution?.completedToolResults;
}

test("runInvalidAgentInvocation fails an existing run when agentRunId is present", async () => {
  const payload = {
    agentRunId: "run-1",
    prompt: "Investigate inc-1001",
    agentKind: "ops-copilot",
  };
  const parsed = z
    .object({
      conversationId: z.string(),
      agentRunId: z.string(),
      prompt: z.string(),
    })
    .safeParse(payload);
  assert.equal(parsed.success, false);
  if (parsed.success) {
    throw new Error("Expected payload to be invalid.");
  }

  const appendedItems: unknown[] = [];
  const statusUpdates: unknown[] = [];
  const events = [];
  const warn = console.warn;

  try {
    console.warn = () => {};
    for await (const event of runInvalidAgentInvocation(
      parsed.error,
      payload,
      {
        appendRunItems: async (_runId, items) => {
          appendedItems.push(...items);
          return [];
        },
        updateAgentRunStatus: async (_runId, update) => {
          statusUpdates.push(update);
          return null;
        },
      }
    )) {
      events.push(event);
    }
  } finally {
    console.warn = warn;
  }

  assert.equal(events[0]?.event, "message");
  assert.equal(events[1]?.event, "summary");
  assert.deepEqual(appendedItems, [
    {
      runId: "run-1",
      kind: "message",
      role: "system",
      source: { type: "system" },
      content: [
        {
          type: "text",
          text: "Invalid agent runtime payload: conversationId Invalid input: expected string, received undefined",
        },
      ],
    },
  ]);
  assert.deepEqual(statusUpdates, [
    {
      status: "failed",
      summary:
        "The runtime request did not match the expected agent invocation shape.",
      investigation: {
        title: "Invalid runtime payload",
        summary:
          "The runtime request did not match the expected agent invocation shape.",
        findings: [
          "conversationId: Invalid input: expected string, received undefined",
        ],
        recommendedActions: [
          "Invoke with version, operation, conversationId, agentRunId, actor, and a valid operation-specific payload.",
        ],
      },
      errorMessage:
        "Invalid agent runtime payload: conversationId Invalid input: expected string, received undefined",
    },
  ]);
});

test("sequential approval interrupts refresh the next snapshot with completed tool results", async () => {
  const executedDevices: string[] = [];
  const firstAgent = createApprovalTestAgent({
    model: new QueuedMessageModel([
      [
        {
          type: "toolUseBlock",
          name: "reset_device",
          toolUseId: "tool-reset-014",
          input: { deviceId: "dev-freezer-014" },
        },
        {
          type: "toolUseBlock",
          name: "reset_device",
          toolUseId: "tool-reset-022",
          input: { deviceId: "dev-freezer-022" },
        },
      ],
    ]),
    executedDevices,
  });

  const firstInterrupt = await firstAgent.invoke("Reset both devices.");
  assert.equal(firstInterrupt.stopReason, "interrupt");
  assert.equal(firstInterrupt.interrupts?.length, 1);
  assert.match(firstInterrupt.interrupts[0].id, /tool-reset-014/);
  assert.deepEqual(executedDevices, []);

  const staleSnapshot = firstAgent.takeSnapshot({ preset: "session" });
  assert.deepEqual(pendingCompletedToolResults(staleSnapshot), {});

  const secondInterrupt = await firstAgent.invoke([
    new InterruptResponseContent({
      interruptId: firstInterrupt.interrupts[0].id,
      response: { approved: true },
    }),
  ]);
  assert.equal(secondInterrupt.stopReason, "interrupt");
  assert.equal(secondInterrupt.interrupts?.length, 1);
  assert.match(secondInterrupt.interrupts[0].id, /tool-reset-022/);
  assert.deepEqual(executedDevices, ["dev-freezer-014"]);

  const refreshedSnapshot = firstAgent.takeSnapshot({ preset: "session" });
  assert.deepEqual(
    Object.keys(pendingCompletedToolResults(refreshedSnapshot) ?? {}),
    ["tool-reset-014"]
  );

  const resumedAgent = createApprovalTestAgent({
    model: new QueuedMessageModel([[{ type: "textBlock", text: "Done." }]]),
    executedDevices,
  });
  await resumedAgent.initialize();
  resumedAgent.loadSnapshot(refreshedSnapshot);
  const finalResult = await resumedAgent.invoke([
    new InterruptResponseContent({
      interruptId: secondInterrupt.interrupts[0].id,
      response: { approved: true },
    }),
  ]);

  assert.equal(finalResult.stopReason, "endTurn");
  assert.deepEqual(executedDevices, [
    "dev-freezer-014",
    "dev-freezer-022",
  ]);
});
