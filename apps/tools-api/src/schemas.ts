import { z } from "@hono/zod-openapi";
import {
  createIncidentActivityInputSchema,
  createTicketInputSchema,
  getDeviceInputSchema,
  getDeviceTelemetryInputSchema,
  getIncidentContextInputSchema,
  proposeRemediationActionInputSchema,
  resetDeviceInputSchema,
} from "../../../shared/pulseforge-tools/src/index.js";

export const errorResponseSchema = z.object({
  ok: z.literal(false),
  errorCode: z.string(),
  message: z.string(),
});

export const deviceParamsSchema = getDeviceInputSchema.openapi("DeviceParams");
export const telemetryParamsSchema =
  getDeviceTelemetryInputSchema.openapi("TelemetryParams");
export const resetDeviceParamsSchema =
  getDeviceInputSchema.openapi("ResetDeviceParams");
export const resetDeviceBodySchema = resetDeviceInputSchema
  .omit({ deviceId: true })
  .openapi("ResetDeviceBody");
export const incidentContextParamsSchema =
  getIncidentContextInputSchema.openapi("IncidentContextParams");

export const incidentActivityParamsSchema = z
  .object({ incidentId: z.string().min(1) })
  .openapi("IncidentActivityParams");
export const createIncidentActivityBodySchema = createIncidentActivityInputSchema
  .omit({ incidentId: true })
  .openapi("CreateIncidentActivityBody");

export const createTicketParamsSchema = z
  .object({ incidentId: z.string().min(1) })
  .openapi("CreateTicketParams");
export const createTicketBodySchema = createTicketInputSchema
  .omit({ incidentId: true })
  .openapi("CreateTicketBody");

export const proposeRemediationActionParamsSchema = z
  .object({ incidentId: z.string().min(1) })
  .openapi("ProposeRemediationActionParams");
export const proposeRemediationActionBodySchema =
  proposeRemediationActionInputSchema
    .omit({ incidentId: true })
    .openapi("ProposeRemediationActionBody");

export const curatedToolResponseSchema = z
  .object({ ok: z.literal(true) })
  .passthrough();
