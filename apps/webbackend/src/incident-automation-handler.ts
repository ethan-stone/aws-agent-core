import "./load-env.js";
import { runIncidentResponderAutomationSweep } from "./services/incident-collaboration-service.js";

export async function handler(): Promise<{ ok: true; result: unknown }> {
  const result = await runIncidentResponderAutomationSweep();
  console.info("[incident-automation] sweep completed", result);
  return {
    ok: true,
    result,
  };
}
