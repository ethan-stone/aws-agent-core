import type {
  Device,
  DeviceMetricSnapshot,
  DeviceStatus,
  Incident,
  IncidentSeverity,
  SimulationScenario,
  SimulationScenarioType,
} from "@agent-core/pulseforge-domain";
import {
  appendDeviceTelemetry,
  completeActiveSimulationScenariosForDevice,
  createIncident,
  createIncidentActivity,
  createSimulationScenario,
  findOpenIncidentForDeviceCategory,
  getDevice,
  listDevices,
  listSimulationScenarios,
  updateDeviceCurrentState,
  updateIncident,
  updateSimulationScenario,
} from "./pulseforge-service.js";

const MAX_SCENARIO_DURATION_MINUTES = 15;
const DEFAULT_SCENARIO_DURATION_MINUTES = 5;
const DEFAULT_TRIGGER_AFTER_POINTS = 1;

export interface QueueSimulationScenarioInput {
  deviceId: string;
  type: SimulationScenarioType;
  durationMinutes?: number;
  triggerAfterConsecutivePoints?: number;
}

export interface SimulationTickResult {
  emittedTelemetry: number;
  activatedScenarios: number;
  completedScenarios: number;
  incidentIds: string[];
}

type Range = { min: number; max: number };
type ScenarioEffect = {
  batteryPercent?: Range;
  connectivityPercent?: Range;
  packetLossPercent?: Range;
  signalStrength?: Range;
  status: DeviceStatus;
  temperatureC?: Range;
  vibrationMmS?: Range;
};

const normalProfiles: Record<Device["type"], Omit<ScenarioEffect, "status">> = {
  "freezer-sensor": {
    batteryPercent: { min: 70, max: 98 },
    connectivityPercent: { min: 94, max: 100 },
    packetLossPercent: { min: 0, max: 1.2 },
    signalStrength: { min: 76, max: 96 },
    temperatureC: { min: -22, max: -17 },
  },
  "vibration-monitor": {
    batteryPercent: { min: 55, max: 95 },
    connectivityPercent: { min: 94, max: 100 },
    packetLossPercent: { min: 0, max: 0.8 },
    signalStrength: { min: 78, max: 98 },
    vibrationMmS: { min: 1.4, max: 2.8 },
  },
  gateway: {
    batteryPercent: { min: 96, max: 100 },
    connectivityPercent: { min: 95, max: 100 },
    packetLossPercent: { min: 0, max: 1 },
    signalStrength: { min: 74, max: 96 },
  },
  "power-meter": {
    batteryPercent: { min: 85, max: 100 },
    connectivityPercent: { min: 95, max: 100 },
    packetLossPercent: { min: 0, max: 0.7 },
    signalStrength: { min: 78, max: 98 },
  },
};

const abnormalProfiles: Record<SimulationScenarioType, ScenarioEffect> = {
  "temperature-drift": {
    status: "critical",
    batteryPercent: { min: 65, max: 95 },
    connectivityPercent: { min: 88, max: 97 },
    packetLossPercent: { min: 2, max: 5.5 },
    signalStrength: { min: 58, max: 78 },
    temperatureC: { min: -9, max: -2 },
  },
  "connectivity-loss": {
    status: "critical",
    batteryPercent: { min: 70, max: 100 },
    connectivityPercent: { min: 35, max: 70 },
    packetLossPercent: { min: 10, max: 28 },
    signalStrength: { min: 22, max: 48 },
  },
  "battery-degradation": {
    status: "warning",
    batteryPercent: { min: 8, max: 24 },
    connectivityPercent: { min: 85, max: 98 },
    packetLossPercent: { min: 0.8, max: 3 },
    signalStrength: { min: 62, max: 86 },
  },
};

export async function queueSimulationScenario(
  input: QueueSimulationScenarioInput
): Promise<SimulationScenario> {
  const device = await getDevice(input.deviceId);
  if (!device) {
    throw new Error(`Device ${input.deviceId} was not found.`);
  }
  if (device.source !== "simulated") {
    throw new Error(`Device ${input.deviceId} is not simulated.`);
  }

  const durationMinutes = Math.min(
    MAX_SCENARIO_DURATION_MINUTES,
    Math.max(1, input.durationMinutes ?? DEFAULT_SCENARIO_DURATION_MINUTES)
  );
  const triggerAfterConsecutivePoints = Math.max(
    1,
    input.triggerAfterConsecutivePoints ?? DEFAULT_TRIGGER_AFTER_POINTS
  );

  return createSimulationScenario({
    deviceId: input.deviceId,
    type: input.type,
    durationMinutes,
    triggerAfterConsecutivePoints,
  });
}

export async function runDeviceSimulationTick(
  now = new Date()
): Promise<SimulationTickResult> {
  const nowIso = now.toISOString();
  const [devices, scenarios] = await Promise.all([
    listDevices(),
    listSimulationScenarios(["queued", "active"]),
  ]);
  const scenariosByDevice = groupScenariosByDevice(scenarios);
  const incidentIds = new Set<string>();
  let emittedTelemetry = 0;
  let activatedScenarios = 0;
  let completedScenarios = 0;

  for (const device of devices.filter((item) => item.source === "simulated")) {
    const scenario = pickScenario(scenariosByDevice.get(device.id) ?? []);
    const activeScenario =
      scenario && scenario.status === "queued"
        ? await activateScenario(scenario, now)
        : scenario;
    if (scenario?.status === "queued") {
      activatedScenarios += 1;
    }

    const effect = activeScenario
      ? abnormalProfiles[activeScenario.type]
      : { ...normalProfiles[device.type], status: "healthy" as const };
    const metric = buildMetric(device, effect, nowIso);
    await appendDeviceTelemetry(device.id, metric);
    emittedTelemetry += 1;

    await updateDeviceCurrentState(device.id, {
      batteryPercent: metric.batteryPercent,
      connectivityPercent: metricToConnectivity(metric),
      status: effect.status,
      lastSeenAt: nowIso,
    });

    if (activeScenario) {
      const updatedScenario = await advanceScenario(
        activeScenario,
        device,
        now,
        incidentIds
      );
      if (updatedScenario && isExpired(updatedScenario, now)) {
        await updateSimulationScenario(updatedScenario.id, {
          status: "completed",
          completedAt: nowIso,
          completedReason: "duration_elapsed",
        });
        completedScenarios += 1;
      }
    }
  }

  return {
    emittedTelemetry,
    activatedScenarios,
    completedScenarios,
    incidentIds: [...incidentIds],
  };
}

export async function recoverSimulatedDeviceFromReset(deviceId: string) {
  const completed = await completeActiveSimulationScenariosForDevice(
    deviceId,
    "reset_recovery"
  );
  return { completedScenarios: completed.length };
}

async function activateScenario(
  scenario: SimulationScenario,
  now: Date
): Promise<SimulationScenario> {
  const startedAt = now.toISOString();
  const expiresAt = new Date(
    now.getTime() + scenario.durationMinutes * 60_000
  ).toISOString();
  return (
    (await updateSimulationScenario(scenario.id, {
      status: "active",
      startedAt,
      expiresAt,
    })) ?? scenario
  );
}

async function advanceScenario(
  scenario: SimulationScenario,
  device: Device,
  now: Date,
  incidentIds: Set<string>
): Promise<SimulationScenario | null> {
  const consecutiveAffectedPoints = scenario.consecutiveAffectedPoints + 1;
  const shouldTrigger =
    !scenario.triggeredAt &&
    consecutiveAffectedPoints >= scenario.triggerAfterConsecutivePoints;
  let incidentId = scenario.incidentId;
  let triggeredAt = scenario.triggeredAt;

  if (shouldTrigger) {
    const incident = await createOrUpdateScenarioIncident(device, scenario, now);
    incidentId = incident.id;
    triggeredAt = now.toISOString();
    incidentIds.add(incident.id);
  } else if (incidentId) {
    incidentIds.add(incidentId);
    await updateIncident(incidentId, { updatedAt: now.toISOString() });
  }

  return updateSimulationScenario(scenario.id, {
    consecutiveAffectedPoints,
    ...(triggeredAt ? { triggeredAt } : {}),
    ...(incidentId ? { incidentId } : {}),
  });
}

async function createOrUpdateScenarioIncident(
  device: Device,
  scenario: SimulationScenario,
  now: Date
): Promise<Incident> {
  const category = scenarioToIncidentCategory(scenario.type);
  const existing = await findOpenIncidentForDeviceCategory(device.id, category);
  const severity = scenarioToSeverity(scenario.type);
  const title = scenarioIncidentTitle(device, scenario.type);
  const summary = scenarioIncidentSummary(device, scenario.type);

  if (existing) {
    return (
      (await updateIncident(existing.id, {
        severity: maxSeverity(existing.severity, severity),
        summary,
        updatedAt: now.toISOString(),
      })) ?? existing
    );
  }

  const incident = await createIncident({
    siteId: device.siteId,
    title,
    summary,
    severity,
    status: "open",
    deviceIds: [device.id],
    category,
  });
  await createIncidentActivity({
    incidentId: incident.id,
    kind: "detected",
    message: `Device simulation detected ${scenario.type} on ${device.name}.`,
    createdBy: { actorType: "agent", actorId: "device-simulation" },
    title: "Simulated incident detected",
  });
  return incident;
}

function buildMetric(
  device: Device,
  effect: ScenarioEffect,
  timestamp: string
): DeviceMetricSnapshot {
  return {
    timestamp,
    batteryPercent: round(rangeValue(effect.batteryPercent), 0),
    signalStrength: round(rangeValue(effect.signalStrength), 0),
    packetLossPercent: round(rangeValue(effect.packetLossPercent), 1),
    ...(effect.temperatureC ? { temperatureC: round(rangeValue(effect.temperatureC), 1) } : {}),
    ...(effect.vibrationMmS && device.type === "vibration-monitor"
      ? { vibrationMmS: round(rangeValue(effect.vibrationMmS), 1) }
      : {}),
  };
}

function metricToConnectivity(metric: DeviceMetricSnapshot) {
  return Math.max(0, Math.min(100, round(100 - metric.packetLossPercent * 3, 0)));
}

function groupScenariosByDevice(scenarios: SimulationScenario[]) {
  const map = new Map<string, SimulationScenario[]>();
  for (const scenario of scenarios) {
    const group = map.get(scenario.deviceId) ?? [];
    group.push(scenario);
    map.set(scenario.deviceId, group);
  }
  return map;
}

function pickScenario(scenarios: SimulationScenario[]) {
  return scenarios
    .filter((scenario) => scenario.status === "active" || scenario.status === "queued")
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
}

function isExpired(scenario: SimulationScenario, now: Date) {
  return Boolean(scenario.expiresAt && new Date(scenario.expiresAt) <= now);
}

function scenarioToIncidentCategory(
  type: SimulationScenarioType
): Incident["category"] {
  if (type === "temperature-drift") {
    return "temperature-drift";
  }
  if (type === "connectivity-loss") {
    return "connectivity-loss";
  }
  return "battery-degradation";
}

function scenarioToSeverity(type: SimulationScenarioType): IncidentSeverity {
  return type === "battery-degradation" ? "medium" : "critical";
}

function scenarioIncidentTitle(device: Device, type: SimulationScenarioType) {
  if (type === "temperature-drift") {
    return `${device.name} temperature drift`;
  }
  if (type === "connectivity-loss") {
    return `${device.name} connectivity loss`;
  }
  return `${device.name} battery degradation`;
}

function scenarioIncidentSummary(device: Device, type: SimulationScenarioType) {
  return `Simulated ${type} telemetry crossed the incident threshold for ${device.name}.`;
}

function maxSeverity(left: IncidentSeverity, right: IncidentSeverity) {
  const order: IncidentSeverity[] = ["low", "medium", "high", "critical"];
  return order.indexOf(right) > order.indexOf(left) ? right : left;
}

function rangeValue(range: Range | undefined) {
  if (!range) {
    return 0;
  }
  return range.min + Math.random() * (range.max - range.min);
}

function round(value: number, places: number) {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}
