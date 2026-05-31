import "./load-env.js";
import { runDeviceSimulationTick } from "@agent-core/pulseforge-backend";

export async function handler() {
  const result = await runDeviceSimulationTick();
  console.info("[device-simulator] tick completed", result);
  return {
    ok: true,
    result,
  };
}
