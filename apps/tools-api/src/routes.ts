import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import {
  buildIncidentInvestigationContext,
  createIncidentEvent,
  createRemediationAction,
  createTicket,
  getDevice,
  getDeviceTelemetry,
  getIncident,
} from "../../../shared/pulseforge-backend/src/index.js";
import type { ToolsApiEnv } from "./types.js";
import { getToolAuth, requireToolAccess, toolScopes } from "./auth.js";
import {
  createIncidentEventBodySchema,
  createTicketBodySchema,
  createTicketParamsSchema,
  curatedToolResponseSchema,
  deviceParamsSchema,
  errorResponseSchema,
  incidentEventParamsSchema,
  incidentContextParamsSchema,
  proposeRemediationActionBodySchema,
  proposeRemediationActionParamsSchema,
  telemetryParamsSchema,
} from "./schemas.js";
import {
  serializeCreatedIncidentEvent,
  serializeDevice,
  serializeDeviceTelemetry,
  serializeIncidentContext,
  serializeRemediationAction,
  serializeTicket,
  serializeToolError,
} from "./serializers.js";

const toolResponses = {
  200: {
    description: "Tool response",
    content: { "application/json": { schema: curatedToolResponseSchema } },
  },
  400: {
    description: "Invalid tool request",
    content: { "application/json": { schema: errorResponseSchema } },
  },
  401: {
    description: "Authentication required",
    content: { "application/json": { schema: errorResponseSchema } },
  },
  403: {
    description: "Forbidden",
    content: { "application/json": { schema: errorResponseSchema } },
  },
  404: {
    description: "Not found",
    content: { "application/json": { schema: errorResponseSchema } },
  },
  503: {
    description: "Tool auth unavailable",
    content: { "application/json": { schema: errorResponseSchema } },
  },
} as const;

export const toolsApp = new OpenAPIHono<ToolsApiEnv>();

toolsApp.openapi(
  createRoute({
    method: "get",
    path: "/devices/{deviceId}",
    request: { params: deviceParamsSchema },
    middleware: [
      requireToolAccess({
        operation: "devices.read",
        scopes: [toolScopes.readDevices],
        resourceType: "device",
        getResourceId: (c) => c.req.param("deviceId") ?? "",
      }),
    ] as const,
    responses: toolResponses,
  }),
  (async (c: any) => {
    const { deviceId } = c.req.valid("param");
    const device = await getDevice(deviceId);
    if (!device) {
      return c.json(serializeToolError("device_not_found", "Device not found"), 404);
    }

    return c.json(serializeDevice(device));
  }) as never
);

toolsApp.openapi(
  createRoute({
    method: "get",
    path: "/devices/{deviceId}/telemetry",
    request: { params: telemetryParamsSchema },
    middleware: [
      requireToolAccess({
        operation: "device_telemetry.read",
        scopes: [toolScopes.readTelemetry],
        resourceType: "device",
        getResourceId: (c) => c.req.param("deviceId") ?? "",
      }),
    ] as const,
    responses: toolResponses,
  }),
  (async (c: any) => {
    const { deviceId } = c.req.valid("param");
    const telemetry = await getDeviceTelemetry(deviceId);
    if (!telemetry) {
      return c.json(
        serializeToolError("device_telemetry_not_found", "Device telemetry not found"),
        404
      );
    }

    return c.json(serializeDeviceTelemetry(deviceId, telemetry));
  }) as never
);

toolsApp.openapi(
  createRoute({
    method: "get",
    path: "/incidents/{incidentId}/context",
    request: { params: incidentContextParamsSchema },
    middleware: [
      requireToolAccess({
        operation: "incident_context.read",
        scopes: [
          toolScopes.readIncidents,
          toolScopes.readDevices,
          toolScopes.readTelemetry,
        ],
        resourceType: "incident",
        getResourceId: (c) => c.req.param("incidentId") ?? "",
      }),
    ] as const,
    responses: toolResponses,
  }),
  (async (c: any) => {
    const { incidentId } = c.req.valid("param");
    const context = await buildIncidentInvestigationContext(incidentId);
    if (!context) {
      return c.json(serializeToolError("incident_not_found", "Incident not found"), 404);
    }

    return c.json(serializeIncidentContext(context));
  }) as never
);

toolsApp.openapi(
  createRoute({
    method: "post",
    path: "/incidents/{incidentId}/events",
    request: {
      params: incidentEventParamsSchema,
      body: {
        content: { "application/json": { schema: createIncidentEventBodySchema } },
      },
    },
    middleware: [
      requireToolAccess({
        operation: "incident_events.create",
        scopes: [toolScopes.writeIncidentEvents],
        resourceType: "incident",
        getResourceId: (c) => c.req.param("incidentId") ?? "",
      }),
    ] as const,
    responses: { ...toolResponses, 201: toolResponses[200] },
  }),
  (async (c: any) => {
    const { incidentId } = c.req.valid("param");
    const incident = await getIncident(incidentId);
    if (!incident) {
      return c.json(serializeToolError("incident_not_found", "Incident not found"), 404);
    }

    const body = c.req.valid("json");
    const event = await createIncidentEvent({
      incidentId,
      kind: body.kind,
      message: body.message,
      createdBy: getToolAuth(c).actor,
    });

    return c.json(serializeCreatedIncidentEvent(event), 201);
  }) as never
);

toolsApp.openapi(
  createRoute({
    method: "post",
    path: "/incidents/{incidentId}/tickets",
    request: {
      params: createTicketParamsSchema,
      body: {
        content: { "application/json": { schema: createTicketBodySchema } },
      },
    },
    middleware: [
      requireToolAccess({
        operation: "tickets.create",
        scopes: [toolScopes.writeTickets],
        resourceType: "incident",
        getResourceId: (c) => c.req.param("incidentId") ?? "",
      }),
    ] as const,
    responses: { ...toolResponses, 201: toolResponses[200] },
  }),
  (async (c: any) => {
    const { incidentId } = c.req.valid("param");
    const incident = await getIncident(incidentId);
    if (!incident) {
      return c.json(serializeToolError("incident_not_found", "Incident not found"), 404);
    }

    const body = c.req.valid("json");
    const ticket = await createTicket({
      incidentId,
      assigneeTeam: body.assigneeTeam,
      externalRef: body.externalRef,
      status: body.status,
      createdBy: getToolAuth(c).actor,
    });

    return c.json(serializeTicket(ticket), 201);
  }) as never
);

toolsApp.openapi(
  createRoute({
    method: "post",
    path: "/incidents/{incidentId}/remediation-actions",
    request: {
      params: proposeRemediationActionParamsSchema,
      body: {
        content: {
          "application/json": { schema: proposeRemediationActionBodySchema },
        },
      },
    },
    middleware: [
      requireToolAccess({
        operation: "remediation_actions.create",
        scopes: [toolScopes.writeRemediationActions],
        resourceType: "incident",
        getResourceId: (c) => c.req.param("incidentId") ?? "",
      }),
    ] as const,
    responses: { ...toolResponses, 201: toolResponses[200] },
  }),
  (async (c: any) => {
    const { incidentId } = c.req.valid("param");
    const incident = await getIncident(incidentId);
    if (!incident) {
      return c.json(serializeToolError("incident_not_found", "Incident not found"), 404);
    }

    const body = c.req.valid("json");
    const action = await createRemediationAction({
      incidentId,
      type: body.type,
      risk: body.risk,
      summary: body.summary,
      createdBy: getToolAuth(c).actor,
    });

    return c.json(serializeRemediationAction(action), 201);
  }) as never
);
