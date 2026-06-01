import "./load-env.js";
import { runDeviceSimulationTick } from "../../../shared/pulseforge-backend/src/index.js";

export async function handler(): Promise<{ ok: true; result: unknown }> {
  const result = await runDeviceSimulationTick();
  console.info("[device-simulator] tick completed", result);
  return {
    ok: true,
    result,
  };
}
