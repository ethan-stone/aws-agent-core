import { z } from "zod";

const toolAuthModeSchema = z
  .enum(["agentcore-runtime", "local-user-id"])
  .default("agentcore-runtime");

const runtimeEnvSchema = z.object({
  MEMORY_ID: z.string().optional(),
  AWS_PROFILE: z.string().optional(),
  AWS_REGION: z.string().optional(),
  ENABLE_AGENTCORE_LONG_TERM_MEMORY: z.string().optional(),
  AGENTCORE_MEMORY_CONTEXT_TAG: z.string().optional(),
  PULSEFORGE_BACKEND_URL: z.string().url().optional(),
  PULSEFORGE_TOOL_AUTH_MODE: toolAuthModeSchema.optional(),
  PULSEFORGE_TOOLS_PROVIDER_NAME: z
    .string()
    .min(1)
    .default("pulseforge-backend-user-federation"),
  PULSEFORGE_WORKLOAD_NAME: z.string().optional(),
  PULSEFORGE_LOCAL_USER_ID: z.string().optional(),
});

export interface RuntimeConfig {
  memoryId?: string;
  awsProfile?: string;
  awsRegion?: string;
  longTermMemoryEnabled: boolean;
  longTermMemoryContextTag: string;
  tools:
    | {
        enabled: true;
        backendUrl: string;
        authMode: "agentcore-runtime" | "local-user-id";
        providerName: string;
        workloadName?: string;
        localUserId?: string;
      }
    | {
        enabled: false;
        reason: string;
      };
}

export function loadRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env
): RuntimeConfig {
  const parsed = runtimeEnvSchema.parse(env);
  const toolAuthMode = parsed.PULSEFORGE_TOOL_AUTH_MODE ?? "agentcore-runtime";

  if (!parsed.PULSEFORGE_BACKEND_URL) {
    return {
      ...baseConfig(parsed),
      tools: {
        enabled: false,
        reason: "PULSEFORGE_BACKEND_URL is not configured.",
      },
    };
  }

  if (toolAuthMode === "local-user-id" && !parsed.PULSEFORGE_WORKLOAD_NAME) {
    return {
      ...baseConfig(parsed),
      tools: {
        enabled: false,
        reason:
          "PULSEFORGE_WORKLOAD_NAME is required when PULSEFORGE_TOOL_AUTH_MODE=local-user-id.",
      },
    };
  }

  return {
    ...baseConfig(parsed),
    tools: {
      enabled: true,
      backendUrl: parsed.PULSEFORGE_BACKEND_URL,
      authMode: toolAuthMode,
      providerName: parsed.PULSEFORGE_TOOLS_PROVIDER_NAME,
      workloadName: parsed.PULSEFORGE_WORKLOAD_NAME,
      localUserId: parsed.PULSEFORGE_LOCAL_USER_ID,
    },
  };
}

function baseConfig(parsed: z.infer<typeof runtimeEnvSchema>) {
  return {
    memoryId: parsed.MEMORY_ID,
    awsProfile: parsed.AWS_PROFILE,
    awsRegion: parsed.AWS_REGION,
    longTermMemoryEnabled:
      parsed.ENABLE_AGENTCORE_LONG_TERM_MEMORY === "true",
    longTermMemoryContextTag:
      parsed.AGENTCORE_MEMORY_CONTEXT_TAG ?? "agentcore-memory-context",
  };
}
