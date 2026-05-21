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
    ]);
  });

  it("keeps per-tool scopes narrower than the bundle grant", () => {
    const deviceTool = getPulseForgeAgentToolDefinitions("ops-copilot").find(
      (definition) => definition.name === "get_device"
    );

    expect(deviceTool?.requiredScopes).toEqual(["read:devices"]);
  });
});
