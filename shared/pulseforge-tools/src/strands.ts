import { tool } from "@strands-agents/sdk";
import { executePulseForgeTool } from "./executor.js";
import type {
  JsonValue,
  PulseForgeToolDefinition,
  PulseForgeToolExecutionContext,
} from "./types.js";

export function createPulseForgeStrandsTools(
  definitions: readonly PulseForgeToolDefinition[],
  context: PulseForgeToolExecutionContext
) {
  return definitions.map((definition) =>
    tool({
      name: definition.name,
      description: definition.description,
      inputSchema: definition.inputSchema,
      callback: async (input): Promise<JsonValue> =>
        executePulseForgeTool(definition, input, context),
    })
  );
}
