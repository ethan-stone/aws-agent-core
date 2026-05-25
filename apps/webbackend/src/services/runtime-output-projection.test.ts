import { describe, expect, it } from "vitest";
import { parseAgentRuntimeResponse } from "./runtime-output-projection.js";

describe("parseAgentRuntimeResponse", () => {
  it("maps runtime activity events into domain run items", () => {
    const result = parseAgentRuntimeResponse(
      [
        {
          event: "tool_call",
          data: {
            toolCallId: "tool-1",
            toolName: "get_incident_context",
            arguments: { incidentId: "inc-1001" },
          },
        },
        {
          event: "auth_required",
          data: {
            requiredActionId: "auth-1",
            providerName: "pulseforge-backend",
            providerDisplayName: "PulseForge Backend",
            authUrl: "https://example.com/auth",
            scopes: ["read:incidents"],
            agentRunId: "runtime-run-id",
          },
        },
        {
          event: "action_resolution",
          data: {
            requiredActionId: "auth-1",
            outcome: "resolved",
            content: [{ type: "text", text: "Authorization completed." }],
          },
        },
        {
          event: "tool_result",
          data: {
            toolCallId: "tool-1",
            toolName: "get_incident_context",
            content: { ok: true, incidentId: "inc-1001" },
          },
        },
        {
          event: "run_agent",
          data: {
            relationship: "agent_as_tool",
            agentKind: "anomaly-investigation",
            childRunId: "child-run-1",
            toolCallId: "tool-2",
            status: "completed",
          },
        },
        {
          event: "message",
          data: { text: "The incident is correlated with firmware rollout." },
        },
        {
          event: "summary",
          data: {
            title: "Investigation summary",
            summary: "Firmware rollout is the likely cause.",
            findings: ["Temperature drift began after firmware 1.14.7."],
            recommendedActions: ["Rollback affected sensors."],
          },
        },
      ],
      { id: "run-1", agentKind: "ops-copilot" }
    );

    expect(result.summary).toBe("Firmware rollout is the likely cause.");
    expect(result.authRequired).toBeUndefined();
    expect(result.items.map((item) => item.kind)).toEqual([
      "tool_call",
      "required_action",
      "action_resolution",
      "tool_result",
      "run_agent",
      "message",
    ]);
    expect(result.items[1]).toMatchObject({
      kind: "required_action",
      requiredActionId: "auth-1",
      actionType: "authorization",
      status: "pending",
    });
    expect(result.items[4]).toMatchObject({
      kind: "run_agent",
      relationship: "agent_as_tool",
      childRunId: "child-run-1",
    });
  });
});
