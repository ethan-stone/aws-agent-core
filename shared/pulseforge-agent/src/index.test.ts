import { describe, expect, it } from "vitest";
import {
  getPulseForgeAgentToolAuthorizationGroups,
  getPulseForgeAgentToolDefinitions,
} from "./index.js";

describe("PulseForge agent tool authorization", () => {
  it("groups ops-copilot tools into one PulseForge delegated auth request", () => {
    const groups = getPulseForgeAgentToolAuthorizationGroups("ops-copilot");

    expect(groups).toHaveLength(1);
    expect(groups[0]?.provider.key).toBe("pulseforge-backend");
    expect(groups[0]?.scopes).toEqual([
      "read:incidents",
      "read:devices",
      "read:telemetry",
      "write:incident_events",
      "write:tickets",
      "write:remediation_actions",
      "write:device_commands",
    ]);
  });

  it("keeps per-tool scopes narrower than the bundle grant", () => {
    const deviceTool = getPulseForgeAgentToolDefinitions("ops-copilot").find(
      (definition) => definition.name === "get_device"
    );

    expect(deviceTool?.requiredScopes).toEqual(["read:devices"]);
  });

  it("includes curated incident context in the ops-copilot tool bundle", () => {
    const toolNames = getPulseForgeAgentToolDefinitions("ops-copilot").map(
      (definition) => definition.name
    );

    expect(toolNames).toContain("get_incident_context");
  });

  it("requires operator approval for device reset tool calls", () => {
    const resetTool = getPulseForgeAgentToolDefinitions("ops-copilot").find(
      (definition) => definition.name === "reset_device"
    );

    expect(resetTool?.requiredScopes).toEqual(["write:device_commands"]);
    expect(resetTool?.approval).toMatchObject({
      required: true,
      actionType: "tool_approval",
      risk: "high",
    });
    expect(
      resetTool?.approval?.buildApproval({
        deviceId: "dev-freezer-014",
        reason: "operator requested reset",
      })
    ).toEqual({
      approvalKey: "reset_device:device:dev-freezer-014",
      approvalLabel: "Reset device dev-freezer-014",
      allowAlwaysLabel: "Always allow reset for dev-freezer-014",
    });
  });
});
