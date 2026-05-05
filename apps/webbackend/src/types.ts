import type {
  AuthenticatedAppUser,
} from "../../../shared/pulseforge-domain/src/index.js";
import type { ToolAuthContext } from "./lib/auth.js";

export type ApiAppEnv = {
  Variables: {
    user: AuthenticatedAppUser | null;
    toolAuth: ToolAuthContext | null;
  };
};
