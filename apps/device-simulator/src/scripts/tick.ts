import "../load-env.js";
import { runDeviceSimulationTick } from "@agent-core/pulseforge-backend";

const result = await runDeviceSimulationTick();
console.log(JSON.stringify(result, null, 2));
