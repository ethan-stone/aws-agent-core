import "./load-env.js";
import {
  queueSimulationScenario,
  type QueueSimulationScenarioInput,
} from "@agent-core/pulseforge-backend";
import type { SimulationScenarioType } from "@agent-core/pulseforge-domain";

const scenarioTypes = new Set<SimulationScenarioType>([
  "temperature-drift",
  "connectivity-loss",
  "battery-degradation",
]);

export async function handler(event: unknown) {
  const request = parseQueueScenarioEvent(event);
  const scenario = await queueSimulationScenario(request);
  console.info("[device-simulator] scenario queued", {
    scenarioId: scenario.id,
    deviceId: scenario.deviceId,
    type: scenario.type,
  });
  return {
    ok: true,
    scenario,
  };
}

function parseQueueScenarioEvent(event: unknown): QueueSimulationScenarioInput {
  if (!event || typeof event !== "object") {
    throw new Error("Queue scenario event must be an object.");
  }

  const input =
    "body" in event && typeof event.body === "string"
      ? JSON.parse(event.body)
      : event;
  if (!input || typeof input !== "object") {
    throw new Error("Queue scenario input must be an object.");
  }

  const deviceId = valueAsString(input, "deviceId");
  const type = valueAsString(input, "type");
  if (!deviceId) {
    throw new Error("deviceId is required.");
  }
  if (!type || !scenarioTypes.has(type as SimulationScenarioType)) {
    throw new Error(
      "type must be temperature-drift, connectivity-loss, or battery-degradation."
    );
  }

  return {
    deviceId,
    type: type as SimulationScenarioType,
    durationMinutes: valueAsNumber(input, "durationMinutes"),
    triggerAfterConsecutivePoints: valueAsNumber(
      input,
      "triggerAfterConsecutivePoints"
    ),
  };
}

function valueAsString(value: object, key: string) {
  const item = (value as Record<string, unknown>)[key];
  return typeof item === "string" && item.trim() ? item.trim() : undefined;
}

function valueAsNumber(value: object, key: string) {
  const item = (value as Record<string, unknown>)[key];
  return typeof item === "number" && Number.isFinite(item) ? item : undefined;
}
