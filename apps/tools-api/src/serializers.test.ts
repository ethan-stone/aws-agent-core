import { describe, expect, it } from "vitest";
import type { IncidentInvestigationContext } from "../../../shared/pulseforge-domain/src/index.js";
import { serializeIncidentContext } from "./serializers.js";

describe("serializeIncidentContext", () => {
  it("includes resolution evidence from approvals, reset tools, audit logs, and recovery signals", () => {
    const context: IncidentInvestigationContext = {
      incident: {
        id: "inc-resolved",
        siteId: "site-1",
        title: "Freezer drift",
        summary: "Freezer warmed above threshold.",
        severity: "high",
        status: "resolved",
        deviceIds: ["dev-1"],
        createdAt: "2026-05-31T12:00:00.000Z",
        updatedAt: "2026-05-31T12:17:00.000Z",
        resolvedAt: "2026-05-31T12:17:00.000Z",
        resolvedByUserId: "user-123",
        category: "temperature-drift",
      },
      activities: [],
      comments: [],
      agentMentions: [],
      actionApprovals: [
        {
          id: "approval-1",
          incidentId: "inc-resolved",
          conversationId: "conv-1",
          agentRunId: "run-1",
          requiredActionId: "action-1",
          toolName: "reset_device",
          title: "Reset device",
          summary: "Reset dev-1.",
          status: "resolved",
          requestedAt: "2026-05-31T12:08:00.000Z",
          resolvedAt: "2026-05-31T12:09:00.000Z",
          resolvedByUserId: "user-123",
        },
      ],
      devices: [
        {
          device: {
            id: "dev-1",
            siteId: "site-1",
            name: "Freezer 1",
            type: "freezer-sensor",
            source: "simulated",
            firmwareVersion: "1.0.0",
            batteryPercent: 96,
            connectivityPercent: 99,
            status: "healthy",
            tags: ["simulated"],
            lastSeenAt: "2026-05-31T12:16:00.000Z",
          },
          telemetry: [
            {
              timestamp: "2026-05-31T12:16:00.000Z",
              temperatureC: -18.2,
              batteryPercent: 96,
              signalStrength: 97,
              packetLossPercent: 0.2,
            },
          ],
        },
      ],
      relatedIncidents: [],
      remediationActions: [],
      tickets: [],
      simulationScenarios: [
        {
          id: "scenario-1",
          deviceId: "dev-1",
          type: "temperature-drift",
          status: "completed",
          durationMinutes: 30,
          triggerAfterConsecutivePoints: 2,
          consecutiveAffectedPoints: 3,
          createdAt: "2026-05-31T11:55:00.000Z",
          incidentId: "inc-resolved",
          completedAt: "2026-05-31T12:10:00.000Z",
          completedReason: "reset_recovery",
        },
      ],
      linkedAgentWork: [
        {
          conversation: {
            id: "conv-1",
            rootAgentKind: "ops-copilot",
            status: "open",
            incidentId: "inc-resolved",
            createdAt: "2026-05-31T12:07:00.000Z",
            updatedAt: "2026-05-31T12:12:00.000Z",
          },
          runs: [
            {
              id: "run-1",
              conversationId: "conv-1",
              incidentId: "inc-resolved",
              agentKind: "ops-copilot",
              relationship: "root",
              status: "completed",
              startedAt: "2026-05-31T12:07:00.000Z",
              requestedByUserId: "user-123",
              completedAt: "2026-05-31T12:12:00.000Z",
              summary: "Reset restored normal operation.",
            },
          ],
          items: [
            {
              id: "tool-call-1",
              runId: "run-1",
              sequence: 1,
              kind: "tool_call",
              source: {
                type: "agent",
                agentRunId: "run-1",
                agentKind: "ops-copilot",
              },
              createdAt: "2026-05-31T12:09:05.000Z",
              toolCallId: "reset-call-1",
              toolName: "reset_device",
              arguments: { deviceId: "dev-1" },
              status: "succeeded",
            },
            {
              id: "tool-result-1",
              runId: "run-1",
              sequence: 2,
              kind: "tool_result",
              source: { type: "tool", toolName: "reset_device" },
              createdAt: "2026-05-31T12:09:10.000Z",
              toolCallId: "reset-call-1",
              content: [
                {
                  type: "json",
                  value: {
                    deviceReset: {
                      deviceId: "dev-1",
                      status: "succeeded",
                      resetAt: "2026-05-31T12:09:10.000Z",
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
      auditLogs: [
        {
          id: "audit-1",
          timestamp: "2026-05-31T12:09:10.000Z",
          actor: {
            actorType: "agent",
            actorId: "agent-user",
            onBehalfOfUserId: "user-123",
            agentRunId: "run-1",
          },
          operation: "device.reset",
          method: "POST",
          path: "/devices/dev-1/reset",
          scopes: ["write:device_commands"],
          resourceType: "device",
          resourceId: "dev-1",
          outcome: "succeeded",
          statusCode: 200,
        },
      ],
      resolutionEvidence: {
        isResolved: true,
        resolvedAt: "2026-05-31T12:17:00.000Z",
        resolvedByUserId: "user-123",
        timeline: [
          {
            timestamp: "2026-05-31T12:08:00.000Z",
            kind: "approval_requested",
            title: "Reset device",
            summary: "Reset dev-1.",
            actor: {
              actorType: "agent",
              actorId: "ops-copilot",
              agentRunId: "run-1",
            },
            source: { type: "incident_action_approval", id: "approval-1" },
          },
          {
            timestamp: "2026-05-31T12:09:00.000Z",
            kind: "approval_resolved",
            title: "Approved: Reset device",
            summary: "Reset dev-1.",
            actor: { actorType: "user", actorId: "user-123" },
            source: { type: "incident_action_approval", id: "approval-1" },
          },
          {
            timestamp: "2026-05-31T12:09:05.000Z",
            kind: "tool_call",
            title: "Tool called: reset_device",
            summary: "{\"deviceId\":\"dev-1\"}",
            actor: {
              actorType: "agent",
              actorId: "ops-copilot",
              agentRunId: "run-1",
            },
            source: { type: "run_item", id: "tool-call-1" },
          },
          {
            timestamp: "2026-05-31T12:09:10.000Z",
            kind: "audit_event",
            title: "Device reset audited",
            summary: "POST /devices/dev-1/reset",
            actor: {
              actorType: "agent",
              actorId: "agent-user",
              onBehalfOfUserId: "user-123",
              agentRunId: "run-1",
            },
            source: { type: "audit_log", id: "audit-1" },
          },
          {
            timestamp: "2026-05-31T12:10:00.000Z",
            kind: "recovery_signal",
            title: "Simulation recovered after reset",
            source: { type: "simulation_scenario", id: "scenario-1" },
          },
          {
            timestamp: "2026-05-31T12:17:00.000Z",
            kind: "incident_resolved",
            title: "Incident resolved",
            actor: { actorType: "user", actorId: "user-123" },
            source: { type: "incident", id: "inc-resolved" },
          },
        ],
        currentState: {
          incidentStatus: "resolved",
          latestDeviceStates: [
            {
              deviceId: "dev-1",
              status: "healthy",
              batteryPercent: 96,
              connectivityPercent: 99,
              lastSeenAt: "2026-05-31T12:16:00.000Z",
              latestTelemetry: {
                timestamp: "2026-05-31T12:16:00.000Z",
                temperatureC: -18.2,
                batteryPercent: 96,
                signalStrength: 97,
                packetLossPercent: 0.2,
              },
            },
          ],
        },
      },
    };

    const response = serializeIncidentContext(context);

    expect(response.resolutionEvidence.isResolved).toBe(true);
    expect(response.resolutionEvidence.resolvedByUserId).toBe("user-123");
    expect(response.resolutionEvidence.timeline.map((entry) => entry.kind)).toEqual([
      "approval_requested",
      "approval_resolved",
      "tool_call",
      "audit_event",
      "recovery_signal",
      "incident_resolved",
    ]);
    expect(response.resolutionEvidence.timeline[1].actor).toEqual({
      actorType: "user",
      actorId: "user-123",
    });
    expect(response.resolutionEvidence.currentState.latestDeviceStates[0]).toMatchObject({
      deviceId: "dev-1",
      status: "healthy",
    });
    expect(response.linkedAgentWork[0].runs[0].requestedByUserId).toBe(
      "user-123"
    );
  });
});
