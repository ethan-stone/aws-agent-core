import { BedrockAgentCoreApp } from "bedrock-agentcore/runtime";
import { Agent, BedrockModel } from "@strands-agents/sdk";
import { fromIni } from "@aws-sdk/credential-providers";
import dotenv from "dotenv";

dotenv.config({
  quiet: true,
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

const agent = new Agent({
  model: bedrockModel,
});

const app = new BedrockAgentCoreApp({
  invocationHandler: {
    process: async (payload, context) => {
      const prompt = (payload as { prompt?: string }).prompt ?? "Hello!";
      console.log(`Session ${context.sessionId} - Received prompt:`, prompt);

      try {
        const result = await agent.invoke(prompt);
        return result;
      } catch (error) {
        console.log(error);
        return;
      }
    },
  },
});

app.run();
