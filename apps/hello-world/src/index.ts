import { BedrockAgentCoreApp } from "bedrock-agentcore/runtime";
import { Agent, BedrockModel } from "@strands-agents/sdk";
import { fromIni } from "@aws-sdk/credential-providers";
import { BedrockAgentCoreClient } from "@aws-sdk/client-bedrock-agentcore";
import { MemoryHook } from "./memory-hook.js";
import dotenv from "dotenv";

dotenv.config({
  quiet: true,
});

const bedrockAgentCoreClient = new BedrockAgentCoreClient({
  region: process.env.AWS_REGION,
  credentials: process.env.AWS_PROFILE
    ? fromIni({
        profile: process.env.AWS_PROFILE,
      })
    : undefined,
});

const memoryId = process.env.MEMORY_ID;
if (!memoryId) {
  throw new Error("MEMORY_ID environment variable is required");
}

const memoryHook = new MemoryHook({
  client: bedrockAgentCoreClient,
  memoryId,
});

const bedrockModel = new BedrockModel({
  modelId: "us.anthropic.claude-opus-4-5-20251101-v1:0",
  clientConfig: process.env.AWS_PROFILE
    ? {
        credentials: fromIni({
          profile: process.env.AWS_PROFILE,
        }),
      }
    : undefined,
});

const app = new BedrockAgentCoreApp({
  invocationHandler: {
    process: async (payload, context) => {
      const prompt = (payload as { prompt?: string }).prompt ?? "Hello!";
      console.log(`Session ${context.sessionId} - Received prompt:`, prompt);

      memoryHook.setSessionId(context.sessionId);

      const messages = await memoryHook.loadConversation(context.sessionId);

      console.log(
        `Loaded ${messages.length} messages from memory for session ${context.sessionId}`
      );

      const agent = new Agent({
        model: bedrockModel,
        hooks: [memoryHook],
        messages,
      });

      try {
        return await agent.invoke(prompt);
      } catch (error) {
        console.log(error);
        return;
      }
    },
  },
});

app.run();
