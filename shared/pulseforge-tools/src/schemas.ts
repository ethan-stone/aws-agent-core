import { z } from "zod";

export const toolErrorOutputSchema = z.object({
  ok: z.literal(false),
  errorCode: z.string(),
  message: z.string(),
});

const okOutputSchema = z.object({ ok: z.literal(true) }).passthrough();
export const genericToolOutputSchema = z.union([
  okOutputSchema,
  toolErrorOutputSchema,
]);

export const getIncidentContextInputSchema = z.object({
  incidentId: z
    .string()
    .min(1)
    .describe("PulseForge incident id to investigate."),
});

export const getDeviceInputSchema = z.object({
  deviceId: z.string().min(1).describe("PulseForge IoT device id."),
});

export const getDeviceTelemetryInputSchema = z.object({
  deviceId: z.string().min(1).describe("PulseForge IoT device id."),
});

export const resetDeviceInputSchema = z.object({
  deviceId: z.string().min(1).describe("PulseForge IoT device id to reset."),
  reason: z
    .string()
    .min(1)
    .max(1200)
    .describe("Operator-readable reason for resetting the device."),
});

export const createIncidentEventInputSchema = z.object({
  incidentId: z.string().min(1).describe("Incident id to append an event to."),
  kind: z
    .enum(["agent_summary", "action_attempted", "action_result", "ticket_created"])
    .describe("Type of event being recorded."),
  message: z
    .string()
    .min(1)
    .max(1200)
    .describe("Operator-readable event text."),
});

export const createTicketInputSchema = z.object({
  incidentId: z.string().min(1).describe("Incident id for the ticket."),
  assigneeTeam: z
    .string()
    .min(1)
    .max(120)
    .describe("Team that should own the ticket."),
  externalRef: z
    .string()
    .min(1)
    .max(120)
    .optional()
    .describe("Optional external ticket reference."),
  status: z
    .enum(["open", "in_progress", "waiting", "closed"])
    .optional()
    .describe("Initial ticket status."),
});

export const proposeRemediationActionInputSchema = z.object({
  incidentId: z.string().min(1).describe("Incident id for the remediation."),
  type: z
    .enum([
      "reboot-device",
      "rollback-firmware",
      "increase-sampling",
      "dispatch-technician",
    ])
    .describe("Remediation action type."),
  risk: z.enum(["low", "medium", "high"]).describe("Estimated operational risk."),
  summary: z
    .string()
    .min(1)
    .max(1200)
    .describe("Operator-readable rationale and expected impact."),
});
