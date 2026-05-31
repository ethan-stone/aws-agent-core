import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { resolveAgentMemorySessionId } from "./agent-invocation.js";
import { runInvalidAgentInvocation } from "./invalid-agent-invocation.js";

test("resolveAgentMemorySessionId uses the canonical provider session when present", () => {
  assert.equal(
    resolveAgentMemorySessionId(
      { providerSessionId: "conversation-123" },
      { sessionId: "agentcore-context-session" }
    ),
    "conversation-123"
  );
});

test("resolveAgentMemorySessionId falls back to the AgentCore context session", () => {
  assert.equal(
    resolveAgentMemorySessionId({}, { sessionId: "agentcore-context-session" }),
    "agentcore-context-session"
  );
});

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
          "Invoke with conversationId, agentRunId, prompt, agentKind, and optional incident/device ids.",
        ],
      },
      errorMessage:
        "Invalid agent runtime payload: conversationId Invalid input: expected string, received undefined",
    },
  ]);
});
