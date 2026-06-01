import "../load-env.js";
import {
  queueSimulationScenario,
  type QueueSimulationScenarioInput,
} from "../../../../shared/pulseforge-backend/src/index.js";
import type { SimulationScenarioType } from "../../../../shared/pulseforge-domain/src/index.js";

const args = parseArgs(process.argv.slice(2));
const request: QueueSimulationScenarioInput = {
  deviceId: required(args, "device-id"),
  type: required(args, "type") as SimulationScenarioType,
  durationMinutes: optionalNumber(args, "duration-minutes"),
  triggerAfterConsecutivePoints: optionalNumber(args, "trigger-after"),
};

const scenario = await queueSimulationScenario(request);
console.log(JSON.stringify(scenario, null, 2));

function parseArgs(values: string[]) {
  const result = new Map<string, string>();
  for (let index = 0; index < values.length; index += 1) {
    const item = values[index];
    if (!item?.startsWith("--")) {
      continue;
    }
    const key = item.slice(2);
    const next = values[index + 1];
    if (next && !next.startsWith("--")) {
      result.set(key, next);
      index += 1;
    }
  }
  return result;
}

function required(args: Map<string, string>, key: string) {
  const value = args.get(key);
  if (!value) {
    throw new Error(`--${key} is required`);
  }
  return value;
}

function optionalNumber(args: Map<string, string>, key: string) {
  const value = args.get(key);
  if (!value) {
    return undefined;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`--${key} must be a number`);
  }
  return number;
}
