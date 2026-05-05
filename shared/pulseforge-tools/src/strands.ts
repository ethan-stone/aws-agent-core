import { tool } from "@strands-agents/sdk";
import { pulseForgeToolBundles } from "./definitions.js";
import { executePulseForgeTool } from "./executor.js";
import type {
  JsonValue,
  PulseForgeAgentToolBundleName,
  PulseForgeToolExecutionContext,
} from "./types.js";

export function createPulseForgeStrandsTools(
  agentKind: PulseForgeAgentToolBundleName,
  context: PulseForgeToolExecutionContext
) {
  return pulseForgeToolBundles[agentKind].map((definition) =>
    tool({
      name: definition.name,
      description: definition.description,
      inputSchema: definition.inputSchema,
      callback: async (input): Promise<JsonValue> =>
        executePulseForgeTool(definition, input, context),
    })
  );
}
