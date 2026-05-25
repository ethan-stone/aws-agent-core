import type {
  AuthenticatedAppUser,
} from "../../../shared/pulseforge-domain/src/index.js";
import type { ToolAuthContext } from "../../../shared/pulseforge-backend/src/index.js";
import type { WebBackendDiagnosticContext } from "./services/webbackend-diagnostics.js";

export type ApiAppEnv = {
  Variables: {
    user: AuthenticatedAppUser | null;
    requestContext: WebBackendDiagnosticContext;
    toolAuth: ToolAuthContext | null;
  };
};
