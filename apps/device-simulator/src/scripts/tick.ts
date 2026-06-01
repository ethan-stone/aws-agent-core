import "../load-env.js";
import { runDeviceSimulationTick } from "../../../../shared/pulseforge-backend/src/index.js";

const result = await runDeviceSimulationTick();
console.log(JSON.stringify(result, null, 2));
