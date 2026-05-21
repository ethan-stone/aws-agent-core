import type {
  AuthenticatedAppUser,
} from "../../../shared/pulseforge-domain/src/index.js";
import type { ToolAuthContext } from "../../../shared/pulseforge-backend/src/index.js";

export type ApiAppEnv = {
  Variables: {
    user: AuthenticatedAppUser | null;
    toolAuth: ToolAuthContext | null;
  };
};
