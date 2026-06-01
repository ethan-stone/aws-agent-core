export const queryKeys = {
  dashboard: ["dashboard"] as const,
  devices: ["devices"] as const,
  device: (deviceId: string) => ["device", deviceId] as const,
  deviceTelemetry: (deviceId: string) =>
    ["device", deviceId, "telemetry"] as const,
  incidents: ["incidents"] as const,
  incident: (incidentId: string) => ["incident", incidentId] as const,
  conversations: ["conversations"] as const,
  conversation: (conversationId: string) =>
    ["conversation", conversationId] as const,
};
