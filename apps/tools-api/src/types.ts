import type { ToolAuthContext } from "../../../shared/pulseforge-backend/src/index.js";

export type ToolsApiEnv = {
  Variables: {
    toolAuth: ToolAuthContext | null;
  };
};
